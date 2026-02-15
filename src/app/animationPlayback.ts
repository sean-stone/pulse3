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

type VertexStop = {
  x: number;
  y: number;
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

const toViewPolyline = (geometry: Polyline, view: any) => {
  let workingGeometry = geometry;
  if (
    view?.spatialReference?.isWebMercator &&
    geometry.spatialReference?.isGeographic
  ) {
    workingGeometry = webMercatorUtils.geographicToWebMercator(geometry) as Polyline;
  } else if (
    view?.spatialReference?.isGeographic &&
    geometry.spatialReference?.isWebMercator
  ) {
    workingGeometry = webMercatorUtils.webMercatorToGeographic(geometry) as Polyline;
  }
  return workingGeometry;
};

const toViewPoint = (geometry: Point, view: any) => {
  let workingGeometry = geometry;
  if (
    view?.spatialReference?.isWebMercator &&
    geometry.spatialReference?.isGeographic
  ) {
    workingGeometry = webMercatorUtils.geographicToWebMercator(geometry) as Point;
  } else if (
    view?.spatialReference?.isGeographic &&
    geometry.spatialReference?.isWebMercator
  ) {
    workingGeometry = webMercatorUtils.webMercatorToGeographic(geometry) as Point;
  }
  return workingGeometry;
};

const buildVertexStops = (geometry: Polyline) => {
  const stops: VertexStop[] = [];
  let total = 0;
  geometry.paths?.forEach((path) => {
    if (!path?.length) return;
    for (let i = 0; i < path.length; i += 1) {
      const point = path[i];
      if (i > 0) {
        const prev = path[i - 1];
        total += Math.hypot(point[0] - prev[0], point[1] - prev[1]);
      }
      const prevStop = stops[stops.length - 1];
      if (prevStop && prevStop.x === point[0] && prevStop.y === point[1]) {
        continue;
      }
      stops.push({ x: point[0], y: point[1], accum: total });
    }
  });
  return { stops, total };
};

const toWaypointLabel = (index: number) => {
  let value = Math.max(0, Math.floor(index));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
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

const getDartLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__dartLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1
  });
  view?.map?.add(layer);
  (layerData as any).__dartLayer = layer;
  return layer;
};

const clearDartLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__dartLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const getWeldSparkLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__weldSparkLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1,
    blendMode: "screen"
  });
  view?.map?.add(layer);
  (layerData as any).__weldSparkLayer = layer;
  return layer;
};

const clearWeldSparkLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__weldSparkLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const getFlightLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__flightLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1,
    blendMode: "screen"
  });
  view?.map?.add(layer);
  (layerData as any).__flightLayer = layer;
  return layer;
};

const clearFlightLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__flightLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const getWaypointLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__waypointLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1,
    blendMode: "screen"
  });
  view?.map?.add(layer);
  (layerData as any).__waypointLayer = layer;
  return layer;
};

const clearWaypointLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__waypointLayer as GraphicsLayer | undefined;
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
      clearDartLayer(layerData);
      clearWeldSparkLayer(layerData);
      clearFlightLayer(layerData);
      clearWaypointLayer(layerData);
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
    let weldProgress: number | null = null;
    let flightProgress: number | null = null;
    let waypointProgress: number | null = null;
    let flightMode: "default" | "cartoon" = "default";
    let waypointMode: "default" | "cartoon" = "default";
    let hasFlightRouteAnimation = false;
    let hasFlightRouteCartoonAnimation = false;
    let hasWaypointRouteAnimation = false;
    let hasWaypointRouteCartoonAnimation = false;
    let dartProgress: number | null = null;
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
      if (
        anim.type === "draw" ||
        anim.type === "drawReverse" ||
        anim.type === "neonTrail" ||
        anim.type === "weldTrail" ||
        anim.type === "flightRoute" ||
        anim.type === "flightRouteCartoon" ||
        anim.type === "waypointRoute" ||
        anim.type === "waypointRouteCartoon"
      ) {
        hasDrawAnimation = true;
        maxDrawEnd = Math.max(maxDrawEnd, animEnd);
        minDrawStart = Math.min(minDrawStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          activeDrawAnimation = anim;
        }
      }
      if (anim.type === "flightRoute" || anim.type === "flightRouteCartoon") {
        hasFlightRouteAnimation = true;
        if (anim.type === "flightRouteCartoon") {
          hasFlightRouteCartoonAnimation = true;
        }
      }
      if (anim.type === "waypointRoute" || anim.type === "waypointRouteCartoon") {
        hasWaypointRouteAnimation = true;
        if (anim.type === "waypointRouteCartoon") {
          hasWaypointRouteCartoonAnimation = true;
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
          case "weldTrail":
            weldProgress = progress;
            opacity = 1;
            break;
          case "flightRoute":
            flightProgress = progress;
            flightMode = "default";
            opacity = 1;
            break;
          case "flightRouteCartoon":
            flightProgress = progress;
            flightMode = "cartoon";
            opacity = 1;
            break;
          case "waypointRoute":
            waypointProgress = progress;
            waypointMode = "default";
            opacity = 1;
            break;
          case "waypointRouteCartoon":
            waypointProgress = progress;
            waypointMode = "cartoon";
            opacity = 1;
            break;
          case "dartHit":
            dartProgress = progress;
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
    if (flightProgress === null && hasFlightRouteAnimation) {
      flightMode = hasFlightRouteCartoonAnimation ? "cartoon" : "default";
    }
    if (waypointProgress === null && hasWaypointRouteAnimation) {
      waypointMode = hasWaypointRouteCartoonAnimation ? "cartoon" : "default";
    }

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
      const dartReveal = dartProgress !== null ? clamp((dartProgress - 0.78) / 0.22, 0, 1) : 1;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "simple-marker") return;
        const symbol = graphic.symbol.clone();
        symbol.size = baseSize * scale * dartReveal;
        symbol.angle = activeSpinProgress !== null ? baseAngle + activeSpinProgress * 360 : baseAngle;
        graphic.symbol = symbol;
      });
      if (dartProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const dartLayer = getDartLayer(layerData, view);
          dartLayer.visible = true;
          dartLayer.opacity = baseLayerOpacity;
          const dartGraphics: Graphic[] = [];
          const progress = clamp(dartProgress, 0, 1);
          const flightWindow = 0.78;
          const flightProgress = clamp(progress / flightWindow, 0, 1);
          const impactProgress = clamp(
            (progress - flightWindow) / Math.max(1 - flightWindow, 1e-6),
            0,
            1
          );
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const viewCenterX = Number(view?.extent?.center?.x ?? view?.center?.x);
          const hasViewCenterX = Number.isFinite(viewCenterX);
          const markColor = toRgbaArray(
            layerData.pointStyle?.color ?? config.defaultPointStyle.color,
            1
          );
          const shaftColor: [number, number, number] = [186, 199, 215];
          const finAColor: [number, number, number] = [201, 63, 63];
          const finBColor: [number, number, number] = [58, 121, 201];
          const tipColor: [number, number, number] = [235, 225, 207];
          const shadowColor: [number, number, number] = [12, 16, 24];
          const ghostColor: [number, number, number] = [228, 234, 242];

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            const sourcePoint =
              (graphic.__originalGeometry as Point | undefined) ??
              (graphic.geometry as Point | undefined);
            if (!sourcePoint || sourcePoint.type !== "point") return;
            const targetPoint = toViewPoint(sourcePoint, view);
            const targetX = targetPoint.x;
            const targetY = targetPoint.y;
            const randomA = noise1(layerSeed * 0.61 + graphicIndex * 17.3 + 0.71);
            const randomB = noise1(layerSeed * 0.39 + graphicIndex * 11.7 + 2.14);
            const shoulderSide = hasViewCenterX
              ? targetX < viewCenterX ? -1 : 1
              : (randomA > 0.35 ? -1 : 1);
            const startOffsetX = (150 + baseSize * 5 + randomA * 60) * resolution;
            const startOffsetY = (110 + baseSize * 4 + randomB * 55) * resolution;
            const curveHeight = (16 + randomB * 24) * resolution;
            const curveSide = (8 + randomA * 16) * resolution * shoulderSide;
            const startX = targetX + shoulderSide * startOffsetX;
            const startY = targetY - startOffsetY;
            const vecX = targetX - startX;
            const vecY = targetY - startY;
            const vecLength = Math.max(Math.hypot(vecX, vecY), 1e-6);
            const ux = vecX / vecLength;
            const uy = vecY / vecLength;
            const nx = -uy;
            const ny = ux;
            const dartBaseSize = clamp(baseSize * 2.5, 11, 32);

            let dartX = targetX;
            let dartY = targetY;
            let heading = Math.atan2(vecY, vecX);
            let dartSize = dartBaseSize;
            let dartAlpha = 0.96;
            let motionBlurAlpha = 0;
            let impactRingAlpha = 0;
            let impactCenterAlpha = 0;
            let shadowSize = dartBaseSize * 1.1;
            let shadowAlpha = 0.14;

            if (progress <= flightWindow) {
              const eased = 1 - Math.pow(1 - flightProgress, 2.8);
              const arc = Math.sin(flightProgress * Math.PI);
              dartX = startX + vecX * eased + nx * curveSide * arc * 0.35;
              dartY = startY + vecY * eased + ny * curveSide * arc * 0.2 + arc * curveHeight;
              heading = Math.atan2(targetY - dartY, targetX - dartX);
              dartSize = dartBaseSize * (1.7 - eased * 0.72);
              dartAlpha = clamp(0.5 + eased * 0.5, 0.5, 0.98);
              motionBlurAlpha = clamp(0.06 + (1 - eased) * 0.24, 0.06, 0.3);
              shadowSize = dartSize * (1.2 + (1 - eased) * 0.28);
              shadowAlpha = clamp(0.08 + (1 - eased) * 0.12, 0.08, 0.2);
            } else {
              const settle = 1 - Math.pow(1 - impactProgress, 2.2);
              const recoil =
                Math.sin((1 - impactProgress) * Math.PI * 2.1) *
                (1 - impactProgress) *
                (6 + randomA * 4) *
                resolution;
              heading =
                Math.atan2(vecY, vecX) +
                (noise1(layerSeed + graphicIndex * 3.7) - 0.5) * 0.08 * (1 - settle);
              const embed = dartBaseSize * (0.15 + (1 - settle) * 0.05) * resolution;
              dartX = targetX - Math.cos(heading) * (embed + recoil);
              dartY = targetY - Math.sin(heading) * (embed + recoil);
              dartSize = dartBaseSize * (1.02 - settle * 0.04 + Math.sin((1 - impactProgress) * Math.PI) * 0.03);
              dartAlpha = clamp(0.95 - settle * 0.08, 0.86, 0.96);
              motionBlurAlpha = clamp((1 - settle) * 0.08, 0, 0.08);
              impactRingAlpha = clamp(0.52 - impactProgress * 0.62, 0, 0.52);
              impactCenterAlpha = clamp(0.44 - impactProgress * 0.55, 0, 0.44);
              shadowSize = dartSize * (1.03 + (1 - settle) * 0.08);
              shadowAlpha = clamp(0.15 - settle * 0.05, 0.09, 0.15);
            }

            const wobble =
              Math.sin(timeSeed * (5.4 + randomA * 1.8) + graphicIndex) *
              (progress <= flightWindow ? (1 - flightProgress) * 3.4 : (1 - impactProgress) * 1.1);
            const angle = -heading * (180 / Math.PI) + wobble;
            const shaftLength = dartSize * 0.72 * resolution;
            const tailBaseX = dartX - Math.cos(heading) * (dartSize * 0.3 * resolution);
            const tailBaseY = dartY - Math.sin(heading) * (dartSize * 0.3 * resolution);
            const noseX = dartX + Math.cos(heading) * (dartSize * 0.39 * resolution);
            const noseY = dartY + Math.sin(heading) * (dartSize * 0.39 * resolution);
            const finBack = dartSize * 0.22 * resolution;
            const finSpread = dartSize * 0.18 * resolution;
            const finCenterX = tailBaseX - Math.cos(heading) * finBack;
            const finCenterY = tailBaseY - Math.sin(heading) * finBack;
            const finAX = finCenterX + nx * finSpread;
            const finAY = finCenterY + ny * finSpread;
            const finBX = finCenterX - nx * finSpread;
            const finBY = finCenterY - ny * finSpread;
            const shadowX =
              dartX + nx * 2.6 * resolution - Math.cos(heading) * (progress <= flightWindow ? 3.6 : 1.4) * resolution;
            const shadowY =
              dartY + ny * 2.6 * resolution - Math.sin(heading) * (progress <= flightWindow ? 3.6 : 1.4) * resolution;

            dartGraphics.push(
              new Graphic({
                geometry: new Point({
                  x: shadowX,
                  y: shadowY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "circle",
                  size: shadowSize,
                  color: [shadowColor[0], shadowColor[1], shadowColor[2], shadowAlpha],
                  outline: {
                    color: [shadowColor[0], shadowColor[1], shadowColor[2], 0],
                    width: 0
                  }
                }
              })
            );

            if (motionBlurAlpha > 0.01) {
              const ghostDistance = (
                progress <= flightWindow
                  ? 9 + (1 - flightProgress) * 9
                  : 3 + (1 - impactProgress) * 3
              ) * resolution;
              const ghost1X = dartX - Math.cos(heading) * (ghostDistance * 0.45);
              const ghost1Y = dartY - Math.sin(heading) * (ghostDistance * 0.45);
              const ghost2X = dartX - Math.cos(heading) * ghostDistance;
              const ghost2Y = dartY - Math.sin(heading) * ghostDistance;
              dartGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: ghost2X,
                    y: ghost2Y,
                    spatialReference: targetPoint.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "path",
                    path: dartCoreMarkerPath,
                    size: dartSize * 0.86,
                    color: [ghostColor[0], ghostColor[1], ghostColor[2], motionBlurAlpha * 0.22],
                    angle,
                    outline: {
                      color: [ghostColor[0], ghostColor[1], ghostColor[2], 0],
                      width: 0
                    }
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: ghost1X,
                    y: ghost1Y,
                    spatialReference: targetPoint.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "path",
                    path: dartCoreMarkerPath,
                    size: dartSize * 0.9,
                    color: [ghostColor[0], ghostColor[1], ghostColor[2], motionBlurAlpha * 0.34],
                    angle,
                    outline: {
                      color: [ghostColor[0], ghostColor[1], ghostColor[2], 0],
                      width: 0
                    }
                  }
                })
              );
            }

            dartGraphics.push(
              new Graphic({
                geometry: new Point({
                  x: finAX,
                  y: finAY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: dartFinMarkerPath,
                  size: dartSize * 0.35,
                  color: [finAColor[0], finAColor[1], finAColor[2], dartAlpha * 0.88],
                  angle,
                  outline: {
                    color: [39, 35, 43, dartAlpha * 0.35],
                    width: Math.max(0.3, dartSize * 0.018)
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: finBX,
                  y: finBY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: dartFinMarkerPath,
                  size: dartSize * 0.35,
                  color: [finBColor[0], finBColor[1], finBColor[2], dartAlpha * 0.88],
                  angle,
                  outline: {
                    color: [39, 35, 43, dartAlpha * 0.35],
                    width: Math.max(0.3, dartSize * 0.018)
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: dartX + nx * 1.2 * resolution,
                  y: dartY + ny * 1.2 * resolution,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: dartMarkerPath,
                  size: dartSize * 1.02,
                  color: [shadowColor[0], shadowColor[1], shadowColor[2], dartAlpha * 0.4],
                  angle,
                  outline: {
                    color: [shadowColor[0], shadowColor[1], shadowColor[2], 0],
                    width: 0
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: dartX,
                  y: dartY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: dartMarkerPath,
                  size: dartSize,
                  color: [68, 78, 96, dartAlpha],
                  angle,
                  outline: {
                    color: [36, 43, 56, dartAlpha * 0.62],
                    width: Math.max(0.55, dartSize * 0.04)
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: dartX,
                  y: dartY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: dartCoreMarkerPath,
                  size: dartSize * 0.82,
                  color: [shaftColor[0], shaftColor[1], shaftColor[2], dartAlpha * 0.94],
                  angle,
                  outline: {
                    color: [214, 224, 236, dartAlpha * 0.6],
                    width: Math.max(0.32, dartSize * 0.028)
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: noseX,
                  y: noseY,
                  spatialReference: targetPoint.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "circle",
                  size: clamp(dartSize * 0.2, 1.8, 6),
                  color: [tipColor[0], tipColor[1], tipColor[2], dartAlpha * 0.96],
                  outline: {
                    color: [209, 192, 170, dartAlpha * 0.8],
                    width: Math.max(0.45, dartSize * 0.022)
                  }
                }
              })
            );

            if (impactRingAlpha > 0.01) {
              const crossHalf = clamp(baseSize * 0.2 + (1 - impactProgress) * 1.8, 1, 3.5) * resolution;
              const crossWidth = Math.max(0.6, baseSize * 0.08);
              dartGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: targetX,
                    y: targetY,
                    spatialReference: targetPoint.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: clamp(dartSize * (0.9 + impactProgress * 0.9), 8, 24),
                    color: [markColor[0], markColor[1], markColor[2], impactRingAlpha * 0.1],
                    outline: {
                      color: [markColor[0], markColor[1], markColor[2], impactRingAlpha * 0.66],
                      width: Math.max(0.6, baseSize * 0.1)
                    }
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[[targetX - crossHalf, targetY], [targetX + crossHalf, targetY]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width: crossWidth,
                    color: [68, 78, 96, impactCenterAlpha * 0.8]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[[targetX, targetY - crossHalf], [targetX, targetY + crossHalf]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width: crossWidth,
                    color: [68, 78, 96, impactCenterAlpha * 0.8]
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: targetX,
                    y: targetY,
                    spatialReference: targetPoint.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: clamp(dartSize * 0.22, 2.2, 7),
                    color: [56, 67, 86, impactCenterAlpha * 0.95],
                    outline: {
                      color: [230, 238, 248, impactCenterAlpha * 0.55],
                      width: Math.max(0.5, baseSize * 0.07)
                    }
                  }
                })
              );
            }
          });

          dartLayer.removeAll();
          if (dartGraphics.length) {
            dartLayer.addMany(dartGraphics);
          }
        }
      } else {
        clearDartLayer(layerData);
      }
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

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
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

      if (weldProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const weldLayer = getWeldSparkLayer(layerData, view);
          weldLayer.visible = true;
          weldLayer.opacity = Math.max(baseLayerOpacity, 0.92);
          const sparkGraphics: Graphic[] = [];
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const frameStep = Math.floor(timeSeed * 45);

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const renderedGeometry = graphic.geometry as Polyline;
            const sourceGeometry =
              renderedGeometry.paths?.length
                ? renderedGeometry
                : ((graphic.__densifiedGeometry as Polyline | undefined) ??
                  (graphic.__originalGeometry as Polyline | undefined) ??
                  renderedGeometry);
            let workingGeometry = sourceGeometry;
            if (
              view?.spatialReference?.isWebMercator &&
              sourceGeometry.spatialReference?.isGeographic
            ) {
              workingGeometry = webMercatorUtils.geographicToWebMercator(sourceGeometry) as Polyline;
            } else if (
              view?.spatialReference?.isGeographic &&
              sourceGeometry.spatialReference?.isWebMercator
            ) {
              workingGeometry = webMercatorUtils.webMercatorToGeographic(sourceGeometry) as Polyline;
            }

            const { segments, total } = buildMarchSegments(workingGeometry);
            if (!segments.length || total <= 0) return;

            const head = sampleMarchPoint(segments, total);
            if (!head) return;
            const nx = -head.uy;
            const ny = head.ux;
            const headX = head.x;
            const headY = head.y;

            const trailLength = clamp(baseWidth * 36, 26, 170) * resolution;
            const trailStart = Math.max(0, total - trailLength);
            const trailSteps = clamp(Math.round((trailLength / Math.max(resolution, 1e-6)) / 6), 12, 28);
            const trailPoints: Array<{ x: number; y: number }> = [];
            for (let step = 0; step <= trailSteps; step += 1) {
              const dist = trailStart + (total - trailStart) * (step / trailSteps);
              const sample = sampleMarchPoint(segments, dist);
              if (!sample) continue;
              trailPoints.push({ x: sample.x, y: sample.y });
            }
            for (let i = 1; i < trailPoints.length; i += 1) {
              const nearHead = i / Math.max(trailPoints.length - 1, 1);
              const slowFade = Math.pow(nearHead, 0.65);
              const glowAlpha = clamp(0.09 + slowFade * 0.16, 0.08, 0.26);
              const coreAlpha = clamp(0.16 + slowFade * 0.33, 0.14, 0.58);
              const dotSize = clamp(baseWidth * (0.8 + slowFade * 1.95), 2.2, 9.5);
              const dotGlowSize = clamp(dotSize * 1.75, 4, 16);
              const dotAlpha = clamp(0.14 + slowFade * 0.48, 0.12, 0.64);
              const prev = trailPoints[i - 1];
              const curr = trailPoints[i];
              sparkGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[[prev.x, prev.y], [curr.x, curr.y]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width: Math.max(baseWidth * 2.9, 2.2),
                    color: [214, 102, 48, glowAlpha]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[[prev.x, prev.y], [curr.x, curr.y]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width: Math.max(baseWidth * 1.55, 1.2),
                    color: [238, 182, 112, coreAlpha]
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: curr.x,
                    y: curr.y,
                    spatialReference: workingGeometry.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: dotGlowSize,
                    color: [198, 88, 39, dotAlpha * 0.3],
                    outline: {
                      color: [198, 88, 39, 0],
                      width: 0
                    }
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: curr.x,
                    y: curr.y,
                    spatialReference: workingGeometry.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: dotSize,
                    color: [238, 182, 112, dotAlpha],
                    outline: {
                      color: [255, 223, 171, dotAlpha * 0.35],
                      width: Math.max(0.4, dotSize * 0.08)
                    }
                  }
                })
              );
            }

            const sparkCount = clamp(Math.round(11 + baseWidth * 2.1), 10, 24);

            sparkGraphics.push(
              new Graphic({
                geometry: new Point({
                  x: headX,
                  y: headY,
                  spatialReference: workingGeometry.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "circle",
                  size: clamp(baseWidth * 6.2, 9, 22),
                  color: [255, 162, 78, 0.42],
                  outline: {
                    color: [255, 199, 134, 0],
                    width: 0
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: headX,
                  y: headY,
                  spatialReference: workingGeometry.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "circle",
                  size: clamp(baseWidth * 3.4, 5, 13),
                  color: [255, 247, 222, 0.98],
                  outline: {
                    color: [255, 186, 110, 0.8],
                    width: Math.max(0.8, baseWidth * 0.22)
                  }
                }
              })
            );

            for (let i = 0; i < sparkCount; i += 1) {
              const seed = layerSeed * 0.41 + graphicIndex * 19.3 + i * 1.97 + frameStep * 0.83;
              const spread = noise1(seed + 0.7) * 2 - 1;
              const arc = noise1(seed + 1.3) * 2 - 1;
              const travel = (11 + noise1(seed + 2.1) * 34) * resolution;
              const trail = (6 + noise1(seed + 3.9) * 18) * resolution;
              const emitsForward = (i + frameStep + graphicIndex) % 7 === 0;
              const directionBase = emitsForward ? head.heading : head.heading + Math.PI;
              const direction =
                directionBase + spread * (emitsForward ? 0.7 : 1.45) + arc * (emitsForward ? 0.2 : 0.45);
              const ux = Math.cos(direction);
              const uy = Math.sin(direction);
              const lateral = (noise1(seed + 4.7) - 0.5) * resolution * 14;
              const startX = headX + nx * lateral * 0.35;
              const startY = headY + ny * lateral * 0.35;
              const endX = startX + ux * travel + nx * lateral;
              const endY = startY + uy * travel + ny * lateral;
              const tailX = endX - ux * trail;
              const tailY = endY - uy * trail;
              const alpha = clamp(0.5 + noise1(seed + 5.9) * 0.5, 0.42, 1);
              const width = Math.max(1.05, baseWidth * (0.24 + noise1(seed + 6.3) * 0.35));

              sparkGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[[tailX, tailY], [endX, endY]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width: Math.max(width * 1.8, 1.4),
                    color: [255, 139, 66, alpha * 0.34]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[[tailX, tailY], [endX, endY]]]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "solid",
                    width,
                    color: [255, 230, 168, alpha]
                  }
                })
              );

              if (i % 2 === 0) {
                sparkGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: endX,
                      y: endY,
                      spatialReference: workingGeometry.spatialReference
                    }),
                    symbol: {
                      type: "simple-marker",
                      style: "circle",
                      size: clamp(2.8 + baseWidth * 0.85 + noise1(seed + 8.1) * 3.2, 3, 11),
                      color: [255, 247, 210, alpha],
                      outline: {
                        color: [255, 199, 134, 0],
                        width: 0
                      }
                    }
                  })
                );
              }
            }
          });

          weldLayer.removeAll();
          if (sparkGraphics.length) {
            weldLayer.addMany(sparkGraphics);
          }
        }
      } else {
        clearWeldSparkLayer(layerData);
      }

      if (flightProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const flightLayer = getFlightLayer(layerData, view);
          flightLayer.visible = true;
          flightLayer.opacity = Math.max(baseLayerOpacity, 0.9);
          const flightGraphics: Graphic[] = [];
          const progress = clamp(flightProgress, 0, 1);
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const pulse = 0.5 + 0.5 * Math.sin(timeSeed * 5.2);
          const cartoon = flightMode === "cartoon";
          const trailOuterColor = cartoon ? [255, 133, 70] : [86, 187, 237];
          const trailInnerColor = cartoon ? [255, 231, 181] : [212, 242, 255];
          const planeGlowColor = cartoon ? [255, 160, 94] : [109, 197, 238];
          const planeBodyColor = cartoon ? [255, 246, 208] : [248, 252, 255];
          const planeOutlineColor = cartoon ? [198, 102, 54] : [76, 177, 227];
          const startMarkerColor = cartoon ? [84, 208, 120] : [43, 167, 220];
          const endMarkerColor = cartoon ? [255, 156, 98] : [236, 146, 95];

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const renderedGeometry = graphic.geometry as Polyline;
            const routeGeometry =
              (graphic.__densifiedGeometry as Polyline | undefined) ??
              (graphic.__originalGeometry as Polyline | undefined) ??
              renderedGeometry;

            const toViewGeometry = (geometry: Polyline) => {
              let workingGeometry = geometry;
              if (
                view?.spatialReference?.isWebMercator &&
                geometry.spatialReference?.isGeographic
              ) {
                workingGeometry = webMercatorUtils.geographicToWebMercator(geometry) as Polyline;
              } else if (
                view?.spatialReference?.isGeographic &&
                geometry.spatialReference?.isWebMercator
              ) {
                workingGeometry = webMercatorUtils.webMercatorToGeographic(geometry) as Polyline;
              }
              return workingGeometry;
            };

            const displayedWorking = toViewGeometry(
              renderedGeometry.paths?.length ? renderedGeometry : routeGeometry
            );
            const fullRouteWorking = toViewGeometry(routeGeometry);
            const { segments, total } = buildMarchSegments(displayedWorking);
            if (!segments.length || total <= 0) return;
            const head = sampleMarchPoint(segments, total);
            if (!head) return;

            const trailLength = clamp(baseWidth * 52, 30, 220) * resolution;
            const trailStart = Math.max(0, total - trailLength);
            const trailSteps = clamp(Math.round((trailLength / Math.max(resolution, 1e-6)) / 8), 8, 30);
            const trailPoints: Array<{ x: number; y: number }> = [];
            for (let step = 0; step <= trailSteps; step += 1) {
              const dist = trailStart + (total - trailStart) * (step / trailSteps);
              const sample = sampleMarchPoint(segments, dist);
              if (!sample) continue;
              trailPoints.push({ x: sample.x, y: sample.y });
            }
            if (cartoon && trailPoints.length > 1) {
              const trailPath = trailPoints.map((point) => [point.x, point.y]);
              flightGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: displayedWorking.spatialReference,
                    paths: [trailPath]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 2.4, 1.8),
                    color: [...trailOuterColor, 0.34]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: displayedWorking.spatialReference,
                    paths: [trailPath]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 1.35, 1),
                    color: [...trailInnerColor, 0.72]
                  }
                })
              );
              for (let i = 2; i < trailPoints.length; i += 2) {
                const nearHead = i / Math.max(trailPoints.length - 1, 1);
                const fade = Math.pow(nearHead, 0.84);
                const prev = trailPoints[i - 1];
                const curr = trailPoints[i];
                const dx = curr.x - prev.x;
                const dy = curr.y - prev.y;
                const len = Math.max(Math.hypot(dx, dy), 1e-6);
                const nx = -dy / len;
                const ny = dx / len;
                const wobble = noise1(layerSeed + graphicIndex * 19.7 + i * 2.13) * 2 - 1;
                const offset = wobble * clamp(baseWidth * 1.35, 0.9, 4.2) * resolution;
                const puffX = curr.x + nx * offset;
                const puffY = curr.y + ny * offset;
                const puffSize = clamp(baseWidth * (3.2 - nearHead * 1.85), 3.4, 14);
                const puffAlpha = clamp(0.08 + fade * 0.32, 0.08, 0.38);

                flightGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: puffX,
                      y: puffY,
                      spatialReference: displayedWorking.spatialReference
                    }),
                    symbol: {
                      type: "simple-marker",
                      style: "circle",
                      size: puffSize * 1.4,
                      color: [255, 212, 168, puffAlpha * 0.42],
                      outline: {
                        color: [255, 214, 173, 0],
                        width: 0
                      }
                    }
                  }),
                  new Graphic({
                    geometry: new Point({
                      x: puffX,
                      y: puffY,
                      spatialReference: displayedWorking.spatialReference
                    }),
                    symbol: {
                      type: "simple-marker",
                      style: "circle",
                      size: puffSize,
                      color: [255, 244, 229, puffAlpha],
                      outline: {
                        color: [255, 223, 188, puffAlpha * 0.45],
                        width: 0.8
                      }
                    }
                  })
                );
              }
            } else {
              for (let i = 1; i < trailPoints.length; i += 1) {
                const nearHead = i / Math.max(trailPoints.length - 1, 1);
                const fade = Math.pow(nearHead, 0.8);
                const prev = trailPoints[i - 1];
                const curr = trailPoints[i];
                flightGraphics.push(
                  new Graphic({
                    geometry: new Polyline({
                      spatialReference: displayedWorking.spatialReference,
                      paths: [[[prev.x, prev.y], [curr.x, curr.y]]]
                    }),
                    symbol: {
                      type: "simple-line",
                      style: "solid",
                      width: Math.max(baseWidth * 2.1, 1.3),
                      color: [...trailOuterColor, clamp(0.05 + fade * 0.22, 0.04, 0.3)]
                    }
                  }),
                  new Graphic({
                    geometry: new Polyline({
                      spatialReference: displayedWorking.spatialReference,
                      paths: [[[prev.x, prev.y], [curr.x, curr.y]]]
                    }),
                    symbol: {
                      type: "simple-line",
                      style: "solid",
                      width: Math.max(baseWidth * 1.2, 0.9),
                      color: [...trailInnerColor, clamp(0.1 + fade * 0.45, 0.08, 0.55)]
                    }
                  })
                );
              }
            }

            const cruise = Math.sin(progress * Math.PI);
            const planeSize = clamp(baseWidth * (4.1 + cruise * 0.9), 10, 24);
            const planeAlpha = clamp(0.74 + cruise * 0.22, 0.7, 1);
            const wobblePhase = timeSeed * 7.5 + progress * TAU * 2;
            const bobOffset =
              cartoon
                ? Math.sin(wobblePhase) * clamp(baseWidth * 2.1, 1.2, 8) * resolution
                : 0;
            const planeX = head.x - head.uy * bobOffset;
            const planeY = head.y + head.ux * bobOffset;
            const planeAngle = head.angle + (cartoon ? Math.sin(wobblePhase * 0.8) * 9 : 0);
            const noseOffset = cartoon ? planeSize * 0.32 * resolution : 0;
            const noseX = planeX + Math.cos(head.heading) * noseOffset;
            const noseY = planeY + Math.sin(head.heading) * noseOffset;
            flightGraphics.push(
              new Graphic({
                geometry: new Point({
                  x: planeX,
                  y: planeY,
                  spatialReference: displayedWorking.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "circle",
                  size: clamp(planeSize * 1.45, 12, 34),
                  color: [...planeGlowColor, 0.12 + pulse * 0.14],
                  outline: {
                    color: [...planeGlowColor, 0],
                    width: 0
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: planeX,
                  y: planeY,
                  spatialReference: displayedWorking.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: "path",
                  path: cartoon ? cartoonPlaneMarkerPath : planeMarkerPath,
                  size: planeSize,
                  color: [...planeBodyColor, planeAlpha],
                  angle: planeAngle,
                  outline: {
                    color: [...planeOutlineColor, cartoon ? 0.82 : 0.45],
                    width: Math.max(cartoon ? 1.1 : 0.5, baseWidth * (cartoon ? 0.2 : 0.12))
                  }
                }
              })
            );
            if (cartoon) {
              flightGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: noseX,
                    y: noseY,
                    spatialReference: displayedWorking.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: clamp(planeSize * 0.3, 2.4, 6.2),
                    color: [255, 145, 96, 0.95],
                    outline: {
                      color: [255, 239, 220, 0.86],
                      width: 1
                    }
                  }
                })
              );
            }

            const { segments: routeSegments, total: routeTotal } = buildMarchSegments(fullRouteWorking);
            const start = routeSegments.length ? sampleMarchPoint(routeSegments, 0) : null;
            const end = routeSegments.length ? sampleMarchPoint(routeSegments, routeTotal) : null;
            if (start && end) {
              const baseMarkerSize = Math.max(6, baseWidth * 2.2);
              flightGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: start.x,
                    y: start.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                    symbol: {
                      type: "simple-marker",
                      style: cartoon ? "diamond" : "circle",
                      size: baseMarkerSize * (cartoon ? 1.1 : 1),
                      color: [...startMarkerColor, cartoon ? 0.72 : 0.58],
                      outline: {
                        color: cartoon ? [239, 255, 242, 0.9] : [205, 244, 255, 0.8],
                        width: 1
                      }
                    }
                }),
                new Graphic({
                  geometry: new Point({
                    x: end.x,
                    y: end.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                    symbol: {
                      type: "simple-marker",
                      style: cartoon ? "diamond" : "circle",
                      size: baseMarkerSize * (cartoon ? 1.1 : 1),
                      color: [...endMarkerColor, cartoon ? 0.72 : 0.58],
                      outline: {
                        color: cartoon ? [255, 241, 227, 0.95] : [255, 233, 204, 0.85],
                        width: 1
                      }
                    }
                }),
                new Graphic({
                  geometry: new Point({
                    x: start.x,
                    y: start.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                    symbol: {
                      type: "text",
                      text: "A",
                      color: cartoon ? [238, 255, 243, 1] : [215, 245, 255, 0.98],
                      yoffset: cartoon ? -16 : -12,
                      haloColor: cartoon ? [23, 68, 31, 0.88] : [26, 72, 91, 0.8],
                      haloSize: cartoon ? 1.8 : 1,
                      font: {
                        size: cartoon ? 12 : 9,
                        family: "sans-serif"
                      }
                    }
                }),
                new Graphic({
                  geometry: new Point({
                    x: end.x,
                    y: end.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                    symbol: {
                      type: "text",
                      text: "B",
                      color: cartoon ? [255, 244, 232, 1] : [255, 235, 208, 0.98],
                      yoffset: cartoon ? -16 : -12,
                      haloColor: cartoon ? [91, 43, 20, 0.86] : [93, 61, 40, 0.78],
                      haloSize: cartoon ? 1.8 : 1,
                      font: {
                        size: cartoon ? 12 : 9,
                        family: "sans-serif"
                      }
                    }
                })
              );

              const takeoffPulse = clamp(1 - progress / 0.22, 0, 1);
              if (takeoffPulse > 0) {
                flightGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: start.x,
                      y: start.y,
                      spatialReference: fullRouteWorking.spatialReference
                    }),
                      symbol: {
                        type: "simple-marker",
                        style: "circle",
                        size: baseMarkerSize + (1 - takeoffPulse) * 20,
                        color: [...startMarkerColor, takeoffPulse * (cartoon ? 0.34 : 0.26)],
                        outline: {
                          color: cartoon
                            ? [239, 255, 242, takeoffPulse * 0.62]
                            : [205, 244, 255, takeoffPulse * 0.5],
                          width: 1
                        }
                      }
                  })
                );
              }

              const landingPulse = clamp((progress - 0.78) / 0.22, 0, 1);
              if (landingPulse > 0) {
                flightGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: end.x,
                      y: end.y,
                      spatialReference: fullRouteWorking.spatialReference
                    }),
                      symbol: {
                        type: "simple-marker",
                        style: "circle",
                        size: baseMarkerSize + landingPulse * 22,
                        color: [...endMarkerColor, (1 - landingPulse * 0.35) * (cartoon ? 0.38 : 0.28)],
                        outline: {
                          color: cartoon
                            ? [255, 241, 227, (1 - landingPulse * 0.3) * 0.72]
                            : [255, 233, 204, (1 - landingPulse * 0.3) * 0.6],
                          width: 1
                        }
                      }
                  })
                );
              }
            }
          });

          flightLayer.removeAll();
          if (flightGraphics.length) {
            flightLayer.addMany(flightGraphics);
          }
        }
      } else {
        clearFlightLayer(layerData);
      }
      if (flightProgress === null && hasFlightRouteAnimation) {
        const view = config.getView?.();
        if (view) {
          const flightLayer = getFlightLayer(layerData, view);
          flightLayer.visible = true;
          flightLayer.opacity = Math.max(baseLayerOpacity, 0.9);
          const flightGraphics: Graphic[] = [];
          const cartoon = flightMode === "cartoon";
          const startMarkerColor = cartoon ? [84, 208, 120] : [43, 167, 220];
          const endMarkerColor = cartoon ? [255, 156, 98] : [236, 146, 95];
          const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;

          layerData.layer.graphics.forEach((graphic: any) => {
            const sourceGeometry =
              (graphic.__originalGeometry as Polyline | undefined) ??
              (graphic.__densifiedGeometry as Polyline | undefined) ??
              (graphic.geometry as Polyline | undefined);
            if (!sourceGeometry || sourceGeometry.type !== "polyline") return;

            const fullRouteWorking = toViewPolyline(sourceGeometry, view);
            const { segments: routeSegments, total: routeTotal } = buildMarchSegments(fullRouteWorking);
            const start = routeSegments.length ? sampleMarchPoint(routeSegments, 0) : null;
            const end = routeSegments.length ? sampleMarchPoint(routeSegments, routeTotal) : null;
            if (!start || !end) return;

            const baseMarkerSize = Math.max(6, baseWidth * 2.2);
            flightGraphics.push(
              new Graphic({
                geometry: new Point({
                  x: start.x,
                  y: start.y,
                  spatialReference: fullRouteWorking.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: cartoon ? "diamond" : "circle",
                  size: baseMarkerSize * (cartoon ? 1.1 : 1),
                  color: [...startMarkerColor, cartoon ? 0.72 : 0.58],
                  outline: {
                    color: cartoon ? [239, 255, 242, 0.9] : [205, 244, 255, 0.8],
                    width: 1
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: end.x,
                  y: end.y,
                  spatialReference: fullRouteWorking.spatialReference
                }),
                symbol: {
                  type: "simple-marker",
                  style: cartoon ? "diamond" : "circle",
                  size: baseMarkerSize * (cartoon ? 1.1 : 1),
                  color: [...endMarkerColor, cartoon ? 0.72 : 0.58],
                  outline: {
                    color: cartoon ? [255, 241, 227, 0.95] : [255, 233, 204, 0.85],
                    width: 1
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: start.x,
                  y: start.y,
                  spatialReference: fullRouteWorking.spatialReference
                }),
                symbol: {
                  type: "text",
                  text: "A",
                  color: cartoon ? [238, 255, 243, 1] : [215, 245, 255, 0.98],
                  yoffset: cartoon ? -16 : -12,
                  haloColor: cartoon ? [23, 68, 31, 0.88] : [26, 72, 91, 0.8],
                  haloSize: cartoon ? 1.8 : 1,
                  font: {
                    size: cartoon ? 12 : 9,
                    family: "sans-serif"
                  }
                }
              }),
              new Graphic({
                geometry: new Point({
                  x: end.x,
                  y: end.y,
                  spatialReference: fullRouteWorking.spatialReference
                }),
                symbol: {
                  type: "text",
                  text: "B",
                  color: cartoon ? [255, 244, 232, 1] : [255, 235, 208, 0.98],
                  yoffset: cartoon ? -16 : -12,
                  haloColor: cartoon ? [91, 43, 20, 0.86] : [93, 61, 40, 0.78],
                  haloSize: cartoon ? 1.8 : 1,
                  font: {
                    size: cartoon ? 12 : 9,
                    family: "sans-serif"
                  }
                }
              })
            );
          });

          flightLayer.removeAll();
          if (flightGraphics.length) {
            flightLayer.addMany(flightGraphics);
          }
        }
      }

      if (waypointProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const waypointLayer = getWaypointLayer(layerData, view);
          waypointLayer.visible = true;
          waypointLayer.opacity = Math.max(baseLayerOpacity, 0.9);
          const waypointGraphics: Graphic[] = [];
          const progress = clamp(waypointProgress, 0, 1);
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const pulse = 0.5 + 0.5 * Math.sin(timeSeed * 4.3 + 0.7);
          const cartoon = waypointMode === "cartoon";

          layerData.layer.graphics.forEach((graphic: any) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const renderedGeometry = graphic.geometry as Polyline;
            const sourceGeometry =
              (graphic.__originalGeometry as Polyline | undefined) ??
              renderedGeometry;

            const displayedWorking = toViewPolyline(
              renderedGeometry.paths?.length ? renderedGeometry : sourceGeometry,
              view
            );
            const fullRouteWorking = toViewPolyline(sourceGeometry, view);
            const { total: visibleDistance } = buildMarchSegments(displayedWorking);
            const { stops, total } = buildVertexStops(fullRouteWorking);
            if (!stops.length) return;

            const revealLead = Math.max(total * 0.002, resolution * 2.5);
            const revealDistance = clamp(
              Math.max(progress * total, Math.min(visibleDistance, total)),
              0,
              total
            );
            const markerSize = clamp(baseWidth * 2.2, 8, 18);
            const reachedPoints: number[][] = [];
            let activeStop: VertexStop | null = null;
            let activeIndex = -1;

            for (let index = 0; index < stops.length; index += 1) {
              const stop = stops[index];
              const reached = index === 0 || stop.accum <= revealDistance + revealLead;
              if (!reached) continue;
              reachedPoints.push([stop.x, stop.y]);
              activeStop = stop;
              activeIndex = index;

              const t = total > 0 ? clamp(stop.accum / total, 0, 1) : 0;
              const r = cartoon
                ? Math.round(92 + 158 * t)
                : Math.round(67 + 168 * t);
              const g = cartoon
                ? Math.round(210 - 52 * t)
                : Math.round(178 - 34 * t);
              const b = cartoon
                ? Math.round(124 + 52 * (1 - t))
                : Math.round(232 - 104 * t);
              const label = toWaypointLabel(index);
              const bounce = cartoon ? 0.5 + 0.5 * Math.sin(timeSeed * 6.2 + index * 0.9) : 0;
              const stopMarkerSize = markerSize * (cartoon ? 0.94 + bounce * 0.26 : 1);

              waypointGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: stop.x,
                    y: stop.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: cartoon ? "diamond" : "circle",
                    size: stopMarkerSize,
                    color: [r, g, b, cartoon ? 0.78 : 0.62],
                    outline: {
                      color: cartoon ? [255, 252, 238, 0.95] : [240, 248, 255, 0.85],
                      width: cartoon ? 1.6 : 1
                    }
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: stop.x,
                    y: stop.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                  symbol: {
                    type: "text",
                    text: label,
                    color: cartoon ? [255, 251, 241, 1] : [246, 251, 255, 0.98],
                    yoffset: cartoon ? -17 : -13,
                    haloColor: cartoon ? [88, 52, 28, 0.88] : [21, 53, 74, 0.9],
                    haloSize: cartoon ? 1.9 : 1.1,
                    font: {
                      size: cartoon ? 13 : 10,
                      family: "sans-serif"
                    }
                  }
                })
              );
              if (cartoon) {
                waypointGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: stop.x,
                      y: stop.y,
                      spatialReference: fullRouteWorking.spatialReference
                    }),
                    symbol: {
                      type: "simple-marker",
                      style: "circle",
                      size: stopMarkerSize * 0.34,
                      color: [255, 250, 239, 0.95],
                      outline: {
                        color: [255, 218, 170, 0.82],
                        width: 1
                      }
                    }
                  })
                );
              }
            }

            if (cartoon && reachedPoints.length > 1) {
              waypointGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: fullRouteWorking.spatialReference,
                    paths: [reachedPoints]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 2, 1.5),
                    color: [255, 190, 123, 0.48]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: fullRouteWorking.spatialReference,
                    paths: [reachedPoints]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 1.05, 0.9),
                    color: [255, 248, 234, 0.84]
                  }
                })
              );
            }

            if (activeStop && activeIndex >= 0) {
              const activeT = stops.length > 1
                ? clamp(activeIndex / Math.max(stops.length - 1, 1), 0, 1)
                : 0;
              const rr = cartoon
                ? Math.round(114 + 126 * activeT)
                : Math.round(84 + 158 * activeT);
              const gg = cartoon
                ? Math.round(214 - 48 * activeT)
                : Math.round(184 - 28 * activeT);
              const bb = cartoon
                ? Math.round(117 + 62 * (1 - activeT))
                : Math.round(238 - 90 * activeT);
              const haloSize = markerSize * (cartoon ? 1.45 + pulse * 0.65 : 1.15 + pulse * 0.55);
              const haloAlpha = clamp(
                (cartoon ? 0.2 : 0.12) + pulse * (cartoon ? 0.2 : 0.16) + (1 - progress) * 0.06,
                cartoon ? 0.18 : 0.12,
                cartoon ? 0.44 : 0.34
              );
              waypointGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: activeStop.x,
                    y: activeStop.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: "circle",
                    size: haloSize,
                    color: [rr, gg, bb, haloAlpha],
                    outline: {
                      color: cartoon
                        ? [255, 251, 241, haloAlpha * 0.82]
                        : [235, 247, 255, haloAlpha * 0.65],
                      width: cartoon ? 1.4 : 1
                    }
                  }
                })
              );
            }
          });

          waypointLayer.removeAll();
          if (waypointGraphics.length) {
            waypointLayer.addMany(waypointGraphics);
          }
        }
      } else {
        clearWaypointLayer(layerData);
      }
      if (waypointProgress === null && hasWaypointRouteAnimation) {
        const view = config.getView?.();
        if (view) {
          const waypointLayer = getWaypointLayer(layerData, view);
          waypointLayer.visible = true;
          waypointLayer.opacity = Math.max(baseLayerOpacity, 0.9);
          const waypointGraphics: Graphic[] = [];
          const cartoon = waypointMode === "cartoon";
          const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
          const markerSize = clamp(baseWidth * 2.2, 8, 18);

          layerData.layer.graphics.forEach((graphic: any) => {
            const sourceGeometry =
              (graphic.__originalGeometry as Polyline | undefined) ??
              (graphic.geometry as Polyline | undefined);
            if (!sourceGeometry || sourceGeometry.type !== "polyline") return;

            const fullRouteWorking = toViewPolyline(sourceGeometry, view);
            const { stops, total } = buildVertexStops(fullRouteWorking);
            if (!stops.length) return;
            const reachedPoints: number[][] = [];

            stops.forEach((stop, index) => {
              reachedPoints.push([stop.x, stop.y]);
              const t = total > 0 ? clamp(stop.accum / total, 0, 1) : 0;
              const r = cartoon
                ? Math.round(92 + 158 * t)
                : Math.round(67 + 168 * t);
              const g = cartoon
                ? Math.round(210 - 52 * t)
                : Math.round(178 - 34 * t);
              const b = cartoon
                ? Math.round(124 + 52 * (1 - t))
                : Math.round(232 - 104 * t);
              const label = toWaypointLabel(index);

              waypointGraphics.push(
                new Graphic({
                  geometry: new Point({
                    x: stop.x,
                    y: stop.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                  symbol: {
                    type: "simple-marker",
                    style: cartoon ? "diamond" : "circle",
                    size: markerSize,
                    color: [r, g, b, cartoon ? 0.78 : 0.62],
                    outline: {
                      color: cartoon ? [255, 252, 238, 0.95] : [240, 248, 255, 0.85],
                      width: cartoon ? 1.6 : 1
                    }
                  }
                }),
                new Graphic({
                  geometry: new Point({
                    x: stop.x,
                    y: stop.y,
                    spatialReference: fullRouteWorking.spatialReference
                  }),
                  symbol: {
                    type: "text",
                    text: label,
                    color: cartoon ? [255, 251, 241, 1] : [246, 251, 255, 0.98],
                    yoffset: cartoon ? -17 : -13,
                    haloColor: cartoon ? [88, 52, 28, 0.88] : [21, 53, 74, 0.9],
                    haloSize: cartoon ? 1.9 : 1.1,
                    font: {
                      size: cartoon ? 13 : 10,
                      family: "sans-serif"
                    }
                  }
                })
              );
              if (cartoon) {
                waypointGraphics.push(
                  new Graphic({
                    geometry: new Point({
                      x: stop.x,
                      y: stop.y,
                      spatialReference: fullRouteWorking.spatialReference
                    }),
                    symbol: {
                      type: "simple-marker",
                      style: "circle",
                      size: markerSize * 0.34,
                      color: [255, 250, 239, 0.95],
                      outline: {
                        color: [255, 218, 170, 0.82],
                        width: 1
                      }
                    }
                  })
                );
              }
            });

            if (cartoon && reachedPoints.length > 1) {
              waypointGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: fullRouteWorking.spatialReference,
                    paths: [reachedPoints]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 2, 1.5),
                    color: [255, 190, 123, 0.48]
                  }
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: fullRouteWorking.spatialReference,
                    paths: [reachedPoints]
                  }),
                  symbol: {
                    type: "simple-line",
                    style: "short-dot",
                    width: Math.max(baseWidth * 1.05, 0.9),
                    color: [255, 248, 234, 0.84]
                  }
                })
              );
            }
          });

          waypointLayer.removeAll();
          if (waypointGraphics.length) {
            waypointLayer.addMany(waypointGraphics);
          }
        }
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
