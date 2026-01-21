import type { LayerEffectSettings } from "../types";

export const defaultLayerEffectSettings: LayerEffectSettings = {
  brightness: 1,
  contrast: 100,
  grayscale: 0,
  hueRotate: 0,
  invert: 0,
  opacity: 1,
  saturate: 1,
  sepia: 0,
  blur: 0,
  dropShadowOffsetX: 0,
  dropShadowOffsetY: 0,
  dropShadowBlur: 0,
  dropShadowColor: "#000000"
};

export function buildLayerEffectString(settings: LayerEffectSettings) {
  const parts = [
    `brightness(${settings.brightness})`,
    `contrast(${settings.contrast}%)`,
    `grayscale(${settings.grayscale})`,
    `hue-rotate(${settings.hueRotate}deg)`,
    `invert(${settings.invert})`,
    `opacity(${settings.opacity})`,
    `saturate(${settings.saturate})`,
    `sepia(${settings.sepia})`,
    `blur(${settings.blur}px)`
  ];

  if (
    settings.dropShadowBlur > 0 ||
    settings.dropShadowOffsetX !== 0 ||
    settings.dropShadowOffsetY !== 0
  ) {
    parts.push(
      `drop-shadow(${settings.dropShadowOffsetX}px ${settings.dropShadowOffsetY}px ${settings.dropShadowBlur}px ${settings.dropShadowColor})`
    );
  }

  return parts.join(" ");
}

export function isDefaultEffectSettings(settings: LayerEffectSettings) {
  return (
    settings.brightness === defaultLayerEffectSettings.brightness &&
    settings.contrast === defaultLayerEffectSettings.contrast &&
    settings.grayscale === defaultLayerEffectSettings.grayscale &&
    settings.hueRotate === defaultLayerEffectSettings.hueRotate &&
    settings.invert === defaultLayerEffectSettings.invert &&
    settings.opacity === defaultLayerEffectSettings.opacity &&
    settings.saturate === defaultLayerEffectSettings.saturate &&
    settings.sepia === defaultLayerEffectSettings.sepia &&
    settings.blur === defaultLayerEffectSettings.blur &&
    settings.dropShadowOffsetX === defaultLayerEffectSettings.dropShadowOffsetX &&
    settings.dropShadowOffsetY === defaultLayerEffectSettings.dropShadowOffsetY &&
    settings.dropShadowBlur === defaultLayerEffectSettings.dropShadowBlur &&
    settings.dropShadowColor.toLowerCase() ===
      defaultLayerEffectSettings.dropShadowColor.toLowerCase()
  );
}
