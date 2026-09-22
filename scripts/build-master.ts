/**
 * Build `templates/master.json` from code.
 *
 *   npm run build:master
 *
 * This is Step 1 of the inheritance chain: the locked master. Everything the
 * master owns is declared here — block names, the text-variable placeholders,
 * the HeroImage placeholder, the creator/adopter scopes, and the master-only
 * compliance footer. Running this script regenerates the scene string, so a
 * master change is a reviewable code diff instead of a hand-edited base64 blob.
 *
 * No license is required: the script only builds and serialises a scene, it
 * never exports pixels.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import CreativeEngine from "@cesdk/node";

import { hexToRgba } from "../src/imgly/utils";
import { DEFAULT_TYPEFACE } from "../src/imgly/typeface";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Master page is a 4:5 brand sheet. Print and mockup layouts are derived per product. */
const PAGE_WIDTH = 1080;
const PAGE_HEIGHT = 1350;

const PAGE_COLOR = "#F7F4EF";
const INK = "#1A1A1A";
const MUTED = "#6B6B6B";

/** Text variables the master exposes. Customers may write the brand subset (see OVERRIDE_VARIABLES). */
const VARIABLE_DEFAULTS: Record<string, string> = {
  brandName: "Brand Co.",
  logoUri: "/images/logo-bean.png",
  primaryColor: "#050087",
  secondaryColor: "#F1E1C7",
  contactName: "Brand Co. HQ",
  contactPhone: "+1 (555) 010-0000",
  contactEmail: "hello@brand.example",
  contactAddress: "100 Market St, San Francisco, CA",
  legalDisclaimer: "© Brand Co. All rights reserved.",
  headline: "Your campaign headline",
  body: "Replace this body copy with offer details, seasonality, or product benefits.",
  cta: "Shop now",
  masterCompliance:
    "Master compliance: Template terms apply. Not for unauthorized redistribution.",
};

/** Brand fields a customer override file is allowed to set. */
const OVERRIDE_VARIABLES = [
  "brandName",
  "logoUri",
  "primaryColor",
  "secondaryColor",
  "contactName",
  "contactPhone",
  "contactEmail",
  "contactAddress",
  "legalDisclaimer",
] as const;

/** Campaign copy the adopter may edit in an embedded editor. */
const ADOPTER_EDITABLE_TEXT = ["Headline", "Body", "CTA"] as const;

/** Blocks the adopter can never touch: brand chrome and master-only legal text. */
const LOCKED_BLOCKS = [
  "BrandLogo",
  "BrandName",
  "BrandPrimarySwatch",
  "BrandSecondarySwatch",
  "BrandPaletteLabel",
  "ContactBlock",
  "LegalLine",
  "MasterCompliance",
] as const;

/** Only the artwork frame is a placeholder — the adopter may swap and crop its image. */
const PLACEHOLDER_BLOCKS = ["HeroImage"] as const;

interface TextSpec {
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color?: string;
  align?: "Left" | "Center" | "Right";
}

const TEXTS: TextSpec[] = [
  {
    name: "BrandName",
    text: "{{brandName}}",
    x: 216,
    y: 76,
    width: 560,
    fontSize: 40,
  },
  {
    name: "BrandPaletteLabel",
    text: "Brand palette",
    x: 840,
    y: 140,
    width: 180,
    fontSize: 16,
    color: MUTED,
    align: "Right",
  },
  {
    name: "Headline",
    text: "{{headline}}",
    x: 60,
    y: 910,
    width: 960,
    fontSize: 54,
  },
  {
    name: "Body",
    text: "{{body}}",
    x: 60,
    y: 1000,
    width: 660,
    fontSize: 24,
    color: MUTED,
  },
  {
    name: "CTA",
    text: "{{cta}}",
    x: 60,
    y: 1120,
    width: 320,
    fontSize: 28,
  },
  {
    name: "ContactBlock",
    text: "{{contactName}}\n{{contactPhone}} · {{contactEmail}}\n{{contactAddress}}",
    x: 620,
    y: 1104,
    width: 400,
    fontSize: 18,
    color: MUTED,
    align: "Right",
  },
  {
    name: "LegalLine",
    text: "{{legalDisclaimer}}",
    x: 60,
    y: 1240,
    width: 960,
    fontSize: 16,
    color: MUTED,
  },
  {
    name: "MasterCompliance",
    text: "{{masterCompliance}}",
    x: 60,
    y: 1276,
    width: 960,
    fontSize: 16,
    color: MUTED,
  },
];

type Engine = Awaited<ReturnType<typeof CreativeEngine.init>>;

function setSolidFill(engine: Engine, block: number, hex: string): void {
  const fill = engine.block.getFill(block);
  engine.block.setColor(fill, "fill/color/value", hexToRgba(hex));
}

function createText(engine: Engine, page: number, spec: TextSpec): number {
  const block = engine.block.create("text");
  engine.block.setName(block, spec.name);
  engine.block.appendChild(page, block);
  engine.block.replaceText(block, spec.text);
  engine.block.setPositionX(block, spec.x);
  engine.block.setPositionY(block, spec.y);
  engine.block.setWidth(block, spec.width);
  engine.block.setHeightMode(block, "Auto");
  engine.block.setFloat(block, "text/fontSize", spec.fontSize);
  engine.block.setEnum(block, "text/horizontalAlignment", spec.align ?? "Left");
  setSolidFill(engine, block, spec.color ?? INK);
  return block;
}

function createImageBlock(
  engine: Engine,
  page: number,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
  source: { uri: string; width: number; height: number },
): number {
  const block = engine.block.create("graphic");
  engine.block.setName(block, name);
  engine.block.setShape(block, engine.block.createShape("rect"));
  const fill = engine.block.createFill("image");
  engine.block.setSourceSet(fill, "fill/image/sourceSet", [source]);
  engine.block.setFill(block, fill);
  engine.block.appendChild(page, block);
  engine.block.setPositionX(block, rect.x);
  engine.block.setPositionY(block, rect.y);
  engine.block.setWidth(block, rect.width);
  engine.block.setHeight(block, rect.height);
  engine.block.setContentFillMode(block, "Cover");
  return block;
}

function createSwatch(
  engine: Engine,
  page: number,
  name: string,
  x: number,
  hex: string,
): number {
  const block = engine.block.create("graphic");
  engine.block.setName(block, name);
  engine.block.setShape(block, engine.block.createShape("rect"));
  engine.block.setFill(block, engine.block.createFill("color"));
  engine.block.appendChild(page, block);
  engine.block.setPositionX(block, x);
  engine.block.setPositionY(block, 70);
  engine.block.setWidth(block, 56);
  engine.block.setHeight(block, 56);
  setSolidFill(engine, block, hex);
  return block;
}

/**
 * Lock the scene for the adopter role.
 *
 * `editor.setRole('Adopter')` switches which role slot `setScopeEnabled` writes,
 * so everything below describes what a *customer* may do in an embedded editor.
 * The creator role keeps full access.
 */
function applyAdopterLocks(
  engine: Engine,
  blocks: Record<string, number>,
): void {
  engine.editor.setRole("Adopter");

  // Block-level scopes are only consulted when the global scope defers to them.
  for (const scope of [
    "text/edit",
    "fill/change",
    "fill/changeType",
    "layer/crop",
    "layer/move",
    "layer/resize",
    "layer/rotate",
    "lifecycle/destroy",
    "lifecycle/duplicate",
    "editor/select",
    "editor/add",
  ] as const) {
    engine.editor.setGlobalScope(scope, "Defer");
  }

  const all = Object.values(blocks);
  const deny = [
    "text/edit",
    "text/character",
    "fill/change",
    "fill/changeType",
    "stroke/change",
    "shape/change",
    "layer/move",
    "layer/resize",
    "layer/rotate",
    "layer/flip",
    "layer/crop",
    "layer/opacity",
    "layer/blendMode",
    "layer/visibility",
    "layer/clipping",
    "appearance/adjustments",
    "appearance/filter",
    "appearance/effect",
    "appearance/blur",
    "appearance/shadow",
    "lifecycle/destroy",
    "lifecycle/duplicate",
    "editor/select",
  ] as const;

  // Default: the adopter may do nothing at all.
  for (const block of all) {
    for (const scope of deny) {
      engine.block.setScopeEnabled(block, scope, false);
    }
  }

  // Campaign copy is editable text, nothing more.
  for (const name of ADOPTER_EDITABLE_TEXT) {
    engine.block.setScopeEnabled(blocks[name], "text/edit", true);
    engine.block.setScopeEnabled(blocks[name], "editor/select", true);
  }

  // The artwork frame accepts a new image and a crop, but cannot be moved or resized.
  for (const name of PLACEHOLDER_BLOCKS) {
    engine.block.setScopeEnabled(blocks[name], "fill/change", true);
    engine.block.setScopeEnabled(blocks[name], "fill/changeType", true);
    engine.block.setScopeEnabled(blocks[name], "layer/crop", true);
    engine.block.setScopeEnabled(blocks[name], "editor/select", true);
    engine.block.setPlaceholderEnabled(blocks[name], true);
    engine.block.setPlaceholderControlsOverlayEnabled(blocks[name], true);
    engine.block.setPlaceholderControlsButtonEnabled(blocks[name], true);
  }

  engine.editor.setRole("Creator");
}

async function main(): Promise<void> {
  const baseURL = pathToFileURL(
    path.join(REPO_ROOT, "node_modules/@cesdk/node/assets/"),
  ).href;

  const engine = await CreativeEngine.init({ baseURL });

  try {
    const scene = engine.scene.create();
    engine.scene.setDesignUnit("Pixel");
    // Font sizes default to Point at 300 DPI, which makes every pixel-space
    // layout measurement in src/resolve.ts wrong by ~4x. Keep type in the same
    // unit as the geometry.
    engine.scene.setFontSizeUnit("Pixel");

    const page = engine.block.create("page");
    engine.block.appendChild(scene, page);
    engine.block.setWidth(page, PAGE_WIDTH);
    engine.block.setHeight(page, PAGE_HEIGHT);
    setSolidFill(engine, page, PAGE_COLOR);

    const blocks: Record<string, number> = {};

    blocks.BrandLogo = createImageBlock(
      engine,
      page,
      "BrandLogo",
      { x: 60, y: 60, width: 130, height: 130 },
      {
        uri: "https://img.ly/static/ubq_samples/imgly_logo.jpg",
        width: 200,
        height: 200,
      },
    );

    blocks.HeroImage = createImageBlock(
      engine,
      page,
      "HeroImage",
      { x: 60, y: 230, width: 960, height: 640 },
      {
        uri: "https://img.ly/static/ubq_samples/sample_1.jpg",
        width: 1280,
        height: 720,
      },
    );

    blocks.BrandPrimarySwatch = createSwatch(
      engine,
      page,
      "BrandPrimarySwatch",
      904,
      VARIABLE_DEFAULTS.primaryColor,
    );
    blocks.BrandSecondarySwatch = createSwatch(
      engine,
      page,
      "BrandSecondarySwatch",
      964,
      VARIABLE_DEFAULTS.secondaryColor,
    );

    for (const spec of TEXTS) {
      blocks[spec.name] = createText(engine, page, spec);
    }

    for (const [key, value] of Object.entries(VARIABLE_DEFAULTS)) {
      engine.variable.setString(key, value);
    }

    applyAdopterLocks(engine, blocks);

    const sceneString = await engine.scene.saveToString();

    const doc = {
      id: "master",
      name: "Brand Master Template",
      description:
        "Generated by scripts/build-master.ts. Locked brand chrome (logo, palette, " +
        "contact, legal) plus a master-only compliance footer. Customers override the " +
        "fields in overrideVariables and supply the printed artwork; products supply " +
        "campaign copy and the print geometry. Edit this file by editing the script.",
      generatedBy: "scripts/build-master.ts",
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      unit: "Pixel",
      roles: {
        creator:
          "Full access — configure scopes, layout and placeholders (npm run build:master)",
        adopter:
          "May replace and crop the HeroImage artwork and edit headline/body/CTA; " +
          "cannot touch logo, palette, contact, legal line or the master compliance footer",
      },
      masterOnly: {
        complianceText: VARIABLE_DEFAULTS.masterCompliance,
      },
      typeface: DEFAULT_TYPEFACE,
      overrideVariables: [...OVERRIDE_VARIABLES],
      locked: [...LOCKED_BLOCKS],
      placeholders: [...PLACEHOLDER_BLOCKS],
      editableText: [...ADOPTER_EDITABLE_TEXT],
      variables: Object.keys(VARIABLE_DEFAULTS),
      exportModes: {
        print: {
          description:
            "Production print plate — the customer's artwork only, sized to the " +
            "product's physical print area at the requested DPI.",
          visibleBlocks: ["HeroImage"],
          hiddenBlocks: [...LOCKED_BLOCKS, ...ADOPTER_EDITABLE_TEXT],
        },
        marketing: {
          description:
            "Catalog mockup — the product photo with the artwork applied, and the " +
            "brand chrome in a caption band beneath it (never printed on the product).",
          artworkBlocks: ["HeroImage"],
          captionBlocks: [
            "BrandLogo",
            "BrandName",
            "BrandPrimarySwatch",
            "BrandSecondarySwatch",
            "BrandPaletteLabel",
            "Headline",
            "Body",
            "CTA",
            "ContactBlock",
            "LegalLine",
            "MasterCompliance",
          ],
        },
      },
      sceneString,
    };

    const out = path.join(REPO_ROOT, "templates/master.json");
    writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(
      `Wrote ${path.relative(REPO_ROOT, out)} (${Object.keys(blocks).length} named blocks, ${sceneString.length} chars of scene)`,
    );
  } finally {
    engine.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
