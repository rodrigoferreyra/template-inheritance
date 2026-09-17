# Swag catalog with template inheritance (CE.SDK)

Personalize a merch catalog with [CE.SDK](https://img.ly/creative-sdk) by [IMG.LY](https://img.ly): one locked **master** design, per-**customer** brand overrides (logo, colors, contact, legal), and per-**product** artwork placement + campaign copy. `resolveScene` merges all three; the batch renderer walks every SKU for a customer and writes two PNGs per print area:

| File             | Contents                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **`print.png`**  | **Production plate — `HeroImage` only**, sized to `artworkLocation` (no BrandLogo, headline, body, CTA, contact, legal, or master compliance) |
| **`mockup.png`** | Full marketing composition (logo, palette, hero, copy, contact, legal, compliance) composited onto the product photo                          |

```
templates/master.json          → locked layout + masterOnly.complianceText
templates/customers/*.json     → logo, palette, contact, legal (via extends)
catalog/brand-campaign.json    → default HeroImage campaign art per customer id
catalog/products.json          → heroImage, headline/body/cta, artworkLocation (50 SKUs)
src/resolve.ts                 → merge master → customer → product
scripts/render-catalog.ts      → headless Node batch (@cesdk/node)
```

Demo customers: **Bean there Bean good**, **Scoop there it is**, **BUN intended**. Catalog spans tees, hoodies, caps, mugs, tumblers, tote bags, posters, stickers, pillows, phone cases, and more.

## Prerequisites

- **Node.js 20+** and npm (`engines.node` in `package.json`)
- A **CE.SDK license key** — [free trial](https://img.ly/forms/free-trial)
- Engine assets under `public/assets/` and product/brand images under `public/` (included in this repo)

```bash
npm install
cp .env.example .env   # then paste your license key
```

---

## License keys (never commit `.env`)

**Never commit a real license key.** Use a local `.env` (gitignored) or your shell.

| Variable             | Used by                                            |
| -------------------- | -------------------------------------------------- |
| `CESDK_LICENSE`      | Preferred by headless `npm run render:catalog`     |
| `VITE_CESDK_LICENSE` | Fallback for the batch renderer; Vite UI if needed |

```bash
# .env
VITE_CESDK_LICENSE=your_key_here
# or
CESDK_LICENSE=your_key_here
```

### Fail-closed by default

If the license is missing or `CreativeEngine.init({ license })` fails, the batch renderer **throws** and does **not** silently continue in evaluation mode.

To explicitly allow watermarked evaluation output:

```bash
npm run render:catalog -- --customer bean-there-bean-good --allow-evaluation-mode
```

The Vite API accepts the same flag as JSON: `{ "allowEvaluationMode": true }`. The UI can pass `?allowEvaluationMode=1`.

---

## Demo UI (Vite)

```bash
npm run dev
```

Open the URL Vite prints (often `http://localhost:5173`).

1. Select a customer.
2. Click **Render catalog** — `POST /api/render-catalog` runs the same path as the CLI.
3. Browse print + mockup tiles (served from `/output/…`).

Smoke in the UI: `/?limit=2` renders only the first two products.

| Number          | Meaning                                     |
| --------------- | ------------------------------------------- |
| **50 products** | SKUs in `catalog/products.json`             |
| **65 areas**    | Print locations (some SKUs have front+back) |
| **~130 images** | Up to two PNGs per area                     |

---

## Batch render (`npm run render:catalog`)

```bash
npm run render:catalog -- --customer bean-there-bean-good
```

### Flags

| Flag                      | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `--customer <id>`         | **Required.** Stem of `templates/customers/<id>.json`       |
| `--out <dir>`             | Output root (default: `output/catalog`)                     |
| `--color <id>`            | Product color id for `{{color}}` mockup tokens              |
| `--limit <n>`             | First _n_ products only                                     |
| `--areas first\|all`      | First area only, or every area (default: `all`)             |
| `--allow-evaluation-mode` | If licensed init fails (or no key), retry without a license |

### Examples

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 3 --areas first
npm run render:catalog -- --customer scoop-there-it-is --out output/scoop-run
```

### Output layout

```
output/catalog/<customer-id>/<product-id>/<area-id>/
  print.png       # HeroImage-only plate @ artworkLocation size
  mockup.png      # marketing composition + product backdrop
  resolved.json
output/catalog/<customer-id>/manifest.json
```

Customers: `bean-there-bean-good` | `scoop-there-it-is` | `bun-intended`.

---

## How the merge works

1. Load the **master** named by the customer’s `extends` field (`resolveMasterTemplate` — functional, not metadata).
2. Apply **customer** logo (`setSourceSet`), palette, and contact/legal variables.
3. Re-apply **master-only** `complianceText` so customers cannot override it.
4. Apply **product** `heroImage` + `headline`/`body`/`cta`, fit to `artworkLocation`, then either:
   - **print** (`includeMockup: false`): hide all brand/marketing chrome; size page + HeroImage to the artwork rect
   - **mockup** (`includeMockup: true`): keep chrome; composite product photo behind the page

Implementation: `src/resolve.ts`.

---

## Add a new customer

1. Create `templates/customers/<id>.json` with **only** brand fields:

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

Do **not** put `heroImage`, `headline`, `body`, `cta`, or `masterOnly` / compliance here.

2. Add assets under `public/` and optional campaign art in `catalog/brand-campaign.json` → `byCustomerId`.
3. Register the import in `src/app/customer-catalog.ts`.
4. Ensure `extends` is registered in `MASTER_TEMPLATES_BY_EXTENDS` in `src/resolve.ts` (default: `../master.json`).

```bash
npm run render:catalog -- --customer acme-merch --limit 2 --areas first
```

---

## Add a new product

Append to `catalog/products.json` → `products`. Include `artworkLocation`, a `heroImage` object `{ "uri", "width", "height" }` (for `setSourceSet`), and `headline` / `body` / `cta`. Add mockup PNGs under `public/` if you want `mockup.png`. Bump `count` if you maintain it.

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 1 --areas first
```

---

## Change the master template

Edit `templates/master.json`:

| Change                        | Propagates when you re-render?   | Touch customers?             |
| ----------------------------- | -------------------------------- | ---------------------------- |
| `masterOnly.complianceText`   | Yes — all customers’ **mockups** | No                           |
| Locked layout / `sceneString` | Yes                              | No                           |
| Customer `logoUri` / colors   | Only that customer               | Yes (that file only)         |
| Product headline / hero       | Only that SKU                    | Edit `catalog/products.json` |

`exportModes.print` documents the HeroImage-only plate; `exportModes.marketing` is the full composition. Print exports intentionally **omit** BrandLogo (brand chrome belongs on mockups, not the production ink plate).

```bash
npm run render:catalog -- --customer bean-there-bean-good --limit 3 --areas first
```

---

## Scripts

| Command                                     | Purpose                                             |
| ------------------------------------------- | --------------------------------------------------- |
| `npm run dev`                               | Vite UI + `/api/render-catalog`                     |
| `npm run render:catalog -- --customer <id>` | Headless batch                                      |
| `npm run test:unit`                         | Smoke: 1 product licensed render + print size check |
| `npm run check:all`                         | Typecheck + format + lint                           |

---

## License

Demo code in this repository is provided for evaluation with CE.SDK. CE.SDK itself requires an IMG.LY license. Do not commit `.env`.
