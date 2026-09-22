/**
 * Shared catalog batch render, used by the CLI and by the dev-server API.
 *
 * License policy (strict):
 * - Always attempt CreativeEngine.init() WITH a license first when one is configured.
 * - If that licensed init fails, throw immediately — do NOT silently retry without a
 *   license — unless `--allow-evaluation-mode` / allowEvaluationMode is explicitly set.
 * - If no license is configured and evaluation mode is not allowed, throw before init.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import CreativeEngine from "@cesdk/node";
import type CreativeEngineBrowser from "@cesdk/engine";

import {
  assertProductsCarryNoBrandArt,
  getProducts,
  printPixelSize,
  resolveScene,
  DEFAULT_DPI,
  type Product,
  type ProductArea,
  type ProductColor,
} from "../../src/resolve";
import {
  resolveCustomerArtwork,
  requireCustomer,
  type CustomerOverride,
} from "../../src/customer-registry";
import { registerCustomersFromDisk } from "./customers-node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

// Customers are discovered from templates/customers/ at import time.
registerCustomersFromDisk(REPO_ROOT);

export function createFileAssetResolver(publicDir: string = PUBLIC_DIR) {
  return (assetPath: string): string => {
    if (
      /^https?:\/\//i.test(assetPath) ||
      assetPath.startsWith("file:") ||
      assetPath.startsWith("data:")
    ) {
      return assetPath;
    }
    const relative = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;
    return pathToFileURL(path.resolve(publicDir, relative)).href;
  };
}

export function loadDotEnv(root: string = REPO_ROOT): void {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function exportPng(
  engine: Awaited<ReturnType<typeof CreativeEngine.init>>,
  blockId: number,
  dest: string,
): Promise<void> {
  const blob = await engine.block.export(blockId, { mimeType: "image/png" });
  writeFileSync(dest, Buffer.from(await blob.arrayBuffer()));
}

function mockupUriOnDisk(
  area: ProductArea,
  color: ProductColor,
  resolveAssetPath: (p: string) => string,
): string | null {
  const image = area.mockup?.images?.[0];
  if (!image) return null;
  const withColor = image.uri.split("{{color}}").join(color.id);
  const fileUrl = resolveAssetPath(withColor);
  if (!fileUrl.startsWith("file:")) return fileUrl;
  return existsSync(fileURLToPath(fileUrl)) ? fileUrl : null;
}

function assertLocalAssetExists(
  label: string,
  assetPath: string,
  resolveAssetPath: (p: string) => string,
): void {
  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith("data:")) {
    return;
  }
  const fileUrl = resolveAssetPath(assetPath);
  if (!fileUrl.startsWith("file:")) return;
  const filePath = fileURLToPath(fileUrl);
  if (!existsSync(filePath)) {
    throw new Error(
      `${label} asset not found on disk: ${assetPath} → ${filePath}`,
    );
  }
}

/**
 * Validate the layering and the brand assets before starting the engine.
 */
export function preflightCatalogRender(
  customer: CustomerOverride,
  products: Product[],
  resolveAssetPath: (p: string) => string,
  dpi: number,
): void {
  if (!customer.extends?.trim()) {
    throw new Error(
      `Customer "${customer.id}" is missing required "extends" (master template ref)`,
    );
  }

  // The catalog must not carry brand art, or customers bleed into each other.
  assertProductsCarryNoBrandArt(products);

  const artwork = resolveCustomerArtwork(customer);
  assertLocalAssetExists(
    `Customer "${customer.id}" artwork`,
    artwork.uri,
    resolveAssetPath,
  );

  const logoUri = customer.variables.logoUri;
  if (!logoUri) {
    throw new Error(`Customer "${customer.id}" is missing variables.logoUri`);
  }
  assertLocalAssetExists(
    `Customer "${customer.id}" logoUri`,
    logoUri,
    resolveAssetPath,
  );

  // Fail before the engine starts if any plate would be absurdly large.
  for (const product of products) {
    for (const area of product.areas) {
      const size = printPixelSize(product, area, dpi);
      if (size.width > 20000 || size.height > 20000) {
        throw new Error(
          `Print plate for ${product.id}/${area.id} would be ${size.width}×${size.height}px at ${dpi} DPI`,
        );
      }
    }
  }
}

export interface CatalogRenderResult {
  productId: string;
  areaId: string;
  colorId: string;
  print?: string;
  printSize?: { width: number; height: number };
  mockup?: string;
  error?: string;
}

export interface CatalogRenderManifest {
  customer: string;
  customerName: string;
  outDir: string;
  colorId: string | null;
  areas: "first" | "all";
  dpi: number;
  productCount: number;
  areaCount: number;
  ok: number;
  failed: number;
  imageCount: number;
  elapsedMs: number;
  evaluationMode?: boolean;
  warning?: string;
  results: CatalogRenderResult[];
}

export interface CatalogRenderOptions {
  /** Registered customer id, or an ad-hoc override (e.g. built from an upload). */
  customer: string | CustomerOverride;
  outDir?: string;
  colorId?: string;
  limit?: number;
  areas?: "first" | "all";
  /** Print resolution for print.png. Defaults to {@link DEFAULT_DPI}. */
  dpi?: number;
  /**
   * When true, if licensed CreativeEngine.init() fails, retry without a license
   * (watermarked evaluation mode). Default false — licensed failure throws.
   */
  allowEvaluationMode?: boolean;
  onProgress?: (message: string) => void;
}

async function renderProductArea(
  engine: Awaited<ReturnType<typeof CreativeEngine.init>>,
  options: {
    customer: CustomerOverride;
    product: Product;
    area: ProductArea;
    colorId?: string;
    dpi: number;
    outDir: string;
    resolveAssetPath: (p: string) => string;
  },
): Promise<CatalogRenderResult> {
  const { customer, product, area, dpi, outDir, resolveAssetPath } = options;
  const color =
    (options.colorId
      ? product.colors.find((c) => c.id === options.colorId)
      : undefined) ??
    product.colors.find((c) => c.isDefault) ??
    product.colors[0];

  const result: CatalogRenderResult = {
    productId: product.id,
    areaId: area.id,
    colorId: color.id,
  };

  const areaDir = path.join(outDir, product.id, area.id);
  mkdirSync(areaDir, { recursive: true });

  try {
    const hasMockup = mockupUriOnDisk(area, color, resolveAssetPath) != null;

    // Production plate: customer artwork only, at the product's physical size.
    const printed = await resolveScene(
      engine as unknown as CreativeEngineBrowser,
      {
        customer,
        product,
        areaId: area.id,
        colorId: color.id,
        resolveAssetPath,
        mode: "print",
        dpi,
      },
    );

    const printPath = path.join(areaDir, "print.png");
    await exportPng(
      engine,
      engine.block.findByType("page")[0] as number,
      printPath,
    );
    result.print = path.relative(REPO_ROOT, printPath);
    result.printSize = printed.pixelSize;

    if (hasMockup) {
      await resolveScene(engine as unknown as CreativeEngineBrowser, {
        customer,
        product,
        areaId: area.id,
        colorId: color.id,
        resolveAssetPath,
        mode: "mockup",
      });
      const mockupPath = path.join(areaDir, "mockup.png");
      await exportPng(
        engine,
        engine.block.findByType("page")[0] as number,
        mockupPath,
      );
      result.mockup = path.relative(REPO_ROOT, mockupPath);
    }

    writeFileSync(
      path.join(areaDir, "resolved.json"),
      JSON.stringify(
        {
          customer: customer.id,
          artwork: resolveCustomerArtwork(customer).uri,
          product: product.id,
          area: area.id,
          color: color.id,
          pageSize: area.pageSize,
          designUnit: product.designUnit,
          dpi,
          printPixelSize: printed.pixelSize,
          artworkLocation: area.artworkLocation,
          mockup: hasMockup,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Initialize headless CE.SDK. Licensed init is attempted first when a key exists.
 * On licensed failure: throw unless allowEvaluationMode, then retry without license.
 */
async function initCatalogEngine(options: {
  baseURL: string;
  license?: string;
  allowEvaluationMode: boolean;
  log: (message: string) => void;
}): Promise<{
  engine: Awaited<ReturnType<typeof CreativeEngine.init>>;
  evaluationMode: boolean;
}> {
  const { baseURL, license, allowEvaluationMode, log } = options;

  if (!license) {
    if (!allowEvaluationMode) {
      throw new Error(
        "CE.SDK license missing (set CESDK_LICENSE or VITE_CESDK_LICENSE). " +
          "Pass --allow-evaluation-mode to explicitly continue without a license.",
      );
    }
    log(
      "[CE.SDK] No license configured; initializing in evaluation mode (--allow-evaluation-mode).",
    );
    const engine = await CreativeEngine.init({ baseURL });
    return { engine, evaluationMode: true };
  }

  // Retry licensed init on transient network failures only — never drop the license
  // unless --allow-evaluation-mode is explicitly set.
  const maxLicenseAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxLicenseAttempts; attempt++) {
    try {
      const engine = await CreativeEngine.init({ license, baseURL });
      return { engine, evaluationMode: false };
    } catch (err) {
      lastErr = err;
      const reason = err instanceof Error ? err.message : String(err);
      const transient = /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(
        reason,
      );
      if (transient && attempt < maxLicenseAttempts) {
        log(
          `[CE.SDK] Licensed init attempt ${attempt}/${maxLicenseAttempts} failed (${reason}); retrying with license…`,
        );
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      break;
    }
  }

  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (!allowEvaluationMode) {
    throw new Error(
      `Licensed CreativeEngine.init() failed: ${reason}. ` +
        `Refusing to silently fall back to evaluation mode. ` +
        `Pass --allow-evaluation-mode to retry without a license.`,
    );
  }
  log(
    `[CE.SDK] Licensed init failed (${reason}); retrying without license (--allow-evaluation-mode).`,
  );
  const engine = await CreativeEngine.init({ baseURL });
  return { engine, evaluationMode: true };
}

export async function runCatalogRender(
  options: CatalogRenderOptions,
): Promise<CatalogRenderManifest> {
  loadDotEnv();

  if (!options.customer) {
    throw new Error("customer is required");
  }
  const customer =
    typeof options.customer === "string"
      ? requireCustomer(options.customer)
      : options.customer;

  const allowEvaluationMode = options.allowEvaluationMode === true;
  const outRoot = path.resolve(
    REPO_ROOT,
    options.outDir ?? path.join("output", "catalog"),
  );
  const colorId = options.colorId;
  const areasMode = options.areas === "first" ? "first" : "all";
  const dpi = options.dpi ?? DEFAULT_DPI;
  const log = options.onProgress ?? (() => undefined);

  const products = getProducts();
  const selected =
    options.limit != null && options.limit > 0
      ? products.slice(0, options.limit)
      : products;

  const license =
    process.env.CESDK_LICENSE || process.env.VITE_CESDK_LICENSE || undefined;

  const resolveAssetPath = createFileAssetResolver(PUBLIC_DIR);
  preflightCatalogRender(customer, selected, resolveAssetPath, dpi);

  const packageAssets = pathToFileURL(
    path.join(REPO_ROOT, "node_modules/@cesdk/node/assets"),
  ).href;
  const baseURL =
    process.env.IMGLY_LOCAL_ASSETS_URL ||
    (packageAssets.endsWith("/") ? packageAssets : `${packageAssets}/`);

  const { engine, evaluationMode } = await initCatalogEngine({
    baseURL,
    license,
    allowEvaluationMode,
    log,
  });

  mkdirSync(outRoot, { recursive: true });
  const customerOut = path.join(outRoot, customer.id);
  if (existsSync(customerOut)) {
    rmSync(customerOut, { recursive: true, force: true });
  }
  mkdirSync(customerOut, { recursive: true });

  log(
    `Rendering ${selected.length}/${products.length} products for "${customer.id}" at ${dpi} DPI → ${path.relative(REPO_ROOT, customerOut)}`,
  );

  const results: CatalogRenderResult[] = [];
  const started = Date.now();

  try {
    for (const product of selected) {
      const areas =
        areasMode === "first" ? product.areas.slice(0, 1) : product.areas;

      for (const area of areas) {
        log(`  ${product.id}/${area.id} …`);
        const entry = await renderProductArea(engine, {
          customer,
          product,
          area,
          colorId,
          dpi,
          outDir: customerOut,
          resolveAssetPath,
        });
        results.push(entry);
        if (entry.error) {
          log(`FAIL ${entry.error}`);
        } else {
          const bits = [
            entry.print &&
              `print ${entry.printSize?.width}×${entry.printSize?.height}`,
            entry.mockup && "mockup",
          ].filter(Boolean);
          log(`ok (${bits.join(" + ")})`);
        }
      }
    }
  } finally {
    engine.dispose();
  }

  const warning = evaluationMode
    ? "CE.SDK ran in evaluation mode; catalog tiles include an IMG.LY watermark."
    : undefined;

  const manifest: CatalogRenderManifest = {
    customer: customer.id,
    customerName: customer.name,
    outDir: path.relative(REPO_ROOT, customerOut),
    colorId: colorId ?? null,
    areas: areasMode,
    dpi,
    productCount: selected.length,
    areaCount: results.length,
    elapsedMs: Date.now() - started,
    ok: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    imageCount: results.reduce(
      (n, r) => n + (r.print ? 1 : 0) + (r.mockup ? 1 : 0),
      0,
    ),
    evaluationMode,
    warning,
    results,
  };

  writeFileSync(
    path.join(customerOut, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return manifest;
}
