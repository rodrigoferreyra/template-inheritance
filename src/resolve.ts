/**
 * Resolve a renderable CE.SDK scene by merging three layers, in precedence order:
 *
 *   1. templates/master.json          — locked layout, brand chrome, compliance footer
 *   2. templates/customers/*.json     — the brand: printed artwork, logo, palette, contact, legal
 *   3. catalog/products.json          — campaign copy plus the print geometry of one SKU
 *
 * Each layer owns a different thing, and the ownership is enforced, not just
 * documented:
 * - The customer supplies the artwork that gets printed. Change it once and
 *   every product for that customer changes. Products cannot supply artwork.
 * - The product supplies `pageSize` (physical print size), `artworkLocation`
 *   (where that print sits on the mockup photo) and campaign copy.
 * - Master-only compliance is re-applied after the customer overlay, so a stray
 *   customer key cannot win.
 *
 * Two outputs come from the same resolved scene:
 * - `mode: "print"`  → the customer artwork alone, at `pageSize × dpi` pixels.
 * - `mode: "mockup"` → the product photo with that artwork applied, and the
 *   brand chrome in a caption band *beneath* the photo — never printed on it.
 */

import type CreativeEngine from "@cesdk/engine";

import masterTemplate from "../templates/master.json";
import productsCatalog from "../catalog/products.json";
import {
  requireCustomer,
  resolveCustomerArtwork,
  type CustomerOverride,
} from "./customer-registry";
import { applyCustomerOverride } from "./customer-override";
import { assertHasProperty } from "./imgly/utils";
import {
  applyDocumentTypeface,
  DEFAULT_TYPEFACE,
  type TypefaceSpec,
} from "./imgly/typeface";

// ─── Master registry (customer.extends → template document) ───────────────────

interface MasterTemplateDoc {
  id?: string;
  sceneString?: string;
  masterOnly?: { complianceText?: string };
  overrideVariables?: string[];
  typeface?: TypefaceSpec;
  exportModes?: {
    print?: { visibleBlocks?: string[]; hiddenBlocks?: string[] };
    marketing?: { artworkBlocks?: string[]; captionBlocks?: string[] };
  };
}

/**
 * Masters keyed by the path customers use in `extends` (relative to
 * templates/customers/). Register additional masters here when you add them.
 */
const MASTER_TEMPLATES_BY_EXTENDS: Record<string, MasterTemplateDoc> = {
  "../master.json": masterTemplate as MasterTemplateDoc,
  "master.json": masterTemplate as MasterTemplateDoc,
  "../templates/master.json": masterTemplate as MasterTemplateDoc,
};

/**
 * Resolve the master document referenced by a customer override's `extends`.
 */
export function resolveMasterTemplate(
  customer: CustomerOverride,
): MasterTemplateDoc {
  const ref = customer.extends?.trim();
  if (!ref) {
    throw new Error(
      `Customer "${customer.id}" is missing required "extends" (master template ref)`,
    );
  }
  const master = MASTER_TEMPLATES_BY_EXTENDS[ref];
  if (!master) {
    const known = Object.keys(MASTER_TEMPLATES_BY_EXTENDS).join(", ");
    throw new Error(
      `Customer "${customer.id}" extends unknown master "${ref}". Known: ${known}`,
    );
  }
  if (!master.sceneString) {
    throw new Error(`Master referenced by "${ref}" is missing sceneString`);
  }
  return master;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Where the print sits on the mockup photo, in that photo's pixels. */
export interface ArtworkLocation {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: string;
  coordinateSpace: string;
}

export interface ProductArea {
  id: string;
  label: string;
  /** Physical print size, in the product's `designUnit`. Drives the print plate. */
  pageSize: { width: number; height: number };
  artworkLocation: ArtworkLocation;
  mockup?: {
    images: Array<{ uri: string; width: number; height: number }>;
  };
}

export interface ProductColor {
  id: string;
  label?: string;
  colorHex: string;
  isDefault?: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  sku: string;
  /** Unit of `areas[].pageSize`. Only `Inch` is supported today. */
  designUnit: string;
  unitPrice?: number;
  /** Product-layer campaign copy (master `{{headline}}` / `{{body}}` / `{{cta}}`) */
  headline?: string;
  body?: string;
  cta?: string;
  sizes?: Array<{ id: string; label: string }>;
  colors: ProductColor[];
  areas: ProductArea[];
}

export type ResolveMode = "print" | "mockup";

/** Default print resolution. Raise to 300 for production plates. */
export const DEFAULT_DPI = 150;

export interface ResolveOptions {
  /** Customer override id, or a full object (e.g. one built from an upload). */
  customer: string | CustomerOverride;
  /** Product id (e.g. `tshirt-01`) or full object */
  product: string | Product;
  /** Print area id; defaults to the product's first area */
  areaId?: string;
  /** Product color id for `{{color}}` mockup tokens; defaults to isDefault / first */
  colorId?: string;
  /** Turn relative `/…` asset paths into absolute URLs (required for CE.SDK fills) */
  resolveAssetPath?: (path: string) => string;
  /** `print` builds the production plate; `mockup` builds the catalog card. */
  mode?: ResolveMode;
  /** Print resolution in DPI (print mode only). Defaults to {@link DEFAULT_DPI}. */
  dpi?: number;
}

export interface ResolvedScene {
  sceneString: string;
  customer: CustomerOverride;
  product: Product;
  area: ProductArea;
  color: ProductColor;
  artworkLocation: ArtworkLocation;
  mode: ResolveMode;
  /** Exported pixel size of the page for this mode. */
  pixelSize: { width: number; height: number };
  /** DPI the print plate was built at (print mode only). */
  dpi?: number;
}

// ─── Catalog helpers ──────────────────────────────────────────────────────────

const PRODUCTS: Product[] = (productsCatalog as { products: Product[] })
  .products;

export function getProducts(): Product[] {
  return PRODUCTS;
}

export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

/** Brand art on a product would break per-customer inheritance — refuse it. */
const BRAND_FIELDS_FORBIDDEN_ON_PRODUCTS = [
  "heroImage",
  "logoUri",
  "artwork",
  "primaryColor",
  "secondaryColor",
] as const;

/**
 * Fail fast if the product catalog carries brand artwork. Without this the
 * catalog silently renders one customer's art into another customer's output.
 */
export function assertProductsCarryNoBrandArt(
  products: Product[] = PRODUCTS,
): void {
  const offenders: string[] = [];
  for (const product of products) {
    for (const field of BRAND_FIELDS_FORBIDDEN_ON_PRODUCTS) {
      if (field in (product as unknown as Record<string, unknown>)) {
        offenders.push(`${product.id}.${field}`);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Brand fields found on the product layer: ${offenders.join(", ")}. ` +
        `Artwork and palette belong to templates/customers/*.json.`,
    );
  }
}

/** Physical print size → exported pixel size at the requested DPI. */
export function printPixelSize(
  product: Product,
  area: ProductArea,
  dpi: number = DEFAULT_DPI,
): { width: number; height: number } {
  if (product.designUnit !== "Inch") {
    throw new Error(
      `Product "${product.id}" uses unsupported designUnit "${product.designUnit}" (expected "Inch")`,
    );
  }
  if (!(dpi > 0)) {
    throw new Error(`DPI must be positive, got ${dpi}`);
  }
  return {
    width: Math.round(area.pageSize.width * dpi),
    height: Math.round(area.pageSize.height * dpi),
  };
}

function resolveCustomerArg(
  customer: string | CustomerOverride,
): CustomerOverride {
  return typeof customer === "string" ? requireCustomer(customer) : customer;
}

function resolveProduct(product: string | Product): Product {
  if (typeof product !== "string") return product;
  const found = getProductById(product);
  if (!found) {
    throw new Error(`Unknown product: ${product}`);
  }
  return found;
}

function resolveArea(product: Product, areaId?: string): ProductArea {
  const area = areaId
    ? product.areas.find((entry) => entry.id === areaId)
    : product.areas[0];
  if (!area) {
    throw new Error(
      `Product ${product.id} has no area${areaId ? ` "${areaId}"` : ""}`,
    );
  }
  return area;
}

function resolveColor(product: Product, colorId?: string): ProductColor {
  if (colorId) {
    const match = product.colors.find((color) => color.id === colorId);
    if (!match) {
      throw new Error(`Product ${product.id} has no color "${colorId}"`);
    }
    return match;
  }
  return product.colors.find((color) => color.isDefault) ?? product.colors[0];
}

function defaultResolveAssetPath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

function applyMockupVariables(
  uri: string,
  variables: Record<string, string>,
): string {
  let resolved = uri;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.split(`{{${key}}}`).join(value);
  }
  return resolved;
}

// ─── Scene helpers ────────────────────────────────────────────────────────────

/** Every named block the master contributes to the marketing composition. */
const DEFAULT_CAPTION_BLOCKS = [
  "BrandLogo",
  "BrandName",
  "BrandPrimarySwatch",
  "BrandSecondarySwatch",
  "BrandPaletteLabel",
  "Headline",
  "Body",
  "CTA",
  "ContactBlock",
  "LegalLine",
  "MasterCompliance",
] as const;

function captionBlockNames(master: MasterTemplateDoc): readonly string[] {
  return master.exportModes?.marketing?.captionBlocks ?? DEFAULT_CAPTION_BLOCKS;
}

function requireBlock(engine: CreativeEngine, name: string): number {
  const [block] = engine.block.findByName(name);
  if (block == null) {
    throw new Error(
      `Master scene is missing required block "${name}" — run \`npm run build:master\``,
    );
  }
  return block;
}

function requirePage(engine: CreativeEngine): number {
  const page = engine.block.findByType("page")[0];
  if (page == null) {
    throw new Error("Resolved scene has no page");
  }
  return page;
}

function setTransparentFill(engine: CreativeEngine, block: number): void {
  if (!engine.block.supportsFill(block)) return;
  const fill = engine.block.getFill(block);
  if (engine.block.getType(fill) !== "//ly.img.ubq/fill/color") return;
  assertHasProperty(engine, fill, "fill/color/value");
  engine.block.setColor(fill, "fill/color/value", { r: 0, g: 0, b: 0, a: 0 });
}

function setWhiteFill(engine: CreativeEngine, block: number): void {
  if (!engine.block.supportsFill(block)) return;
  const fill = engine.block.getFill(block);
  if (engine.block.getType(fill) !== "//ly.img.ubq/fill/color") return;
  assertHasProperty(engine, fill, "fill/color/value");
  engine.block.setColor(fill, "fill/color/value", { r: 1, g: 1, b: 1, a: 1 });
}

/**
 * Production print plate: the customer artwork alone, sized to the product's
 * physical print area at the requested DPI.
 *
 * Nothing else survives — no logo, no copy, no contact block, no compliance
 * footer. Brand chrome belongs on the mockup, not on the ink plate.
 */
function applyPrintLayout(
  engine: CreativeEngine,
  master: MasterTemplateDoc,
  size: { width: number; height: number },
  dpi: number,
): void {
  for (const name of captionBlockNames(master)) {
    const [block] = engine.block.findByName(name);
    if (block != null) engine.block.setVisible(block, false);
  }

  const hero = requireBlock(engine, "HeroImage");
  const page = requirePage(engine);

  engine.block.setWidth(page, size.width);
  engine.block.setHeight(page, size.height);
  engine.block.setPositionX(hero, 0);
  engine.block.setPositionY(hero, 0);
  engine.block.setWidth(hero, size.width);
  engine.block.setHeight(hero, size.height);
  engine.block.resetCrop(hero);
  if (engine.block.supportsContentFillMode(hero)) {
    engine.block.setContentFillMode(hero, "Cover");
  }

  // Transparent plate: the export is the artwork, not the master's paper colour.
  setTransparentFill(engine, page);

  // Record the physical resolution on the scene so exported files carry it.
  const scene = engine.scene.get();
  if (scene != null) {
    const props = engine.block.findAllProperties(scene);
    if (props.includes("scene/dpi")) {
      engine.block.setFloat(scene, "scene/dpi", dpi);
    }
  }
}

interface TextMeasurement {
  width: number;
  fontSize: number;
  align?: "Left" | "Center" | "Right";
}

/**
 * Position a named text block and report the height it takes at that width.
 * Returns 0 when the block is absent so callers can keep stacking.
 */
/**
 * Size a named text block and report the height it needs at that width, without
 * committing to a position yet. Returns 0 when the block is absent.
 */
function measureText(
  engine: CreativeEngine,
  name: string,
  placement: TextMeasurement,
): number {
  const [block] = engine.block.findByName(name);
  if (block == null) return 0;
  engine.block.setWidth(block, placement.width);
  if (engine.block.findAllProperties(block).includes("text/fontSize")) {
    engine.block.setFloat(block, "text/fontSize", placement.fontSize);
  }
  engine.block.setHeightMode(block, "Auto");
  engine.block.setEnum(
    block,
    "text/horizontalAlignment",
    placement.align ?? "Left",
  );
  return engine.block.getHeight(block);
}

/** Move an already-measured block into place. */
function positionAt(
  engine: CreativeEngine,
  name: string,
  x: number,
  y: number,
): void {
  const [block] = engine.block.findByName(name);
  if (block == null) return;
  engine.block.setPositionX(block, x);
  engine.block.setPositionY(block, y);
}

function placeRect(
  engine: CreativeEngine,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const [block] = engine.block.findByName(name);
  if (block == null) return;
  engine.block.setPositionX(block, rect.x);
  engine.block.setPositionY(block, rect.y);
  engine.block.setWidth(block, rect.width);
  engine.block.setHeight(block, rect.height);
  engine.block.resetCrop(block);
}

/**
 * Catalog mockup: the product photo with the customer's artwork applied inside
 * the product's print area, and the brand chrome laid out in a caption band
 * underneath the photo.
 *
 * The split matters. Earlier versions shrank the whole brand sheet — contact
 * block, legal line and compliance footer included — into the print rect, which
 * rendered a phone number onto the garment. Only the artwork goes on the
 * product; everything else is catalog furniture around it.
 */
function applyMockupComposition(
  engine: CreativeEngine,
  area: ProductArea,
  color: ProductColor,
  options: {
    resolveAssetPath: (path: string) => string;
  },
): { width: number; height: number } {
  const photo = area.mockup?.images?.[0];
  if (!photo) {
    throw new Error(`Area "${area.id}" has no mockup image to compose onto`);
  }

  const page = requirePage(engine);
  const art = area.artworkLocation;

  // The canvas is the product photo plus a caption band, in photo pixels.
  const width = photo.width;
  const pad = Math.round(width * 0.055);
  const gap = Math.round(width * 0.032);
  const logoSize = Math.round(width * 0.11);
  const swatch = Math.round(width * 0.05);
  const inner = width - pad * 2;

  // Measure every caption row first so the band is exactly as tall as it needs
  // to be — a fixed ratio either clipped the footer or left a gap.
  const paletteHeight = measureText(engine, "BrandPaletteLabel", {
    width: width * 0.4,
    fontSize: Math.round(width * 0.021),
    align: "Right",
  });
  const brandNameHeight = measureText(engine, "BrandName", {
    width: inner - logoSize - gap - swatch * 2 - gap,
    fontSize: Math.round(width * 0.034),
  });
  const headlineHeight = measureText(engine, "Headline", {
    width: inner,
    fontSize: Math.round(width * 0.046),
  });
  const bodyHeight = measureText(engine, "Body", {
    width: inner,
    fontSize: Math.round(width * 0.026),
  });
  const ctaHeight = measureText(engine, "CTA", {
    width: width * 0.42,
    fontSize: Math.round(width * 0.03),
  });
  const contactHeight = measureText(engine, "ContactBlock", {
    width: width * 0.5 - pad,
    fontSize: Math.round(width * 0.022),
    align: "Right",
  });
  const footerFont = Math.round(width * 0.02);
  const legalHeight = measureText(engine, "LegalLine", {
    width: inner,
    fontSize: footerFont,
  });
  const complianceHeight = measureText(engine, "MasterCompliance", {
    width: inner,
    fontSize: footerFont,
  });

  const headerHeight = Math.max(
    logoSize,
    swatch + Math.round(width * 0.012) + paletteHeight,
  );
  const detailsHeight = Math.max(ctaHeight, contactHeight);
  const captionHeight =
    pad +
    headerHeight +
    gap +
    headlineHeight +
    Math.round(gap * 0.6) +
    bodyHeight +
    gap +
    detailsHeight +
    gap +
    legalHeight +
    Math.round(footerFont * 0.4) +
    complianceHeight +
    pad;

  const height = photo.height + captionHeight;

  engine.block.setName(page, `Mockup-${area.id}`);
  engine.block.setWidth(page, width);
  engine.block.setHeight(page, height);
  engine.block.setPositionX(page, 0);
  engine.block.setPositionY(page, 0);
  engine.block.setClipped(page, true);
  setWhiteFill(engine, page);

  // Artwork sits exactly in the product's print area — and nothing else does.
  const hero = requireBlock(engine, "HeroImage");
  placeRect(engine, "HeroImage", {
    x: art.x,
    y: art.y,
    width: art.width,
    height: art.height,
  });
  if (engine.block.supportsContentFillMode(hero)) {
    engine.block.setContentFillMode(hero, "Cover");
  }

  // Product photo behind everything.
  const backdrop = engine.block.create("graphic");
  engine.block.setName(backdrop, `ProductPhoto-${area.id}`);
  engine.block.setShape(backdrop, engine.block.createShape("rect"));
  const fill = engine.block.createFill("image");
  assertHasProperty(engine, fill, "fill/image/sourceSet");
  engine.block.setSourceSet(fill, "fill/image/sourceSet", [
    {
      uri: options.resolveAssetPath(
        applyMockupVariables(photo.uri, { color: color.id }),
      ),
      width: photo.width,
      height: photo.height,
    },
  ]);
  engine.block.setFill(backdrop, fill);
  engine.block.appendChild(page, backdrop);
  engine.block.setPositionX(backdrop, 0);
  engine.block.setPositionY(backdrop, 0);
  engine.block.setWidth(backdrop, photo.width);
  engine.block.setHeight(backdrop, photo.height);
  if (engine.block.supportsContentFillMode(backdrop)) {
    engine.block.setContentFillMode(backdrop, "Cover");
  }
  engine.block.sendToBack(backdrop);

  // ── Caption band ──────────────────────────────────────────────────────────
  let y = photo.height + pad;

  placeRect(engine, "BrandLogo", {
    x: pad,
    y,
    width: logoSize,
    height: logoSize,
  });
  positionAt(
    engine,
    "BrandName",
    pad + logoSize + gap,
    y + Math.round((logoSize - brandNameHeight) / 2),
  );
  placeRect(engine, "BrandPrimarySwatch", {
    x: width - pad - swatch * 2 - Math.round(gap * 0.3),
    y,
    width: swatch,
    height: swatch,
  });
  placeRect(engine, "BrandSecondarySwatch", {
    x: width - pad - swatch,
    y,
    width: swatch,
    height: swatch,
  });
  positionAt(
    engine,
    "BrandPaletteLabel",
    width - pad - width * 0.4,
    y + swatch + Math.round(width * 0.012),
  );

  y += headerHeight + gap;
  positionAt(engine, "Headline", pad, y);
  y += headlineHeight + Math.round(gap * 0.6);
  positionAt(engine, "Body", pad, y);
  y += bodyHeight + gap;

  // CTA and contact share a row: campaign call to action left, brand right.
  positionAt(
    engine,
    "CTA",
    pad,
    y + Math.round((detailsHeight - ctaHeight) / 2),
  );
  positionAt(engine, "ContactBlock", width * 0.5, y);
  y += detailsHeight + gap;

  positionAt(engine, "LegalLine", pad, y);
  y += legalHeight + Math.round(footerFont * 0.4);
  positionAt(engine, "MasterCompliance", pad, y);

  return { width, height };
}

/**
 * Apply the product layer: campaign copy only.
 *
 * The product layer MUST NOT touch artwork, logo, palette, contact, legal or
 * compliance — those belong to the customer and master layers.
 */
function applyProductLayer(engine: CreativeEngine, product: Product): void {
  if (product.headline) {
    engine.variable.setString("headline", product.headline);
  }
  if (product.body) {
    engine.variable.setString("body", product.body);
  }
  if (product.cta) {
    engine.variable.setString("cta", product.cta);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply master-only fields that must never come from customer overrides.
 * Written after the master scene loads and re-applied after the customer
 * overlay so a stray customer key cannot win.
 */
export function applyMasterOnlyFields(
  engine: CreativeEngine,
  master: MasterTemplateDoc,
): void {
  const complianceText =
    master.masterOnly?.complianceText ??
    "Master compliance: Template terms apply. Not for unauthorized redistribution.";

  engine.variable.setString("masterCompliance", complianceText);
  engine.block.replaceText(
    requireBlock(engine, "MasterCompliance"),
    complianceText,
  );
}

/**
 * Merge master (from customer.extends) + customer + product into the engine and
 * return a serializable scene string plus the geometry of the resulting page.
 */
export async function resolveScene(
  engine: CreativeEngine,
  options: ResolveOptions,
): Promise<ResolvedScene> {
  const customer = resolveCustomerArg(options.customer);
  const product = resolveProduct(options.product);
  const area = resolveArea(product, options.areaId);
  const color = resolveColor(product, options.colorId);
  const resolveAssetPath = options.resolveAssetPath ?? defaultResolveAssetPath;
  const mode: ResolveMode = options.mode ?? "mockup";
  const dpi = options.dpi ?? DEFAULT_DPI;

  // 1. Master named by customer.extends (lowest precedence / base)
  const master = resolveMasterTemplate(customer);
  await engine.scene.loadFromString(master.sceneString!);
  // Without an explicit typeface CE.SDK falls back to metrics that break every
  // measured layout below, so this has to happen before anything is placed.
  applyDocumentTypeface(engine, {
    spec: master.typeface ?? DEFAULT_TYPEFACE,
    resolveAssetPath,
  });
  applyMasterOnlyFields(engine, master);

  // 2. Customer override — brand variables, printed artwork, locked brand assets
  applyCustomerOverride(engine, customer, {
    resolveAssetPath,
    allowedVariables: master.overrideVariables,
  });
  // Re-assert master-only after customer so compliance cannot be overwritten
  applyMasterOnlyFields(engine, master);

  // 3. Product layer — campaign copy
  applyProductLayer(engine, product);

  // 4. Lay the resolved scene out for the requested output
  const pixelSize =
    mode === "print"
      ? (() => {
          const size = printPixelSize(product, area, dpi);
          applyPrintLayout(engine, master, size, dpi);
          return size;
        })()
      : applyMockupComposition(engine, area, color, { resolveAssetPath });

  const sceneString = await engine.scene.saveToString();

  return {
    sceneString,
    customer,
    product,
    area,
    color,
    artworkLocation: area.artworkLocation,
    mode,
    pixelSize,
    ...(mode === "print" ? { dpi } : {}),
  };
}

/**
 * Convenience for browser callers: resolve and export a blob URL for one page.
 */
export async function resolveAndExport(
  engine: CreativeEngine,
  options: ResolveOptions,
  mimeType: "image/png" | "image/jpeg" = "image/png",
): Promise<{ blobUrl: string; resolved: ResolvedScene }> {
  const resolved = await resolveScene(engine, options);
  const page = engine.block.findByType("page")[0] ?? engine.scene.get();
  if (page == null) {
    throw new Error("Nothing to export after resolve");
  }
  const blob = await engine.block.export(page, { mimeType });
  return { blobUrl: URL.createObjectURL(blob), resolved };
}

export { resolveCustomerArtwork };
export type { CustomerOverride };
