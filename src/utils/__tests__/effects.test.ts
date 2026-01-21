import { describe, expect, test } from "vitest";

import {
  buildLayerEffectString,
  defaultLayerEffectSettings,
  isDefaultEffectSettings
} from "../effects";

describe("effects", () => {
  test("buildLayerEffectString omits drop-shadow when default", () => {
    const result = buildLayerEffectString(defaultLayerEffectSettings);
    expect(result.includes("drop-shadow")).toBe(false);
  });

  test("buildLayerEffectString includes drop-shadow when enabled", () => {
    const result = buildLayerEffectString({
      ...defaultLayerEffectSettings,
      dropShadowOffsetX: 4,
      dropShadowOffsetY: 2,
      dropShadowBlur: 6
    });
    expect(result.includes("drop-shadow")).toBe(true);
  });

  test("isDefaultEffectSettings detects defaults", () => {
    expect(isDefaultEffectSettings(defaultLayerEffectSettings)).toBe(true);
  });

  test("isDefaultEffectSettings detects changes", () => {
    expect(
      isDefaultEffectSettings({ ...defaultLayerEffectSettings, brightness: 0.9 })
    ).toBe(false);
  });
});
