/**
 * Resolve a renderable CE.SDK scene by merging, in precedence order:
 *
 *   1. Master template named by customer `extends` (e.g. ../master.json)
 *   2. templates/customers/*.json     — customer text-variable overrides
 *   3. catalog/products.json           — product copy, artworkLocation, optional hero
 *      (+ catalog/brand-campaign.json for default HeroImage campaign art per customer)
 *
 * Later layers win for their own concerns:
 * - Customer wins brand variables / logo / palette / contact
 * - Product wins optional heroImage, campaign copy (headline/body/cta), page size &
 *   mockup framing (does not overwrite customer brand variables)
 * - HeroImage is required: product.heroImage or catalog/brand-campaign.json by customer id
 *   (Cover-cropped campaign art for prints/mockups)
 * - Master-only `masterCompliance` / MasterCompliance is re-applied after
 *   customer overlay and is never read from customer JSON
 * - `includeMockup: false` (print.png) hides all brand/marketing chrome so the
 *   export is a HeroImage-only production plate sized to artworkLocation;
 *   `includeMockup: true` (mockup.png) keeps BrandLogo + campaign copy + contact
 *   for the catalog preview composited on the product photo
 */

import type CreativeEngine from "@cesdk/engine";

import masterTemplate from "../templates/master.json";
import productsCatalog from "../catalog/products.json";
import brandCampaign from "../catalog/brand-campaign.json";
import { CUSTOMERS_BY_ID, type CustomerOverride } from "./app/customer-catalog";
import { applyCustomerOverride } from "./customer-override";
import { assertHasProperty, replaceImageByName } from "./imgly/utils";

// ─── Master registry (customer.extends → template document) ───────────────────

interface MasterTemplateDoc {
  id?: string;
  sceneString?: string;
  masterOnly?: { complianceText?: string };
  overrideVariables?: string[];
  exportModes?: {
    print?: { visibleBlocks?: string[]; hiddenBlocks?: string[] };
    marketing?: { visibleBlocks?: string[]; hiddenBlocks?: string[] };
  };
}

/**
 * Masters keyed by the path customers use in `extends` (relative to
 * templates/customers/). Register additional masters here when you add them.
 */
const MASTER_TEMPLATES_BY_EXTENDS: Record<string, MasterTemplateDoc> = {
  "../master.json": masterTemplate as MasterTemplateDoc,
  // Aliases for convenience / alternate spellings
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

export interface ImageSource {
  uri: string;
  width: number;
  height: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  sku: string;
  designUnit: string;
  unitPrice?: number;
  /** Product-layer image for the master `HeroImage` placeholder (setSourceSet dims) */
  heroImage?: string | ImageSource;
  /** Product-layer campaign copy (master `{{headline}}` / `{{body}}` / `{{cta}}`) */
  headline?: string;
  body?: string;
  cta?: string;
  sizes?: Array<{ id: string; label: string }>;
  colors: ProductColor[];
  areas: ProductArea[];
}

export interface ResolveOptions {
  /** Customer override id (e.g. `bean-there-bean-good`) or full object */
  customer: string | CustomerOverride;
  /** Product id (e.g. `tshirt-01`) or full object */
  product: string | Product;
  /** Print area id; defaults to the product's first area */
  areaId?: string;
  /** Product color id for `{{color}}` mockup tokens; defaults to isDefault / first */
  colorId?: string;
  /** Turn relative `/…` asset paths into absolute URLs (required for CE.SDK fills) */
  resolveAssetPath?: (path: string) => string;
  /** When false, print artwork only (hide marketing blocks; resize page to artworkLocation). When true, keep marketing chrome and add mockup backdrop. */
  includeMockup?: boolean;
}

export interface ResolvedScene {
  sceneString: string;
  customer: CustomerOverride;
  product: Product;
  area: ProductArea;
  color: ProductColor;
  artworkLocation: ArtworkLocation;
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

/** Campaign art map: customer id → public asset path for default HeroImage. */
export function getBrandCampaignImage(customerId: string): string | undefined {
  return (brandCampaign as { byCustomerId?: Record<string, string> })
    .byCustomerId?.[customerId];
}

function normalizeHeroSource(
  hero: string | ImageSource | undefined,
  fallbackUri?: string,
): ImageSource | undefined {
  if (hero && typeof hero === "object") {
    return hero;
  }
  const uri = (typeof hero === "string" && hero) || fallbackUri;
  if (!uri) return undefined;
  // Campaign / string-only fallbacks: landscape campaign art is 1280×720.
  return { uri, width: 1280, height: 720 };
}

/**
 * Resolve HeroImage source for a product (product.heroImage wins over brand-campaign).
 */
export function resolveHeroImageSource(
  customerId: string,
  product: Product,
): ImageSource | undefined {
  return normalizeHeroSource(
    product.heroImage,
    getBrandCampaignImage(customerId),
  );
}

/** @deprecated prefer resolveHeroImageSource — kept for preflight path strings */
export function resolveHeroImageUri(
  customerId: string,
  product: Product,
): string | undefined {
  return resolveHeroImageSource(customerId, product)?.uri;
}

/**
 * Fail fast before engine init if any selected product lacks HeroImage coverage.
 */
export function assertHeroCoverageForCustomer(
  customerId: string,
  products: Product[],
): void {
  const missing = products.filter(
    (product) => !resolveHeroImageSource(customerId, product),
  );
  if (missing.length === 0) return;
  const ids = missing.map((p) => p.id).join(", ");
  throw new Error(
    `No HeroImage for customer "${customerId}" on product(s): ${ids}. ` +
      `Add catalog/brand-campaign.json byCustomerId["${customerId}"] or set product.heroImage.`,
  );
}

function resolveCustomer(
  customer: string | CustomerOverride,
): CustomerOverride {
  if (typeof customer !== "string") return customer;
  const found = CUSTOMERS_BY_ID[customer];
  if (!found) {
    throw new Error(`Unknown customer override: ${customer}`);
  }
  return found;
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

/**
 * Blocks that must never appear on production print artwork.
 * Kept visible for mockup previews (`includeMockup: true`); hidden for print
 * exports (`includeMockup: false`). Print plate is HeroImage only — BrandLogo
 * is brand chrome for mockups, not ink on the garment.
 * Sourced from master.exportModes when present so scene metadata drives visibility.
 */
const DEFAULT_PRINT_HIDDEN_BLOCKS = [
  "BrandLogo",
  "Headline",
  "Body",
  "CTA",
  "ContactBlock",
  "LegalLine",
  "MasterCompliance",
  "BrandName",
  "BrandPaletteLabel",
  "BrandPrimarySwatch",
  "BrandSecondarySwatch",
] as const;

function printHiddenBlocks(master: MasterTemplateDoc): readonly string[] {
  return master.exportModes?.print?.hiddenBlocks ?? DEFAULT_PRINT_HIDDEN_BLOCKS;
}

function setBlocksVisibleByName(
  engine: CreativeEngine,
  names: readonly string[],
  visible: boolean,
  options: { required?: boolean } = {},
): void {
  const required = options.required ?? false;
  const missing: string[] = [];
  for (const name of names) {
    const [block] = engine.block.findByName(name);
    if (block == null) {
      if (required) missing.push(name);
      continue;
    }
    engine.block.setVisible(block, visible);
  }
  if (missing.length > 0) {
    throw new Error(
      `Print layout expected marketing blocks that are missing from the master scene: ${missing.join(", ")}`,
    );
  }
}

/**
 * Production print plate: hide all brand/marketing chrome, then size the page
 * and HeroImage to the product artworkLocation so print.png is artwork-only.
 */
function applyPrintArtworkOnlyLayout(
  engine: CreativeEngine,
  master: MasterTemplateDoc,
  art: ArtworkLocation,
): void {
  setBlocksVisibleByName(engine, printHiddenBlocks(master), false, {
    required: true,
  });

  const [hero] = engine.block.findByName("HeroImage");
  if (hero == null) {
    throw new Error(
      "Print layout requires HeroImage — regenerate templates/master.json",
    );
  }

  const page = engine.block.findByType("page")[0];
  if (page == null) {
    throw new Error("Print layout expected a page");
  }

  // Tight plate: page === artwork rect; hero fills it edge-to-edge
  engine.block.setWidth(page, art.width);
  engine.block.setHeight(page, art.height);
  engine.block.setPositionX(hero, 0);
  engine.block.setPositionY(hero, 0);
  engine.block.setWidth(hero, art.width);
  engine.block.setHeight(hero, art.height);
  engine.block.resetCrop(hero);
  if (engine.block.supportsContentFillMode(hero)) {
    engine.block.setContentFillMode(hero, "Cover");
  }

  // Transparent page so the plate is the image, not cream poster margins
  if (engine.block.supportsFill(page)) {
    const fill = engine.block.getFill(page);
    if (engine.block.getType(fill) === "//ly.img.ubq/fill/color") {
      assertHasProperty(engine, fill, "fill/color/value");
      engine.block.setColor(fill, "fill/color/value", {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      });
    }
  }
}

/**
 * Full master is a ~1080×1350 brand page. Skinny / small artwork rects (caps,
 * mug wraps, tumblers) still show logo + hero + headline + master compliance on
 * mockups, but hide secondary chrome that only reads well on larger rects.
 *
 * Note: print exports (`includeMockup: false`) rebuild a HeroImage-only plate
 * via `applyPrintArtworkOnlyLayout` and never include BrandLogo or copy.
 */
function applyCompactPrintLayoutIfNeeded(
  engine: CreativeEngine,
  art: ArtworkLocation,
): void {
  const aspect = art.width / Math.max(art.height, 1);
  // Tumbler wraps (~320×520) and other skinny rects — not square tee prints (~360×360)
  const isCompact = art.width <= 320 || aspect < 0.7;
  if (!isCompact) return;

  // Soft hide: optional chrome for skinny mockup rects.
  setBlocksVisibleByName(
    engine,
    [
      "BrandPaletteLabel",
      "BrandPrimarySwatch",
      "BrandSecondarySwatch",
      "ContactBlock",
      "Body",
      "CTA",
    ],
    false,
    { required: false },
  );

  // Bump remaining text so compact mockups stay legible (caps, mug wraps).
  const textBoosts: Array<{ name: string; fontSize: number }> = [
    { name: "BrandName", fontSize: 28 },
    { name: "Headline", fontSize: 36 },
    { name: "MasterCompliance", fontSize: 16 },
    { name: "LegalLine", fontSize: 16 },
  ];
  for (const { name, fontSize } of textBoosts) {
    const [block] = engine.block.findByName(name);
    if (block == null) continue;
    if (!engine.block.findAllProperties(block).includes("text/fontSize")) {
      continue;
    }
    engine.block.setFloat(block, "text/fontSize", fontSize);
  }
}

/**
 * Apply product-layer fields: hero image, campaign copy, artworkLocation, and
 * optional mockup framing (same layout math as ProductBackdrop / printableAreaPx).
 *
 * Hero image precedence:
 *   1. product.heroImage (setSourceSet {uri,width,height} or string URI)
 *   2. catalog/brand-campaign.json entry for this customer (campaign art default)
 *
 * Product layer MUST NOT touch logo / palette / contact / legal / masterCompliance.
 */
function applyProductLayer(
  engine: CreativeEngine,
  product: Product,
  area: ProductArea,
  color: ProductColor,
  options: {
    resolveAssetPath: (path: string) => string;
    includeMockup: boolean;
    brandCampaignImage?: string;
    master: MasterTemplateDoc;
  },
): void {
  const hero = normalizeHeroSource(
    product.heroImage,
    options.brandCampaignImage,
  );
  if (!hero) {
    throw new Error(
      `No HeroImage for product "${product.id}": set product.heroImage or catalog/brand-campaign.json byCustomerId entry`,
    );
  }
  replaceImageByName(
    engine,
    "HeroImage",
    {
      uri: options.resolveAssetPath(hero.uri),
      width: hero.width,
      height: hero.height,
    },
    { required: true },
  );
  if (product.headline) {
    engine.variable.setString("headline", product.headline);
  }
  if (product.body) {
    engine.variable.setString("body", product.body);
  }
  if (product.cta) {
    engine.variable.setString("cta", product.cta);
  }

  const page = engine.block.findByType("page")[0];
  if (page == null) {
    throw new Error("Resolved scene has no page");
  }

  const art = area.artworkLocation;

  // Product layer wins layout: shrink/expand master content to the print rect
  engine.block.resizeContentAware([page], art.width, art.height);
  engine.block.setName(page, `Artwork-${area.id}`);
  engine.block.setClipped(page, true);
  engine.block.setScopeEnabled(page, "editor/select", false);

  // Skinny / small print areas can't carry the full brand poster — keep logo,
  // hero, brand/headline, and the master compliance footer; hide secondary UI.
  // (Mockup path only; print path rebuilds a HeroImage-only plate next.)
  applyCompactPrintLayoutIfNeeded(engine, art);

  // Print export: HeroImage-only production plate at artworkLocation size.
  // Mockup export keeps the full composition (plus compact-layout reductions above).
  if (!options.includeMockup) {
    applyPrintArtworkOnlyLayout(engine, options.master, art);
  }

  // Transparent page only when a mockup backdrop will show around the print rect
  if (options.includeMockup && engine.block.supportsFill(page)) {
    const fill = engine.block.getFill(page);
    if (engine.block.getType(fill) === "//ly.img.ubq/fill/color") {
      assertHasProperty(engine, fill, "fill/color/value");
      engine.block.setColor(fill, "fill/color/value", {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      });
    }
  }

  if (!options.includeMockup) return;

  const image = area.mockup?.images?.[0];
  if (!image) return;

  const scene = engine.scene.get();
  if (scene == null) return;

  const uri = options.resolveAssetPath(
    applyMockupVariables(image.uri, { color: color.id }),
  );

  const backdrop = engine.block.create("graphic");
  engine.block.setName(backdrop, `ProductMockup-${area.id}`);
  engine.block.setShape(backdrop, engine.block.createShape("rect"));
  const fill = engine.block.createFill("image");
  engine.block.setFill(backdrop, fill);
  assertHasProperty(engine, fill, "fill/image/sourceSet");
  engine.block.setSourceSet(fill, "fill/image/sourceSet", [
    { uri, width: image.width, height: image.height },
  ]);
  // contentFill/mode on the graphic block, not the fill
  if (engine.block.supportsContentFillMode(backdrop)) {
    engine.block.setContentFillMode(backdrop, "Cover");
  }

  const pageWidth = engine.block.getWidth(page);
  const scale = pageWidth / art.width;
  engine.block.setWidth(backdrop, image.width * scale);
  engine.block.setHeight(backdrop, image.height * scale);
  engine.block.setPositionX(backdrop, -art.x * scale);
  engine.block.setPositionY(backdrop, -art.y * scale);
  engine.block.resetCrop(backdrop);

  for (const scope of engine.editor.findAllScopes()) {
    engine.block.setScopeEnabled(backdrop, scope, false);
  }

  // Mockup behind the page (scene children: backdrop @0, page on top)
  engine.block.insertChild(scene, backdrop, 0);
  engine.block.setPositionX(page, 0);
  engine.block.setPositionY(page, 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply master-only fields that must never come from customer overrides.
 * Written after the master scene loads and re-applied after customer overlay
 * so a stray customer key cannot win.
 */
export function applyMasterOnlyFields(
  engine: CreativeEngine,
  master: MasterTemplateDoc,
): void {
  const complianceText =
    master.masterOnly?.complianceText ??
    "Master compliance: Template terms apply. Not for unauthorized redistribution.";

  // Keep a variable for tooling/docs, and write the concrete string onto the
  // locked block for mockup/catalog previews. Print exports hide this block via
  // applyPrintArtworkOnlyLayout (marketing-only chrome).
  engine.variable.setString("masterCompliance", complianceText);

  const [block] = engine.block.findByName("MasterCompliance");
  if (block == null) {
    throw new Error(
      "Master scene is missing locked MasterCompliance block — regenerate templates/master.json",
    );
  }
  engine.block.replaceText(block, complianceText);
}

/**
 * Merge master (from customer.extends) + customer + product into the engine
 * and return a serializable scene string.
 */
export async function resolveScene(
  engine: CreativeEngine,
  options: ResolveOptions,
): Promise<ResolvedScene> {
  const customer = resolveCustomer(options.customer);
  const product = resolveProduct(options.product);
  const area = resolveArea(product, options.areaId);
  const color = resolveColor(product, options.colorId);
  const resolveAssetPath = options.resolveAssetPath ?? defaultResolveAssetPath;
  const includeMockup = options.includeMockup !== false;

  // 1. Master named by customer.extends (lowest precedence / base)
  const master = resolveMasterTemplate(customer);
  await engine.scene.loadFromString(master.sceneString!);
  applyMasterOnlyFields(engine, master);

  // 2. Customer override (brand variables + locked brand assets only)
  applyCustomerOverride(engine, customer, {
    resolveAssetPath,
    allowedVariables: master.overrideVariables,
  });
  // Re-assert master-only after customer so compliance cannot be overwritten
  applyMasterOnlyFields(engine, master);

  // 3. Product layer (copy, layout, mockup; hero from product or brand-campaign map)
  const brandCampaignImage = getBrandCampaignImage(customer.id);
  applyProductLayer(engine, product, area, color, {
    resolveAssetPath,
    includeMockup,
    brandCampaignImage,
    master,
  });

  const sceneString = await engine.scene.saveToString();

  return {
    sceneString,
    customer,
    product,
    area,
    color,
    artworkLocation: area.artworkLocation,
  };
}

/**
 * Convenience: resolve and export a JPEG/PNG blob URL.
 */
export async function resolveAndExport(
  engine: CreativeEngine,
  options: ResolveOptions,
  mimeType: "image/png" | "image/jpeg" = "image/jpeg",
): Promise<{ blobUrl: string; resolved: ResolvedScene }> {
  const resolved = await resolveScene(engine, options);
  const pages = engine.block.findByType("page");
  const target = pages[0] ?? engine.scene.get();
  if (target == null) {
    throw new Error("Nothing to export after resolve");
  }
  const blob = await engine.block.export(target, { mimeType });
  return { blobUrl: URL.createObjectURL(blob), resolved };
}
