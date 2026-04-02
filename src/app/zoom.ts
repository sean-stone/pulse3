import Extent from "@arcgis/core/geometry/Extent";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import type { LayerData } from "../types";

type ZoomConfig = {
  getView: () => any;
};

const SCENE_POINT_TARGET_SCALE = 3500;
const SCENE_TEXT_TARGET_SCALE = 4500;
const SCENE_SMALL_EXTENT_SCALE = 9000;
const SCENE_MEDIUM_EXTENT_SCALE = 22000;
const SCENE_SMALL_EXTENT_THRESHOLD_METERS = 1800;
const SCENE_MEDIUM_EXTENT_THRESHOLD_METERS = 12000;

const isSceneView3D = (view: any) => String(view?.type || "") === "3d";

const getLayerGraphics = (layerData: LayerData) => {
  const layer = layerData.layer as any;
  return (layer?.graphics?.items ?? []) as any[];
};

const getLayerPrimaryGraphic = (layerData: LayerData) => {
  const graphics = getLayerGraphics(layerData);
  return graphics[0] ?? null;
};

const estimateExtentSizeMeters = (extent: Extent | null) => {
  if (!extent) return Number.POSITIVE_INFINITY;
  const width = Number(extent.width ?? extent.xmax - extent.xmin);
  const height = Number(extent.height ?? extent.ymax - extent.ymin);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return Number.POSITIVE_INFINITY;
  }
  const spatialReference = extent.spatialReference as any;
  if (spatialReference?.isGeographic) {
    const centerY = Number(extent.center?.y ?? (extent.ymin + extent.ymax) * 0.5);
    const latitudeRadians = (centerY * Math.PI) / 180;
    const metersPerDegreeLat = 111132;
    const metersPerDegreeLon = 111320 * Math.max(0.1, Math.cos(latitudeRadians));
    return Math.max(Math.abs(width) * metersPerDegreeLon, Math.abs(height) * metersPerDegreeLat);
  }
  return Math.max(Math.abs(width), Math.abs(height));
};

const getSceneTargetScale = (layerData: LayerData, extent: Extent | null) => {
  if (layerData.type === "point" || layerData.type === "volume") {
    return SCENE_POINT_TARGET_SCALE;
  }
  if (layerData.type === "text") {
    return SCENE_TEXT_TARGET_SCALE;
  }
  const sizeMeters = estimateExtentSizeMeters(extent);
  if (sizeMeters <= SCENE_SMALL_EXTENT_THRESHOLD_METERS) {
    return SCENE_SMALL_EXTENT_SCALE;
  }
  if (sizeMeters <= SCENE_MEDIUM_EXTENT_THRESHOLD_METERS) {
    return SCENE_MEDIUM_EXTENT_SCALE;
  }
  return null;
};

const buildSceneGoToTarget = (view: any, layerData: LayerData, extent: Extent | null) => {
  const primaryGraphic = getLayerPrimaryGraphic(layerData);
  const pointGeometry =
    primaryGraphic?.geometry?.type === "point" ? primaryGraphic.geometry : extent?.center ?? null;
  const targetScale = getSceneTargetScale(layerData, extent);

  if (pointGeometry && targetScale) {
    return {
      target: pointGeometry,
      scale: targetScale,
      heading: view?.camera?.heading,
      tilt: view?.camera?.tilt
    };
  }

  if (extent) {
    return extent.expand?.(1.15) ?? extent;
  }

  if (primaryGraphic?.geometry) {
    return {
      target: primaryGraphic.geometry,
      scale: SCENE_SMALL_EXTENT_SCALE,
      heading: view?.camera?.heading,
      tilt: view?.camera?.tilt
    };
  }

  return null;
};

const getLayerExtent = (config: ZoomConfig, layerData: LayerData) => {
  const graphics = getLayerGraphics(layerData);
  let xmin = Number.POSITIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;
  let spatialReference: any = null;

  graphics.forEach((graphic: any) => {
    const geometry = graphic?.geometry;
    if (!geometry) return;
    if (geometry.spatialReference && !spatialReference) {
      spatialReference = geometry.spatialReference;
    }
    if (geometry.type === "point") {
      const x = geometry.x;
      const y = geometry.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
      return;
    }
    const extent = geometry.extent;
    if (!extent) return;
    xmin = Math.min(xmin, extent.xmin);
    ymin = Math.min(ymin, extent.ymin);
    xmax = Math.max(xmax, extent.xmax);
    ymax = Math.max(ymax, extent.ymax);
  });

  if (!Number.isFinite(xmin) || !Number.isFinite(ymin)) {
    return null;
  }
  return new Extent({
    xmin,
    ymin,
    xmax,
    ymax,
    spatialReference: spatialReference ?? config.getView()?.spatialReference
  });
};

const zoomToLayer = (config: ZoomConfig, layerData: LayerData) => {
  const view = config.getView();
  if (!view) return;
  if (layerData.type === "feature") {
    const layer = layerData.layer as FeatureLayer;
    const target = layer.fullExtent;
    if (target) {
      if (isSceneView3D(view)) {
        const sceneTarget = buildSceneGoToTarget(view, layerData, target);
        if (sceneTarget) {
          view.goTo(sceneTarget);
          return;
        }
      }
      view.goTo(target);
      return;
    }
    layer.queryExtent({}).then((result: any) => {
      if (result?.extent) {
        const targetExtent = result.extent as Extent;
        if (isSceneView3D(view)) {
          const sceneTarget = buildSceneGoToTarget(view, layerData, targetExtent);
          if (sceneTarget) {
            view.goTo(sceneTarget);
            return;
          }
        }
        view.goTo(targetExtent);
      }
    });
    return;
  }

  const extent = getLayerExtent(config, layerData);
  if (extent) {
    if (isSceneView3D(view)) {
      const sceneTarget = buildSceneGoToTarget(view, layerData, extent);
      if (sceneTarget) {
        view.goTo(sceneTarget);
        return;
      }
    }
    const expanded = extent.expand?.(1.4) ?? extent;
    view.goTo(expanded);
    return;
  }
  const graphic = getLayerPrimaryGraphic(layerData);
  if (graphic?.geometry) {
    if (isSceneView3D(view)) {
      view.goTo({
        target: graphic.geometry,
        scale: getSceneTargetScale(layerData, null) ?? SCENE_SMALL_EXTENT_SCALE,
        heading: view?.camera?.heading,
        tilt: view?.camera?.tilt
      });
      return;
    }
    view.goTo({ target: graphic.geometry, zoom: Math.max(view.zoom ?? 12, 14) });
  }
};

const zoomToLayers = (config: ZoomConfig, layers: LayerData[]) => {
  const view = config.getView();
  if (!view || layers.length === 0) return;
  let combined: Extent | null = null;

  layers.forEach((layerData) => {
    const extent = getLayerExtent(config, layerData);
    if (!extent) return;
    if (!combined) {
      combined = extent;
      return;
    }
    combined = new Extent({
      xmin: Math.min(combined.xmin, extent.xmin),
      ymin: Math.min(combined.ymin, extent.ymin),
      xmax: Math.max(combined.xmax, extent.xmax),
      ymax: Math.max(combined.ymax, extent.ymax),
      spatialReference: combined.spatialReference ?? extent.spatialReference
    });
  });

  if (combined) {
    const combinedExtent = combined as Extent;
    if (isSceneView3D(view)) {
      const sizeMeters = estimateExtentSizeMeters(combinedExtent);
      if (sizeMeters <= SCENE_MEDIUM_EXTENT_THRESHOLD_METERS) {
        view.goTo({
          target: combinedExtent.center,
          scale:
            sizeMeters <= SCENE_SMALL_EXTENT_THRESHOLD_METERS
              ? SCENE_SMALL_EXTENT_SCALE
              : SCENE_MEDIUM_EXTENT_SCALE,
          heading: view?.camera?.heading,
          tilt: view?.camera?.tilt
        });
        return;
      }
      view.goTo(combinedExtent.expand?.(1.15) ?? combinedExtent);
      return;
    }
    const expanded = combinedExtent.expand?.(1.4) ?? combinedExtent;
    view.goTo(expanded);
    return;
  }

  const firstLayer = layers[0];
  if (firstLayer) {
    zoomToLayer(config, firstLayer);
  }
};

export type { ZoomConfig };
export { zoomToLayer, zoomToLayers };
