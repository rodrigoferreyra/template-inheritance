/**
 * Generate the product mockup images under `public/assets/products/`.
 *
 *   npm run build:assets
 *
 * The mockups are flat vector product shots rendered to PNG, one per product
 * type and colour. They are generated rather than hand-drawn for two reasons:
 * the catalog needs a consistent look across 10 product types, and the print
 * area must stay clean — an earlier set had a dashed print-area guide baked
 * into the artwork, which then showed up in every rendered mockup.
 *
 * Geometry note: the print rectangle of each type is where `artworkLocation`
 * points in catalog/products.json, and its aspect ratio matches that area's
 * physical `pageSize`. Keep the two in step — `npm run test:unit` checks it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(REPO_ROOT, "public/assets/products");

const BACKDROP = "#F5F6F8";

export const PRODUCT_COLORS: Array<{ id: string; hex: string }> = [
  { id: "white", hex: "#FFFFFF" },
  { id: "black", hex: "#111111" },
  { id: "navy", hex: "#0B1F3A" },
  { id: "forest", hex: "#2E573E" },
  { id: "coral", hex: "#E85D4C" },
  { id: "sand", hex: "#E8D5B7" },
];

interface ShapeContext {
  /** Base garment colour. */
  hex: string;
  /** Shared defs: soft shadow plus a top-light gradient for depth. */
  shade: string;
  stroke: string;
}

interface AssetSpec {
  /** Folder under public/assets/products/ */
  dir: string;
  /** File suffix, e.g. `front` in `navy_front.png`. */
  views: string[];
  width: number;
  height: number;
  draw: (view: string, ctx: ShapeContext) => string;
}

/** Light products need a hairline so they read against the light backdrop. */
function strokeFor(hex: string): string {
  const light = ["#FFFFFF", "#E8D5B7"].includes(hex.toUpperCase());
  return light ? "#D9D9DE" : "rgba(0,0,0,0.08)";
}

function svg(spec: AssetSpec, view: string, hex: string): string {
  const ctx: ShapeContext = {
    hex,
    shade: "url(#shade)",
    stroke: strokeFor(hex),
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.10"/>
    </linearGradient>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(spec.height * 0.012)}" stdDeviation="${Math.round(spec.height * 0.018)}" flood-color="#0B1F3A" flood-opacity="0.13"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="${BACKDROP}"/>
  ${spec.draw(view, ctx)}
</svg>`;
}

/** Paint one silhouette path: base colour, gradient shading, hairline. */
function body(d: string, ctx: ShapeContext, shadow = true): string {
  return `<g ${shadow ? 'filter="url(#drop)"' : ""}>
    <path d="${d}" fill="${ctx.hex}" stroke="${ctx.stroke}" stroke-width="2"/>
    <path d="${d}" fill="${ctx.shade}"/>
  </g>`;
}

function rectBody(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  ctx: ShapeContext,
): string {
  return `<g filter="url(#drop)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${ctx.hex}" stroke="${ctx.stroke}" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${ctx.shade}"/>
  </g>`;
}

const SPECS: AssetSpec[] = [
  {
    dir: "tshirt",
    views: ["front", "back"],
    width: 814,
    height: 947,
    draw: (view, ctx) => {
      const tee = `M 300 120
        L 250 138 L 96 208 L 40 250 L 112 372 L 186 330 L 186 858
        Q 186 878 206 878 L 608 878 Q 628 878 628 858 L 628 330
        L 702 372 L 774 250 L 718 208 L 564 138 L 514 120
        Q 480 172 407 172 Q 334 172 300 120 Z`;
      const collar =
        view === "front"
          ? `<path d="M 300 120 Q 407 200 514 120 Q 470 150 407 150 Q 344 150 300 120 Z" fill="rgba(0,0,0,0.10)"/>`
          : `<path d="M 300 120 Q 407 156 514 120 Q 470 138 407 138 Q 344 138 300 120 Z" fill="rgba(0,0,0,0.10)"/>`;
      return body(tee, ctx) + collar;
    },
  },
  {
    dir: "hoodie",
    views: ["front"],
    width: 900,
    height: 1100,
    draw: (_view, ctx) => {
      const hoodie = `M 330 150
        L 250 180 L 92 268 L 40 320 L 130 452 L 214 400 L 214 1000
        Q 214 1022 236 1022 L 664 1022 Q 686 1022 686 1000 L 686 400
        L 770 452 L 860 320 L 808 268 L 650 180 L 570 150
        Q 528 224 450 224 Q 372 224 330 150 Z`;
      const hood = `<path d="M 330 150 Q 450 300 570 150 Q 520 236 450 236 Q 380 236 330 150 Z" fill="rgba(0,0,0,0.12)"/>`;
      const pocket = `<path d="M 300 800 L 600 800 L 588 916 L 312 916 Z" fill="rgba(0,0,0,0.07)"/>`;
      const cord = `<g stroke="rgba(0,0,0,0.18)" stroke-width="7" stroke-linecap="round" fill="none"><path d="M 402 214 L 396 300"/><path d="M 498 214 L 504 300"/></g>`;
      return body(hoodie, ctx) + hood + cord + pocket;
    },
  },
  {
    dir: "totebag",
    views: ["front"],
    width: 751,
    height: 1225,
    draw: (_view, ctx) => {
      const bag = `M 96 300 L 655 300 L 655 1140 Q 655 1160 635 1160 L 116 1160 Q 96 1160 96 1140 Z`;
      const handles = `<g fill="none" stroke="${ctx.hex}" stroke-width="26" stroke-linecap="round" opacity="0.95">
        <path d="M 214 300 Q 214 104 300 104 Q 352 104 352 300"/>
        <path d="M 399 300 Q 399 104 451 104 Q 537 104 537 300"/>
      </g>
      <g fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="26" stroke-linecap="round">
        <path d="M 214 300 Q 214 104 300 104 Q 352 104 352 300"/>
        <path d="M 399 300 Q 399 104 451 104 Q 537 104 537 300"/>
      </g>`;
      return handles + body(bag, ctx);
    },
  },
  {
    dir: "cap",
    views: ["front", "back"],
    width: 736,
    height: 760,
    draw: (view, ctx) => {
      const crown = `M 130 500 Q 130 200 368 200 Q 606 200 606 500 Q 606 520 586 520 L 150 520 Q 130 520 130 500 Z`;
      const brim =
        view === "front"
          ? `<path d="M 122 520 Q 368 480 614 520 Q 690 548 668 592 Q 368 630 68 592 Q 46 548 122 520 Z" fill="${ctx.hex}" stroke="${ctx.stroke}" stroke-width="2"/>
             <path d="M 122 520 Q 368 480 614 520 Q 690 548 668 592 Q 368 630 68 592 Q 46 548 122 520 Z" fill="rgba(0,0,0,0.14)"/>`
          : `<path d="M 300 520 L 436 520 L 436 592 Q 368 606 300 592 Z" fill="rgba(0,0,0,0.12)"/>
             <path d="M 318 536 L 418 536 L 418 576 L 318 576 Z" fill="rgba(0,0,0,0.16)"/>`;
      const seams =
        view === "front"
          ? `<g stroke="rgba(0,0,0,0.10)" stroke-width="4" fill="none"><path d="M 368 200 L 368 520"/></g>`
          : `<g stroke="rgba(0,0,0,0.08)" stroke-width="4" fill="none"><path d="M 250 214 Q 258 380 252 520"/><path d="M 486 214 Q 478 380 484 520"/></g>`;
      return body(crown, ctx) + seams + brim;
    },
  },
  {
    dir: "phonecase",
    views: ["back"],
    width: 494,
    height: 917,
    draw: (_view, ctx) => {
      const lens = `<g>
        <rect x="58" y="60" width="150" height="150" rx="38" fill="rgba(0,0,0,0.16)"/>
        <circle cx="104" cy="108" r="26" fill="rgba(0,0,0,0.42)"/>
        <circle cx="162" cy="108" r="26" fill="rgba(0,0,0,0.42)"/>
        <circle cx="104" cy="164" r="26" fill="rgba(0,0,0,0.42)"/>
      </g>`;
      return rectBody(28, 24, 438, 869, 62, ctx) + lens;
    },
  },
  {
    dir: "sticker",
    views: ["sheet"],
    width: 600,
    height: 900,
    draw: (_view, ctx) => {
      const sheet = rectBody(24, 24, 552, 852, 18, ctx);
      const perforation = `<rect x="44" y="70" width="512" height="772" rx="12" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>`;
      return sheet + perforation;
    },
  },
  {
    dir: "mug",
    views: ["front"],
    width: 841,
    height: 762,
    draw: (_view, ctx) => {
      const handle = `<g fill="none" stroke="${ctx.hex}" stroke-width="52">
        <path d="M 606 250 Q 742 250 742 380 Q 742 510 606 510"/>
      </g>
      <g fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="52">
        <path d="M 606 250 Q 742 250 742 380 Q 742 510 606 510"/>
      </g>`;
      const cup = `M 150 140 L 620 140 L 620 640 Q 620 672 588 672 L 182 672 Q 150 672 150 640 Z`;
      const rim = `<ellipse cx="385" cy="142" rx="235" ry="26" fill="rgba(255,255,255,0.35)" stroke="${ctx.stroke}" stroke-width="2"/>`;
      return handle + body(cup, ctx) + rim;
    },
  },
  {
    dir: "tumbler",
    views: ["front"],
    width: 700,
    height: 1000,
    draw: (_view, ctx) => {
      const cup = `M 208 190 L 492 190 L 456 918 Q 454 946 426 946 L 274 946 Q 246 946 244 918 Z`;
      const lid = `<g>
        <rect x="192" y="96" width="316" height="86" rx="26" fill="rgba(0,0,0,0.20)"/>
        <rect x="214" y="60" width="272" height="52" rx="22" fill="rgba(0,0,0,0.28)"/>
      </g>`;
      return body(cup, ctx) + lid;
    },
  },
  {
    dir: "pillow",
    views: ["front"],
    width: 800,
    height: 800,
    draw: (_view, ctx) => {
      const pillow = `M 70 70 Q 400 44 730 70 Q 756 400 730 730 Q 400 756 70 730 Q 44 400 70 70 Z`;
      return body(pillow, ctx);
    },
  },
  {
    dir: "poster",
    views: ["face"],
    width: 900,
    height: 1200,
    draw: (_view, ctx) => rectBody(30, 40, 840, 1120, 6, ctx),
  },
];

async function main(): Promise<void> {
  let written = 0;
  for (const spec of SPECS) {
    const dir = path.join(OUT_ROOT, spec.dir);
    mkdirSync(dir, { recursive: true });
    for (const view of spec.views) {
      for (const color of PRODUCT_COLORS) {
        const markup = svg(spec, view, color.hex);
        const png = await sharp(Buffer.from(markup)).png().toBuffer();
        writeFileSync(path.join(dir, `${color.id}_${view}.png`), png);
        written++;
      }
    }
  }
  console.log(
    `Wrote ${written} product mockups to ${path.relative(REPO_ROOT, OUT_ROOT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
