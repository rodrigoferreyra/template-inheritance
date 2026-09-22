/**
 * Apply a customer override on top of a loaded master scene.
 *
 * The customer layer owns the brand: the artwork that gets printed, the logo,
 * the palette, the contact block and the legal line. It owns nothing else —
 * campaign copy belongs to the product layer and compliance belongs to the
 * master, and both are rejected here rather than silently accepted.
 */

import type CreativeEngine from "@cesdk/engine";

import {
  resolveCustomerArtwork,
  type CustomerOverride,
} from "./customer-registry";
import { replaceImageByName, setColorFillByName } from "./imgly/utils";

/** Variables the customer layer is allowed to write. */
const DEFAULT_CUSTOMER_VARIABLES = [
  "logoUri",
  "primaryColor",
  "secondaryColor",
  "contactName",
  "contactPhone",
  "contactEmail",
  "contactAddress",
  "legalDisclaimer",
  "brandName",
] as const;

/** Fields that belong to the product or the master, never to a customer file. */
const FORBIDDEN_CUSTOMER_VARIABLES = [
  "heroImage",
  "headline",
  "body",
  "cta",
  "masterCompliance",
  "complianceText",
] as const;

/**
 * 1. Rejects product/master fields that leaked into the customer file.
 * 2. Writes the allowed `variables` via `engine.variable.setString`.
 * 3. Resolves the brand artwork → locked `HeroImage` placeholder (this is what prints).
 * 4. Resolves `logoUri` → locked `BrandLogo` and the palette hexes → locked swatches.
 */
export function applyCustomerOverride(
  engine: CreativeEngine,
  customer: CustomerOverride,
  options: {
    resolveAssetPath?: (path: string) => string;
    allowedVariables?: string[];
  } = {},
): void {
  const resolve = options.resolveAssetPath ?? ((path: string) => path);
  const allowed = new Set(
    options.allowedVariables ?? [...DEFAULT_CUSTOMER_VARIABLES],
  );

  for (const key of FORBIDDEN_CUSTOMER_VARIABLES) {
    if (key in customer.variables) {
      throw new Error(
        `Customer "${customer.id}" must not define product/master field "${key}"`,
      );
    }
  }

  for (const [key, value] of Object.entries(customer.variables)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Customer "${customer.id}" variable "${key}" is not an allowed brand override ` +
          `(allowed: ${[...allowed].join(", ")})`,
      );
    }
    engine.variable.setString(key, value);
  }

  // The printed artwork is brand data: one change here moves every product.
  const artwork = resolveCustomerArtwork(customer);
  replaceImageByName(
    engine,
    "HeroImage",
    {
      uri: resolve(artwork.uri),
      width: artwork.width,
      height: artwork.height,
    },
    { required: true },
  );

  const logoUri = customer.variables.logoUri;
  if (!logoUri) {
    throw new Error(
      `Customer "${customer.id}" is missing required variables.logoUri`,
    );
  }
  // Brand logos in this catalog are 200×200 PNGs (setSourceSet, not URI-only).
  replaceImageByName(
    engine,
    "BrandLogo",
    { uri: resolve(logoUri), width: 200, height: 200 },
    { required: true },
  );

  const primary = customer.variables.primaryColor;
  const secondary = customer.variables.secondaryColor;
  if (!primary) {
    throw new Error(
      `Customer "${customer.id}" is missing required variables.primaryColor`,
    );
  }
  if (!secondary) {
    throw new Error(
      `Customer "${customer.id}" is missing required variables.secondaryColor`,
    );
  }
  setColorFillByName(engine, "BrandPrimarySwatch", primary, { required: true });
  setColorFillByName(engine, "BrandSecondarySwatch", secondary, {
    required: true,
  });
}
