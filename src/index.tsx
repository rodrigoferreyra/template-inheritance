/**
 * Swag catalog demo — customer select + Render catalog (Node batch via Vite API).
 * Browser CE.SDK is not required for this shell; licensed export runs in
 * scripts/lib/render-catalog-core.ts.
 */

import { createRoot } from "react-dom/client";

import App from "./app/App";

async function main(): Promise<void> {
  const container = document.getElementById("root");
  if (container == null) {
    throw new Error("Root container not found");
  }

  const root = createRoot(container);
  root.render(<App />);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to initialize application:", error);
});
