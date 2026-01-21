import Extent from "@arcgis/core/geometry/Extent";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import type { LayerData } from "../types";

type ZoomConfig = {
  getView: () => any;
};

const getLayerExtent = (config: ZoomConfig, layerData: LayerData) => {
  const layer = layerData.layer as any;
  const graphics = layer?.graphics?.items ?? [];
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
      view.goTo(target);
      return;
    }
    layer.queryExtent({}).then((result: any) => {
      if (result?.extent) {
        view.goTo(result.extent);
      }
    });
    return;
  }

  const extent = getLayerExtent(config, layerData);
  if (extent) {
    const expanded = extent.expand?.(1.4) ?? extent;
    view.goTo(expanded);
    return;
  }
  const graphic = (layerData.layer.graphics as any).getItemAt?.(0) ?? layerData.layer.graphics?.items?.[0];
  if (graphic?.geometry) {
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
    const expanded = (combined as Extent).expand?.(1.4) ?? combined;
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
