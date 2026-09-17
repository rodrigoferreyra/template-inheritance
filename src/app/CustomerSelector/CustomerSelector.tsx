/**
 * Customer brand picker — options come from templates/customers/*.json
 * via CUSTOMERS (not a hardcoded restaurant list). Card art matches each brand.
 */

import classNames from "classnames";

import {
  CUSTOMERS,
  CUSTOMER_CARD_PATHS,
  type CustomerOverride,
} from "../customer-catalog";
import { resolveAssetPath } from "../resolveAssetPath";

import styles from "./CustomerSelector.module.css";

interface CustomerSelectorProps {
  selectedCustomer: CustomerOverride | null;
  disabled?: boolean;
  onSelect: (customer: CustomerOverride | null) => void;
}

export default function CustomerSelector({
  selectedCustomer,
  disabled = false,
  onSelect,
}: CustomerSelectorProps) {
  const handleClick = (customer: CustomerOverride) => {
    if (selectedCustomer?.id === customer.id) {
      onSelect(null);
    } else {
      onSelect(customer);
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Select customer</h3>
      <div className={styles.buttons}>
        {CUSTOMERS.map((customer) => {
          const secondary = customer.variables.secondaryColor || "#eeeeee";
          const selected = selectedCustomer?.id === customer.id;
          const cardPath = CUSTOMER_CARD_PATHS[customer.id];

          return (
            <button
              key={customer.id}
              type="button"
              className={classNames(styles.button, {
                [styles.selected]: selected,
              })}
              style={{ backgroundColor: secondary }}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={customer.name}
              onClick={() => handleClick(customer)}
            >
              {cardPath ? (
                <img src={resolveAssetPath(cardPath)} alt={customer.name} />
              ) : (
                <span>{customer.name}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
