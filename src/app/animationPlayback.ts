import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

import type { LayerAnimation, LayerData, PointKeyframe, PointStyle } from "../types";
import { buildPartialPaths } from "../utils/geometryPaths";
import { buildLayerEffectString, defaultLayerEffectSettings, isDefaultEffectSettings } from "../utils/effects";
import { defaultLineStyle, defaultPolygonStyle } from "./constants";

type AnimationPlaybackConfig = {
  getView: () => any;
  getGraphicsLayers: () => LayerData[];
  defaultPointStyle: PointStyle;
  hasPointKeyframes: (layerData: LayerData) => boolean;
  getPointKeyframeAtTime: (layerData: LayerData, time: number) => PointKeyframe | null;
  applyFeatureLayerAnimation: (layerData: LayerData, time: number) => void;
  isPlaying: () => boolean;
  isScrubbingTimeline: () => boolean;
};

const updatePolylineDraw = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  maxDrawEnd: number,
  isPlaying: boolean,
  isScrubbingTimeline: boolean
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic.geometry || graphic.geometry.type !== "polyline") return;

    if (!graphic.__originalGeometry) {
      graphic.__originalGeometry = graphic.geometry.clone();
    }

    const original = graphic.__originalGeometry as Polyline;
    if (!isPlaying && !isScrubbingTimeline) {
      const displayGeometry = (original.spatialReference as any)?.isGeographic
        ? (graphic.__densifiedGeometry ?? densifyPolyline(original))
        : original;
      graphic.__densifiedGeometry = displayGeometry;
      graphic.geometry = displayGeometry.clone();
      return;
    }
    const densified = graphic.__densifiedGeometry ?? densifyPolyline(original);
    graphic.__densifiedGeometry = densified;

    if (activeAnim) {
      const progress = Math.min(1, Math.max(0, (time - activeAnim.start) / activeAnim.duration));
      const reverse = activeAnim.type === "drawReverse";
      graphic.geometry = buildPartialPolyline(densified, progress, reverse);
      return;
    }

    if (time > maxDrawEnd) {
      const displayGeometry = (original.spatialReference as any)?.isGeographic ? densified : original;
      graphic.geometry = displayGeometry.clone();
    } else if (time < maxDrawEnd) {
      graphic.geometry = buildPartialPolyline(densified, 0, false);
    }
  });
};

const updatePolygonFill = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  maxFillEnd: number
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic.geometry || graphic.geometry.type !== "polygon") return;

    if (!graphic.__originalGeometry) {
      graphic.__originalGeometry = graphic.geometry.clone();
    }

    const original = graphic.__originalGeometry as Polygon;

    if (activeAnim) {
      const progress = Math.min(1, Math.max(0, (time - activeAnim.start) / activeAnim.duration));
      if (!graphic.__fillMaxInset) {
        graphic.__fillMaxInset = estimateFillInset(original);
      }
      const inset = graphic.__fillMaxInset * (1 - progress);
      if (inset <= 0) {
        graphic.geometry = original.clone();
        return;
      }
      const buffered = geometryEngine.buffer(original, -inset) as Polygon | null;
      if (buffered && buffered.rings?.length) {
        graphic.geometry = buffered;
        return;
      }
      graphic.geometry = progress >= 0.98 ? original.clone() : buildEmptyPolygon(original);
      return;
    }

    if (time > maxFillEnd) {
      graphic.geometry = original.clone();
    } else if (time < maxFillEnd) {
      graphic.geometry = buildEmptyPolygon(original);
    }
  });
};

const estimateFillInset = (geometry: Polygon) => {
  const extent = geometry.extent;
  if (!extent) {
    return 0;
  }
  const width = extent.width ?? extent.xmax - extent.xmin;
  const height = extent.height ?? extent.ymax - extent.ymin;
  const minDim = Math.min(width, height);
  if (!Number.isFinite(minDim) || minDim <= 0) {
    return 0;
  }
  return minDim * 0.5;
};

const buildEmptyPolygon = (geometry: Polygon) => {
  return new Polygon({
    spatialReference: geometry.spatialReference,
    rings: []
  });
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;

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

const getGeometryExtentScale = (geometry: Polyline | Polygon) => {
  const extent = geometry.extent;
  if (!extent) return 1;
  const width = extent.width ?? extent.xmax - extent.xmin;
  const height = extent.height ?? extent.ymax - extent.ymin;
  const span = Math.max(width, height);
  return Number.isFinite(span) && span > 0 ? span : 1;
};

const getJitterAmplitude = (geometry: Polyline | Polygon) => {
  const span = getGeometryExtentScale(geometry);
  const isGeographic = Boolean((geometry.spatialReference as any)?.isGeographic);
  if (isGeographic) {
    return clamp(span * 0.004, 0.00005, 0.002);
  }
  return clamp(span * 0.004, 0.5, span * 0.02);
};

const jitterPath = (
  path: number[][],
  time: number,
  seed: number,
  amplitude: number,
  pathIndex: number
) => {
  const t = time * 3;
  return path.map((point, idx) => {
    const x = point[0];
    const y = point[1];
    const noiseX = noise1(seed + pathIndex * 12.9898 + idx * 78.233 + t * 1.3);
    const noiseY = noise1(seed + pathIndex * 39.3467 + idx * 11.135 + t * 1.1);
    const offsetX = (noiseX * 2 - 1) * amplitude;
    const offsetY = (noiseY * 2 - 1) * amplitude;
    if (point.length > 2) {
      return [x + offsetX, y + offsetY, ...point.slice(2)];
    }
    return [x + offsetX, y + offsetY];
  });
};

const jitterPolyline = (geometry: Polyline, time: number, seed: number) => {
  const amplitude = getJitterAmplitude(geometry);
  if (!geometry.paths?.length) return geometry.clone();
  const paths = geometry.paths.map((path, pathIndex) =>
    jitterPath(path, time, seed, amplitude, pathIndex)
  );
  return new Polyline({
    spatialReference: geometry.spatialReference,
    paths
  });
};

const jitterPolygon = (geometry: Polygon, time: number, seed: number) => {
  const amplitude = getJitterAmplitude(geometry);
  if (!geometry.rings?.length) return geometry.clone();
  const rings = geometry.rings.map((ring, ringIndex) => {
    const nextRing = jitterPath(ring, time, seed, amplitude, ringIndex);
    if (nextRing.length > 2) {
      nextRing[nextRing.length - 1] = [...nextRing[0]];
    }
    return nextRing;
  });
  return new Polygon({
    spatialReference: geometry.spatialReference,
    rings
  });
};

type MarchSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  len: number;
  accum: number;
};

const buildMarchSegments = (geometry: Polyline) => {
  const segments: MarchSegment[] = [];
  let total = 0;
  geometry.paths?.forEach((path) => {
    for (let i = 1; i < path.length; i += 1) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len <= 0) {
        continue;
      }
      segments.push({ x0, y0, x1, y1, dx, dy, len, accum: total });
      total += len;
    }
  });
  return { segments, total };
};

const sampleMarchPoint = (segments: MarchSegment[], distance: number) => {
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (distance <= seg.accum + seg.len) {
      const t = (distance - seg.accum) / seg.len;
      const x = seg.x0 + seg.dx * t;
      const y = seg.y0 + seg.dy * t;
      const heading = Math.atan2(seg.dy, seg.dx);
      const angle = 90 - heading * (180 / Math.PI);
      const ux = seg.dx / seg.len;
      const uy = seg.dy / seg.len;
      return { x, y, angle, ux, uy, heading };
    }
  }
  return null;
};

const getArrowLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__arrowLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1
  });
  view?.map?.add(layer);
  (layerData as any).__arrowLayer = layer;
  return layer;
};

const clearArrowLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__arrowLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const getBarrageLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__barrageLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1
  });
  view?.map?.add(layer);
  (layerData as any).__barrageLayer = layer;
  return layer;
};

const clearBarrageLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__barrageLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const densifyPolyline = (polyline: Polyline) => {
  const isGeographic = Boolean((polyline.spatialReference as any)?.isGeographic);
  const totalLength = isGeographic
    ? geometryEngine.geodesicLength(polyline) || 0
    : geometryEngine.planarLength(polyline) || 0;
  if (totalLength <= 0) {
    return polyline.clone();
  }
  const maxSegmentLength = Math.max(totalLength / 400, totalLength / 2000, 0.00001);
  const densified = (isGeographic
    ? geometryEngine.geodesicDensify(polyline, maxSegmentLength)
    : geometryEngine.densify(polyline, maxSegmentLength)) as Polyline;
  if (!densified?.paths?.length) {
    return polyline.clone();
  }
  return densified;
};

const buildPartialPolyline = (polyline: Polyline, progress: number, reverse: boolean) => {
  const resultPaths = buildPartialPaths(polyline.paths, progress, reverse);
  return new Polyline({
    spatialReference: polyline.spatialReference,
    paths: resultPaths
  });
};

const applyAnimationsAtTime = (config: AnimationPlaybackConfig, time: number) => {
  const isPlaying = config.isPlaying();
  const isScrubbingTimeline = config.isScrubbingTimeline();
  config.getGraphicsLayers().forEach((layerData) => {
    if (layerData.type === "feature") {
      config.applyFeatureLayerAnimation(layerData, time);
      return;
    }
    const isPreviewing = isPlaying || isScrubbingTimeline;
    const hasRealAnimations = layerData.animations?.some((anim) => anim.type !== "__placeholder__") ?? false;
    if (!hasRealAnimations && !config.hasPointKeyframes(layerData)) {
      layerData.layer.opacity = 1;
      return;
    }
    if (!isPreviewing) {
      layerData.layer.opacity = 1;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (graphic.__originalGeometry) {
          graphic.geometry = graphic.__originalGeometry.clone();
        }
      });
      applyBaseLayerEffect(layerData);
      clearArrowLayer(layerData);
      clearBarrageLayer(layerData);
      if (layerData.type === "point") {
        const baseSize = layerData.pointStyle?.size ?? config.defaultPointStyle.size;
        const baseAngle = layerData.pointStyle?.angle ?? 0;
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.symbol || graphic.symbol.type !== "simple-marker") return;
          const symbol = graphic.symbol.clone();
          symbol.size = baseSize;
          symbol.angle = baseAngle;
          graphic.symbol = symbol;
        });
      }
      if (layerData.type === "polyline") {
        const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.symbol || graphic.symbol.type !== "simple-line") return;
          const symbol = graphic.symbol.clone();
          symbol.width = baseWidth;
          graphic.symbol = symbol;
        });
      }
      if (layerData.type === "polygon") {
        const baseOutline = layerData.polygonStyle?.outlineWidth ?? defaultPolygonStyle.outlineWidth;
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.symbol || graphic.symbol.type !== "simple-fill" || !graphic.symbol.outline) return;
          const symbol = graphic.symbol.clone();
          symbol.outline = { ...symbol.outline, width: baseOutline };
          graphic.symbol = symbol;
        });
      }
      if (layerData.type === "text") {
        const baseText = layerData.textContent || "Text";
        const baseSize = layerData.textSize ?? 14;
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.symbol || graphic.symbol.type !== "text") return;
          const symbol = graphic.symbol.clone();
          symbol.text = baseText;
          symbol.font = symbol.font || { size: baseSize, family: "sans-serif" };
          symbol.font.size = baseSize;
          symbol.font.family = layerData.textFontFamily || symbol.font.family || "sans-serif";
          symbol.font.style = layerData.textItalic ? "italic" : "normal";
          symbol.font.decoration = layerData.textUnderline ? "underline" : "none";
          graphic.symbol = symbol;
        });
      }
      if (config.hasPointKeyframes(layerData)) {
        applyPointKeyframes(layerData, time, config.getPointKeyframeAtTime);
      }
      return;
    }
    let layerVisible = false;
    let opacity = 1;
    let baseLayerOpacity = 1;
    let scale = 1;
    let lineWidthScale = 1;
    let outlineWidthScale = 1;
    let activeDrawAnimation: LayerAnimation | null = null;
    let hasDrawAnimation = false;
    let maxDrawEnd = 0;
    let minDrawStart = Number.POSITIVE_INFINITY;
    let activeFillAnimation: LayerAnimation | null = null;
    let hasFillAnimation = false;
    let maxFillEnd = 0;
    let minFillStart = Number.POSITIVE_INFINITY;
    let activeSpinProgress: number | null = null;
    let activeTypewriter: { anim: LayerAnimation; progress: number } | null = null;
    let maxTypewriterEnd = 0;
    let minTypewriterStart = Number.POSITIVE_INFINITY;
    let hasTypewriterAnimation = false;
    let hasActiveAnimation = false;
    let latestEndedAnimation: LayerAnimation | null = null;
    let latestEndedAnimationEnd = Number.NEGATIVE_INFINITY;
    let glowProgress: number | null = null;
    let glowMode: "soft" | "pulse" | null = null;
    let neonProgress: number | null = null;
    let gradientProgress: number | null = null;
    let prismProgress: number | null = null;
    let flickerProgress: number | null = null;
    let hazeProgress: number | null = null;
    let scanlineProgress: number | null = null;
    let sparkProgress: number | null = null;
    let arrowProgress: number | null = null;
    let barrageProgress: number | null = null;
    let jitterProgress: number | null = null;
    let dissolveProgress: number | null = null;
    let ghostProgress: number | null = null;
    let breatheProgress: number | null = null;
    let pixelateProgress: number | null = null;
    const layerSeed = hashString(layerData.name || "layer");

    layerData.animations.forEach((anim: LayerAnimation) => {
      if (anim.type === "__placeholder__") {
        return;
      }
      const animEnd = anim.start + anim.duration;
      if (anim.type === "draw" || anim.type === "drawReverse" || anim.type === "neonTrail") {
        hasDrawAnimation = true;
        maxDrawEnd = Math.max(maxDrawEnd, animEnd);
        minDrawStart = Math.min(minDrawStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          activeDrawAnimation = anim;
        }
      }
      if (anim.type === "fill") {
        hasFillAnimation = true;
        maxFillEnd = Math.max(maxFillEnd, animEnd);
        minFillStart = Math.min(minFillStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          activeFillAnimation = anim;
        }
      }
      if (anim.type === "typewriter") {
        hasTypewriterAnimation = true;
        maxTypewriterEnd = Math.max(maxTypewriterEnd, animEnd);
        minTypewriterStart = Math.min(minTypewriterStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          const progress = (time - anim.start) / anim.duration;
          activeTypewriter = { anim, progress };
        }
      }

      if (time >= anim.start && time <= animEnd) {
        hasActiveAnimation = true;
        layerVisible = true;
        const progress = (time - anim.start) / anim.duration;

        switch (anim.type) {
          case "fadeIn":
            opacity = progress;
            break;
          case "fadeOut":
            opacity = 1 - progress;
            break;
          case "pulse":
            opacity = 0.5 + 0.5 * Math.sin(progress * Math.PI * 4);
            scale = 0.9 + 0.15 * Math.sin(progress * Math.PI * 4);
            break;
          case "grow":
            scale = 0.5 + progress * 0.5;
            break;
          case "bounce":
            scale = 1 + Math.sin(progress * Math.PI * 2) * 0.3;
            break;
          case "spin":
            activeSpinProgress = progress;
            break;
          case "glow":
            glowProgress = progress;
            glowMode = "soft";
            opacity = 1;
            break;
          case "glowPulse": {
            const pulse = Math.sin(progress * Math.PI * 2);
            opacity = 0.85 + 0.15 * pulse;
            scale = 0.95 + 0.08 * pulse;
            glowProgress = progress;
            glowMode = "pulse";
            break;
          }
          case "electricFlicker":
            flickerProgress = progress;
            opacity = 1;
            break;
          case "heatHaze":
            hazeProgress = progress;
            opacity = 1;
            break;
          case "scanline":
            scanlineProgress = progress;
            opacity = 1;
            break;
          case "sparkEmit":
            sparkProgress = progress;
            opacity = 1;
            break;
          case "arrowMarch":
            arrowProgress = progress;
            opacity = 1;
            break;
          case "barrageOfArrows":
            barrageProgress = progress;
            opacity = 1;
            break;
          case "jitterSketch":
            jitterProgress = progress;
            opacity = 1;
            break;
          case "noiseDissolve":
            dissolveProgress = progress;
            opacity = progress;
            break;
          case "ghostTrail":
            ghostProgress = progress;
            opacity = 0.85;
            break;
          case "breathe":
            breatheProgress = progress;
            opacity = 1;
            break;
          case "pixelate":
            pixelateProgress = progress;
            opacity = 1;
            break;
          case "timeGradient":
            gradientProgress = progress;
            opacity = 1;
            break;
          case "neonTrail":
            neonProgress = progress;
            glowProgress = progress;
            glowMode = "pulse";
            gradientProgress = progress;
            opacity = 1;
            break;
          case "prismShift":
            prismProgress = progress;
            opacity = 1;
            break;
          case "draw":
          case "drawReverse":
            opacity = 1;
            break;
          case "fill":
            opacity = 1;
            break;
          default:
            opacity = 1;
        }
      }

      if (animEnd <= time && animEnd > latestEndedAnimationEnd) {
        latestEndedAnimation = anim;
        latestEndedAnimationEnd = animEnd;
      }
    });

    const timeSeed = time + layerSeed * 0.001;
    if (flickerProgress !== null) {
      const flickerA = 0.5 + 0.5 * Math.sin(timeSeed * 35);
      const flickerB = 0.5 + 0.5 * Math.sin(timeSeed * 61 + 1.7);
      const flicker = flickerA * flickerB;
      opacity *= 0.7 + 0.3 * flicker;
    }
    if (scanlineProgress !== null) {
      const scan = triangleWave(timeSeed * 1.2);
      opacity *= 0.85 + 0.15 * scan;
    }
    if (dissolveProgress !== null) {
      opacity *= clamp(dissolveProgress, 0, 1);
    }
    if (ghostProgress !== null) {
      opacity *= 0.85;
    }
    if (breatheProgress !== null) {
      const breathe = getPulse(breatheProgress, 1);
      scale *= 0.92 + breathe * 0.1;
      opacity *= 0.9 + breathe * 0.1;
    }

    if (layerData.animations.length > 0) {
      if (config.hasPointKeyframes(layerData) && !layerData.animations.some((anim) => anim.type !== "__placeholder__")) {
        const firstKeyframeTime = layerData.pointKeyframes?.[0]?.time ?? 0;
        layerVisible = time >= firstKeyframeTime;
      }
      if (hasDrawAnimation && time < minDrawStart && (isPlaying || isScrubbingTimeline)) {
        layerVisible = false;
      }
      if (hasFillAnimation && time < minFillStart && (isPlaying || isScrubbingTimeline)) {
        layerVisible = false;
      }
      if (!hasActiveAnimation && latestEndedAnimation) {
        switch ((latestEndedAnimation as LayerAnimation).type) {
          case "fadeOut":
            opacity = 0;
            layerVisible = false;
            break;
          default:
            opacity = 1;
            layerVisible = true;
            break;
        }
      }
      baseLayerOpacity = layerVisible ? opacity : 0;
      layerData.layer.opacity = baseLayerOpacity;
    }

    if (hasDrawAnimation) {
      updatePolylineDraw(layerData, activeDrawAnimation, time, maxDrawEnd, isPlaying, isScrubbingTimeline);
    }
    if (hasFillAnimation) {
      updatePolygonFill(layerData, activeFillAnimation, time, maxFillEnd);
    }
    if (config.hasPointKeyframes(layerData)) {
      applyPointKeyframes(layerData, time, config.getPointKeyframeAtTime);
    }
    if (jitterProgress === null) {
      if (layerData.type === "polyline" && !hasDrawAnimation) {
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
          if (!graphic.__originalGeometry) {
            graphic.__originalGeometry = graphic.geometry.clone();
          }
          graphic.geometry = graphic.__originalGeometry.clone();
        });
      } else if (layerData.type === "polygon" && !hasFillAnimation) {
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.geometry || graphic.geometry.type !== "polygon") return;
          if (!graphic.__originalGeometry) {
            graphic.__originalGeometry = graphic.geometry.clone();
          }
          graphic.geometry = graphic.__originalGeometry.clone();
        });
      }
    }
    if (jitterProgress !== null) {
      if (layerData.type === "polyline") {
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
          if (!graphic.__originalGeometry) {
            graphic.__originalGeometry = graphic.geometry.clone();
          }
          const baseGeometry = hasDrawAnimation
            ? (graphic.geometry as Polyline)
            : (graphic.__originalGeometry as Polyline);
          graphic.geometry = jitterPolyline(baseGeometry, time, layerSeed);
        });
      } else if (layerData.type === "polygon") {
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.geometry || graphic.geometry.type !== "polygon") return;
          if (!graphic.__originalGeometry) {
            graphic.__originalGeometry = graphic.geometry.clone();
          }
          const baseGeometry = hasFillAnimation
            ? (graphic.geometry as Polygon)
            : (graphic.__originalGeometry as Polygon);
          graphic.geometry = jitterPolygon(baseGeometry, time, layerSeed);
        });
      }
    }
    if (layerData.type === "point") {
      const baseSize = layerData.pointStyle?.size ?? config.defaultPointStyle.size;
      const baseAngle = layerData.pointStyle?.angle ?? 0;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "simple-marker") return;
        const symbol = graphic.symbol.clone();
        symbol.size = baseSize * scale;
        symbol.angle = activeSpinProgress !== null ? baseAngle + activeSpinProgress * 360 : baseAngle;
        graphic.symbol = symbol;
      });
    }
    if (layerData.type === "text") {
      const baseText = layerData.textContent || "Text";
      const baseSize = layerData.textSize ?? 14;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "text") return;
        const symbol = graphic.symbol.clone();
        symbol.font = symbol.font || { size: baseSize, family: "sans-serif" };
        symbol.font.size = baseSize * scale;
        symbol.font.family = layerData.textFontFamily || symbol.font.family || "sans-serif";
        symbol.font.style = layerData.textItalic ? "italic" : "normal";
        symbol.font.decoration = layerData.textUnderline ? "underline" : "none";
        if (hasTypewriterAnimation) {
          if (activeTypewriter) {
            const length = Math.max(0, Math.floor(baseText.length * activeTypewriter.progress));
            symbol.text = baseText.slice(0, length);
          } else if (time < minTypewriterStart) {
            symbol.text = "";
          } else if (time > maxTypewriterEnd) {
            symbol.text = baseText;
          }
        }
        graphic.symbol = symbol;
      });
    }

    if (layerData.type === "polyline") {
      if (neonProgress !== null) {
        lineWidthScale = 1.2 + getPulse(neonProgress, 3) * 0.6;
      } else if (glowProgress !== null) {
        lineWidthScale = 1 + getPulse(glowProgress, 2) * 0.25;
      } else if (prismProgress !== null) {
        lineWidthScale = 1 + getPulse(prismProgress, 1) * 0.2;
      }
      if (sparkProgress !== null) {
        const sparkBurst = Math.pow(noise1(timeSeed * 7.3), 3);
        lineWidthScale *= 1 + sparkBurst * 0.9;
      }
      if (arrowProgress !== null) {
        lineWidthScale *= 0.95 + getPulse(arrowProgress, 3) * 0.25;
      }
      if (breatheProgress !== null) {
        const breathe = getPulse(breatheProgress, 1);
        lineWidthScale *= 0.9 + breathe * 0.25;
      }

      const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "simple-line") return;
        const symbol = graphic.symbol.clone();
        symbol.width = baseWidth * lineWidthScale;
        graphic.symbol = symbol;
      });

      if (arrowProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const arrowLayer = getArrowLayer(layerData, view);
          arrowLayer.visible = true;
          arrowLayer.opacity = layerData.layer.opacity ?? 1;
          const arrowColor = layerData.lineStyle?.color ?? defaultLineStyle.color;
          const arrowSize = Math.max(8, baseWidth * 3);
          const arrowGraphics: Graphic[] = [];

          layerData.layer.graphics.forEach((graphic: any) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const geometry = graphic.geometry as Polyline;
            const marchGeometry =
              geometry.paths?.length ? geometry : ((graphic.__originalGeometry as Polyline) ?? geometry);
            const { segments, total } = buildMarchSegments(marchGeometry);
            if (!segments.length || total <= 0) return;
            const resolution = Number(view?.resolution) || 1;
            const totalPx = total / Math.max(resolution, 1e-6);
            const arrowCount = clamp(Math.round(totalPx / 40), 8, 64);
            const spacing = total / Math.max(arrowCount, 1);
            const offset = (arrowProgress ?? 0) * total;

            for (let i = 0; i < arrowCount; i += 1) {
              const dist = (offset + i * spacing) % total;
              const sample = sampleMarchPoint(segments, dist);
              if (!sample) continue;
              const arrowGraphic = new Graphic({
                geometry: new Point({
                  x: sample.x,
                  y: sample.y,
                  spatialReference: marchGeometry.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: arrowMarkerPath,
                  color: arrowColor,
                  size: arrowSize,
                  angle: sample.angle,
                  outline: {
                    color: [0, 0, 0, 0],
                    width: 0
                  }
                }
              });
              arrowGraphics.push(arrowGraphic);
            }
          });

          arrowLayer.removeAll();
          if (arrowGraphics.length) {
            arrowLayer.addMany(arrowGraphics);
          }
        }
      } else {
        clearArrowLayer(layerData);
      }

      if (barrageProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const barrageLayer = getBarrageLayer(layerData, view);
          barrageLayer.visible = true;
          barrageLayer.opacity = baseLayerOpacity;
          const baseColor = layerData.lineStyle?.color ?? defaultLineStyle.color;
          const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
          const resolution = Number(view?.resolution) || 1;
          const barrageGraphics: Graphic[] = [];
          const progress = barrageProgress ?? 0;

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const geometry = graphic.geometry as Polyline;
            const sourceGeometry =
              geometry.paths?.length ? geometry : ((graphic.__originalGeometry as Polyline) ?? geometry);
            let workingGeometry = sourceGeometry;
            if (
              view?.spatialReference?.isWebMercator &&
              sourceGeometry.spatialReference?.isGeographic
            ) {
              workingGeometry = webMercatorUtils.geographicToWebMercator(sourceGeometry) as Polyline;
            }
            const densified = densifyPolyline(workingGeometry);
            const { segments, total } = buildMarchSegments(densified);
            if (!segments.length || total <= 0) return;

            const totalPx = total / Math.max(resolution, 1e-6);
            const arrowCount = clamp(Math.round(totalPx / 20), 18, 90);
            const spacing = total / Math.max(arrowCount, 1);
            const arrowLengthPx = clamp(baseWidth * 6, 14, 80);
            const arrowLength = arrowLengthPx * resolution;
            const maxOffsetPx = clamp(baseWidth * 2.4, 6, 36);
            const maxOffset = maxOffsetPx * resolution;
            const randomBase = layerSeed + graphicIndex * 23.1;
            const jitterStep = Math.floor(timeSeed * 1.1);

            for (let i = 0; i < arrowCount; i += 1) {
              const drift = noise1(randomBase + i * 1.7) * 0.6;
              const dist = (progress * total + (i + drift) * spacing) % total;
              const head = sampleMarchPoint(segments, dist);
              if (!head) continue;
              const tail = sampleMarchPoint(segments, Math.max(0, dist - arrowLength));
              if (!tail) continue;

              const spread = noise1(randomBase + i * 2.9) * 2 - 1;
              const jitter = (noise1(randomBase + i * 4.3 + jitterStep) - 0.5) * 0.3;
              const offset = (spread + jitter) * maxOffset;
              const nx = -head.uy;
              const ny = head.ux;
              const hx = head.x + nx * offset;
              const hy = head.y + ny * offset;
              const tx = tail.x + nx * offset;
              const ty = tail.y + ny * offset;

              const alpha = clamp(0.55 + (1 - Math.abs(spread)) * 0.35, 0.35, 0.95);
              const width = Math.max(1, baseWidth * (0.35 + (1 - Math.abs(spread)) * 0.35));
              barrageGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: densified.spatialReference,
                    paths: [[[tx, ty], [hx, hy]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width,
                    color: toRgbaArray(baseColor, alpha)
                  }
                })
              );

              const arrowSize = Math.max(6, baseWidth * 2.4);
              barrageGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: hx,
                    y: hy,
                    spatialReference: densified.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "path",
                    path: arrowMarkerPath,
                    color: toRgbaArray(baseColor, alpha),
                    size: arrowSize,
                    angle: head.angle,
                    outline: {
                      color: [0, 0, 0, 0],
                      width: 0
                    }
                  }
                })
              );
            }
          });

          barrageLayer.removeAll();
          if (barrageGraphics.length) {
            barrageLayer.addMany(barrageGraphics);
          }
        }
        layerData.layer.opacity = 0;
      } else {
        clearBarrageLayer(layerData);
      }
    }

    if (layerData.type === "polygon") {
      if (glowProgress !== null) {
        outlineWidthScale = 1 + getPulse(glowProgress, 2) * 0.3;
      } else if (prismProgress !== null) {
        outlineWidthScale = 1 + getPulse(prismProgress, 1) * 0.2;
      }
      if (breatheProgress !== null) {
        const breathe = getPulse(breatheProgress, 1);
        outlineWidthScale *= 0.9 + breathe * 0.25;
      }

      const baseOutline = layerData.polygonStyle?.outlineWidth ?? defaultPolygonStyle.outlineWidth;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "simple-fill" || !graphic.symbol.outline) return;
        const symbol = graphic.symbol.clone();
        symbol.outline = { ...symbol.outline, width: baseOutline * outlineWidthScale };
        graphic.symbol = symbol;
      });
    }

    const baseEffect = buildBaseLayerEffect(layerData);
    const baseBlend = layerData.layerBlendMode || "normal";
    const extraEffects: string[] = [];
    let blendOverride: string | null = null;
    const glowColor = getLayerGlowColor(layerData);

    if (gradientProgress !== null) {
      const hue = clamp(gradientProgress * 360, 0, 360);
      extraEffects.push(`hue-rotate(${hue.toFixed(1)}deg) saturate(1.7)`);
    }

    if (flickerProgress !== null) {
      const flickerA = 0.5 + 0.5 * Math.sin(timeSeed * 42);
      const flickerB = 0.5 + 0.5 * Math.sin(timeSeed * 87 + 0.9);
      const flicker = flickerA * flickerB;
      const brightness = 1.05 + flicker * 0.35;
      const saturate = 1.15 + flicker * 0.6;
      extraEffects.push(`brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`);
      blendOverride = blendOverride ?? "screen";
    }

    if (hazeProgress !== null) {
      const haze = 0.5 + 0.5 * Math.sin(timeSeed * 1.7);
      const blur = 0.6 + haze * 1.6;
      const brightness = 1.01 + haze * 0.08;
      const saturate = 1.05 + haze * 0.2;
      const hue = -6 + haze * 12;
      extraEffects.push(
        `blur(${blur.toFixed(1)}px) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)}) hue-rotate(${hue.toFixed(1)}deg)`
      );
    }

    if (scanlineProgress !== null) {
      const scan = triangleWave(timeSeed * 1.2);
      const brightness = 1 + scan * 0.35;
      const contrast = 1.1 + scan * 0.25;
      extraEffects.push(`brightness(${brightness.toFixed(2)}) contrast(${contrast.toFixed(2)})`);
    }

    if (sparkProgress !== null) {
      const spark = Math.pow(noise1(timeSeed * 12.7 + 1.3), 5);
      const blur = 4 + spark * 16;
      const brightness = 1.1 + spark * 0.8;
      const saturate = 1.3 + spark * 1.5;
      extraEffects.push(
        `drop-shadow(0 0 ${blur.toFixed(1)}px ${glowColor}) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`
      );
      blendOverride = "screen";
    }

    if (arrowProgress !== null) {
      const march = triangleWave(timeSeed * 2.5);
      const hue = clamp(march * 180, 0, 180);
      const brightness = 1.05 + march * 0.2;
      const saturate = 1.2 + march * 0.5;
      extraEffects.push(
        `hue-rotate(${hue.toFixed(1)}deg) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`
      );
    }

    if (dissolveProgress !== null) {
      const dissolveNoise = noise1(timeSeed * 4.1 + 0.8);
      const blur = dissolveNoise * 1.8;
      const contrast = 1 + dissolveNoise * 0.5;
      extraEffects.push(`blur(${blur.toFixed(1)}px) contrast(${contrast.toFixed(2)})`);
    }

    if (ghostProgress !== null) {
      const ghost = getPulse(ghostProgress, 1);
      const offsetX = Math.sin(timeSeed * 1.4) * 4;
      const offsetY = Math.cos(timeSeed * 1.2) * 4;
      const blur = 4 + ghost * 8;
      extraEffects.push(
        `drop-shadow(${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blur.toFixed(1)}px ${glowColor}) blur(0.6px)`
      );
      blendOverride = blendOverride ?? "screen";
    }

    if (pixelateProgress !== null) {
      const pixel = triangleWave(timeSeed * 3.3);
      const stepped = Math.round(pixel * 1) / 1;
      const blur = 2.8 + stepped * 7.2;
      const contrast = 1.15 + stepped * 0.85;
      const saturate = 0.8 + stepped * 0.35;
      extraEffects.push(
        `blur(${blur.toFixed(1)}px) contrast(${contrast.toFixed(2)}) saturate(${saturate.toFixed(2)})`
      );
    }

    if (glowProgress !== null) {
      const mode = (glowMode ?? "pulse") as "soft" | "pulse";
      const glowPulse = getPulse(glowProgress, mode === "soft" ? 1 : 2);
      const blur =
        mode === "soft"
          ? 4 + glowPulse * 6
          : 6 + glowPulse * 18;
      const brightness =
        mode === "soft"
          ? 1.02 + glowPulse * 0.08
          : 1.05 + glowPulse * 0.25;
      const saturate =
        mode === "soft"
          ? 1.1 + glowPulse * 0.3
          : 1.2 + glowPulse * 0.9;
      extraEffects.push(
        `drop-shadow(0 0 ${blur.toFixed(1)}px ${glowColor}) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`
      );
      blendOverride = blendOverride ?? "screen";
    }

    if (neonProgress !== null) {
      const neonPulse = getPulse(neonProgress, 3);
      const blur = 10 + neonPulse * 22;
      const brightness = 1.2 + neonPulse * 0.35;
      const saturate = 1.6 + neonPulse * 1.2;
      extraEffects.push(
        `drop-shadow(0 0 ${blur.toFixed(1)}px ${glowColor}) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`
      );
      blendOverride = "screen";
    }

    if (prismProgress !== null) {
      const prismPulse = getPulse(prismProgress, 1);
      const hue = clamp(prismProgress * 420, 0, 420);
      const blur = 2 + prismPulse * 6;
      extraEffects.push(
        `hue-rotate(${hue.toFixed(1)}deg) contrast(115%) blur(${blur.toFixed(1)}px)`
      );
      blendOverride = blendOverride ?? "screen";
    }

    if (extraEffects.length > 0) {
      layerData.layer.effect = joinEffects([baseEffect, ...extraEffects]);
      layerData.layer.blendMode = blendOverride ?? baseBlend;
    } else {
      applyBaseLayerEffect(layerData);
    }
  });
};

const applyPointKeyframes = (
  layerData: LayerData,
  time: number,
  getPointKeyframeAtTime: (layerData: LayerData, time: number) => PointKeyframe | null
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic?.geometry) return;
    const frame = getPointKeyframeAtTime(layerData, time);
    if (!frame) return;
    graphic.geometry = new Point({
      x: frame.x,
      y: frame.y,
      spatialReference: frame.spatialReference
    });
  });
};

export { applyAnimationsAtTime };
