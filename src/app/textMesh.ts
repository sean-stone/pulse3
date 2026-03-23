import Color from "@arcgis/core/Color";
import Mesh from "@arcgis/core/geometry/Mesh";
import Point from "@arcgis/core/geometry/Point";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

import { BoxGeometry, Matrix4 } from "three";
import helvetikerRegularData from "three/examples/fonts/helvetiker_regular.typeface.json";
import optimerRegularData from "three/examples/fonts/optimer_regular.typeface.json";
import droidSansMonoRegularData from "three/examples/fonts/droid/droid_sans_mono_regular.typeface.json";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";

import type { LayerData } from "../types";
import { DEFAULT_TEXT_MESH_DEPTH_PERCENT } from "./constants";

type FontKey = "sans" | "serif" | "mono";

type TextMeshTemplate = {
  localPositions: Float64Array;
  faces: Uint32Array;
};

const fontLoader = new FontLoader();
const fontCatalog: Record<FontKey, any> = {
  sans: fontLoader.parse(helvetikerRegularData as any),
  serif: fontLoader.parse(optimerRegularData as any),
  mono: fontLoader.parse(droidSansMonoRegularData as any)
};

const ITALIC_SHEAR = 0.18;
const DEFAULT_CURVE_SEGMENTS = 8;
const MIN_TEXT_WORLD_HEIGHT = 0.6;
const MAX_TEXT_WORLD_HEIGHT = 5000;
const templateCache = new Map<string, TextMeshTemplate>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isSceneView3D = (view: any) => String(view?.type || "") === "3d";

const resolveFontKey = (fontFamily?: string): FontKey => {
  const family = String(fontFamily || "").toLowerCase();
  if (family.includes("mono")) {
    return "mono";
  }
  if (
    family.includes("serif") ||
    family.includes("georgia") ||
    family.includes("times")
  ) {
    return "serif";
  }
  return "sans";
};

const normalizeTextMeshDepth = (depth?: number) =>
  clamp(
    Number.isFinite(Number(depth)) ? Number(depth) : DEFAULT_TEXT_MESH_DEPTH_PERCENT,
    5,
    60
  );

const getTextMeshTemplateKey = (options: {
  text: string;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  depthPercent?: number;
}) =>
  JSON.stringify({
    text: options.text,
    font: resolveFontKey(options.fontFamily),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    depth: normalizeTextMeshDepth(options.depthPercent)
  });

const computeBounds = (positions: Float64Array) => {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (z < bounds.minZ) bounds.minZ = z;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
    if (z > bounds.maxZ) bounds.maxZ = z;
  }
  return bounds;
};

const mergeThreeGeometries = (geometries: Array<any>) => {
  let totalPositionCount = 0;
  let totalFaceCount = 0;

  geometries.forEach((geometry) => {
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr?.count) return;
    totalPositionCount += positionAttr.count;
    totalFaceCount += geometry.index?.count ?? positionAttr.count;
  });

  const positions = new Float64Array(totalPositionCount * 3);
  const faces = new Uint32Array(totalFaceCount);
  let positionOffset = 0;
  let faceOffset = 0;
  let vertexOffset = 0;

  geometries.forEach((geometry) => {
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr?.count) return;

    const positionArray = positionAttr.array as ArrayLike<number>;
    for (let index = 0; index < positionAttr.count * 3; index += 1) {
      positions[positionOffset + index] = Number(positionArray[index]);
    }

    const indexArray = geometry.index?.array as ArrayLike<number> | undefined;
    if (indexArray?.length) {
      for (let index = 0; index < indexArray.length; index += 1) {
        faces[faceOffset + index] = vertexOffset + Number(indexArray[index]);
      }
      faceOffset += indexArray.length;
    } else {
      for (let index = 0; index < positionAttr.count; index += 1) {
        faces[faceOffset + index] = vertexOffset + index;
      }
      faceOffset += positionAttr.count;
    }

    positionOffset += positionAttr.count * 3;
    vertexOffset += positionAttr.count;
  });

  return { positions, faces };
};

const buildTextMeshTemplate = (options: {
  text: string;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  depthPercent?: number;
}) => {
  const trimmedText = String(options.text || "");
  if (!trimmedText.trim()) {
    return null;
  }

  const geometry = new TextGeometry(trimmedText, {
    font: fontCatalog[resolveFontKey(options.fontFamily)],
    size: 1,
    depth: normalizeTextMeshDepth(options.depthPercent) / 100,
    curveSegments: DEFAULT_CURVE_SEGMENTS,
    bevelEnabled: false
  });

  if (options.italic) {
    geometry.applyMatrix4(
      new Matrix4().set(
        1,
        ITALIC_SHEAR,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      )
    );
  }

  geometry.computeBoundingBox();
  const textBounds = geometry.boundingBox;
  if (!textBounds) {
    return null;
  }

  const componentGeometries: Array<any> = [geometry];
  if (options.underline) {
    const width = Math.max(textBounds.max.x - textBounds.min.x, 0.28);
    const underlineThickness = 0.06;
    const underlineGap = 0.06;
    const underline = new BoxGeometry(
      width,
      underlineThickness,
      normalizeTextMeshDepth(options.depthPercent) / 100
    );
    underline.translate(
      (textBounds.min.x + textBounds.max.x) / 2,
      textBounds.min.y - underlineGap - underlineThickness / 2,
      normalizeTextMeshDepth(options.depthPercent) / 200
    );
    componentGeometries.push(underline);
  }

  const merged = mergeThreeGeometries(componentGeometries);
  const mergedBounds = computeBounds(merged.positions);
  const offsetX = -((mergedBounds.minX + mergedBounds.maxX) / 2);
  const offsetY = -mergedBounds.minY;
  const offsetZ = -((mergedBounds.minZ + mergedBounds.maxZ) / 2);

  const localPositions = new Float64Array(merged.positions.length);
  for (let index = 0; index < merged.positions.length; index += 3) {
    const x = merged.positions[index] + offsetX;
    const y = merged.positions[index + 1] + offsetY;
    const z = merged.positions[index + 2] + offsetZ;
    localPositions[index] = x;
    localPositions[index + 1] = z;
    localPositions[index + 2] = y;
  }

  return {
    localPositions,
    faces: merged.faces
  };
};

const getTextMeshTemplate = (options: {
  text: string;
  fontFamily?: string;
  italic?: boolean;
  underline?: boolean;
  depthPercent?: number;
}) => {
  const key = getTextMeshTemplateKey(options);
  if (templateCache.has(key)) {
    return templateCache.get(key) ?? null;
  }
  const template = buildTextMeshTemplate(options);
  if (template) {
    templateCache.set(key, template);
  }
  return template;
};

const toMeterPoint = (point: any) => {
  if (!point || point.type !== "point") return null;
  if (point.spatialReference?.isWebMercator) {
    return point as Point;
  }
  if (point.spatialReference?.isWGS84 || point.spatialReference?.isGeographic) {
    return webMercatorUtils.geographicToWebMercator(point) as Point;
  }
  return point as Point;
};

const getWorldTextHeight = (view: any, point: any, size: number) => {
  const sizeValue = clamp(Number.isFinite(Number(size)) ? Number(size) : 14, 8, 64);
  const anchorPoint = toMeterPoint(point);
  const cameraPoint = toMeterPoint(view?.camera?.position);
  const viewHeight = Math.max(1, Number(view?.height) || 1);
  const fov = Number(view?.camera?.fov);

  if (
    anchorPoint &&
    cameraPoint &&
    Number.isFinite(fov) &&
    fov > 0
  ) {
    const dx = Number(cameraPoint.x) - Number(anchorPoint.x);
    const dy = Number(cameraPoint.y) - Number(anchorPoint.y);
    const dz = Number(cameraPoint.z || 0) - Number(anchorPoint.z || 0);
    const distance = Math.hypot(dx, dy, dz);
    if (Number.isFinite(distance) && distance > 0) {
      const metersPerPixel = (2 * distance * Math.tan((fov * Math.PI) / 360)) / viewHeight;
      if (Number.isFinite(metersPerPixel) && metersPerPixel > 0) {
        return clamp(metersPerPixel * sizeValue, MIN_TEXT_WORLD_HEIGHT, MAX_TEXT_WORLD_HEIGHT);
      }
    }
  }

  return clamp(sizeValue * 0.75, MIN_TEXT_WORLD_HEIGHT, 120);
};

const getTextRotationAngle = (view: any, point: any) => {
  const anchorPoint = toMeterPoint(point);
  const cameraPoint = toMeterPoint(view?.camera?.position);
  if (anchorPoint && cameraPoint) {
    const dx = Number(cameraPoint.x) - Number(anchorPoint.x);
    const dy = Number(cameraPoint.y) - Number(anchorPoint.y);
    if (Math.hypot(dx, dy) > 1e-6) {
      return (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360;
    }
  }
  const fallbackHeading = Number(view?.camera?.heading);
  return (((Number.isFinite(fallbackHeading) ? fallbackHeading : 0) + 180) % 360 + 360) % 360;
};

const buildTextMeshSymbol = (colorValue?: string) => {
  const color = new Color(colorValue || "#22323a");
  const [r, g, b, a] = color.toRgba();
  return {
    type: "mesh-3d",
    symbolLayers: [
      {
        type: "fill",
        material: {
          color: [r, g, b, a]
        },
        edges: {
          type: "solid",
          color: [255, 255, 255, 0.28],
          size: 0.75
        }
      }
    ]
  } as any;
};

const buildTextMeshGeometry = (
  template: TextMeshTemplate,
  point: any,
  worldHeight: number,
  headingDegrees: number
) =>
  new Mesh({
    spatialReference: point.spatialReference,
    vertexSpace: {
      type: "local",
      origin: [Number(point.x), Number(point.y), Number(point.z || 0)]
    },
    transform: {
      rotationAxis: [0, 0, 1],
      rotationAngle: headingDegrees,
      scale: [worldHeight, worldHeight, worldHeight]
    },
    vertexAttributes: {
      position: Float64Array.from(template.localPositions)
    },
    components: [
      {
        faces: template.faces,
        shading: "flat"
      }
    ]
  });

const syncOverlayLayerState = (overlayLayer: GraphicsLayer, layerData: LayerData, view: any) => {
  const overlayAny = overlayLayer as any;
  const sourceLayer: any = layerData.layer;
  overlayLayer.visible = sourceLayer.visible !== false;
  overlayLayer.opacity = sourceLayer.opacity ?? 1;
  overlayAny.blendMode = sourceLayer.blendMode ?? "normal";
  overlayAny.effect = sourceLayer.effect ?? "";
  const sourceElevationInfo = sourceLayer.elevationInfo;
  if (isSceneView3D(view) && sourceElevationInfo && typeof sourceElevationInfo === "object") {
    overlayAny.elevationInfo = { ...sourceElevationInfo };
  } else if (overlayAny.elevationInfo) {
    overlayAny.elevationInfo = null;
  }
};

const getOrCreateTextMeshOverlayLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__textMeshLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1
  });
  (layer as any).__pulseTextLayerData = layerData;
  view?.map?.add(layer);
  (layerData as any).__textMeshLayer = layer;
  return layer;
};

export const isMeshTextRenderMode = (renderMode?: string | null) => String(renderMode || "") === "mesh-3d";

export const measureTextMeshWorldHeight = (view: any, point: any, size: number) =>
  getWorldTextHeight(view, point, size);

export const measureTextMeshRotation = (view: any, point: any) =>
  getTextRotationAngle(view, point);

export const buildTextMeshAnchorSymbol = () =>
  ({
    type: "simple-marker",
    style: "circle",
    size: 1,
    color: [0, 0, 0, 0],
    outline: {
      color: [0, 0, 0, 0],
      width: 0
    }
  } as any);

export const hideTextMeshOverlay = (layerData: LayerData) => {
  const overlay = (layerData as any).__textMeshLayer as GraphicsLayer | undefined;
  if (!overlay) return;
  overlay.removeAll();
  overlay.visible = false;
};

export const destroyTextMeshOverlay = (layerData: LayerData, view?: any) => {
  const overlay = (layerData as any).__textMeshLayer as GraphicsLayer | undefined;
  if (!overlay) return;
  overlay.removeAll();
  view?.map?.remove?.(overlay);
  delete (layerData as any).__textMeshLayer;
};

export const resolveTextMeshHitGraphic = (graphic: any) => {
  const overlayGraphic = graphic as Graphic | undefined;
  const overlayLayer = overlayGraphic?.layer as any;
  const layerData = (overlayGraphic as any)?.__pulseTextLayerData ?? overlayLayer?.__pulseTextLayerData;
  const anchorGraphic = (overlayGraphic as any)?.__pulseTextAnchorGraphic;
  if (!layerData || !anchorGraphic) {
    return null;
  }
  return {
    layerData: layerData as LayerData,
    graphic: anchorGraphic
  };
};

export const syncTextMeshOverlay = (layerData: LayerData, view: any) => {
  if (
    !view ||
    layerData.type !== "text" ||
    !isSceneView3D(view) ||
    !isMeshTextRenderMode(layerData.textRenderMode)
  ) {
    hideTextMeshOverlay(layerData);
    return;
  }

  const overlayLayer = getOrCreateTextMeshOverlayLayer(layerData, view);
  syncOverlayLayerState(overlayLayer, layerData, view);

  const meshSymbol = buildTextMeshSymbol(layerData.textColor);
  const activeGraphics = new Set<Graphic>();
  let resolvedFixedWorldHeight = Number(layerData.textWorldHeight);
  let resolvedFixedWorldRotation = Number(layerData.textWorldRotation);

  layerData.layer.graphics.forEach((anchorGraphic: any) => {
    if (!anchorGraphic?.geometry || anchorGraphic.geometry.type !== "point") return;

    const text = String(anchorGraphic.__pulseTextCurrentText ?? layerData.textContent ?? "Text");
    if (!text.trim()) {
      const staleGraphic = anchorGraphic.__pulseTextMeshGraphic as Graphic | undefined;
      if (staleGraphic) {
        overlayLayer.remove(staleGraphic);
        delete anchorGraphic.__pulseTextMeshGraphic;
      }
      return;
    }

    const template = getTextMeshTemplate({
      text,
      fontFamily: layerData.textFontFamily,
      italic: layerData.textItalic,
      underline: layerData.textUnderline,
      depthPercent: layerData.textDepth
    });
    if (!template) return;

    const size = Number(anchorGraphic.__pulseTextCurrentSize ?? layerData.textSize ?? 14);
    if (layerData.textFixedToWorld && (!Number.isFinite(resolvedFixedWorldHeight) || resolvedFixedWorldHeight <= 0)) {
      resolvedFixedWorldHeight = getWorldTextHeight(view, anchorGraphic.geometry, size);
      layerData.textWorldHeight = resolvedFixedWorldHeight;
    }
    if (layerData.textFixedToWorld && !Number.isFinite(resolvedFixedWorldRotation)) {
      resolvedFixedWorldRotation = getTextRotationAngle(view, anchorGraphic.geometry);
      layerData.textWorldRotation = resolvedFixedWorldRotation;
    }
    const worldHeight =
      layerData.textFixedToWorld && Number.isFinite(resolvedFixedWorldHeight) && resolvedFixedWorldHeight > 0
        ? resolvedFixedWorldHeight
        : getWorldTextHeight(view, anchorGraphic.geometry, size);
    const rotationAngle =
      layerData.textFixedToWorld && Number.isFinite(resolvedFixedWorldRotation)
        ? resolvedFixedWorldRotation
        : getTextRotationAngle(view, anchorGraphic.geometry);
    const meshGeometry = buildTextMeshGeometry(template, anchorGraphic.geometry, worldHeight, rotationAngle);
    let meshGraphic = anchorGraphic.__pulseTextMeshGraphic as Graphic | undefined;

    if (!meshGraphic || meshGraphic.layer !== overlayLayer) {
      meshGraphic = new Graphic();
      overlayLayer.add(meshGraphic);
      anchorGraphic.__pulseTextMeshGraphic = meshGraphic;
    }

    meshGraphic.geometry = meshGeometry;
    meshGraphic.symbol = meshSymbol;
    (meshGraphic as any).__pulseTextAnchorGraphic = anchorGraphic;
    (meshGraphic as any).__pulseTextLayerData = layerData;
    activeGraphics.add(meshGraphic);
  });

  const staleGraphics = overlayLayer.graphics.toArray().filter((graphic) => !activeGraphics.has(graphic));
  if (staleGraphics.length) {
    overlayLayer.removeMany(staleGraphics);
  }
  overlayLayer.visible = overlayLayer.graphics.length > 0 && layerData.layer.visible !== false;
};
