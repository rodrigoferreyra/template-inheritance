/**
 * Document typeface for the master template.
 *
 * CE.SDK text blocks render with fallback metrics when no typeface is set —
 * line heights come out several times too large and every layout measured with
 * `getHeight()` is wrong. The font is therefore applied to every text block at
 * resolve time, from a font vendored in `public/fonts/`.
 *
 * The master stores only relative URIs, so the scene string stays portable
 * between the browser and Node; each entry point turns them into real URLs with
 * its own `resolveAssetPath`.
 */

import type CreativeEngine from "@cesdk/engine";
import type { FontStyle, FontWeight, Typeface } from "@cesdk/engine";

export interface TypefaceFontSpec {
  uri: string;
  subFamily: string;
  weight?: FontWeight;
  style?: FontStyle;
}

export interface TypefaceSpec {
  name: string;
  fonts: TypefaceFontSpec[];
  /** Named blocks that should render in the bold weight. */
  boldBlocks?: string[];
}

/** Roboto (Apache-2.0), vendored under public/fonts/. */
export const DEFAULT_TYPEFACE: TypefaceSpec = {
  name: "Roboto",
  fonts: [
    {
      uri: "/fonts/Roboto-Regular.ttf",
      subFamily: "Regular",
      weight: "normal",
      style: "normal",
    },
    {
      uri: "/fonts/Roboto-Bold.ttf",
      subFamily: "Bold",
      weight: "bold",
      style: "normal",
    },
  ],
  boldBlocks: ["BrandName", "Headline", "CTA"],
};

function pickFont(
  spec: TypefaceSpec,
  weight: FontWeight,
): TypefaceFontSpec | undefined {
  return spec.fonts.find((font) => font.weight === weight) ?? spec.fonts[0];
}

/**
 * Apply the document typeface to every text block in the current scene.
 */
export function applyDocumentTypeface(
  engine: CreativeEngine,
  options: {
    spec?: TypefaceSpec;
    resolveAssetPath?: (path: string) => string;
  } = {},
): void {
  const spec = options.spec ?? DEFAULT_TYPEFACE;
  const resolve = options.resolveAssetPath ?? ((path: string) => path);

  if (spec.fonts.length === 0) {
    throw new Error(`Typeface "${spec.name}" has no fonts`);
  }

  const typeface: Typeface = {
    name: spec.name,
    fonts: spec.fonts.map((font) => ({
      uri: resolve(font.uri),
      subFamily: font.subFamily,
      weight: font.weight,
      style: font.style,
    })),
  };

  const bold = new Set(spec.boldBlocks ?? []);
  const regularFont = pickFont(spec, "normal");
  const boldFont = pickFont(spec, "bold");

  for (const block of engine.block.findByType("text")) {
    const name = engine.block.getName(block);
    const font = bold.has(name) ? boldFont : regularFont;
    if (!font) continue;
    engine.block.setFont(block, resolve(font.uri), typeface);
  }
}
