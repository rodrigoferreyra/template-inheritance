/**
 * Smoke: resolve + export one customer × one product (print + mockup when present).
 *
 *   npm run test:unit
 *
 * Requires a valid CESDK_LICENSE / VITE_CESDK_LICENSE in .env (fail-closed by default).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { REPO_ROOT, runCatalogRender } from "./lib/render-catalog-core.ts";

async function main(): Promise<void> {
  const customerId = "bean-there-bean-good";
  const outDir = path.join("output", "smoke-catalog");

  const manifest = await runCatalogRender({
    customer: customerId,
    outDir,
    limit: 1,
    areas: "first",
    // Prefer licensed; allow evaluation only if SMOKE_ALLOW_EVALUATION=1
    allowEvaluationMode: process.env.SMOKE_ALLOW_EVALUATION === "1",
    onProgress: (message) => console.log(message),
  });

  if (manifest.failed > 0) {
    const errors = manifest.results
      .filter((r) => r.error)
      .map((r) => `${r.productId}/${r.areaId}: ${r.error}`)
      .join("\n");
    throw new Error(`Smoke render had failures:\n${errors}`);
  }

  if (manifest.ok < 1 || manifest.imageCount < 1) {
    throw new Error(
      `Expected at least one successful area with images; got ok=${manifest.ok} imageCount=${manifest.imageCount}`,
    );
  }

  const entry = manifest.results[0];
  if (!entry?.print) {
    throw new Error("Smoke expected a print.png path on the first result");
  }

  const printAbs = path.join(REPO_ROOT, entry.print);
  if (!existsSync(printAbs)) {
    throw new Error(`Missing print file: ${printAbs}`);
  }

  const resolvedJson = path.join(
    REPO_ROOT,
    path.dirname(entry.print),
    "resolved.json",
  );
  if (!existsSync(resolvedJson)) {
    throw new Error(`Missing resolved.json: ${resolvedJson}`);
  }

  const meta = JSON.parse(readFileSync(resolvedJson, "utf8")) as {
    printPixelSize?: { width: number; height: number };
    artworkLocation?: { width: number; height: number };
    includeMockup?: boolean;
  };
  if (
    !meta.printPixelSize ||
    !(meta.printPixelSize.width > 0) ||
    !(meta.printPixelSize.height > 0)
  ) {
    throw new Error("resolved.json missing positive printPixelSize");
  }
  if (
    !meta.artworkLocation ||
    !(meta.artworkLocation.width > 0) ||
    !(meta.artworkLocation.height > 0)
  ) {
    throw new Error("resolved.json missing positive artworkLocation size");
  }

  // Print plate is the physical page at the requested DPI (HeroImage-only
  // production export). artworkLocation lives in mockup pixel space and no
  // longer describes the plate.
  const printMeta = await sharp(printAbs).metadata();
  if (
    printMeta.width !== meta.printPixelSize.width ||
    printMeta.height !== meta.printPixelSize.height
  ) {
    throw new Error(
      `print.png size ${printMeta.width}x${printMeta.height} !== printPixelSize ${meta.printPixelSize.width}x${meta.printPixelSize.height}`,
    );
  }

  if (entry.mockup) {
    const mockupAbs = path.join(REPO_ROOT, entry.mockup);
    if (!existsSync(mockupAbs)) {
      throw new Error(`Missing mockup file: ${mockupAbs}`);
    }
  }

  if (manifest.evaluationMode && process.env.SMOKE_ALLOW_EVALUATION !== "1") {
    throw new Error("Smoke ran in evaluationMode unexpectedly");
  }

  console.log(
    `Smoke OK: ${entry.productId}/${entry.areaId} ` +
      `print ${printMeta.width}x${printMeta.height}` +
      `${entry.mockup ? "+mockup" : ""}` +
      `${manifest.evaluationMode ? ", evaluationMode" : ", licensed"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
