/**
 * Customer brand overrides for a master template.
 *
 * Each file sets `extends` to a path under templates/ (relative to this folder,
 * e.g. `../master.json`). `resolveScene` loads that master, then applies
 * logoUri, palette colors, and contact via text variables.
 *
 * Default HeroImage campaign art lives in catalog/brand-campaign.json (Cover
 * fill on a wide frame), so customer files stay logo / palette / contact / legal only.
 */

import beanThere from "../../templates/customers/bean-there-bean-good.json";
import scoopThere from "../../templates/customers/scoop-there-it-is.json";
import bunIntended from "../../templates/customers/bun-intended.json";

export interface CustomerOverride {
  id: string;
  name: string;
  extends: string;
  description?: string;
  variables: Record<string, string>;
}

export const CUSTOMERS: CustomerOverride[] = [
  beanThere,
  scoopThere,
  bunIntended,
] as CustomerOverride[];

export const CUSTOMERS_BY_ID: Record<string, CustomerOverride> =
  Object.fromEntries(CUSTOMERS.map((customer) => [customer.id, customer]));

/** UI card art for the customer picker (not part of the CE.SDK scene). */
export const CUSTOMER_CARD_PATHS: Record<string, string> = {
  "bean-there-bean-good": "/images/card-bean.png",
  "scoop-there-it-is": "/images/card-scoop.png",
  "bun-intended": "/images/card-bun.png",
};

/**
 * Match a brand name to its customer override.
 */
export function findCustomerByName(name: string): CustomerOverride | undefined {
  return CUSTOMERS.find(
    (customer) => customer.name.toLowerCase() === name.toLowerCase(),
  );
}
