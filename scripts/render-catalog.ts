/**
 * Headless catalog render CLI.
 *
 *   npm run render:catalog -- --customer bean-there-bean-good
 *   npm run render:catalog -- --customer bean-there-bean-good --allow-evaluation-mode
 */

import {
  runCatalogRender,
  type CatalogRenderOptions,
} from "./lib/render-catalog-core";

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
  --allow-evaluation-mode     If licensed init fails (or no license), retry without a license.
                              Without this flag, licensed init failure throws immediately.

Customers: bean-there-bean-good | scoop-there-it-is | bun-intended
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const customerId =
    typeof args.customer === "string" ? args.customer : undefined;
  if (!customerId) usage("Missing required --customer <id>");

  const options: CatalogRenderOptions = {
    customerId,
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
    `\nDone: ${manifest.ok} ok, ${manifest.failed} failed (${manifest.elapsedMs}ms)`,
  );
  console.log(`Manifest: ${manifest.outDir}/manifest.json`);
  if (manifest.warning) {
    console.warn(`Warning: ${manifest.warning}`);
  }
  if (manifest.evaluationMode) {
    console.log("evaluationMode: true");
  } else {
    console.log("evaluationMode: false");
  }

  if (manifest.failed > 0 || manifest.evaluationMode) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
