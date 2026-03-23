import Color from "@arcgis/core/Color";

import type { LayerData } from "../types";
import { buildLayerEffectString, defaultLayerEffectSettings, isDefaultEffectSettings } from "../utils/effects";
import {
  getPointOrientationAngle,
  getPointOrientationHeading,
  getSymbolLayers,
  setSymbolLayers,
  toFiniteNumber
} from "./pointOrientation";
import type { PointSymbolOrientation } from "./pointOrientation";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;
const GLOW_INTENSITY_MULTIPLIER = 10;

const fract = (value: number) => value - Math.floor(value);
const noise1 = (value: number) => fract(Math.sin(value) * 43758.5453123);
const triangleWave = (value: number) => {
  const t = value - Math.floor(value);
  return 1 - Math.abs(t * 2 - 1);
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildBaseLayerEffect = (layerData: LayerData) => {
  const settings = layerData.layerEffectSettings ?? defaultLayerEffectSettings;
  const enabled = layerData.layerEffectsEnabled !== false;
  if (!enabled || isDefaultEffectSettings(settings)) {
    return "";
  }
  return buildLayerEffectString(settings);
};

const applyBaseLayerEffect = (layerData: LayerData) => {
  layerData.layer.blendMode = layerData.layerBlendMode || "normal";
  layerData.layer.effect = buildBaseLayerEffect(layerData);
};

const getLayerGlowColor = (layerData: LayerData) => {
  if (layerData.type === "point") {
    return layerData.pointStyle?.color ?? "#7ac7b0";
  }
  if (layerData.type === "polyline") {
    return layerData.lineStyle?.color ?? "#7ac7b0";
  }
  if (layerData.type === "polygon") {
    return layerData.polygonStyle?.outlineColor ?? layerData.polygonStyle?.color ?? "#7ac7b0";
  }
  if (layerData.type === "text") {
    return layerData.textColor ?? "#7ac7b0";
  }
  return "#7ac7b0";
};

const getPulse = (progress: number, cycles = 2) =>
  0.5 + 0.5 * Math.sin(progress * TAU * cycles);

const joinEffects = (parts: Array<string | null | undefined>) =>
  parts.filter((part) => part && part.length > 0).join(" ");

const arrowMarkerPath = "M12 2 L22 22 L12 17 L2 22 Z";
const planeMarkerPath = "M12 1 L14.8 8.8 L22.5 11 L14.8 13.2 L12 23 L9.2 13.2 L1.5 11 L9.2 8.8 Z";
const cartoonPlaneMarkerPath =
  "M2 12 L8 10 L9 6 L15 4 L21 7 L16 10 L23 12 L16 14 L21 17 L15 20 L9 18 L8 14 Z";
const dartMarkerPath =
  "M1.5 6.5 L7.8 9.8 L18.8 9.8 L24 12 L18.8 14.2 L7.8 14.2 L1.5 17.5 L3.7 12 Z";
const dartCoreMarkerPath =
  "M5.2 10.5 L19.6 10.5 L22.2 12 L19.6 13.5 L5.2 13.5 L4.1 12 Z";
const dartFinMarkerPath = "M3 12 L20.5 5.6 L20.5 18.4 Z";

const toRgbaArray = (color: string, alpha = 1) => {
  try {
    const arcColor = new Color(color);
    const rgba = arcColor.toRgba() as number[];
    rgba[3] = alpha;
    return rgba;
  } catch {
    return [10, 76, 102, alpha];
  }
};

const parseColorToRgbaArray = (
  color: string | undefined,
  fallback: [number, number, number, number]
): [number, number, number, number] => {
  if (!color) return fallback;
  try {
    const rgba = new Color(color).toRgba() as number[];
    return [
      Number.isFinite(Number(rgba[0])) ? Number(rgba[0]) : fallback[0],
      Number.isFinite(Number(rgba[1])) ? Number(rgba[1]) : fallback[1],
      Number.isFinite(Number(rgba[2])) ? Number(rgba[2]) : fallback[2],
      Number.isFinite(Number(rgba[3])) ? clamp(Number(rgba[3]), 0, 1) : fallback[3]
    ];
  } catch {
    return fallback;
  }
};

const toClampedColorArray = (
  color: ArrayLike<number> | null | undefined,
  fallback: [number, number, number, number]
): [number, number, number, number] => {
  const r = Number(color?.[0]);
  const g = Number(color?.[1]);
  const b = Number(color?.[2]);
  const a = Number(color?.[3]);
  return [
    Number.isFinite(r) ? clamp(r, 0, 255) : fallback[0],
    Number.isFinite(g) ? clamp(g, 0, 255) : fallback[1],
    Number.isFinite(b) ? clamp(b, 0, 255) : fallback[2],
    Number.isFinite(a) ? clamp(a, 0, 1) : fallback[3]
  ];
};

const buildEmissiveMaterial = (
  rgba: [number, number, number, number],
  intensity: number
) => {
  const alpha = clamp(rgba[3], 0, 1);
  const clampedIntensity = clamp(intensity * GLOW_INTENSITY_MULTIPLIER * alpha, 0, 22);
  return {
    color: rgba,
    emissive: {
      source: "color",
      strength: clampedIntensity
    }
  };
};

const buildWeldLineSymbol = (
  width: number,
  color: ArrayLike<number> | null | undefined,
  use3D: boolean
) => {
  const rgba = toClampedColorArray(color, [255, 255, 255, 1]);
  if (use3D) {
    const strokeSize = Math.max(0.6, width);
    return {
      type: "line-3d",
      symbolLayers: [
        {
          type: "path",
          profile: "circle",
          cap: "round",
          join: "round",
          width: strokeSize,
          height: strokeSize,
          material: buildEmissiveMaterial(rgba, 0.95)
        }
      ]
    } as any;
  }
  return {
    type: "simple-line",
    style: "solid",
    width,
    color: rgba
  } as any;
};

const buildWeldPointSymbol = (
  size: number,
  color: ArrayLike<number> | null | undefined,
  outlineColor: ArrayLike<number> | null | undefined,
  outlineWidth: number,
  use3D: boolean
) => {
  const fillRgba = toClampedColorArray(color, [255, 255, 255, 1]);
  const strokeRgba = toClampedColorArray(outlineColor, [0, 0, 0, 0]);
  if (use3D) {
    return {
      type: "point-3d",
      symbolLayers: [
        {
          type: "icon",
          resource: { primitive: "circle" },
          size: Math.max(1.4, size),
          material: buildEmissiveMaterial(fillRgba, 0.85),
          outline: {
            color: strokeRgba,
            size: Math.max(0, outlineWidth)
          }
        }
      ]
    } as any;
  }
  return {
    type: "simple-marker",
    style: "circle",
    size,
    color: fillRgba,
    outline: {
      color: strokeRgba,
      width: Math.max(0, outlineWidth)
    }
  } as any;
};

const hueToRgb = (p: number, q: number, t: number) => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const rotateHueRgba = (
  rgba: [number, number, number, number],
  degrees: number
): [number, number, number, number] => {
  const r = clamp(rgba[0], 0, 255) / 255;
  const g = clamp(rgba[1], 0, 255) / 255;
  const b = clamp(rgba[2], 0, 255) / 255;
  const a = clamp(rgba[3], 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  h += degrees / 360;
  h = ((h % 1) + 1) % 1;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray, a];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const nextR = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const nextG = Math.round(hueToRgb(p, q, h) * 255);
  const nextB = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return [nextR, nextG, nextB, a];
};

const cloneSymbol = (symbol: any) => {
  if (!symbol) return null;
  if (typeof symbol.clone === "function") {
    return symbol.clone();
  }
  return {
    ...symbol,
    outline: symbol?.outline ? { ...symbol.outline } : symbol?.outline,
    font: symbol?.font ? { ...symbol.font } : symbol?.font,
    symbolLayers: Array.isArray(symbol?.symbolLayers)
      ? symbol.symbolLayers.map((layer: any) => ({
          ...layer,
          material: layer?.material ? { ...layer.material } : layer?.material,
          outline: layer?.outline ? { ...layer.outline } : layer?.outline,
          halo: layer?.halo ? { ...layer.halo } : layer?.halo,
          font: layer?.font ? { ...layer.font } : layer?.font,
          resource: layer?.resource ? { ...layer.resource } : layer?.resource
        }))
      : symbol?.symbolLayers
  };
};

const EPSILON = 0.001;

const normalizeDegrees = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const anglesClose = (left: unknown, right: unknown, epsilon = EPSILON) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const aNorm = normalizeDegrees(a);
  const bNorm = normalizeDegrees(b);
  let delta = Math.abs(aNorm - bNorm);
  if (delta > 180) {
    delta = 360 - delta;
  }
  return delta <= epsilon;
};

const numbersClose = (left: unknown, right: unknown, epsilon = EPSILON) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= epsilon;
};

const pointSymbolAlreadyMatchesState = (
  symbol: any,
  size: number,
  orientation: Partial<PointSymbolOrientation>
) => {
  const angle = getPointOrientationAngle(orientation);
  const heading = getPointOrientationHeading(orientation);
  const tilt = toFiniteNumber(orientation.tilt);
  const roll = toFiniteNumber(orientation.roll);
  if (!symbol) return false;
  if (symbol.type === "simple-marker") {
    return numbersClose(symbol.size, size) && anglesClose(symbol.angle, angle);
  }
  if (symbol.type !== "point-3d") {
    return false;
  }
  const symbolLayers = getSymbolLayers(symbol);
  if (!symbolLayers.length) return false;
  let hasComparableLayer = false;
  for (const layer of symbolLayers) {
    if (!layer) continue;
    if (layer.type === "icon") {
      hasComparableLayer = true;
      if (!numbersClose(layer.size, size) || !anglesClose(layer.angle, angle)) {
        return false;
      }
      continue;
    }
    if (layer.type === "object") {
      hasComparableLayer = true;
      if (!anglesClose(layer.heading, heading) || !numbersClose(layer.tilt, tilt) || !anglesClose(layer.roll, roll)) {
        return false;
      }
    }
  }
  return hasComparableLayer;
};

const applyPointSymbolScaleOrientation = (
  graphic: any,
  size: number,
  orientation: Partial<PointSymbolOrientation>
) => {
  const liveSymbol = graphic?.symbol;
  if (pointSymbolAlreadyMatchesState(liveSymbol, size, orientation)) {
    return true;
  }
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol) return false;
  if (symbol.type === "simple-marker") {
    symbol.size = size;
    const angle = getPointOrientationAngle(orientation);
    if (Number.isFinite(angle)) {
      symbol.angle = angle;
    }
    graphic.symbol = symbol;
    return true;
  }
  if (symbol.type === "point-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return false;
    const angle = getPointOrientationAngle(orientation);
    const heading = getPointOrientationHeading(orientation);
    const tilt = toFiniteNumber(orientation.tilt);
    const roll = toFiniteNumber(orientation.roll);
    let changed = false;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (layer?.type !== "icon" && layer?.type !== "object") return layer;
      changed = true;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
      if (nextLayer?.type === "icon") {
        nextLayer.size = size;
        if (Number.isFinite(angle)) {
          nextLayer.angle = angle;
        }
      } else if (nextLayer?.type === "object") {
        if (Number.isFinite(heading)) {
          nextLayer.heading = heading;
        }
        if (Number.isFinite(tilt)) {
          nextLayer.tilt = tilt;
        }
        if (Number.isFinite(roll)) {
          nextLayer.roll = roll;
        }
      }
      return nextLayer;
    });
    if (changed) {
      setSymbolLayers(symbol, nextLayers);
      graphic.symbol = symbol;
      return true;
    }
  }
  return false;
};

const applyLineSymbolWidth = (graphic: any, width: number) => {
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol) return false;
  if (symbol.type === "simple-line") {
    symbol.width = width;
    graphic.symbol = symbol;
    return true;
  }
  if (symbol.type === "line-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return false;
    let changed = false;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (layer?.type !== "line" && layer?.type !== "path") return layer;
      changed = true;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
      if (nextLayer?.type === "path") {
        nextLayer.width = width;
        nextLayer.height = width;
      } else {
        nextLayer.size = width;
      }
      return nextLayer;
    });
    if (changed) {
      setSymbolLayers(symbol, nextLayers);
      graphic.symbol = symbol;
      return true;
    }
  }
  return false;
};

const applyPolygonExtrusionHeight = (graphic: any, height: number) => {
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol || symbol.type !== "polygon-3d") return false;
  const symbolLayers = getSymbolLayers(symbol);
  if (!symbolLayers.length) return false;
  let changed = false;
  const nextLayers = symbolLayers.map((layer: any) => {
    if (layer?.type !== "extrude") return layer;
    changed = true;
    const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
    nextLayer.size = height;
    return nextLayer;
  });
  if (!changed) return false;
  setSymbolLayers(symbol, nextLayers);
  graphic.symbol = symbol;
  return true;
};

const applyLineSymbolGlow = (
  graphic: any,
  intensity: number,
  colorOverride?: ArrayLike<number> | null
) => {
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol || symbol.type !== "line-3d") return false;
  const symbolLayers = getSymbolLayers(symbol);
  if (!symbolLayers.length) return false;
  const override = colorOverride
    ? toClampedColorArray(colorOverride, [255, 255, 255, 1])
    : null;
  let changed = false;
  const nextLayers = symbolLayers.map((layer: any) => {
    if (layer?.type !== "line" && layer?.type !== "path") return layer;
    changed = true;
    const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
    const sourceColor = toClampedColorArray(nextLayer?.material?.color, [255, 255, 255, 1]);
    const nextColor = override ?? sourceColor;
    nextLayer.material = {
      ...(nextLayer?.material ?? {}),
      ...buildEmissiveMaterial(nextColor, intensity)
    };
    return nextLayer;
  });
  if (!changed) return false;
  setSymbolLayers(symbol, nextLayers);
  graphic.symbol = symbol;
  return true;
};

export {
  applyBaseLayerEffect,
  applyLineSymbolGlow,
  applyLineSymbolWidth,
  applyPolygonExtrusionHeight,
  applyPointSymbolScaleOrientation,
  arrowMarkerPath,
  buildBaseLayerEffect,
  buildWeldLineSymbol,
  buildWeldPointSymbol,
  cartoonPlaneMarkerPath,
  clamp,
  cloneSymbol,
  dartCoreMarkerPath,
  dartFinMarkerPath,
  dartMarkerPath,
  getLayerGlowColor,
  getPulse,
  getSymbolLayers,
  hashString,
  joinEffects,
  noise1,
  parseColorToRgbaArray,
  planeMarkerPath,
  rotateHueRgba,
  setSymbolLayers,
  TAU,
  toRgbaArray,
  triangleWave
};
