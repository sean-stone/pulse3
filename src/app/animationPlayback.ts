import * as bufferOperator from "@arcgis/core/geometry/operators/bufferOperator";
import * as densifyOperator from "@arcgis/core/geometry/operators/densifyOperator";
import * as geodeticDensifyOperator from "@arcgis/core/geometry/operators/geodeticDensifyOperator";
import * as geodeticLengthOperator from "@arcgis/core/geometry/operators/geodeticLengthOperator";
import * as lengthOperator from "@arcgis/core/geometry/operators/lengthOperator";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

import type { LayerAnimation, LayerData, PointKeyframe, PointStyle } from "../types";
import { buildPartialPaths } from "../utils/geometryPaths";
import {
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
} from "./animationPlaybackHelpers";
import { defaultLineStyle, defaultPolygonStyle, MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "./constants";
import {
  getPointOrientationAngle,
  getPointOrientationHeading,
  mergePointSymbolOrientations,
  readPointKeyframeOrientation,
  readPointStyleOrientation
} from "./pointOrientation";
import type { PointSymbolOrientation } from "./pointOrientation";
import { getInactiveRevealGeometryMode } from "./revealTiming";
import { isParticleLayer } from "./particles";
import { isMeshTextRenderMode, syncTextMeshOverlay } from "./textMesh";
import { syncVolumeBoxOverlay } from "./volumeBox";

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

type FollowPathState = {
  animation: LayerAnimation;
  geometry: Point;
  orientation: Partial<PointSymbolOrientation> | null;
  visible: boolean;
};

type FollowPathAnimation = LayerAnimation & {
  pathLayerId: string;
};

type VolumeAnimationPlaybackState = {
  effect: "smoke" | "fire";
  progress: number;
  time: number;
};

let geodeticOperatorsLoadPromise: Promise<void> | null = null;

const setVolumeAnimationPlaybackState = (
  layerData: LayerData,
  state: VolumeAnimationPlaybackState | null
) => {
  if (!isParticleLayer(layerData)) return;
  if (state) {
    (layerData as any).__volumeAnimationState = state;
  } else {
    delete (layerData as any).__volumeAnimationState;
  }
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic) return;
    graphic.visible = !state;
  });
};

const ensureGeodeticOperatorsLoaded = () => {
  if (geodeticLengthOperator.isLoaded() && geodeticDensifyOperator.isLoaded()) {
    return true;
  }
  if (!geodeticOperatorsLoadPromise) {
    geodeticOperatorsLoadPromise = Promise.all([
      geodeticLengthOperator.isLoaded() ? Promise.resolve() : geodeticLengthOperator.load(),
      geodeticDensifyOperator.isLoaded() ? Promise.resolve() : geodeticDensifyOperator.load()
    ])
      .then(() => undefined)
      .catch(() => {
        geodeticOperatorsLoadPromise = null;
      });
  }
  return false;
};

void ensureGeodeticOperatorsLoaded();

const updatePolylineDraw = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  firstDrawStart: number,
  firstAnimationStart: number,
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

    if (getInactiveRevealGeometryMode(time, firstDrawStart, firstAnimationStart) === "empty") {
      graphic.geometry = buildPartialPolyline(densified, 0, false);
      return;
    }

    const displayGeometry = (original.spatialReference as any)?.isGeographic ? densified : original;
    graphic.geometry = displayGeometry.clone();
  });
};

const updatePolygonFill = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  firstFillStart: number,
  firstAnimationStart: number
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
      const buffered = bufferOperator.execute(original, -inset) as Polygon | null;
      if (buffered && buffered.rings?.length) {
        graphic.geometry = buffered;
        return;
      }
      graphic.geometry = progress >= 0.98 ? original.clone() : buildEmptyPolygon(original);
      return;
    }

    if (getInactiveRevealGeometryMode(time, firstFillStart, firstAnimationStart) === "empty") {
      graphic.geometry = buildEmptyPolygon(original);
      return;
    }

    graphic.geometry = original.clone();
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

const isSceneView3D = (view: any) => String((view as any)?.type || "") === "3d";
const GLOW_DISTANCE_MULTIPLIER = 10;
const FIREWORKS_COOLDOWN_DURATION = 1.2;
const FIREWORKS_POST_END_PROGRESS_MAX = 2.1;
const FIREWORKS_FALL_SPEED_MULTIPLIER = 0.5;
const FIREWORKS_RANDOM_MULTIPLIER_MIN = 1;
const FIREWORKS_RANDOM_MULTIPLIER_MAX = 10;
const FIREWORKS_HEIGHT_MULTIPLIER_MIN = 0.7;
const FIREWORKS_HEIGHT_MULTIPLIER_MAX = 2.0;

const applyPolygonOutlineWidth = (graphic: any, width: number) => {
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol) return false;
  if (symbol.type === "simple-fill" && symbol.outline) {
    symbol.outline = { ...symbol.outline, width };
    graphic.symbol = symbol;
    return true;
  }
  if (symbol.type === "polygon-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return false;
    let changed = false;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (layer?.type !== "fill" && layer?.type !== "extrude") return layer;
      changed = true;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
      if (nextLayer?.type === "extrude") {
        if (width > 0) {
          if (nextLayer?.edges && typeof nextLayer.edges.clone === "function") {
            const nextEdges = nextLayer.edges.clone();
            nextEdges.size = width;
            nextLayer.edges = nextEdges;
          } else {
            nextLayer.edges = {
              ...(nextLayer?.edges ?? {}),
              type: "solid",
              size: width
            };
          }
        } else {
          nextLayer.edges = null;
        }
        return nextLayer;
      }
      if (nextLayer?.outline) {
        if (typeof nextLayer.outline.clone === "function") {
          const nextOutline = nextLayer.outline.clone();
          nextOutline.size = width;
          nextLayer.outline = nextOutline;
        } else {
          nextLayer.outline = { ...(nextLayer.outline ?? {}), size: width };
        }
      } else {
        nextLayer.outline = { size: width };
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

const toClampedRgbaColor = (
  color: unknown,
  fallback: [number, number, number, number]
): [number, number, number, number] => {
  if (typeof color === "string") {
    return parseColorToRgbaArray(color, fallback);
  }
  const r = Number((color as any)?.[0]);
  const g = Number((color as any)?.[1]);
  const b = Number((color as any)?.[2]);
  const a = Number((color as any)?.[3]);
  return [
    Number.isFinite(r) ? clamp(r, 0, 255) : fallback[0],
    Number.isFinite(g) ? clamp(g, 0, 255) : fallback[1],
    Number.isFinite(b) ? clamp(b, 0, 255) : fallback[2],
    Number.isFinite(a) ? clamp(a, 0, 1) : fallback[3]
  ];
};

const multiplyColorOpacity = (
  color: unknown,
  opacity: number,
  fallback: [number, number, number, number]
): [number, number, number, number] => {
  const rgba = toClampedRgbaColor(color, fallback);
  return [rgba[0], rgba[1], rgba[2], clamp(rgba[3] * clamp(opacity, 0, 1), 0, 1)];
};

const applyTextSymbolState = (
  graphic: any,
  layerData: LayerData,
  text: string,
  size: number,
  symbolOpacity = 1,
  enforceSymbolOpacity = false
) => {
  const resolvedSize = clamp(Number(size) || 14, MIN_TEXT_SIZE, MAX_TEXT_SIZE);
  graphic.__pulseTextCurrentText = text;
  graphic.__pulseTextCurrentSize = resolvedSize;
  const symbol = cloneSymbol(graphic?.symbol);
  if (!symbol) return false;
  const baseTextColor = toClampedRgbaColor(layerData.textColor || "#22323a", [34, 35, 58, 1]);
  if (symbol.type === "text") {
    symbol.text = text;
    symbol.font = symbol.font || { size: resolvedSize, family: "sans-serif" };
    symbol.font.size = resolvedSize;
    symbol.font.family = layerData.textFontFamily || symbol.font.family || "sans-serif";
    symbol.font.style = layerData.textItalic ? "italic" : "normal";
    symbol.font.decoration = layerData.textUnderline ? "underline" : "none";
    if (enforceSymbolOpacity) {
      symbol.color = multiplyColorOpacity(symbol.color ?? baseTextColor, symbolOpacity, baseTextColor);
      if (symbol.haloColor) {
        symbol.haloColor = multiplyColorOpacity(symbol.haloColor, symbolOpacity, [255, 255, 255, 0.9]);
      }
    }
    graphic.symbol = symbol;
    return true;
  }
  if (symbol.type === "point-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return false;
    let changed = false;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (layer?.type !== "text") return layer;
      changed = true;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
      const nextFont = { ...(nextLayer.font ?? {}) };
      nextFont.family = layerData.textFontFamily || nextFont.family || "sans-serif";
      nextFont.style = layerData.textItalic ? "italic" : "normal";
      nextLayer.text = text;
      nextLayer.size = resolvedSize;
      nextLayer.font = nextFont;
      if (enforceSymbolOpacity) {
        nextLayer.material = {
          ...(nextLayer.material ?? {}),
          color: multiplyColorOpacity(nextLayer.material?.color ?? baseTextColor, symbolOpacity, baseTextColor)
        };
        if (nextLayer.halo) {
          nextLayer.halo = {
            ...(nextLayer.halo ?? {}),
            color: multiplyColorOpacity(nextLayer.halo?.color, symbolOpacity, [255, 255, 255, 0.9])
          };
        }
      }
      return nextLayer;
    });
    if (changed) {
      setSymbolLayers(symbol, nextLayers);
      if (enforceSymbolOpacity && symbol.callout) {
        symbol.callout = {
          ...(symbol.callout ?? {}),
          color: multiplyColorOpacity(symbol.callout?.color ?? baseTextColor, symbolOpacity, [
            baseTextColor[0],
            baseTextColor[1],
            baseTextColor[2],
            0.9
          ]),
          border: symbol.callout?.border
            ? {
                ...(symbol.callout.border ?? {}),
                color: multiplyColorOpacity(symbol.callout.border?.color, symbolOpacity, [255, 255, 255, 0.9])
              }
            : symbol.callout?.border
        };
      }
      graphic.symbol = symbol;
      return true;
    }
  }
  return false;
};

const applyPolygonTimeGradient3D = (layerData: LayerData, progress: number) => {
  const hue = clamp(progress, 0, 1) * 360;
  const baseFill = parseColorToRgbaArray(
    layerData.polygonStyle?.color,
    [10, 76, 102, 0.3]
  );
  const baseOutline = parseColorToRgbaArray(
    layerData.polygonStyle?.outlineColor,
    [34, 139, 196, 1]
  );
  const shiftedFill = rotateHueRgba(baseFill, hue);
  const shiftedOutline = rotateHueRgba(baseOutline, hue);

  layerData.layer.graphics.forEach((graphic: any) => {
    const symbol = cloneSymbol(graphic?.symbol);
    if (!symbol || symbol.type !== "polygon-3d") return;
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return;

    let changed = false;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (layer?.type !== "fill" && layer?.type !== "extrude") return layer;
      changed = true;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };

      if (nextLayer?.material && typeof nextLayer.material.clone === "function") {
        const nextMaterial = nextLayer.material.clone();
        nextMaterial.color = shiftedFill;
        nextLayer.material = nextMaterial;
      } else {
        nextLayer.material = {
          ...(nextLayer?.material ?? {}),
          color: shiftedFill
        };
      }

      if (nextLayer?.type === "extrude") {
        if (nextLayer?.edges && typeof nextLayer.edges.clone === "function") {
          const nextEdges = nextLayer.edges.clone();
          nextEdges.color = shiftedOutline;
          nextLayer.edges = nextEdges;
        } else if (nextLayer?.edges) {
          nextLayer.edges = {
            ...(nextLayer?.edges ?? {}),
            color: shiftedOutline
          };
        }
        return nextLayer;
      }

      if (nextLayer?.outline && typeof nextLayer.outline.clone === "function") {
        const nextOutline = nextLayer.outline.clone();
        nextOutline.color = shiftedOutline;
        nextLayer.outline = nextOutline;
      } else {
        nextLayer.outline = {
          ...(nextLayer?.outline ?? {}),
          color: shiftedOutline
        };
      }
      return nextLayer;
    });

    if (changed) {
      setSymbolLayers(symbol, nextLayers);
      graphic.symbol = symbol;
    }
  });
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
  z0?: number;
  z1?: number;
  dz?: number;
  hasZ?: boolean;
  dx: number;
  dy: number;
  len: number;
  accum: number;
};

type VertexStop = {
  x: number;
  y: number;
  z?: number;
  accum: number;
};

const buildMarchSegments = (geometry: Polyline) => {
  const segments: MarchSegment[] = [];
  let total = 0;
  geometry.paths?.forEach((path) => {
    for (let i = 1; i < path.length; i += 1) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const z0 = Number(path[i - 1][2]);
      const z1 = Number(path[i][2]);
      const hasZ = Number.isFinite(z0) && Number.isFinite(z1);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len <= 0) {
        continue;
      }
      segments.push({
        x0,
        y0,
        x1,
        y1,
        z0: hasZ ? z0 : undefined,
        z1: hasZ ? z1 : undefined,
        dz: hasZ ? z1 - z0 : undefined,
        hasZ,
        dx,
        dy,
        len,
        accum: total
      });
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
      const z = seg.hasZ ? (seg.z0 as number) + (seg.dz as number) * t : undefined;
      const heading = Math.atan2(seg.dy, seg.dx);
      const angle = 90 - heading * (180 / Math.PI);
      const ux = seg.dx / seg.len;
      const uy = seg.dy / seg.len;
      return { x, y, z, angle, ux, uy, heading };
    }
  }
  return null;
};

const getSmoothedMarchAngle = (
  segments: MarchSegment[],
  total: number,
  distance: number,
  fallbackAngle: number
) => {
  if (!Number.isFinite(total) || total <= 0) {
    return fallbackAngle;
  }
  const smoothWindow = Math.min(total * 0.125, Math.max(total * 0.025, 0.000001));
  const behindDistance = Math.max(0, distance - smoothWindow);
  const aheadDistance = Math.min(total, distance + smoothWindow);
  if (aheadDistance <= behindDistance) {
    return fallbackAngle;
  }
  const behindSample = sampleMarchPoint(segments, behindDistance);
  const aheadSample = sampleMarchPoint(segments, aheadDistance);
  if (!behindSample || !aheadSample) {
    return fallbackAngle;
  }
  const dx = aheadSample.x - behindSample.x;
  const dy = aheadSample.y - behindSample.y;
  if (Math.hypot(dx, dy) <= 0.000001) {
    return fallbackAngle;
  }
  const heading = Math.atan2(dy, dx);
  return 90 - heading * (180 / Math.PI);
};

const toPathCoord = (x: number, y: number, z?: number) =>
  Number.isFinite(Number(z)) ? [x, y, Number(z)] : [x, y];

const buildPointGeometry = (x: number, y: number, spatialReference: any, z?: number) =>
  new Point({
    x,
    y,
    ...(Number.isFinite(Number(z)) ? { z: Number(z) } : {}),
    spatialReference
  });

const hasRenderablePolylinePath = (geometry: Polyline | null | undefined) =>
  Boolean(geometry?.paths?.some((path) => Array.isArray(path) && path.length > 1));

const getStablePolylineEffectGeometry = (graphic: any) => {
  const original = graphic?.__originalGeometry as Polyline | undefined;
  if (hasRenderablePolylinePath(original)) {
    return original;
  }
  const backup = graphic?.__lastRenderableGeometry as Polyline | undefined;
  if (hasRenderablePolylinePath(backup)) {
    return backup;
  }
  const geometry = graphic?.geometry as Polyline | undefined;
  if (hasRenderablePolylinePath(geometry)) {
    return geometry;
  }
  return original ?? backup ?? geometry ?? null;
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
      const z = Number(point[2]);
      const stopZ = Number.isFinite(z) ? z : undefined;
      const prevStop = stops[stops.length - 1];
      if (prevStop && prevStop.x === point[0] && prevStop.y === point[1] && prevStop.z === stopZ) {
        continue;
      }
      stops.push({ x: point[0], y: point[1], z: stopZ, accum: total });
    }
  });
  return { stops, total };
};

const syncOverlayLayerElevation = (
  overlayLayer: GraphicsLayer,
  sourceLayer: any,
  view: any,
  fallbackOffset = 0
) => {
  const overlayAny = overlayLayer as any;
  if (!isSceneView3D(view)) {
    if (overlayAny.elevationInfo) {
      overlayAny.elevationInfo = null;
    }
    return;
  }

  const sourceElevationInfo = sourceLayer?.elevationInfo;
  if (sourceElevationInfo && typeof sourceElevationInfo === "object") {
    overlayAny.elevationInfo = { ...sourceElevationInfo };
    return;
  }

  overlayAny.elevationInfo = { mode: "relative-to-ground", offset: fallbackOffset };
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

const getFireworksLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__fireworksLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1,
    blendMode: "screen"
  });
  view?.map?.add(layer);
  (layerData as any).__fireworksLayer = layer;
  return layer;
};

const clearFireworksLayer = (layerData: LayerData) => {
  const layer = (layerData as any).__fireworksLayer as GraphicsLayer | undefined;
  if (!layer) return;
  layer.removeAll();
  layer.visible = false;
};

const densifyPolyline = (polyline: Polyline) => {
  const hasAnyZ = Boolean(
    polyline.paths?.some((path) =>
      path?.some((coord) => Array.isArray(coord) && Number.isFinite(Number(coord[2])))
    )
  );
  // Avoid densify operators for Z-enabled lines because they may emit mixed/no-Z vertices,
  // which can pull path-following effects off the actual elevated geometry.
  if (hasAnyZ) {
    return polyline.clone();
  }

  const isGeographic = Boolean((polyline.spatialReference as any)?.isGeographic);
  const geodeticReady = !isGeographic || ensureGeodeticOperatorsLoaded();
  if (isGeographic && !geodeticReady) {
    return polyline.clone();
  }
  const totalLength = isGeographic
    ? geodeticLengthOperator.execute(polyline) || 0
    : lengthOperator.execute(polyline) || 0;
  if (totalLength <= 0) {
    return polyline.clone();
  }
  // SceneView is more reliable with denser animated long lines, especially while zoomed far out.
  const maxSegmentLength = Math.max(totalLength / 1200, totalLength / 6000, 0.00001);
  const densified = (isGeographic
    ? geodeticDensifyOperator.execute(polyline, maxSegmentLength)
    : densifyOperator.execute(polyline, maxSegmentLength)) as Polyline | null | undefined;
  if (!densified?.paths?.length) {
    return polyline.clone();
  }
  return densified;
};

const normalizeAngleDegrees = (value: number) => {
  let next = value % 360;
  if (next < 0) {
    next += 360;
  }
  return next;
};

const getLayerGraphicsArray = (layer: any) => {
  const graphics = layer?.graphics;
  if (Array.isArray(graphics)) {
    return graphics;
  }
  if (graphics && typeof graphics.toArray === "function") {
    try {
      return graphics.toArray();
    } catch {
      return [];
    }
  }
  return [];
};

const getFollowPathStateAtTime = (
  graphicsLayers: LayerData[],
  layerData: LayerData,
  time: number,
  defaultPointStyle: PointStyle
): FollowPathState | null => {
  if (layerData.type !== "point") {
    return null;
  }

  const followAnimations = layerData.animations.filter(
    (anim): anim is FollowPathAnimation =>
      anim.type === "followPath" && typeof anim.pathLayerId === "string" && anim.pathLayerId.trim() !== ""
  );
  if (!followAnimations.length) {
    return null;
  }

  let activeAnim: FollowPathAnimation | null = null;
  let latestEndedAnim: FollowPathAnimation | null = null;
  let earliestUpcomingAnim: FollowPathAnimation | null = null;
  let latestEndedTime = Number.NEGATIVE_INFINITY;
  let earliestUpcomingTime = Number.POSITIVE_INFINITY;

  for (const anim of followAnimations) {
    const end = anim.start + anim.duration;
    if (time >= anim.start && time <= end) {
      activeAnim = anim;
      continue;
    }
    if (end <= time && end > latestEndedTime) {
      latestEndedTime = end;
      latestEndedAnim = anim;
    }
    if (anim.start > time && anim.start < earliestUpcomingTime) {
      earliestUpcomingTime = anim.start;
      earliestUpcomingAnim = anim;
    }
  }

  const animation: FollowPathAnimation | null = activeAnim ?? latestEndedAnim ?? earliestUpcomingAnim;
  if (!animation) {
    return null;
  }

  const pathLayerId = animation.pathLayerId.trim();
  if (!pathLayerId) {
    return null;
  }

  const sourceLayer = graphicsLayers.find(
    (candidate) => candidate.type === "polyline" && String(candidate.layer?.id || "").trim() === pathLayerId
  );
  if (!sourceLayer) {
    return null;
  }

  const sourceGraphic = getLayerGraphicsArray(sourceLayer.layer).find((graphic: any) =>
    hasRenderablePolylinePath(getStablePolylineEffectGeometry(graphic))
  );
  if (!sourceGraphic) {
    return null;
  }

  const sourceGeometry = getStablePolylineEffectGeometry(sourceGraphic);
  if (!sourceGeometry) {
    return null;
  }
  const densifiedGeometry = sourceGraphic.__densifiedGeometry ?? densifyPolyline(sourceGeometry);
  sourceGraphic.__densifiedGeometry = densifiedGeometry;
  const { segments, total } = buildMarchSegments(densifiedGeometry);
  if (!segments.length || total <= 0) {
    return null;
  }

  const rawProgress =
    animation.duration > 0
      ? clamp((time - animation.start) / animation.duration, 0, 1)
      : time >= animation.start
        ? 1
        : 0;
  const travelProgress = animation.reverse ? 1 - rawProgress : rawProgress;
  const travelDistance = total * travelProgress;
  const sample = sampleMarchPoint(segments, travelDistance);
  if (!sample) {
    return null;
  }

  const styleOrientation = readPointStyleOrientation(layerData.pointStyle ?? defaultPointStyle);
  const styleAngleOffset = getPointOrientationAngle(styleOrientation) ?? 0;
  const styleHeadingOffset = getPointOrientationHeading(styleOrientation) ?? styleAngleOffset;
  const baseTravelAngle =
    animation.smoothFollow !== false
      ? getSmoothedMarchAngle(segments, total, travelDistance, sample.angle)
      : sample.angle;
  const travelAngle = normalizeAngleDegrees(baseTravelAngle + (animation.reverse ? 180 : 0));
  const orientation =
    animation.orientToPath === false
      ? styleOrientation
      : {
          ...styleOrientation,
          angle: normalizeAngleDegrees(travelAngle + styleAngleOffset),
          heading: normalizeAngleDegrees(travelAngle + styleHeadingOffset)
        };

  return {
    animation,
    geometry: buildPointGeometry(sample.x, sample.y, densifiedGeometry.spatialReference, sample.z),
    orientation,
    visible: Boolean(activeAnim || latestEndedAnim)
  };
};

const buildPartialPolyline = (polyline: Polyline, progress: number, reverse: boolean) => {
  const resultPaths = buildPartialPaths(polyline.paths, progress, reverse);
  return new Polyline({
    spatialReference: polyline.spatialReference,
    hasZ: Boolean((polyline as any).hasZ),
    hasM: Boolean((polyline as any).hasM),
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
    const view = config.getView?.();
    const useExplicit3DTextOpacity =
      layerData.type === "text" && String(view?.type) === "3d" && !isMeshTextRenderMode(layerData.textRenderMode);
    const isPreviewing = isPlaying || isScrubbingTimeline;
    const hasRealAnimations = layerData.animations?.some((anim) => anim.type !== "__placeholder__") ?? false;
    const hasLayerPointKeyframes = config.hasPointKeyframes(layerData);
    const pointKeyframe = hasLayerPointKeyframes ? config.getPointKeyframeAtTime(layerData, time) : null;
    const followPathState =
      layerData.type === "point"
        ? getFollowPathStateAtTime(config.getGraphicsLayers(), layerData, time, config.defaultPointStyle)
        : null;
    const pointStyleOrientation =
      layerData.type === "point"
        ? readPointStyleOrientation(layerData.pointStyle ?? config.defaultPointStyle)
        : null;
    const basePointOrientation =
      layerData.type === "point"
        ? followPathState?.orientation ??
          mergePointSymbolOrientations(
            pointStyleOrientation,
            readPointKeyframeOrientation(pointKeyframe)
          )
        : null;
    if (!hasRealAnimations && !hasLayerPointKeyframes) {
      setVolumeAnimationPlaybackState(layerData, null);
      layerData.layer.opacity = 1;
      return;
    }
    if (!isPreviewing) {
      setVolumeAnimationPlaybackState(layerData, null);
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
      clearFireworksLayer(layerData);
      if (layerData.type === "point") {
        const baseSize = layerData.pointStyle?.size ?? config.defaultPointStyle.size;
        layerData.layer.graphics.forEach((graphic: any) => {
          applyPointSymbolScaleOrientation(graphic, baseSize, basePointOrientation ?? {});
        });
      }
      if (layerData.type === "polyline") {
        const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
        layerData.layer.graphics.forEach((graphic: any) => {
          applyLineSymbolWidth(graphic, baseWidth);
        });
      }
      if (layerData.type === "polygon") {
        const baseOutline = layerData.polygonStyle?.outlineWidth ?? defaultPolygonStyle.outlineWidth;
        const baseExtrudeHeight = Number(layerData.polygonStyle?.extrudeHeight) || 0;
        layerData.layer.graphics.forEach((graphic: any) => {
          applyPolygonOutlineWidth(graphic, baseOutline);
          applyPolygonExtrusionHeight(graphic, baseExtrudeHeight);
        });
      }
      if (layerData.type === "text") {
        const baseText = layerData.textContent || "Text";
        const baseSize = layerData.textSize ?? 14;
        layerData.layer.graphics.forEach((graphic: any) => {
          applyTextSymbolState(graphic, layerData, baseText, baseSize, 1, useExplicit3DTextOpacity);
        });
        syncTextMeshOverlay(layerData, view);
      } else if (isParticleLayer(layerData)) {
        syncVolumeBoxOverlay(layerData, view);
      }
      if (pointKeyframe) {
        applyPointKeyframes(layerData, pointKeyframe);
      }
      if (followPathState) {
        layerData.layer.graphics.forEach((graphic: any) => {
          if (!graphic?.geometry) return;
          graphic.geometry = followPathState.geometry.clone();
        });
      }
      return;
    }
    let layerVisible = false;
    let opacity = 1;
    let baseLayerOpacity = 1;
    let scale = 1;
    let lineWidthScale = 1;
    let outlineWidthScale = 1;
    let minAnimationStart = Number.POSITIVE_INFINITY;
    let activeDrawAnimation: LayerAnimation | null = null;
    let hasDrawAnimation = false;
    let minDrawStart = Number.POSITIVE_INFINITY;
    let activeFillAnimation: LayerAnimation | null = null;
    let hasFillAnimation = false;
    let minFillStart = Number.POSITIVE_INFINITY;
    let activeSpinProgress: number | null = null;
    let activeTypewriter: { anim: LayerAnimation; progress: number } | null = null;
    let maxTypewriterEnd = 0;
    let minTypewriterStart = Number.POSITIVE_INFINITY;
    let hasTypewriterAnimation = false;
    let hasActiveAnimation = false;
    let latestEndedAnimation: LayerAnimation | null = null;
    let latestEndedAnimationEnd = Number.NEGATIVE_INFINITY;
    let extrudeProgress: number | null = null;
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
    let fireworksProgress: number | null = null;
    let fireworksVariant: "fireworks" | "crossetteShell" | "mineShellCombo" = "fireworks";
    let fireworksFadeEnvelope = 1;
    let activeVolumeEffect: "smoke" | "fire" | null = null;
    let activeVolumeEffectProgress: number | null = null;
    let arrowProgress: number | null = null;
    let barrageProgress: number | null = null;
    let jitterProgress: number | null = null;
    let dissolveProgress: number | null = null;
    let ghostProgress: number | null = null;
    let breatheProgress: number | null = null;
    let pixelateProgress: number | null = null;
    let hasFireworksAnimation = false;
    let hasTimeGradientAnimation = false;
    const layerSeed = hashString(layerData.name || "layer");

    layerData.animations.forEach((anim: LayerAnimation) => {
      if (anim.type === "__placeholder__") {
        return;
      }
      const animEnd = anim.start + anim.duration;
      minAnimationStart = Math.min(minAnimationStart, anim.start);
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
      if (anim.type === "timeGradient") {
        hasTimeGradientAnimation = true;
      }
      if (
        anim.type === "fireworks" ||
        anim.type === "crossetteShell" ||
        anim.type === "mineShellCombo"
      ) {
        hasFireworksAnimation = true;
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
          case "extrude":
            extrudeProgress = progress;
            opacity = 1;
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
          case "fireworks":
            fireworksProgress = progress;
            fireworksVariant = "fireworks";
            opacity = 1;
            break;
          case "crossetteShell":
            fireworksProgress = progress;
            fireworksVariant = "crossetteShell";
            opacity = 1;
            break;
          case "mineShellCombo":
            fireworksProgress = progress;
            fireworksVariant = "mineShellCombo";
            opacity = 1;
            break;
          case "smoke":
            activeVolumeEffect = "smoke";
            activeVolumeEffectProgress = progress;
            opacity = 1;
            break;
          case "fire":
            activeVolumeEffect = "fire";
            activeVolumeEffectProgress = progress;
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
          case "followPath":
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
      if (fireworksProgress === null && latestEndedAnimation) {
        const endedType = String((latestEndedAnimation as LayerAnimation).type || "");
        const isFireworkType =
          endedType === "fireworks" ||
          endedType === "crossetteShell" ||
        endedType === "mineShellCombo";
      if (isFireworkType) {
        const cooldownProgress = clamp(
          (time - latestEndedAnimationEnd) / FIREWORKS_COOLDOWN_DURATION,
          0,
          1
        );
        if (cooldownProgress < 1) {
          fireworksProgress =
            1 + cooldownProgress * (FIREWORKS_POST_END_PROGRESS_MAX - 1);
          fireworksVariant =
            endedType === "crossetteShell"
              ? "crossetteShell"
              : endedType === "mineShellCombo"
                ? "mineShellCombo"
                : "fireworks";
          fireworksFadeEnvelope = 1 - cooldownProgress;
        }
      }
    }
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
      if (
        hasDrawAnimation &&
        getInactiveRevealGeometryMode(time, minDrawStart, minAnimationStart) === "empty" &&
        (isPlaying || isScrubbingTimeline)
      ) {
        layerVisible = false;
      }
      if (
        hasFillAnimation &&
        getInactiveRevealGeometryMode(time, minFillStart, minAnimationStart) === "empty" &&
        (isPlaying || isScrubbingTimeline)
      ) {
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
      layerData.layer.opacity = useExplicit3DTextOpacity ? 1 : baseLayerOpacity;
    }

    if (isParticleLayer(layerData)) {
      setVolumeAnimationPlaybackState(
        layerData,
        activeVolumeEffect && activeVolumeEffectProgress !== null
          ? {
              effect: activeVolumeEffect,
              progress: clamp(activeVolumeEffectProgress, 0, 1),
              time
            }
          : null
      );
    }

    if (hasDrawAnimation) {
      updatePolylineDraw(
        layerData,
        activeDrawAnimation,
        time,
        minDrawStart,
        minAnimationStart,
        isPlaying,
        isScrubbingTimeline
      );
    }
    if (hasFillAnimation) {
      updatePolygonFill(layerData, activeFillAnimation, time, minFillStart, minAnimationStart);
    }
    if (followPathState) {
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.geometry) return;
        graphic.geometry = followPathState.geometry.clone();
      });
    } else if (pointKeyframe) {
      applyPointKeyframes(layerData, pointKeyframe);
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
      const baseAngle = getPointOrientationAngle(basePointOrientation) ?? 0;
      const dartReveal = dartProgress !== null ? clamp((dartProgress - 0.78) / 0.22, 0, 1) : 1;
      const hideBasePoint = hasFireworksAnimation;
      const spunOrientation =
        activeSpinProgress !== null
          ? {
              ...(basePointOrientation ?? {}),
              angle: baseAngle + activeSpinProgress * 360,
              heading: baseAngle + activeSpinProgress * 360
            }
          : basePointOrientation ?? {};
      layerData.layer.graphics.forEach((graphic: any) => {
        applyPointSymbolScaleOrientation(
          graphic,
          hideBasePoint ? 0 : baseSize * scale * dartReveal,
          spunOrientation
        );
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

      if (fireworksProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const fireworksLayer = getFireworksLayer(layerData, view);
          const use3DSymbols = isSceneView3D(view);
          fireworksLayer.visible = true;
          fireworksLayer.opacity = Math.max(baseLayerOpacity, 0.9);
          const fireworksGraphics: Graphic[] = [];
          const progress = clamp(
            fireworksProgress,
            0,
            FIREWORKS_POST_END_PROGRESS_MAX
          );
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const activeFireworksVariant = fireworksVariant as
            | "fireworks"
            | "crossetteShell"
            | "mineShellCombo";
          const isCrossetteShell = activeFireworksVariant === "crossetteShell";
          const isMineShellCombo = activeFireworksVariant === "mineShellCombo";
          const styleSize = Math.max(2, layerData.pointStyle?.size ?? config.defaultPointStyle.size);
          const baseFireworkColor = parseColorToRgbaArray(
            layerData.pointStyle?.color ?? config.defaultPointStyle.color,
            [255, 160, 96, 1]
          );
          const baseFireworkAlpha = clamp(baseFireworkColor[3], 0, 1);
          const tintTowardWhite = (
            rgba: [number, number, number, number],
            amount: number
          ): [number, number, number, number] => {
            const t = clamp(amount, 0, 1);
            return [
              clamp(rgba[0] + (255 - rgba[0]) * t, 0, 255),
              clamp(rgba[1] + (255 - rgba[1]) * t, 0, 255),
              clamp(rgba[2] + (255 - rgba[2]) * t, 0, 255),
              clamp(rgba[3], 0, 1)
            ];
          };
          const withFireworkAlpha = (
            rgba: [number, number, number, number],
            alpha: number
          ): [number, number, number, number] => [
            rgba[0],
            rgba[1],
            rgba[2],
            clamp(alpha * baseFireworkAlpha * fireworksFadeEnvelope, 0, 1)
          ];
          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            const sourcePoint =
              (graphic.__originalGeometry as Point | undefined) ??
              (graphic.geometry as Point | undefined);
            if (!sourcePoint || sourcePoint.type !== "point") return;

            const targetPoint = toViewPoint(sourcePoint, view);
            const centerX = targetPoint.x;
            const centerY = targetPoint.y;
            const rawZ = Number((targetPoint as any)?.z ?? (sourcePoint as any)?.z);
            const centerZ = use3DSymbols ? (Number.isFinite(rawZ) ? rawZ : 0) : undefined;

            const shellSeed = layerSeed * 0.71 + graphicIndex * 17.93;
            const shellRandom = (offset: number) => noise1(shellSeed + offset);
            const shellTypeRoll = shellRandom(0.4);
            let shellType: "ring" | "peony" | "chrysanthemum" | "willow" | "palm" =
              shellTypeRoll < 0.34
                ? "peony"
                : shellTypeRoll < 0.62
                  ? "chrysanthemum"
                  : shellTypeRoll < 0.84
                    ? "willow"
                    : "palm";
            if (isCrossetteShell) {
              shellType = shellTypeRoll < 0.5 ? "peony" : "chrysanthemum";
            }
            if (isMineShellCombo) {
              shellType = shellTypeRoll < 0.62 ? "peony" : "palm";
            }
            const launchCutoff = isMineShellCombo
              ? 0.45 + shellRandom(0.9) * 0.15
              : 0.3 + shellRandom(0.9) * 0.18;
            const fuseDelay = isMineShellCombo
              ? 0.05 + shellRandom(1.3) * 0.08
              : 0.03 + shellRandom(1.3) * 0.11;
            const burstStart = Math.min(0.94, launchCutoff + fuseDelay);
            const sceneScaleBoost = use3DSymbols
              ? clamp(1 + Math.log2(resolution + 1) * 0.22, 1, 2.2)
              : 1;
            const sparkCountMultiplier =
              FIREWORKS_RANDOM_MULTIPLIER_MIN +
              shellRandom(1.53) * (FIREWORKS_RANDOM_MULTIPLIER_MAX - FIREWORKS_RANDOM_MULTIPLIER_MIN);
            const distanceMultiplier =
              FIREWORKS_RANDOM_MULTIPLIER_MIN +
              shellRandom(1.59) * (FIREWORKS_RANDOM_MULTIPLIER_MAX - FIREWORKS_RANDOM_MULTIPLIER_MIN);
            const lifetimeMultiplier =
              FIREWORKS_RANDOM_MULTIPLIER_MIN +
              shellRandom(1.67) * (FIREWORKS_RANDOM_MULTIPLIER_MAX - FIREWORKS_RANDOM_MULTIPLIER_MIN);
            const heightMultiplier =
              FIREWORKS_HEIGHT_MULTIPLIER_MIN +
              shellRandom(1.73) * (FIREWORKS_HEIGHT_MULTIPLIER_MAX - FIREWORKS_HEIGHT_MULTIPLIER_MIN);
            const launchHeight = use3DSymbols
              ? clamp(
                  (92 + styleSize * 8 + shellRandom(1.7) * 150) * sceneScaleBoost * heightMultiplier,
                  70,
                  1280
                )
              : 0;
            const lateralSpan = use3DSymbols
              ? clamp(launchHeight * (0.08 + shellRandom(2.3) * 0.18), 6, 130)
              : clamp(
                  (2 + styleSize * 0.35 + shellRandom(2.6) * 5) * resolution,
                  resolution * 0.5,
                  resolution * 18
                );
            const driftTheta = shellRandom(2.9) * TAU;
            const driftX = Math.cos(driftTheta) * lateralSpan;
            const driftY = Math.sin(driftTheta) * lateralSpan;
            const apexX = centerX + driftX;
            const apexY = centerY + driftY;
            const apexZ = use3DSymbols ? Number(centerZ ?? 0) + launchHeight : undefined;
            const shellHueShift = (shellRandom(3.4) - 0.5) * 46;
            const shellBaseColor = rotateHueRgba(baseFireworkColor, shellHueShift);
            const shellWarmColor = rotateHueRgba(shellBaseColor, 14 + shellRandom(3.9) * 20);
            const shellCoolColor = rotateHueRgba(shellBaseColor, -(10 + shellRandom(4.2) * 22));
            const fireworksSparkColor = tintTowardWhite(shellBaseColor, 0.58);
            const fireworksCoreColor = tintTowardWhite(shellBaseColor, 0.8);
            const fireworksGlowColor = tintTowardWhite(shellWarmColor, 0.34);
            const emberFireworkColor = tintTowardWhite(shellCoolColor, 0.22);

            if (isMineShellCombo) {
              const mineWindow = Math.max(launchCutoff * 0.72, 1e-6);
              const mineProgress = clamp(progress / mineWindow, 0, 1);
              if (mineProgress < 1) {
                const mineRise = Math.pow(mineProgress, 0.78);
                const mineFade = clamp(1 - mineProgress * 0.9, 0.05, 1);
                const mineCenterZ = use3DSymbols ? Number(centerZ ?? 0) + 0.8 : undefined;
                const mineRingRadiusBase = use3DSymbols
                  ? clamp((7 + styleSize * 0.9 + shellRandom(4.8) * 14) * mineRise, 3, 80)
                  : clamp(
                      (10 + styleSize * 1.3 + shellRandom(4.8) * 16) * resolution * mineRise,
                      resolution * 0.5,
                      resolution * 42
                    );
                const mineRingRadius = clamp(
                  mineRingRadiusBase * distanceMultiplier,
                  use3DSymbols ? 3 : resolution * 0.5,
                  use3DSymbols ? 800 : resolution * 420
                );
                const mineFlashAlpha = clamp(0.52 * mineFade, 0, 0.52);
                fireworksGraphics.push(
                  new Graphic({
                    geometry: buildPointGeometry(
                      centerX,
                      centerY,
                      targetPoint.spatialReference,
                      mineCenterZ
                    ),
                    symbol: buildWeldPointSymbol(
                      clamp(styleSize * (1.8 + mineRise * 2.8), 4, 18),
                      withFireworkAlpha(fireworksCoreColor, mineFlashAlpha),
                      withFireworkAlpha(fireworksGlowColor, mineFlashAlpha * 0.72),
                      clamp(styleSize * 0.05, 0.2, 0.8),
                      use3DSymbols
                    )
                  }),
                  new Graphic({
                    geometry: buildPointGeometry(
                      centerX,
                      centerY,
                      targetPoint.spatialReference,
                      mineCenterZ
                    ),
                    symbol: buildWeldPointSymbol(
                      clamp(styleSize * 1.4 + mineRingRadius * (use3DSymbols ? 0.1 : 0.08), 5, 28),
                      withFireworkAlpha(shellWarmColor, mineFlashAlpha * 0.08),
                      withFireworkAlpha(fireworksGlowColor, mineFlashAlpha * 0.62),
                      clamp(styleSize * 0.045, 0.18, 0.7),
                      use3DSymbols
                    )
                  })
                );

                const mineSparkBaseCount = Math.round(clamp(14 + styleSize * 1.1, 14, 30));
                const mineSparkCount = Math.max(
                  mineSparkBaseCount,
                  Math.round(mineSparkBaseCount * sparkCountMultiplier)
                );
                for (let mineIndex = 0; mineIndex < mineSparkCount; mineIndex += 1) {
                  const mineSeed = shellSeed + mineIndex * 2.07;
                  const mineAngle = (mineIndex / mineSparkCount) * TAU + (noise1(mineSeed + 0.6) - 0.5) * 0.48;
                  const mineRadius = mineRingRadius * (0.45 + noise1(mineSeed + 1.2) * 0.7);
                  const mineLift = use3DSymbols
                    ? launchHeight * (0.04 + noise1(mineSeed + 1.7) * 0.12) * mineRise
                    : 0;
                  const mineTipX = centerX + Math.cos(mineAngle) * mineRadius;
                  const mineTipY = centerY + Math.sin(mineAngle) * mineRadius;
                  const mineTipZ = use3DSymbols ? Number(centerZ ?? 0) + mineLift : undefined;
                  const mineCoreAlpha = clamp((0.24 + noise1(mineSeed + 2.2) * 0.5) * mineFade, 0.04, 0.62);
                  fireworksGraphics.push(
                    new Graphic({
                      geometry: new Polyline({
                        spatialReference: targetPoint.spatialReference,
                        paths: [[
                          toPathCoord(centerX, centerY, mineCenterZ),
                          toPathCoord(mineTipX, mineTipY, mineTipZ)
                        ]]
                      }),
                      symbol: buildWeldLineSymbol(
                        clamp(styleSize * (0.06 + noise1(mineSeed + 2.8) * 0.05), 0.5, 1.8),
                        withFireworkAlpha(fireworksSparkColor, mineCoreAlpha),
                        use3DSymbols
                      )
                    }),
                    new Graphic({
                      geometry: buildPointGeometry(
                        mineTipX,
                        mineTipY,
                        targetPoint.spatialReference,
                        mineTipZ
                      ),
                      symbol: buildWeldPointSymbol(
                        clamp(styleSize * (0.38 + noise1(mineSeed + 3.4) * 0.34), 1.8, 5.4),
                        withFireworkAlpha(shellWarmColor, mineCoreAlpha),
                        withFireworkAlpha(fireworksGlowColor, mineCoreAlpha * 0.3),
                        clamp(styleSize * 0.03, 0.1, 0.34),
                        use3DSymbols
                      )
                    })
                  );
                }
              }
            }

            const launchProgress = clamp(progress / Math.max(launchCutoff, 1e-6), 0, 1);
            if (launchProgress < 1) {
              const easedLaunch = 1 - Math.pow(1 - launchProgress, 2.45);
              const arcProgress = Math.pow(launchProgress, 1.35);
              const rocketX = centerX + (apexX - centerX) * arcProgress;
              const rocketY = centerY + (apexY - centerY) * arcProgress;
              const rocketZ = use3DSymbols
                ? Number(centerZ ?? 0) + launchHeight * easedLaunch
                : undefined;
              const tailProgress = Math.max(0, launchProgress - 0.1);
              const tailEase = 1 - Math.pow(1 - tailProgress, 2.45);
              const tailArcProgress = Math.pow(tailProgress, 1.35);
              const tailX = centerX + (apexX - centerX) * tailArcProgress;
              const tailY = centerY + (apexY - centerY) * tailArcProgress;
              const tailZ = use3DSymbols
                ? Number(centerZ ?? 0) + launchHeight * tailEase
                : undefined;
              const plumeAlpha = clamp(0.18 + (1 - launchProgress) * 0.4, 0.14, 0.58);
              const coreAlpha = clamp(0.68 + launchProgress * 0.26, 0.68, 0.96);
              const rocketWidth = clamp(styleSize * (0.09 + shellRandom(5.1) * 0.06), 0.55, 2.3);
              fireworksGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[
                      toPathCoord(tailX, tailY, tailZ),
                      toPathCoord(rocketX, rocketY, rocketZ)
                    ]]
                  }),
                  symbol: buildWeldLineSymbol(
                    Math.max(rocketWidth * 1.45, 0.66),
                    withFireworkAlpha(emberFireworkColor, plumeAlpha * 0.48),
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[
                      toPathCoord(tailX, tailY, tailZ),
                      toPathCoord(rocketX, rocketY, rocketZ)
                    ]]
                  }),
                  symbol: buildWeldLineSymbol(
                    rocketWidth,
                    withFireworkAlpha(fireworksSparkColor, plumeAlpha),
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: buildPointGeometry(
                    rocketX,
                    rocketY,
                    targetPoint.spatialReference,
                    rocketZ
                  ),
                  symbol: buildWeldPointSymbol(
                    clamp(styleSize * (0.85 + shellRandom(5.5) * 0.55), 2.8, 9.6),
                    withFireworkAlpha(fireworksCoreColor, coreAlpha),
                    withFireworkAlpha(fireworksGlowColor, plumeAlpha),
                    clamp(styleSize * 0.045, 0.22, 0.72),
                    use3DSymbols
                  )
                })
              );
            }

            const burstProgress = use3DSymbols
              ? clamp(
                  (progress - burstStart) / Math.max(1 - burstStart, 1e-6),
                  0,
                  fireworksFadeEnvelope < 1 ? FIREWORKS_POST_END_PROGRESS_MAX : 1
                )
              : clamp(
                  (progress - burstStart * 0.55) / Math.max(1 - burstStart * 0.55, 1e-6),
                  0,
                  fireworksFadeEnvelope < 1 ? FIREWORKS_POST_END_PROGRESS_MAX : 1
                );
            if (burstProgress <= 0) {
              if (launchProgress >= 0.96) {
                fireworksGraphics.push(
                  new Graphic({
                    geometry: buildPointGeometry(apexX, apexY, targetPoint.spatialReference, apexZ),
                    symbol: buildWeldPointSymbol(
                      clamp(styleSize * 0.6, 2, 6.2),
                      withFireworkAlpha(fireworksCoreColor, 0.74),
                      withFireworkAlpha(fireworksGlowColor, 0.42),
                      clamp(styleSize * 0.035, 0.12, 0.52),
                      use3DSymbols
                    )
                  })
                );
              }
              return;
            }

            const spreadProgress = Math.pow(
              burstProgress,
              shellType === "palm" ? 0.58 : 0.74
            );
            const burstLife = clamp(
              1 -
                (burstProgress / Math.max(lifetimeMultiplier, 1e-6)) *
                  (shellType === "willow" ? 0.52 : shellType === "palm" ? 0.66 : 0.74),
              0.03,
              1
            );
            const burstCenterX = apexX + (shellRandom(5.8) - 0.5) * lateralSpan * burstProgress * 0.24;
            const burstCenterY = apexY + (shellRandom(6.1) - 0.5) * lateralSpan * burstProgress * 0.24;
            const burstCenterZ = use3DSymbols ? apexZ : undefined;
            const baseSparkCount = Math.max(
              12,
              Math.round(
                use3DSymbols
                  ? clamp(
                      (isCrossetteShell ? 12 : 18) +
                        styleSize * (isCrossetteShell ? 0.65 : 0.95) +
                        (shellType === "willow" ? 10 : shellType === "chrysanthemum" ? 6 : 2),
                      isCrossetteShell ? 12 : 18,
                      isCrossetteShell ? 28 : 46
                    )
                  : clamp(
                      (isCrossetteShell ? 14 : 16) + styleSize * 0.85,
                      12,
                      isCrossetteShell ? 26 : 36
                    )
              )
            );
            const sparkCount = Math.max(
              baseSparkCount,
              Math.round(baseSparkCount * sparkCountMultiplier)
            );
            const burstRadiusBase = use3DSymbols
              ? clamp(
                  launchHeight *
                    (shellType === "willow"
                        ? 0.48
                        : shellType === "palm"
                          ? 0.36
                          : 0.42) *
                    (isCrossetteShell ? 0.82 : 1),
                  28,
                  320
                )
              : clamp(
                  (32 + styleSize * 6.7 + shellRandom(6.4) * 24) * resolution * (isCrossetteShell ? 0.82 : 1),
                  4,
                  2200
                );
            const burstRadiusMax = clamp(
              burstRadiusBase * distanceMultiplier,
              use3DSymbols ? 28 : 4,
              use3DSymbols ? 3200 : 22000
            );
            const streakBase = use3DSymbols
              ? clamp(
                  burstRadiusMax *
                    (shellType === "willow" ? 0.28 : shellType === "palm" ? 0.24 : 0.2) *
                    (isCrossetteShell ? 0.86 : 1),
                  6,
                  96
                )
              : clamp(
                  (10 + styleSize * 1.2) * resolution * (1 - burstProgress * 0.35),
                  resolution * 1.2,
                  resolution * 48
                );
            const gravityDrop = use3DSymbols
              ? launchHeight *
                (shellType === "willow" ? 0.58 : shellType === "palm" ? 0.46 : 0.38) *
                (isCrossetteShell ? 0.82 : 1)
              : 0;
            const dragFactor =
              (shellType === "willow" ? 0.62 : shellType === "palm" ? 0.46 : 0.36) +
              (isCrossetteShell ? 0.04 : 0);
            const windX = (shellRandom(6.7) - 0.5) * burstRadiusMax * (use3DSymbols ? 0.26 : 0.2);
            const windY = (shellRandom(7.1) - 0.5) * burstRadiusMax * (use3DSymbols ? 0.2 : 0.16);
            const hasCrackle = isCrossetteShell ? shellRandom(7.4) > 0.72 : shellRandom(7.4) > 0.56;
            const hasComets = isCrossetteShell ? shellRandom(7.8) > 0.8 : shellRandom(7.8) > 0.64;
            const flashAlpha = clamp(
              (1 - burstProgress * 2.5) * (0.42 + shellRandom(8.2) * 0.28),
              0,
              0.68
            );
            if (flashAlpha > 0.02) {
              fireworksGraphics.push(
                new Graphic({
                  geometry: buildPointGeometry(
                    burstCenterX,
                    burstCenterY,
                    targetPoint.spatialReference,
                    burstCenterZ
                  ),
                  symbol: buildWeldPointSymbol(
                    clamp(styleSize * (2.4 + (1 - burstProgress) * 4.8), 5.2, 34),
                    withFireworkAlpha(fireworksCoreColor, flashAlpha),
                    withFireworkAlpha(fireworksGlowColor, flashAlpha * 0.62),
                    clamp(styleSize * 0.05, 0.24, 0.82),
                    use3DSymbols
                  )
                })
              );
            }

            for (let i = 0; i < sparkCount; i += 1) {
              const seed = layerSeed * 0.53 + graphicIndex * 17.2 + i * 1.91;
              const sparkRandom = (offset: number) => noise1(seed + offset);
              const laneJitter = (sparkRandom(0.4) - 0.5) * (TAU / sparkCount) * 1.35;
              const angle = (i / sparkCount) * TAU + laneJitter;
              let elevation = -0.1 + sparkRandom(0.9) * 0.95;
              if (shellType === "willow") {
                elevation = 0.04 + sparkRandom(1.2) * 0.58;
              } else if (shellType === "palm") {
                elevation = 0.18 + sparkRandom(1.3) * 0.72;
              } else if (shellType === "chrysanthemum") {
                elevation = -0.16 + sparkRandom(1.4) * 1.08;
              }
              if (use3DSymbols) {
                const minElevationMagnitude = shellType === "palm" ? 0.14 : 0.2;
                if (Math.abs(elevation) < minElevationMagnitude) {
                  const sign = sparkRandom(1.47) < 0.5 ? -1 : 1;
                  elevation = sign * (minElevationMagnitude + sparkRandom(1.49) * 0.42);
                }
                elevation = clamp(elevation, -1.2, 1.2);
              }
              const cosElevation = Math.cos(elevation);
              const dirX = Math.cos(angle) * cosElevation;
              const dirY = Math.sin(angle) * cosElevation;
              const dirZ = use3DSymbols ? Math.sin(elevation) : 0;
              const speedScale = 0.6 + sparkRandom(1.7) * 0.75;
              // Approximate ballistic spark motion: expanding velocity with drag and gravity-driven falloff.
              const travelDistance =
                burstRadiusMax *
                spreadProgress *
                speedScale *
                (1 - dragFactor * burstProgress * 0.35);
              const fallProgress =
                burstProgress <= 1
                  ? burstProgress
                  : 1 + (burstProgress - 1) * FIREWORKS_FALL_SPEED_MULTIPLIER;
              const dropAmount = use3DSymbols
                ? gravityDrop *
                  fallProgress *
                  fallProgress *
                  FIREWORKS_FALL_SPEED_MULTIPLIER
                : 0;
              const tipX = burstCenterX + dirX * travelDistance + windX * burstProgress * burstProgress;
              const tipY = burstCenterY + dirY * travelDistance + windY * burstProgress * burstProgress;
              const tipZ = use3DSymbols
                ? Number(burstCenterZ ?? 0) + dirZ * travelDistance - dropAmount
                : undefined;
              const trailDistance = Math.max(
                0,
                travelDistance - streakBase * (0.78 + speedScale * 0.34)
              );
              const trailProgress = Math.max(0, burstProgress - 0.08);
              const trailFallProgress =
                trailProgress <= 1
                  ? trailProgress
                  : 1 + (trailProgress - 1) * FIREWORKS_FALL_SPEED_MULTIPLIER;
              const trailDrop = use3DSymbols
                ? gravityDrop *
                  trailFallProgress *
                  trailFallProgress *
                  FIREWORKS_FALL_SPEED_MULTIPLIER
                : 0;
              const tailX = burstCenterX + dirX * trailDistance + windX * trailProgress * trailProgress;
              const tailY = burstCenterY + dirY * trailDistance + windY * trailProgress * trailProgress;
              const tailZ = use3DSymbols
                ? Number(burstCenterZ ?? 0) + dirZ * trailDistance - trailDrop
                : undefined;
              const twinkle =
                0.76 +
                0.24 *
                  Math.sin(
                    timeSeed * (5.8 + sparkRandom(2.9) * 5.2) + i * 0.73 + graphicIndex * 0.41
                  );
              const sparkAlpha = clamp(
                (0.4 + sparkRandom(3.3) * 0.52) * burstLife * twinkle,
                0.04,
                0.95
              );
              const strokeWidth = clamp(
                styleSize * (0.05 + sparkRandom(3.9) * 0.09),
                0.42,
                2.5
              );
              const colorPick = sparkRandom(4.4);
              const sparkColorBase =
                colorPick < 0.2
                  ? shellWarmColor
                  : colorPick > 0.78
                    ? shellCoolColor
                    : shellBaseColor;
              const sparkColor = tintTowardWhite(sparkColorBase, 0.52 + sparkRandom(5.2) * 0.22);
              const sparkGlowColor = tintTowardWhite(
                sparkColorBase,
                0.24 + sparkRandom(5.8) * 0.18
              );

              fireworksGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[
                      toPathCoord(tailX, tailY, tailZ),
                      toPathCoord(tipX, tipY, tipZ)
                    ]]
                  }),
                  symbol: buildWeldLineSymbol(
                    Math.max(strokeWidth * 1.4, 0.62),
                    withFireworkAlpha(sparkGlowColor, sparkAlpha * 0.28),
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: targetPoint.spatialReference,
                    paths: [[
                      toPathCoord(tailX, tailY, tailZ),
                      toPathCoord(tipX, tipY, tipZ)
                    ]]
                  }),
                  symbol: buildWeldLineSymbol(
                    strokeWidth,
                    withFireworkAlpha(sparkColor, sparkAlpha),
                    use3DSymbols
                  )
                })
              );

              if (i % 3 === 0 || shellType === "palm") {
                fireworksGraphics.push(
                  new Graphic({
                    geometry: buildPointGeometry(tipX, tipY, targetPoint.spatialReference, tipZ),
                    symbol: buildWeldPointSymbol(
                      clamp(1.8 + styleSize * 0.35 + sparkRandom(6.2) * 2.7, 2, hasComets ? 10.4 : 8.8),
                      withFireworkAlpha(fireworksCoreColor, sparkAlpha),
                      withFireworkAlpha(fireworksGlowColor, sparkAlpha * 0.44),
                      clamp(styleSize * 0.038, 0.18, 0.58),
                      use3DSymbols
                    )
                  })
                );
              }

              if (hasComets && i % 5 === 0) {
                fireworksGraphics.push(
                  new Graphic({
                    geometry: buildPointGeometry(tipX, tipY, targetPoint.spatialReference, tipZ),
                    symbol: buildWeldPointSymbol(
                      clamp(styleSize * (0.94 + sparkRandom(6.7) * 0.42), 3.1, 11.8),
                      withFireworkAlpha(shellWarmColor, sparkAlpha * 0.6),
                      withFireworkAlpha(fireworksGlowColor, sparkAlpha * 0.34),
                      clamp(styleSize * 0.042, 0.18, 0.62),
                      use3DSymbols
                    )
                  })
                );
              }

              if (isCrossetteShell && burstProgress > 0.34 && burstProgress < 0.92 && i % 4 === 0) {
                const splitProgress = clamp((burstProgress - 0.34) / 0.58, 0, 1);
                const splitFade = clamp(1 - splitProgress * 0.84, 0.08, 1);
                const splitRadius =
                  streakBase * (0.14 + splitProgress * 0.42) * (0.72 + sparkRandom(7.05) * 0.62);
                const splitSize = clamp(
                  1.2 + styleSize * 0.2 + sparkRandom(7.2) * 1.3,
                  1.4,
                  5
                );
                for (let splitIndex = 0; splitIndex < 4; splitIndex += 1) {
                  const splitAngle = splitIndex * (TAU / 4) + sparkRandom(7.4 + splitIndex * 0.31) * 0.2;
                  const splitX = tipX + Math.cos(splitAngle) * splitRadius;
                  const splitY = tipY + Math.sin(splitAngle) * splitRadius;
                  const splitZ = use3DSymbols
                    ? Number(tipZ ?? burstCenterZ ?? 0) +
                      (sparkRandom(7.8 + splitIndex * 0.27) - 0.5) * splitRadius * 0.36
                    : undefined;
                  const splitAlpha = clamp(
                    sparkAlpha * splitFade * (0.48 + sparkRandom(8.1 + splitIndex * 0.19) * 0.34),
                    0.04,
                    0.52
                  );
                  fireworksGraphics.push(
                    new Graphic({
                      geometry: new Polyline({
                        spatialReference: targetPoint.spatialReference,
                        paths: [[
                          toPathCoord(tipX, tipY, tipZ),
                          toPathCoord(splitX, splitY, splitZ)
                        ]]
                      }),
                      symbol: buildWeldLineSymbol(
                        Math.max(strokeWidth * 0.85, 0.45),
                        withFireworkAlpha(shellWarmColor, splitAlpha),
                        use3DSymbols
                      )
                    }),
                    new Graphic({
                      geometry: buildPointGeometry(
                        splitX,
                        splitY,
                        targetPoint.spatialReference,
                        splitZ
                      ),
                      symbol: buildWeldPointSymbol(
                        splitSize,
                        withFireworkAlpha(fireworksCoreColor, splitAlpha),
                        withFireworkAlpha(fireworksGlowColor, splitAlpha * 0.34),
                        clamp(styleSize * 0.025, 0.08, 0.22),
                        use3DSymbols
                      )
                    })
                  );
                }
              }

              if (hasCrackle && burstProgress > 0.34 && i % 6 === 0) {
                const crackleCount = Math.round(clamp(2 + sparkRandom(7.1) * 3, 2, 5));
                for (let crackleIndex = 0; crackleIndex < crackleCount; crackleIndex += 1) {
                  const crackleAngle = sparkRandom(7.6 + crackleIndex * 0.31) * TAU;
                  const crackleRadius =
                    streakBase *
                    (0.08 + sparkRandom(8.2 + crackleIndex * 0.37) * 0.22) *
                    burstProgress;
                  const crackleX = tipX + Math.cos(crackleAngle) * crackleRadius;
                  const crackleY = tipY + Math.sin(crackleAngle) * crackleRadius;
                  const crackleZ = use3DSymbols
                    ? Number(tipZ ?? burstCenterZ ?? 0) +
                      (sparkRandom(8.8 + crackleIndex * 0.44) - 0.5) * crackleRadius * 0.55
                    : undefined;
                  const crackleAlpha = clamp(
                    (0.2 + sparkRandom(9.4 + crackleIndex * 0.23) * 0.55) *
                      burstLife *
                      (1 - burstProgress * 0.6),
                    0.03,
                    0.52
                  );
                  fireworksGraphics.push(
                    new Graphic({
                      geometry: buildPointGeometry(
                        crackleX,
                        crackleY,
                        targetPoint.spatialReference,
                        crackleZ
                      ),
                      symbol: buildWeldPointSymbol(
                        clamp(styleSize * (0.2 + sparkRandom(9.9) * 0.22), 1.2, 3.4),
                        withFireworkAlpha(shellWarmColor, crackleAlpha),
                        withFireworkAlpha(fireworksGlowColor, crackleAlpha * 0.22),
                        clamp(styleSize * 0.028, 0.08, 0.26),
                        use3DSymbols
                      )
                    })
                  );
                }
              }
            }

            const ringAlpha = clamp(
              (1 - burstProgress) * 0.28,
              0,
              0.38
            );
            if (ringAlpha > 0.01) {
              fireworksGraphics.push(
                new Graphic({
                  geometry: buildPointGeometry(
                    burstCenterX,
                    burstCenterY,
                    targetPoint.spatialReference,
                    burstCenterZ
                  ),
                  symbol: buildWeldPointSymbol(
                    clamp(styleSize * (3.2 + spreadProgress * 8.5), 6, 40),
                    withFireworkAlpha(shellWarmColor, ringAlpha * 0.11),
                    withFireworkAlpha(fireworksGlowColor, ringAlpha),
                    clamp(styleSize * 0.048, 0.2, 0.82),
                    use3DSymbols
                  )
                })
              );
            }

            fireworksGraphics.push(
              new Graphic({
                geometry: buildPointGeometry(
                  burstCenterX,
                  burstCenterY,
                  targetPoint.spatialReference,
                  burstCenterZ
                ),
                symbol: buildWeldPointSymbol(
                  clamp(styleSize * (0.88 + (1 - burstProgress) * 1.36), 2.8, 12.2),
                  withFireworkAlpha(
                    fireworksCoreColor,
                    clamp(0.2 + burstLife * 0.72, 0.2, 0.92)
                  ),
                  withFireworkAlpha(
                    shellWarmColor,
                    clamp(0.14 + burstLife * 0.46, 0.14, 0.74)
                  ),
                  clamp(styleSize * 0.042, 0.2, 0.66),
                  use3DSymbols
                )
              })
            );
          });

          if (use3DSymbols) {
            (fireworksLayer as any).elevationInfo = { mode: "relative-to-ground", offset: 0.3 };
          } else if ((fireworksLayer as any).elevationInfo) {
            (fireworksLayer as any).elevationInfo = null;
          }

          fireworksLayer.removeAll();
          if (fireworksGraphics.length) {
            fireworksLayer.addMany(fireworksGraphics);
          }
        }
      } else {
        clearFireworksLayer(layerData);
      }
    }
      if (layerData.type === "text") {
        const baseText = layerData.textContent || "Text";
        const baseSize = layerData.textSize ?? 14;
        layerData.layer.graphics.forEach((graphic: any) => {
          let text = baseText;
        if (hasTypewriterAnimation) {
          if (activeTypewriter) {
            const length = Math.max(0, Math.floor(baseText.length * activeTypewriter.progress));
            text = baseText.slice(0, length);
          } else if (time < minTypewriterStart) {
            text = "";
            } else if (time > maxTypewriterEnd) {
              text = baseText;
            }
          }
          applyTextSymbolState(
            graphic,
            layerData,
            text,
            baseSize * scale,
            useExplicit3DTextOpacity ? baseLayerOpacity : 1,
            useExplicit3DTextOpacity
          );
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
      const use3DLineGlow = isSceneView3D(config.getView?.());
      const baseLineColor = parseColorToRgbaArray(layerData.lineStyle?.color, [10, 76, 102, 1]);
      let glowStrength = 0.28;
      if (glowProgress !== null) {
        glowStrength = Math.max(glowStrength, glowMode === "soft" ? 0.55 : 0.9);
      }
      if (neonProgress !== null) glowStrength = Math.max(glowStrength, 1.35);
      if (sparkProgress !== null) glowStrength = Math.max(glowStrength, 1.15);
      if (weldProgress !== null || flightProgress !== null || waypointProgress !== null) {
        glowStrength = Math.max(glowStrength, 1.05);
      }
      if (arrowProgress !== null || barrageProgress !== null) {
        glowStrength = Math.max(glowStrength, 0.8);
      }
      layerData.layer.graphics.forEach((graphic: any) => {
        applyLineSymbolWidth(graphic, baseWidth * lineWidthScale);
        if (use3DLineGlow) {
          applyLineSymbolGlow(graphic, glowStrength, baseLineColor);
        }
      });

      if (arrowProgress !== null) {
        const view = config.getView?.();
        if (view) {
          const arrowLayer = getArrowLayer(layerData, view);
          syncOverlayLayerElevation(arrowLayer, layerData.layer, view, 0.25);
          arrowLayer.visible = true;
          arrowLayer.opacity = layerData.layer.opacity ?? 1;
          const arrowColor = layerData.lineStyle?.color ?? defaultLineStyle.color;
          const arrowSize = Math.max(8, baseWidth * 3);
          const arrowGraphics: Graphic[] = [];

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const marchGeometry = getStablePolylineEffectGeometry(graphic);
            if (!marchGeometry) return;
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
                geometry: buildPointGeometry(
                  sample.x,
                  sample.y,
                  marchGeometry.spatialReference,
                  sample.z
                ),
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
          const use3DSymbols = isSceneView3D(view);
          weldLayer.visible = true;
          weldLayer.opacity = Math.max(baseLayerOpacity, 0.92);
          const sparkGraphics: Graphic[] = [];
          const resolution = Math.max(Number(view?.resolution) || 1, 1e-6);
          const frameStep = Math.floor(timeSeed * 45);
          let weldUsesZ = false;

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
            weldUsesZ = weldUsesZ || segments.some((segment) => segment.hasZ);

            const head = sampleMarchPoint(segments, total);
            if (!head) return;
            const nx = -head.uy;
            const ny = head.ux;
            const headX = head.x;
            const headY = head.y;
            const headZ = Number.isFinite(Number(head.z))
              ? Number(head.z)
              : (use3DSymbols ? 0 : undefined);

            const trailLength = clamp(baseWidth * 36, 26, 170) * resolution;
            const trailStart = Math.max(0, total - trailLength);
            const trailSteps = clamp(Math.round((trailLength / Math.max(resolution, 1e-6)) / 6), 12, 28);
            const trailPoints: Array<{ x: number; y: number; z?: number }> = [];
            for (let step = 0; step <= trailSteps; step += 1) {
              const dist = trailStart + (total - trailStart) * (step / trailSteps);
              const sample = sampleMarchPoint(segments, dist);
              if (!sample) continue;
              trailPoints.push({
                x: sample.x,
                y: sample.y,
                z: Number.isFinite(Number(sample.z))
                  ? Number(sample.z)
                  : (use3DSymbols ? 0 : undefined)
              });
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
                    paths: [[toPathCoord(prev.x, prev.y, prev.z), toPathCoord(curr.x, curr.y, curr.z)]]
                  }),
                  symbol: buildWeldLineSymbol(
                    Math.max(baseWidth * 2.9, 2.2),
                    [214, 102, 48, glowAlpha],
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[toPathCoord(prev.x, prev.y, prev.z), toPathCoord(curr.x, curr.y, curr.z)]]
                  }),
                  symbol: buildWeldLineSymbol(
                    Math.max(baseWidth * 1.55, 1.2),
                    [238, 182, 112, coreAlpha],
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: buildPointGeometry(curr.x, curr.y, workingGeometry.spatialReference, curr.z),
                  symbol: buildWeldPointSymbol(
                    dotGlowSize,
                    [198, 88, 39, dotAlpha * 0.3],
                    [198, 88, 39, 0],
                    0,
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: buildPointGeometry(curr.x, curr.y, workingGeometry.spatialReference, curr.z),
                  symbol: buildWeldPointSymbol(
                    dotSize,
                    [238, 182, 112, dotAlpha],
                    [255, 223, 171, dotAlpha * 0.35],
                    Math.max(0.4, dotSize * 0.08),
                    use3DSymbols
                  )
                })
              );
            }

            const sparkCount = clamp(Math.round(11 + baseWidth * 2.1), 10, 24);
            const sparkZScale = use3DSymbols ? clamp(resolution * 2.2, 0.2, 6) : 0;

            sparkGraphics.push(
              new Graphic({
                geometry: buildPointGeometry(headX, headY, workingGeometry.spatialReference, headZ),
                symbol: buildWeldPointSymbol(
                  clamp(baseWidth * 6.2, 9, 22),
                  [255, 162, 78, 0.42],
                  [255, 199, 134, 0],
                  0,
                  use3DSymbols
                )
              }),
              new Graphic({
                geometry: buildPointGeometry(headX, headY, workingGeometry.spatialReference, headZ),
                symbol: buildWeldPointSymbol(
                  clamp(baseWidth * 3.4, 5, 13),
                  [255, 247, 222, 0.98],
                  [255, 186, 110, 0.8],
                  Math.max(0.8, baseWidth * 0.22),
                  use3DSymbols
                )
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
              const baseZ = Number.isFinite(Number(headZ)) ? Number(headZ) : 0;
              const zLift = use3DSymbols
                ? (0.8 + noise1(seed + 7.2) * 3.4) * sparkZScale
                : 0;
              const zDrift = use3DSymbols
                ? (noise1(seed + 7.8) - 0.35) * sparkZScale * 0.75
                : 0;
              const endZ = use3DSymbols ? baseZ + zLift : headZ;
              const tailX = endX - ux * trail;
              const tailY = endY - uy * trail;
              const tailZ = use3DSymbols ? baseZ + zDrift : endZ;
              const alpha = clamp(0.5 + noise1(seed + 5.9) * 0.5, 0.42, 1);
              const width = Math.max(1.05, baseWidth * (0.24 + noise1(seed + 6.3) * 0.35));

              sparkGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[toPathCoord(tailX, tailY, tailZ), toPathCoord(endX, endY, endZ)]]
                  }),
                  symbol: buildWeldLineSymbol(
                    Math.max(width * 1.8, 1.4),
                    [255, 139, 66, alpha * 0.34],
                    use3DSymbols
                  )
                }),
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: workingGeometry.spatialReference,
                    paths: [[toPathCoord(tailX, tailY, tailZ), toPathCoord(endX, endY, endZ)]]
                  }),
                  symbol: buildWeldLineSymbol(width, [255, 230, 168, alpha], use3DSymbols)
                })
              );

              if (i % 2 === 0) {
                sparkGraphics.push(
                  new Graphic({
                    geometry: buildPointGeometry(endX, endY, workingGeometry.spatialReference, endZ),
                    symbol: buildWeldPointSymbol(
                      clamp(2.8 + baseWidth * 0.85 + noise1(seed + 8.1) * 3.2, 3, 11),
                      [255, 247, 210, alpha],
                      [255, 199, 134, 0],
                      0,
                      use3DSymbols
                    )
                  })
                );
              }
            }
          });
          if (use3DSymbols) {
            (weldLayer as any).elevationInfo = weldUsesZ
              ? { mode: "absolute-height" }
              : { mode: "relative-to-ground", offset: 0.25 };
          } else if ((weldLayer as any).elevationInfo) {
            (weldLayer as any).elevationInfo = null;
          }

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
          syncOverlayLayerElevation(flightLayer, layerData.layer, view, 0.25);
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
            const trailPoints: Array<{ x: number; y: number; z?: number }> = [];
            for (let step = 0; step <= trailSteps; step += 1) {
              const dist = trailStart + (total - trailStart) * (step / trailSteps);
              const sample = sampleMarchPoint(segments, dist);
              if (!sample) continue;
              trailPoints.push({
                x: sample.x,
                y: sample.y,
                z: Number.isFinite(Number(sample.z)) ? Number(sample.z) : undefined
              });
            }
            if (cartoon && trailPoints.length > 1) {
              const trailPath = trailPoints.map((point) => toPathCoord(point.x, point.y, point.z));
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
                    geometry: buildPointGeometry(
                      puffX,
                      puffY,
                      displayedWorking.spatialReference,
                      curr.z
                    ),
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
                    geometry: buildPointGeometry(
                      puffX,
                      puffY,
                      displayedWorking.spatialReference,
                      curr.z
                    ),
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
                      paths: [[
                        toPathCoord(prev.x, prev.y, prev.z),
                        toPathCoord(curr.x, curr.y, curr.z)
                      ]]
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
                      paths: [[
                        toPathCoord(prev.x, prev.y, prev.z),
                        toPathCoord(curr.x, curr.y, curr.z)
                      ]]
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
            const planeZ = Number.isFinite(Number(head.z)) ? Number(head.z) : undefined;
            flightGraphics.push(
              new Graphic({
                geometry: buildPointGeometry(
                  planeX,
                  planeY,
                  displayedWorking.spatialReference,
                  planeZ
                ),
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
                geometry: buildPointGeometry(
                  planeX,
                  planeY,
                  displayedWorking.spatialReference,
                  planeZ
                ),
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
                  geometry: buildPointGeometry(
                    noseX,
                    noseY,
                    displayedWorking.spatialReference,
                    planeZ
                  ),
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
                  geometry: buildPointGeometry(
                    start.x,
                    start.y,
                    fullRouteWorking.spatialReference,
                    start.z
                  ),
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
                  geometry: buildPointGeometry(
                    end.x,
                    end.y,
                    fullRouteWorking.spatialReference,
                    end.z
                  ),
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
                  geometry: buildPointGeometry(
                    start.x,
                    start.y,
                    fullRouteWorking.spatialReference,
                    start.z
                  ),
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
                  geometry: buildPointGeometry(
                    end.x,
                    end.y,
                    fullRouteWorking.spatialReference,
                    end.z
                  ),
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
                    geometry: buildPointGeometry(
                      start.x,
                      start.y,
                      fullRouteWorking.spatialReference,
                      start.z
                    ),
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
                    geometry: buildPointGeometry(
                      end.x,
                      end.y,
                      fullRouteWorking.spatialReference,
                      end.z
                    ),
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
          syncOverlayLayerElevation(flightLayer, layerData.layer, view, 0.25);
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
                geometry: buildPointGeometry(
                  start.x,
                  start.y,
                  fullRouteWorking.spatialReference,
                  start.z
                ),
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
                geometry: buildPointGeometry(
                  end.x,
                  end.y,
                  fullRouteWorking.spatialReference,
                  end.z
                ),
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
                geometry: buildPointGeometry(
                  start.x,
                  start.y,
                  fullRouteWorking.spatialReference,
                  start.z
                ),
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
                geometry: buildPointGeometry(
                  end.x,
                  end.y,
                  fullRouteWorking.spatialReference,
                  end.z
                ),
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
          syncOverlayLayerElevation(waypointLayer, layerData.layer, view, 0.25);
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
            const reachedPoints: Array<number[]> = [];
            let activeStop: VertexStop | null = null;
            let activeIndex = -1;

            for (let index = 0; index < stops.length; index += 1) {
              const stop = stops[index];
              const reached = index === 0 || stop.accum <= revealDistance + revealLead;
              if (!reached) continue;
              reachedPoints.push(toPathCoord(stop.x, stop.y, stop.z));
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
                  geometry: buildPointGeometry(
                    stop.x,
                    stop.y,
                    fullRouteWorking.spatialReference,
                    stop.z
                  ),
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
                  geometry: buildPointGeometry(
                    stop.x,
                    stop.y,
                    fullRouteWorking.spatialReference,
                    stop.z
                  ),
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
                    geometry: buildPointGeometry(
                      stop.x,
                      stop.y,
                      fullRouteWorking.spatialReference,
                      stop.z
                    ),
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
                  geometry: buildPointGeometry(
                    activeStop.x,
                    activeStop.y,
                    fullRouteWorking.spatialReference,
                    activeStop.z
                  ),
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
          syncOverlayLayerElevation(waypointLayer, layerData.layer, view, 0.25);
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
            const reachedPoints: Array<number[]> = [];

            stops.forEach((stop, index) => {
              reachedPoints.push(toPathCoord(stop.x, stop.y, stop.z));
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
                  geometry: buildPointGeometry(
                    stop.x,
                    stop.y,
                    fullRouteWorking.spatialReference,
                    stop.z
                  ),
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
                  geometry: buildPointGeometry(
                    stop.x,
                    stop.y,
                    fullRouteWorking.spatialReference,
                    stop.z
                  ),
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
                    geometry: buildPointGeometry(
                      stop.x,
                      stop.y,
                      fullRouteWorking.spatialReference,
                      stop.z
                    ),
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
          syncOverlayLayerElevation(barrageLayer, layerData.layer, view, 0.25);
          barrageLayer.visible = true;
          barrageLayer.opacity = baseLayerOpacity;
          const baseColor = layerData.lineStyle?.color ?? defaultLineStyle.color;
          const baseWidth = layerData.lineStyle?.width ?? defaultLineStyle.width;
          const resolution = Number(view?.resolution) || 1;
          const barrageGraphics: Graphic[] = [];
          const progress = barrageProgress ?? 0;

          layerData.layer.graphics.forEach((graphic: any, graphicIndex: number) => {
            if (!graphic?.geometry || graphic.geometry.type !== "polyline") return;
            const sourceGeometry = getStablePolylineEffectGeometry(graphic);
            if (!sourceGeometry) return;
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
              const hz = Number.isFinite(Number(head.z)) ? Number(head.z) : undefined;
              const tz = Number.isFinite(Number(tail.z)) ? Number(tail.z) : undefined;

              const alpha = clamp(0.55 + (1 - Math.abs(spread)) * 0.35, 0.35, 0.95);
              const width = Math.max(1, baseWidth * (0.35 + (1 - Math.abs(spread)) * 0.35));
              barrageGraphics.push(
                new Graphic({
                  geometry: new Polyline({
                    spatialReference: densified.spatialReference,
                    paths: [[toPathCoord(tx, ty, tz), toPathCoord(hx, hy, hz)]]
                  }),
                  symbol: buildWeldLineSymbol(width, toRgbaArray(baseColor, alpha), isSceneView3D(view))
                })
              );

              const arrowSize = Math.max(6, baseWidth * 2.4);
              barrageGraphics.push(
                new Graphic({
                  geometry: buildPointGeometry(hx, hy, densified.spatialReference, hz),
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
      const baseExtrudeHeight = Number(layerData.polygonStyle?.extrudeHeight) || 0;
      const animatedExtrudeHeight =
        extrudeProgress !== null ? baseExtrudeHeight * clamp(extrudeProgress, 0, 1) : baseExtrudeHeight;
      layerData.layer.graphics.forEach((graphic: any) => {
        applyPolygonOutlineWidth(graphic, baseOutline * outlineWidthScale);
        applyPolygonExtrusionHeight(graphic, animatedExtrudeHeight);
      });
      if (hasTimeGradientAnimation) {
        applyPolygonTimeGradient3D(layerData, gradientProgress ?? 0);
      }
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
      const blur = (4 + spark * 16) * GLOW_DISTANCE_MULTIPLIER;
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
          ? (4 + glowPulse * 6) * GLOW_DISTANCE_MULTIPLIER
          : (6 + glowPulse * 18) * GLOW_DISTANCE_MULTIPLIER;
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
      const blur = (10 + neonPulse * 22) * GLOW_DISTANCE_MULTIPLIER;
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
    if (layerData.type === "text") {
      syncTextMeshOverlay(layerData, view);
      if (useExplicit3DTextOpacity && isPreviewing) {
        view?.requestRender?.();
      }
    } else if (isParticleLayer(layerData)) {
      syncVolumeBoxOverlay(layerData, view);
    }
  });
};

const applyPointKeyframes = (layerData: LayerData, frame: PointKeyframe | null) => {
  if (!frame) return;
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic?.geometry) return;
    const frameZ = Number(frame.z);
    const currentZ = Number((graphic.geometry as any)?.z);
    const z = Number.isFinite(frameZ) ? frameZ : Number.isFinite(currentZ) ? currentZ : undefined;
    graphic.geometry = new Point({
      x: frame.x,
      y: frame.y,
      spatialReference: frame.spatialReference ?? graphic.geometry?.spatialReference,
      ...(Number.isFinite(Number(z)) ? { z: Number(z) } : {})
    });
  });
};

export { applyAnimationsAtTime, getFollowPathStateAtTime };
