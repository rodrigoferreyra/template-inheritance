/**
 * Shared catalog batch render used by the CLI.
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
  assertHeroCoverageForCustomer,
  getBrandCampaignImage,
  getProducts,
  resolveHeroImageSource,
  resolveScene,
  type Product,
  type ProductArea,
  type ProductColor,
} from "../../src/resolve";
import { CUSTOMERS_BY_ID } from "../../src/app/customer-catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

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
  const filePath = fileURLToPath(fileUrl);
  return existsSync(filePath) ? fileUrl : null;
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
 * Validate customer + hero/logo assets before starting the engine.
 */
export function preflightCatalogRender(
  customerId: string,
  products: Product[],
  resolveAssetPath: (p: string) => string,
): void {
  const customer = CUSTOMERS_BY_ID[customerId];
  if (!customer) {
    throw new Error(`Unknown customer override: ${customerId}`);
  }
  if (!customer.extends?.trim()) {
    throw new Error(
      `Customer "${customerId}" is missing required "extends" (master template ref)`,
    );
  }

  assertHeroCoverageForCustomer(customerId, products);

  const logoUri = customer.variables.logoUri;
  if (!logoUri) {
    throw new Error(`Customer "${customerId}" is missing variables.logoUri`);
  }
  assertLocalAssetExists(
    `Customer "${customerId}" logoUri`,
    logoUri,
    resolveAssetPath,
  );

  const campaign = getBrandCampaignImage(customerId);
  if (campaign) {
    assertLocalAssetExists(
      `brand-campaign for "${customerId}"`,
      campaign,
      resolveAssetPath,
    );
  }

  for (const product of products) {
    const hero = resolveHeroImageSource(customerId, product);
    if (hero) {
      assertLocalAssetExists(
        `product "${product.id}" heroImage`,
        hero.uri,
        resolveAssetPath,
      );
    }
  }
}

export interface CatalogRenderResult {
  productId: string;
  areaId: string;
  colorId: string;
  print?: string;
  mockup?: string;
  error?: string;
}

export interface CatalogRenderManifest {
  customer: string;
  outDir: string;
  colorId: string | null;
  areas: "first" | "all";
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
  customerId: string;
  outDir?: string;
  colorId?: string;
  limit?: number;
  areas?: "first" | "all";
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
    customerId: string;
    product: Product;
    area: ProductArea;
    colorId?: string;
    outDir: string;
    resolveAssetPath: (p: string) => string;
  },
): Promise<CatalogRenderResult> {
  const { customerId, product, area, outDir, resolveAssetPath } = options;
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

    const resolved = await resolveScene(
      engine as unknown as CreativeEngineBrowser,
      {
        customer: customerId,
        product,
        areaId: area.id,
        colorId: color.id,
        resolveAssetPath,
        includeMockup: false,
      },
    );

    const page = engine.block.findByType("page")[0];
    if (page == null) {
      throw new Error("No page after resolve");
    }

    const printPath = path.join(areaDir, "print.png");
    await exportPng(engine, page, printPath);
    result.print = path.relative(REPO_ROOT, printPath);

    if (hasMockup) {
      await resolveScene(engine as unknown as CreativeEngineBrowser, {
        customer: customerId,
        product,
        areaId: area.id,
        colorId: color.id,
        resolveAssetPath,
        includeMockup: true,
      });
      const scene = engine.scene.get();
      if (scene != null) {
        const mockupPath = path.join(areaDir, "mockup.png");
        await exportPng(engine, scene, mockupPath);
        result.mockup = path.relative(REPO_ROOT, mockupPath);
      }
    }

    writeFileSync(
      path.join(areaDir, "resolved.json"),
      JSON.stringify(
        {
          customer: resolved.customer.id,
          product: resolved.product.id,
          area: resolved.area.id,
          color: resolved.color.id,
          artworkLocation: resolved.artworkLocation,
          includeMockup: hasMockup,
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

  const customerId = options.customerId;
  if (!customerId) {
    throw new Error("customerId is required");
  }

  const allowEvaluationMode = options.allowEvaluationMode === true;
  const outRoot = path.resolve(
    REPO_ROOT,
    options.outDir ?? path.join("output", "catalog"),
  );
  const colorId = options.colorId;
  const areasMode = options.areas === "first" ? "first" : "all";
  const log = options.onProgress ?? (() => undefined);

  const products = getProducts();
  const selected =
    options.limit != null && options.limit > 0
      ? products.slice(0, options.limit)
      : products;

  const license =
    process.env.CESDK_LICENSE || process.env.VITE_CESDK_LICENSE || undefined;

  const resolveAssetPath = createFileAssetResolver(PUBLIC_DIR);
  preflightCatalogRender(customerId, selected, resolveAssetPath);

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
  const customerOut = path.join(outRoot, customerId);
  if (existsSync(customerOut)) {
    rmSync(customerOut, { recursive: true, force: true });
  }
  mkdirSync(customerOut, { recursive: true });

  log(
    `Rendering ${selected.length}/${products.length} products for "${customerId}" → ${path.relative(REPO_ROOT, customerOut)}`,
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
          customerId,
          product,
          area,
          colorId,
          outDir: customerOut,
          resolveAssetPath,
        });
        results.push(entry);
        if (entry.error) {
          log(`FAIL ${entry.error}`);
        } else {
          const bits = [
            entry.print && "print",
            entry.mockup && "mockup",
          ].filter(Boolean);
          log(`ok (${bits.join("+")})`);
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
    customer: customerId,
    outDir: path.relative(REPO_ROOT, customerOut),
    colorId: colorId ?? null,
    areas: areasMode,
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
