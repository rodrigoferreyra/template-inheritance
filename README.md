# Template Inheritance Catalog
A customizable merch catalog that merges a locked **master** design, per-**customer** brand overrides, and per-**product** catalog data into personalized **print** plates and **mockup** previews. This page explains the three-layer model, how to run the Vite demo, batch-render the catalog, and extend customers or products.

Built with [CreativeEditor SDK (CE.SDK)](https://img.ly/creative-sdk) by [IMG.LY](https://img.ly).

## Key features

- **Three-layer merge:** Master, customer, and product stay separated so brand rules and SKU data do not overwrite each other.
- **Functional `extends`:** The customer `extends` value selects the master template that `resolveMasterTemplate` loads. It is not metadata alone.
- **Print vs mockup split:** Print is ink-ready artwork. Mockup is the sales/preview composition on a product backdrop.
- **Fail-closed licensing:** Headless render throws if a license is missing or rejected, unless you explicitly allow evaluation mode.
- **Demo UI:** The Vite app lets you select a customer, run the same batch path as the CLI, and browse result tiles.

## Main benefits

- One master change (such as `masterOnly.complianceText`) can propagate to every customer mockup on the next render without editing customer files.
- One customer logo change affects only that customer’s outputs.
- Product copy and artwork placement scale across the catalog without polluting brand overrides.

## How it works

Template inheritance keeps brand control and product scale in separate layers. The **master** owns locked layout and a master-only compliance footer. Each **customer** file overrides only brand fields (logo, palette, contact, legal) and points at the master through an `extends` field. Each **product** supplies campaign copy, a `heroImage`, and an `artworkLocation`.

At resolve time, `resolveScene` in `src/resolve.ts` loads the master named by `extends`, applies the customer override, re-applies master-only compliance so customers cannot override it, then applies product data. The batch renderer walks every SKU for a chosen customer and writes two PNG files per print area.

| Output | Role |
| --- | --- |
| **`print.png`** | Production plate. Contains **`HeroImage` only**, sized to `artworkLocation`. It excludes BrandLogo, headline, body, CTA, contact, legal, and master compliance. |
| **`mockup.png`** | Marketing preview. Contains the full composition (logo, palette, hero, copy, contact, legal, compliance) composited onto the product photo. |

```
templates/master.json          → locked layout + masterOnly.complianceText
templates/customers/*.json     → logo, palette, contact, legal (via extends)
catalog/brand-campaign.json    → default HeroImage campaign art per customer id
catalog/products.json          → heroImage, headline/body/cta, artworkLocation (50 SKUs)
src/resolve.ts                 → merge master → customer → product
scripts/render-catalog.ts      → headless Node batch (@cesdk/node)
```

## Prerequisites

Before you install or run the project, confirm you have:

- **Node.js 20+** and npm (`engines.node` in `package.json`)
- A **CE.SDK license key** from the [IMG.LY free trial form](https://img.ly/forms/free-trial)
- The included assets under `public/` (brand images, product mockups, and engine assets as shipped in this repository)

## Set up the project

1. Install dependencies.
2. Copy the environment example file to `.env`.
3. Paste your CE.SDK license key into `.env`.

```bash
npm install
cp .env.example .env
```

## Configure a license key

License keys belong in a local `.env` file or your shell environment. `.env` is gitignored.

| Variable | Used by |
| --- | --- |
| `CESDK_LICENSE` | Preferred by headless `npm run render:catalog` |
| `VITE_CESDK_LICENSE` | Fallback for the batch renderer; available if a browser engine path is added |

```bash
# .env
VITE_CESDK_LICENSE=your_key_here
# or
CESDK_LICENSE=your_key_here
```

### Fail-closed behavior

If the license is missing or `CreativeEngine.init({ license })` fails, the batch renderer throws. It does not silently continue in evaluation mode.

To allow watermarked evaluation output on purpose:

```bash
npm run render:catalog -- --customer bean-there-bean-good --allow-evaluation-mode
```

The Vite API accepts the same option as JSON: `{ "allowEvaluationMode": true }`. In the demo UI, you can append `?allowEvaluationMode=1` to the page URL.

> **Warning:** Evaluation mode produces watermarked exports. Use a valid license for review or production-like runs.

## Run the demo UI

1. Start the Vite development server:
```bash
npm run dev
```
2. Open the local URL printed in the terminal (often `http://localhost:5173`).
3. Select a customer in the **Select customer** section.
4. Click **Render catalog**.
5. Review the print and mockup tiles in the results grid.


**Render catalog** calls `POST /api/render-catalog`, which runs the same headless path as the CLI. Result images are served from `/output/…`.

To render only the first two products while testing the UI, open the app with `/?limit=2`.

| Number | Meaning |
| --- | --- |
| **50 products** | SKUs in `catalog/products.json` |
| **65 areas** | Print locations (some SKUs have front and back) |
| **~130 images** | Up to two PNGs per area |

## Render the catalog from the command line

1. Ensure `.env` contains a valid license key.
2. Run the batch for one customer id.
3. Inspect files under `output/catalog/<customer-id>/`.

```bash
npm run render:catalog -- --customer bean-there-bean-good
```

### Examples

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 3 --areas first
npm run render:catalog -- --customer scoop-there-it-is --out output/scoop-run
```

Available customers: `bean-there-bean-good`, `scoop-there-it-is`, `bun-intended`.

### CLI flags

| Flag | Meaning |
| --- | --- |
| `--customer <id>` | **Required.** Stem of `templates/customers/<id>.json` |
| `--out <dir>` | Output root (default: `output/catalog`) |
| `--color <id>` | Product color id for `{{color}}` mockup tokens |
| `--limit <n>` | First *n* products only |
| `--areas first\|all` | First area only, or every area (default: `all`) |
| `--allow-evaluation-mode` | If licensed init fails (or no key), retry without a license |

### Output layout

```
output/catalog/<customer-id>/<product-id>/<area-id>/
  print.png       # HeroImage-only plate at artworkLocation size
  mockup.png      # marketing composition + product backdrop
  resolved.json
output/catalog/<customer-id>/manifest.json
```

## Add a new customer

Customer files hold brand data only. Keep product copy and hero artwork out of this layer.

1. Create `templates/customers/<id>.json` with brand fields and `"extends": "../master.json"`.
2. Place logo and related assets under `public/` so paths such as `/images/logo-acme.png` resolve.
3. Optionally add campaign art for the customer in `catalog/brand-campaign.json` under `byCustomerId`.
4. Register the customer import in `src/app/customer-catalog.ts`.
5. Confirm `extends` is registered in `MASTER_TEMPLATES_BY_EXTENDS` inside `src/resolve.ts` (default: `../master.json`).
6. Render a short smoke batch for the new customer.

```json
{
  "id": "acme-merch",
  "name": "Acme Merch Co.",
  "extends": "../master.json",
  "variables": {
    "brandName": "Acme Merch Co.",
    "logoUri": "/images/logo-acme.png",
    "primaryColor": "#111111",
    "secondaryColor": "#F5F0E8",
    "contactName": "Acme Merch Co.",
    "contactPhone": "+1 (555) 010-9999",
    "contactEmail": "hello@acme.example",
    "contactAddress": "1 Market St, San Francisco, CA",
    "legalDisclaimer": "© Acme Merch Co. All rights reserved."
  }
}
```

> **Warning:** Do not put `heroImage`, `headline`, `body`, `cta`, or master-only compliance fields in a customer file.
> Those campaign fields belong on the product (or brand-campaign map) so one brand does not freeze the same art and copy across every SKU.
> Compliance stays on the master so customers cannot override shared legal/policy text.

```bash
npm run render:catalog -- --customer acme-merch --limit 2 --areas first
```

## Add a new product

1. Append an entry to the `products` array in `catalog/products.json`.
2. Include `artworkLocation`, a `heroImage` object with `uri`, `width`, and `height` (for `setSourceSet`), and `headline`, `body`, and `cta`.
3. Add mockup PNGs under `public/` if you want `mockup.png` output.
4. Update `count` in `catalog/products.json` if you maintain that field.
5. Smoke-test with a limited batch render.

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 1 --areas first
```

## Change the master template

The shared design lives in `templates/master.json` (`sceneString` plus metadata).

### What belongs on the master

- Locked brand structure: logo slot, palette swatches, contact block, legal line
- Master-only compliance footer (`MasterCompliance` / `masterOnly.complianceText`), which must not appear in customer files
- Placeholders for `HeroImage` and campaign text variables (`headline`, `body`, `cta`) filled from the product layer

### What propagates

| Change | Propagates when you re-render? | Edit customers? |
| --- | --- | --- |
| `masterOnly.complianceText` | Yes — all customers’ **mockups** | No |
| Locked layout / `sceneString` | Yes | No |
| Customer `logoUri` / colors | Only that customer | Yes (that file only) |
| Product headline / hero | Only that SKU | Edit `catalog/products.json` |

`exportModes.print` documents the HeroImage-only plate. `exportModes.marketing` documents the full composition. Print exports omit BrandLogo on purpose: brand chrome belongs on mockups, not on the production ink plate.

After you change the master:

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 3 --areas first
```

## Scripts reference

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite UI and `/api/render-catalog` |
| `npm run render:catalog -- --customer <id>` | Headless batch render |
| `npm run test:unit` | Smoke: one product licensed render and print size check |
| `npm run check:all` | Typecheck, format, and lint |

## License

Demo code in this repository is provided for evaluation with CE.SDK. CE.SDK requires an IMG.LY license. Do not commit `.env`.
