import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import type { LayerData , PointStyle, LineStyle, PolygonStyle } from "../types";

type FeatureLayerState = {
  getView: () => any;
  getIsAdding: () => boolean;
  setIsAdding: (value: boolean) => void;
  addLayerData: (layerData: LayerData) => number;
};

type FeatureLayerConfig = {
  getEl: (id: string) => HTMLElement;
  isValidFeatureLayerUrl: (value: string) => boolean;
  setFeatureLayerError: (message: string | null) => void;
  sanitizePlainText: (value: string, fallback: string) => string;
  createPlaceholderAnimation: () => any;
  getFeatureLayerFields: (layer: FeatureLayer) => Array<{ name: string; type: string }>;
  updateFeatureFieldStats: (layerData: LayerData) => Promise<boolean>;
  applyFeatureLayerDefinition: (layerData: LayerData) => void;
  applyFeatureLayerAnimation: (layerData: LayerData, time: number) => void;
  zoomToLayer: (layerData: LayerData) => void;
  selectLayer: (index: number) => void;
  updateTimeline: () => void;
  scheduleProjectSave: () => void;
  defaultPointStyle: PointStyle;
  defaultLineStyle: LineStyle;
  defaultPolygonStyle: PolygonStyle;
  applyLayerModeProperties?: (layerData: LayerData) => void;
};

const handleAddFeatureLayer = async (state: FeatureLayerState, config: FeatureLayerConfig) => {
  const view = state.getView();
  if (!view) return;
  if (state.getIsAdding()) return;
  const input = config.getEl("feature-layer-url") as HTMLInputElement;
  const url = String(input.value || "").trim();
  const button = document.getElementById("add-feature-layer-btn");
  config.setFeatureLayerError(null);
  if (!url) {
    config.setFeatureLayerError("Enter a FeatureLayer URL first.");
    return;
  }
  if (!config.isValidFeatureLayerUrl(url)) {
    config.setFeatureLayerError("Enter a valid FeatureServer URL (https://.../FeatureServer/0).");
    return;
  }
  state.setIsAdding(true);
  if (button) {
    button.setAttribute("disabled", "true");
  }

  try {
    let layer: FeatureLayer;
    try {
      layer = new FeatureLayer({ url });
      await layer.load();
    } catch (error) {
      config.setFeatureLayerError("Unable to load FeatureLayer. Please check the URL.");
      return;
    }

    const fields = config.getFeatureLayerFields(layer);
    if (!fields.length) {
      config.setFeatureLayerError("No numeric or date fields available to animate.");
      return;
    }

    view.map.add(layer);
    const layerData: LayerData = {
      layer,
      name: config.sanitizePlainText(layer.title || "Feature Layer", "Feature Layer"),
      type: "feature",
      animations: [config.createPlaceholderAnimation()],
      featureLayerUrl: url,
      featureFields: fields,
      featureField: fields[0].name,
      featureFieldType: fields[0].type,
      featureVisualVariable: "opacity",
      featureHideNulls: false,
      featureKeepVisible: false
    };

    if (layer.geometryType === "polyline") {
      layerData.lineStyle = { ...config.defaultLineStyle };
    } else if (layer.geometryType === "polygon") {
      layerData.polygonStyle = { ...config.defaultPolygonStyle };
      layerData.polygonZOffset = 0;
    } else {
      layerData.pointStyle = { ...config.defaultPointStyle };
      layerData.pointFollowTerrain3D = true;
    }
    layerData.layerEffectsEnabled = true;
    config.applyLayerModeProperties?.(layerData);

    const layerIndex = state.addLayerData(layerData);
    input.value = "";

    const statsOk = await config.updateFeatureFieldStats(layerData);
    if (!statsOk) {
      config.setFeatureLayerError("Unable to compute min/max for that field. Try another field.");
    }
    config.applyFeatureLayerDefinition(layerData);
    config.applyFeatureLayerAnimation(layerData, 0);
    config.zoomToLayer(layerData);

    config.selectLayer(layerIndex);
    config.updateTimeline();
    config.scheduleProjectSave();
  } finally {
    state.setIsAdding(false);
    if (button) {
      button.removeAttribute("disabled");
    }
  }
};

export type { FeatureLayerConfig, FeatureLayerState };
export { handleAddFeatureLayer };
