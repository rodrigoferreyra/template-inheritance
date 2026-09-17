/**
 * CE.SDK Multi-Image Generation - Utility Functions
 *
 * Common utility functions used across the imgly module.
 */

import type CreativeEngine from "@cesdk/engine";

import type { RgbaColor } from "./types";

/**
 * Convert hex color string to RGBA object.
 */
export function hexToRgba(hex: string): RgbaColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
    a: 1,
  };
}

/**
 * Confirm a property exists on a block before get/set (CE.SDK schemas differ by type).
 */
export function assertHasProperty(
  engine: CreativeEngine,
  block: number,
  prop: string,
): void {
  const props = engine.block.findAllProperties(block);
  if (!props.includes(prop)) {
    throw new Error(
      `Block ${block} is missing property "${prop}". Available: ${props.join(", ") || "(none)"}`,
    );
  }
}

export interface NamedBlockOptions {
  /**
   * When true (default), throw if the named block is missing or has the wrong fill type.
   */
  required?: boolean;
}

/** setSourceSet-compatible image descriptor (preferred over URI-only). */
export interface ImageSource {
  uri: string;
  width: number;
  height: number;
}

export type ImageSourceInput = string | ImageSource;

function normalizeImageSource(input: ImageSourceInput): ImageSource {
  if (typeof input === "string") {
    // Dimensions unknown — still prefer sourceSet with a conservative square so
    // callers that only have a URI do not fall back to imageFileURI alone.
    return { uri: input, width: 1024, height: 1024 };
  }
  if (
    !input?.uri ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw new Error(
      `Image source requires uri + positive width/height, got ${JSON.stringify(input)}`,
    );
  }
  return input;
}

/**
 * Replace an image block's source by block name using setSourceSet + block-level
 * contentFillMode (never setString(fill/image/imageFileURI) alone; never set
 * contentFillMode on the fill).
 */
export function replaceImageByName(
  engine: CreativeEngine,
  blockName: string,
  image: ImageSourceInput,
  options: NamedBlockOptions = {},
): void {
  const required = options.required ?? true;
  const [block] = engine.block.findByName(blockName);

  if (block == null) {
    if (required) {
      throw new Error(`Required image block "${blockName}" not found in scene`);
    }
    return;
  }
  if (!engine.block.supportsFill(block)) {
    if (required) {
      throw new Error(`Required block "${blockName}" does not support a fill`);
    }
    return;
  }

  const fillBlock = engine.block.getFill(block);
  if (engine.block.getType(fillBlock) !== "//ly.img.ubq/fill/image") {
    if (required) {
      throw new Error(
        `Required block "${blockName}" fill is not an image fill (got ${engine.block.getType(fillBlock)})`,
      );
    }
    return;
  }

  const source = normalizeImageSource(image);
  assertHasProperty(engine, fillBlock, "fill/image/sourceSet");
  engine.block.setSourceSet(fillBlock, "fill/image/sourceSet", [
    { uri: source.uri, width: source.width, height: source.height },
  ]);
  engine.block.resetCrop(block);
  // contentFill/mode belongs on the graphic block, not the fill
  if (engine.block.supportsContentFillMode(block)) {
    engine.block.setContentFillMode(block, "Cover");
  }
}

/**
 * Set a named graphic block's color fill from a hex string.
 */
export function setColorFillByName(
  engine: CreativeEngine,
  blockName: string,
  hex: string,
  options: NamedBlockOptions = {},
): void {
  const required = options.required ?? true;
  const [block] = engine.block.findByName(blockName);

  if (block == null) {
    if (required) {
      throw new Error(`Required color block "${blockName}" not found in scene`);
    }
    return;
  }
  if (!engine.block.supportsFill(block)) {
    if (required) {
      throw new Error(`Required block "${blockName}" does not support a fill`);
    }
    return;
  }

  const fillBlock = engine.block.getFill(block);
  if (engine.block.getType(fillBlock) !== "//ly.img.ubq/fill/color") {
    if (required) {
      throw new Error(
        `Required block "${blockName}" fill is not a color fill (got ${engine.block.getType(fillBlock)})`,
      );
    }
    return;
  }

  assertHasProperty(engine, fillBlock, "fill/color/value");
  engine.block.setColor(fillBlock, "fill/color/value", hexToRgba(hex));
}

/**
 * Export current scene as an image blob URL.
 */
export async function exportSceneAsImage(
  engine: CreativeEngine,
  mimeType: "image/png" | "image/jpeg" = "image/jpeg",
): Promise<string | null> {
  const scene = engine.scene.get();
  if (scene == null) return null;

  const blob = await engine.block.export(scene, { mimeType });
  return URL.createObjectURL(blob);
}
