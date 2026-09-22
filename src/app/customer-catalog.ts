/**
 * Browser-side customer discovery.
 *
 * Every `templates/customers/*.json` file is picked up at build time by
 * `import.meta.glob` — dropping in a new brand file is enough, there is no
 * import list to maintain. Node does the equivalent with `fs.readdir` in
 * scripts/lib/customers-node.ts.
 */

import {
  assertValidCustomer,
  listCustomers,
  setCustomers,
  type CustomerOverride,
} from "../customer-registry";

const modules = import.meta.glob<{ default: unknown }>(
  "../../templates/customers/*.json",
  { eager: true },
);

setCustomers(
  Object.entries(modules).map(([file, mod]) =>
    assertValidCustomer(mod.default, file),
  ),
);

export const CUSTOMERS: CustomerOverride[] = listCustomers();

/** UI card art for the customer picker (not part of the CE.SDK scene). */
export const CUSTOMER_CARD_PATHS: Record<string, string> = {
  "bean-there-bean-good": "/images/card-bean.png",
  "scoop-there-it-is": "/images/card-scoop.png",
  "bun-intended": "/images/card-bun.png",
};

export type { CustomerOverride };
