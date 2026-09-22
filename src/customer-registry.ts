/**
 * Customer overrides, discovered at runtime rather than hardcoded.
 *
 * Both entry points fill this registry from `templates/customers/*.json` without
 * anyone editing TypeScript:
 * - browser: `src/app/customer-catalog.ts` via `import.meta.glob`
 * - node:    `scripts/lib/customers-node.ts` via `fs.readdir`
 *
 * Ad-hoc customers (for example one created from an uploaded logo) never enter
 * the registry — they are passed to `resolveScene` as objects.
 */

/** Brand artwork that gets printed on the product. Defaults to the brand logo. */
export interface CustomerArtwork {
  uri: string;
  width: number;
  height: number;
}

export interface CustomerOverride {
  id: string;
  name: string;
  /** Path of the master template this customer inherits from, e.g. `../master.json`. */
  extends: string;
  description?: string;
  /** Printed artwork for this brand. Omit to print the logo itself. */
  artwork?: CustomerArtwork;
  variables: Record<string, string>;
}

let customers: CustomerOverride[] = [];

/**
 * Validate a customer document loaded from disk or uploaded at runtime.
 */
export function assertValidCustomer(
  candidate: unknown,
  source: string,
): CustomerOverride {
  const customer = candidate as Partial<CustomerOverride>;
  if (!customer || typeof customer !== "object") {
    throw new Error(`${source}: customer override must be an object`);
  }
  for (const key of ["id", "name", "extends"] as const) {
    if (typeof customer[key] !== "string" || !customer[key]?.trim()) {
      throw new Error(`${source}: customer override is missing "${key}"`);
    }
  }
  if (!customer.variables || typeof customer.variables !== "object") {
    throw new Error(`${source}: customer override is missing "variables"`);
  }
  if (customer.artwork != null) {
    const art = customer.artwork;
    if (
      typeof art.uri !== "string" ||
      !Number.isFinite(art.width) ||
      !Number.isFinite(art.height) ||
      art.width <= 0 ||
      art.height <= 0
    ) {
      throw new Error(
        `${source}: "artwork" needs uri plus positive width/height`,
      );
    }
  }
  return customer as CustomerOverride;
}

/** Replace the registry contents (called once per entry point at startup). */
export function setCustomers(list: CustomerOverride[]): void {
  const seen = new Set<string>();
  for (const customer of list) {
    if (seen.has(customer.id)) {
      throw new Error(`Duplicate customer id: ${customer.id}`);
    }
    seen.add(customer.id);
  }
  customers = [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function listCustomers(): CustomerOverride[] {
  return customers;
}

export function getCustomerById(id: string): CustomerOverride | undefined {
  return customers.find((customer) => customer.id === id);
}

export function requireCustomer(id: string): CustomerOverride {
  const found = getCustomerById(id);
  if (!found) {
    const known = customers.map((c) => c.id).join(", ") || "(registry empty)";
    throw new Error(`Unknown customer override "${id}". Known: ${known}`);
  }
  return found;
}

/**
 * The artwork that gets printed for this customer.
 *
 * This is the whole point of the inheritance chain: it comes from the brand
 * layer, so one upload changes every product. Products never supply artwork.
 */
export function resolveCustomerArtwork(
  customer: CustomerOverride,
): CustomerArtwork {
  if (customer.artwork) return customer.artwork;
  const logoUri = customer.variables.logoUri;
  if (!logoUri) {
    throw new Error(
      `Customer "${customer.id}" has neither "artwork" nor "variables.logoUri" to print`,
    );
  }
  return { uri: logoUri, width: 200, height: 200 };
}
