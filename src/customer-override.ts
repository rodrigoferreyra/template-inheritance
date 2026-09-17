/**
 * Apply a customer override on top of a loaded master scene.
 *
 * Used by resolveScene (catalog inheritance). Hero / product imagery is applied
 * from the product catalog layer, not here.
 */

import type CreativeEngine from "@cesdk/engine";

import type { CustomerOverride } from "./app/customer-catalog";
import { replaceImageByName, setColorFillByName } from "./imgly/utils";

/** Variables the customer layer is allowed to write (never hero/campaign/compliance). */
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

const FORBIDDEN_CUSTOMER_VARIABLES = [
  "heroImage",
  "headline",
  "body",
  "cta",
  "masterCompliance",
  "complianceText",
] as const;

/**
 * 1. Writes allowed `variables` via `engine.variable.setString` (contact block,
 *    legal, palette hex, logoUri, brandName) — never hero/campaign/compliance.
 * 2. Resolves `logoUri` → locked `BrandLogo` image fill via setSourceSet (required).
 * 3. Resolves `primaryColor` / `secondaryColor` → locked palette swatches (required).
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
