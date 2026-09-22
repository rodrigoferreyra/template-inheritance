/**
 * Load customer overrides from disk (Node entry points).
 *
 * Adding a customer is dropping a JSON file into templates/customers/ — no
 * import to register, no code change, no rebuild. The browser does the same
 * thing with `import.meta.glob` in src/app/customer-catalog.ts.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  assertValidCustomer,
  setCustomers,
  type CustomerOverride,
} from "../../src/customer-registry";

export const CUSTOMERS_DIR = "templates/customers";

export function loadCustomersFromDisk(repoRoot: string): CustomerOverride[] {
  const dir = path.join(repoRoot, CUSTOMERS_DIR);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  return files.map((file) => {
    const full = path.join(dir, file);
    const parsed = JSON.parse(readFileSync(full, "utf8")) as unknown;
    const customer = assertValidCustomer(parsed, `${CUSTOMERS_DIR}/${file}`);
    const stem = path.basename(file, ".json");
    if (customer.id !== stem) {
      throw new Error(
        `${CUSTOMERS_DIR}/${file}: id "${customer.id}" must match the filename stem "${stem}"`,
      );
    }
    return customer;
  });
}

/** Load and register every customer override found on disk. */
export function registerCustomersFromDisk(
  repoRoot: string,
): CustomerOverride[] {
  const list = loadCustomersFromDisk(repoRoot);
  setCustomers(list);
  return list;
}
