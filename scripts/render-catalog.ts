/**
 * Headless catalog render CLI.
 *
 *   npm run render:catalog -- --customer bean-there-bean-good
 *   npm run render:catalog -- --customer bean-there-bean-good --dpi 300
 */

import path from "node:path";

import {
  runCatalogRender,
  REPO_ROOT,
  type CatalogRenderOptions,
} from "./lib/render-catalog-core";
import { loadCustomersFromDisk } from "./lib/customers-node";
import { DEFAULT_DPI } from "../src/resolve";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function knownCustomers(): string {
  return loadCustomersFromDisk(REPO_ROOT)
    .map((customer) => customer.id)
    .join(" | ");
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(`
Usage:
  npm run render:catalog -- --customer <id> [options]

Options:
  --out <dir>                 Output root (default: output/catalog)
  --color <id>                Product color id for mockup {{color}} tokens
  --limit <n>                 Only the first n products
  --areas all|first           Print areas to render (default: all)
  --dpi <n>                   Print resolution for print.png (default: ${DEFAULT_DPI})
  --allow-evaluation-mode     If licensed init fails (or no license), retry without a license.
                              Without this flag, licensed init failure throws immediately.

Customers (${path.join("templates", "customers")}/*.json): ${knownCustomers()}
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const customerId =
    typeof args.customer === "string" ? args.customer : undefined;
  if (!customerId) usage("Missing required --customer <id>");

  const dpi =
    typeof args.dpi === "string" ? Number.parseInt(args.dpi, 10) : undefined;
  if (dpi != null && (!Number.isFinite(dpi) || dpi <= 0)) {
    usage(`--dpi must be a positive number, got "${args.dpi}"`);
  }

  const options: CatalogRenderOptions = {
    customer: customerId,
    outDir: typeof args.out === "string" ? args.out : undefined,
    colorId: typeof args.color === "string" ? args.color : undefined,
    limit:
      typeof args.limit === "string"
        ? Number.parseInt(args.limit, 10)
        : undefined,
    areas:
      typeof args.areas === "string" && args.areas === "first"
        ? "first"
        : "all",
    dpi,
    allowEvaluationMode: args["allow-evaluation-mode"] === true,
    onProgress: (message) => {
      if (message.endsWith("…")) {
        process.stdout.write(message + " ");
      } else {
        console.log(message);
      }
    },
  };

  const manifest = await runCatalogRender(options);

  console.log(
    `\nDone: ${manifest.ok} ok, ${manifest.failed} failed (${manifest.elapsedMs}ms, ${manifest.dpi} DPI)`,
  );
  console.log(`Manifest: ${manifest.outDir}/manifest.json`);
  if (manifest.warning) {
    console.warn(`Warning: ${manifest.warning}`);
  }
  console.log(`evaluationMode: ${manifest.evaluationMode === true}`);

  // A watermarked run is still a successful run — only failures are errors.
  if (manifest.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
