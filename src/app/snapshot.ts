import Extent from "@arcgis/core/geometry/Extent";
import Graphic from "@arcgis/core/Graphic";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { LayerAnimation, LayerData, LineStyle, PointStyle, PolygonStyle } from "../types";

import type { ProjectLayerSnapshot, ProjectSnapshot } from "./constants";
import { PROJECT_VERSION } from "./constants";

type SnapshotBuildConfig = {
  view: any;
  graphicsLayers: LayerData[];
  projectName: string;
  currentLayout: "default" | "mobile" | "tablet" | "custom";
  timelineDurationOverride: number | null;
  isRotated: boolean;
  getEl: (id: string) => HTMLElement;
  ensureGeometryCache: (layerData: LayerData, graphic: any) => void;
  arcgisGeometryToGeoJSON: (geometry: any) => any;
};

type SnapshotApplyConfig = {
  view: any;
  getGraphicsLayers: () => LayerData[];
  setGraphicsLayers: (next: LayerData[]) => void;
  addGraphicsLayer: (layerData: LayerData) => void;
  setSelectedLayerIndex: (index: number) => void;
  setTimelineDurationOverride: (value: number | null) => void;
  setProjectName: (value: string, shouldSave: boolean) => void;
  setProjectError: (message: string | null) => void;
  setIsRestoringProject: (value: boolean) => void;
  setIsRotated: (value: boolean) => void;
  resetHistoryState: () => void;
  stopAnimation: () => void;
  updateLayersList: () => void;
  updateTimeline: () => void;
  updateAnimationOptions: () => void;
  goToStart: () => void;
  startAnimation: () => void;
  hasPlayableAnimation: () => boolean;
  isApplyingHistory: () => boolean;
  getCurrentTime: () => number;
  getCurrentAspectRatio: () => { width: number; height: number } | null;
  scheduleAspectRatioUpdate: () => void;
  setCurrentLayout: (layout: "default" | "mobile" | "tablet" | "custom") => void;
  handleLayoutChange: (event: Event) => void;
  getEl: (id: string) => HTMLElement;
  setCalciteValue: (el: HTMLElement, value: any) => void;
  normalizeBasemap: (value: string) => string;
  handleBasemapChange: () => void;
  createPlaceholderAnimation: () => LayerAnimation;
  getFeatureLayerFields: (layer: FeatureLayer) => Array<{ name: string; type: string }>;
  updateFeatureFieldStats: (layerData: LayerData) => Promise<boolean>;
  applyFeatureLayerDefinition: (layerData: LayerData) => void;
  applyFeatureLayerAnimation: (layerData: LayerData, time: number) => void;
  applyLayerEffects: (layerData: LayerData) => void;
  applyLayerStyle: (layerData: LayerData) => void;
  ensureGeometryCache: (layerData: LayerData, graphic: any) => void;
  sanitizePlainText: (value: string, fallback: string) => string;
  defaultPointStyle: PointStyle;
  defaultLineStyle: LineStyle;
  defaultPolygonStyle: PolygonStyle;
  geoJSONToArcGISGeometry: (geometry: any, spatialReference: any) => any;
  scheduleProjectSave: () => void;
};

const explodeGeoJsonGeometry = (geometry: any) => {
  if (!geometry || typeof geometry.type !== "string") return [];
  if (geometry.type === "MultiPoint") {
    return (geometry.coordinates ?? []).map((coords: any) => ({
      type: "Point",
      coordinates: coords
    }));
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates ?? []).map((coords: any) => ({
      type: "LineString",
      coordinates: coords
    }));
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates ?? []).map((coords: any) => ({
      type: "Polygon",
      coordinates: coords
    }));
  }
  return [geometry];
};

const buildProjectSnapshot = (config: SnapshotBuildConfig): ProjectSnapshot | null => {
  if (!config.view) return null;
  const spatialReference = config.view?.spatialReference
    ? {
        wkid: config.view.spatialReference.isWebMercator
          ? 4326
          : config.view.spatialReference.wkid
      }
    : undefined;

  const layers: ProjectLayerSnapshot[] = config.graphicsLayers.map((layerData, index) => ({
    id: `layer-${index}`,
    name: layerData.name,
    type: layerData.type,
    animations: layerData.animations.map((anim) => ({ ...anim })),
    pointKeyframes: layerData.pointKeyframes?.map((frame) => ({ ...frame })),
    pointStyle: layerData.pointStyle ? { ...layerData.pointStyle } : undefined,
    lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
    polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
    textContent: layerData.textContent,
    textSize: layerData.textSize,
    textColor: layerData.textColor,
    textFontFamily: layerData.textFontFamily,
    textItalic: layerData.textItalic,
    textUnderline: layerData.textUnderline,
    featureLayerUrl: layerData.featureLayerUrl,
    featureFields: layerData.featureFields?.map((field) => ({ ...field })),
    featureField: layerData.featureField,
    featureFieldType: layerData.featureFieldType,
    featureFieldStats: layerData.featureFieldStats ? { ...layerData.featureFieldStats } : undefined,
    featureVisualVariable: layerData.featureVisualVariable,
    featureHideNulls: layerData.featureHideNulls,
    featureKeepVisible: layerData.featureKeepVisible,
    layerBlendMode: layerData.layerBlendMode,
    layerEffectSettings: layerData.layerEffectSettings
      ? { ...layerData.layerEffectSettings }
      : undefined,
    layerEffectsEnabled: layerData.layerEffectsEnabled
  }));

  const features: ProjectSnapshot["features"] = [];
  config.graphicsLayers.forEach((layerData, index) => {
    if (layerData.type === "feature") return;
    const layerId = `layer-${index}`;
    layerData.layer.graphics.forEach((graphic: any) => {
      config.ensureGeometryCache(layerData, graphic);
      const sourceGeometry =
        graphic.__originalGeometry && (layerData.type === "polyline" || layerData.type === "polygon")
          ? graphic.__originalGeometry
          : graphic.geometry;
      const geometry = config.arcgisGeometryToGeoJSON(sourceGeometry);
      if (!geometry) return;
      const geometries = explodeGeoJsonGeometry(geometry);
      const properties = { ...(graphic.attributes ?? {}) };
      properties._pulse = { layerId };
      geometries.forEach((geom: any) => {
        features.push({
          type: "Feature",
          geometry: geom,
          properties
        });
      });
    });
  });

  const basemapSelect = config.getEl("basemap-select") as any;
  const basemapBackgroundInput = document.getElementById("basemap-bg-color") as HTMLInputElement | null;
  const basemapBackgroundTransparentInput = document.getElementById(
    "basemap-bg-transparent"
  ) as HTMLInputElement | null;
  const basemapLabelsToggle = document.getElementById("basemap-labels-toggle") as HTMLInputElement | null;
  const customWidthInput = document.getElementById("custom-width") as any;
  const customHeightInput = document.getElementById("custom-height") as any;
  const customWidth = Number(customWidthInput?.value);
  const customHeight = Number(customHeightInput?.value);
  const backgroundColor = basemapBackgroundInput?.value || "#ffffff";
  const backgroundTransparent = Boolean(basemapBackgroundTransparentInput?.checked);
  const basemapLabelsVisible = basemapLabelsToggle ? Boolean(basemapLabelsToggle.checked) : true;

  return {
    type: "FeatureCollection",
    features,
    properties: {
      _pulse: {
        version: PROJECT_VERSION,
        savedAt: new Date().toISOString(),
        projectName: config.projectName,
        spatialReference,
        app: {
          layout: config.currentLayout,
          customWidth: Number.isFinite(customWidth) ? customWidth : null,
          customHeight: Number.isFinite(customHeight) ? customHeight : null,
          isRotated: config.isRotated,
          basemap: String(basemapSelect?.value || "gray-vector"),
          basemapVisible: basemapSelect?.value !== "none",
          basemapLabelsVisible,
          backgroundColor,
          backgroundTransparent,
          extent: config.view.extent
            ? {
                xmin: config.view.extent.xmin,
                ymin: config.view.extent.ymin,
                xmax: config.view.extent.xmax,
                ymax: config.view.extent.ymax,
                wkid: config.view.extent.spatialReference?.wkid
              }
            : undefined
        },
        timeline: {
          durationOverride: config.timelineDurationOverride
        },
        layers
      }
    }
  };
};

const applyProjectSnapshot = async (config: SnapshotApplyConfig, snapshot: ProjectSnapshot) => {
  if (!config.view) return;
  const meta = snapshot?.properties?._pulse;
  if (!meta) return;
  const layersToAwait: any[] = [];
  let targetExtent: Extent | null = null;

  config.setIsRestoringProject(true);
  config.setProjectError(null);
  try {
    config.stopAnimation();
    config.getGraphicsLayers().forEach((layerData) => {
      config.view.map.remove(layerData.layer);
    });
    config.setGraphicsLayers([]);
    config.setSelectedLayerIndex(-1);
    config.resetHistoryState();

    config.setProjectName(meta.projectName || "Untitled", true);
    config.setTimelineDurationOverride(meta.timeline?.durationOverride ?? null);

    const prefersDefaultLayout = document.body.classList.contains("is-mobile");
    const layout = prefersDefaultLayout ? "default" : meta.app?.layout ?? "default";
    const customWidth = meta.app?.customWidth;
    const customHeight = meta.app?.customHeight;
    if (layout === "custom") {
      const customWidthEl = document.getElementById("custom-width");
      const customHeightEl = document.getElementById("custom-height");
      if (customWidthEl && Number.isFinite(customWidth)) {
        config.setCalciteValue(customWidthEl, customWidth ?? 0);
      }
      if (customHeightEl && Number.isFinite(customHeight)) {
        config.setCalciteValue(customHeightEl, customHeight ?? 0);
      }
    }
    const layoutTab = document.querySelector(
      `calcite-tab-title[data-layout="${layout}"]`
    ) as HTMLElement | null;
    if (layoutTab) {
      document.querySelectorAll("calcite-tab-title").forEach((tab) => {
        tab.toggleAttribute("selected", tab === layoutTab);
      });
      config.handleLayoutChange({ target: layoutTab } as unknown as Event);
      config.setCurrentLayout(layout);
    }

    config.setIsRotated(Boolean(meta.app?.isRotated));
    if (config.getCurrentAspectRatio()) {
      config.scheduleAspectRatioUpdate();
    }

    const basemapSelect = config.getEl("basemap-select") as any;
    const storedBasemap = config.normalizeBasemap(meta.app?.basemap || "gray-vector");
    basemapSelect.value = meta.app?.basemapVisible === false ? "none" : storedBasemap;
    const basemapBackgroundInput = document.getElementById("basemap-bg-color") as HTMLInputElement | null;
    if (basemapBackgroundInput && meta.app?.backgroundColor) {
      basemapBackgroundInput.value = String(meta.app.backgroundColor);
    }
    const basemapLabelsToggle = document.getElementById("basemap-labels-toggle") as HTMLInputElement | null;
    if (basemapLabelsToggle) {
      basemapLabelsToggle.checked = meta.app?.basemapLabelsVisible !== false;
    }
    const basemapBackgroundTransparentInput = document.getElementById(
      "basemap-bg-transparent"
    ) as HTMLInputElement | null;
    if (basemapBackgroundTransparentInput && meta.app?.backgroundTransparent !== undefined) {
      basemapBackgroundTransparentInput.checked = Boolean(meta.app.backgroundTransparent);
    }
    config.handleBasemapChange();
    if (meta.app?.extent) {
      const extent = meta.app.extent;
      targetExtent = new Extent({
        xmin: extent.xmin,
        ymin: extent.ymin,
        xmax: extent.xmax,
        ymax: extent.ymax,
        spatialReference: extent.wkid ? { wkid: extent.wkid } : config.view.spatialReference
      });
    }

    const spatialReference = meta.spatialReference?.wkid
      ? { wkid: meta.spatialReference.wkid }
      : config.view.spatialReference;

    const featuresByLayer = new Map<string, ProjectSnapshot["features"]>();
    (snapshot.features || []).forEach((feature) => {
      const layerId = feature?.properties?._pulse?.layerId;
      if (!layerId) return;
      if (!featuresByLayer.has(layerId)) {
        featuresByLayer.set(layerId, []);
      }
      featuresByLayer.get(layerId)!.push(feature);
    });

    for (const layerSnapshot of meta.layers || []) {
      if (layerSnapshot.type === "feature") {
        if (!layerSnapshot.featureLayerUrl) continue;
        let featureLayer: FeatureLayer;
        try {
          featureLayer = new FeatureLayer({ url: layerSnapshot.featureLayerUrl });
          await featureLayer.load();
        } catch (error) {
          console.warn("Unable to load FeatureLayer from project.", error);
          continue;
        }

        config.view.map.add(featureLayer);
        layersToAwait.push(featureLayer);
        const layerData: LayerData = {
          layer: featureLayer,
          name: config.sanitizePlainText(layerSnapshot.name, "Feature Layer"),
          type: "feature",
          animations: layerSnapshot.animations?.length
            ? layerSnapshot.animations.map((anim) => ({ ...anim }))
            : [config.createPlaceholderAnimation()],
          featureLayerUrl: layerSnapshot.featureLayerUrl,
          featureFields: layerSnapshot.featureFields?.map((field) => ({ ...field })),
          featureField: layerSnapshot.featureField,
          featureFieldType: layerSnapshot.featureFieldType,
          featureFieldStats: layerSnapshot.featureFieldStats
            ? { ...layerSnapshot.featureFieldStats }
            : undefined,
          featureVisualVariable: layerSnapshot.featureVisualVariable,
          featureHideNulls: layerSnapshot.featureHideNulls,
          featureKeepVisible: layerSnapshot.featureKeepVisible,
          pointStyle: layerSnapshot.pointStyle ? { ...layerSnapshot.pointStyle } : undefined,
          lineStyle: layerSnapshot.lineStyle ? { ...layerSnapshot.lineStyle } : undefined,
          polygonStyle: layerSnapshot.polygonStyle ? { ...layerSnapshot.polygonStyle } : undefined,
          layerBlendMode: layerSnapshot.layerBlendMode,
          layerEffectSettings: layerSnapshot.layerEffectSettings
            ? { ...layerSnapshot.layerEffectSettings }
            : undefined,
          layerEffectsEnabled: layerSnapshot.layerEffectsEnabled
        };

        if (!layerData.featureFields || !layerData.featureFields.length) {
          layerData.featureFields = config.getFeatureLayerFields(featureLayer);
        }
        if (layerData.featureFields?.length) {
          const match = layerData.featureFields.find(
            (field) => field.name === layerData.featureField
          );
          if (!match) {
            layerData.featureField = layerData.featureFields[0].name;
            layerData.featureFieldType = layerData.featureFields[0].type;
          } else {
            layerData.featureFieldType = match.type;
          }
        }

        if (featureLayer.geometryType === "polyline" && !layerData.lineStyle) {
          layerData.lineStyle = { ...config.defaultLineStyle };
        } else if (featureLayer.geometryType === "polygon" && !layerData.polygonStyle) {
          layerData.polygonStyle = { ...config.defaultPolygonStyle };
        } else if (!layerData.pointStyle) {
          layerData.pointStyle = { ...config.defaultPointStyle };
        }
        if (layerData.layerEffectsEnabled === undefined) {
          layerData.layerEffectsEnabled = true;
        }

        config.addGraphicsLayer(layerData);
        if (!layerData.featureFieldStats) {
          await config.updateFeatureFieldStats(layerData);
        }
        config.applyFeatureLayerDefinition(layerData);
        config.applyFeatureLayerAnimation(layerData, config.getCurrentTime());
        config.applyLayerEffects(layerData);
        continue;
      }

      const newLayer = new GraphicsLayer({
        title: config.sanitizePlainText(layerSnapshot.name, "Layer")
      });
      config.view.map.add(newLayer);
      layersToAwait.push(newLayer);

      const layerData: LayerData = {
        layer: newLayer,
        name: config.sanitizePlainText(layerSnapshot.name, "Layer"),
        type: layerSnapshot.type,
        color: "#0a4c66",
        animations: layerSnapshot.animations?.length
          ? layerSnapshot.animations.map((anim) => ({ ...anim }))
          : [config.createPlaceholderAnimation()],
        pointKeyframes: layerSnapshot.pointKeyframes?.map((frame) => ({ ...frame })),
        pointStyle: layerSnapshot.pointStyle ? { ...layerSnapshot.pointStyle } : undefined,
        lineStyle: layerSnapshot.lineStyle ? { ...layerSnapshot.lineStyle } : undefined,
        polygonStyle: layerSnapshot.polygonStyle ? { ...layerSnapshot.polygonStyle } : undefined,
        textContent: layerSnapshot.textContent,
        textSize: layerSnapshot.textSize,
        textColor: layerSnapshot.textColor,
        textFontFamily: layerSnapshot.textFontFamily,
        textItalic: layerSnapshot.textItalic,
        textUnderline: layerSnapshot.textUnderline,
        layerBlendMode: layerSnapshot.layerBlendMode,
        layerEffectSettings: layerSnapshot.layerEffectSettings
          ? { ...layerSnapshot.layerEffectSettings }
          : undefined,
        layerEffectsEnabled: layerSnapshot.layerEffectsEnabled
      };

      if (layerData.type === "point" && !layerData.pointStyle) {
        layerData.pointStyle = { ...config.defaultPointStyle };
      } else if (layerData.type === "polyline" && !layerData.lineStyle) {
        layerData.lineStyle = { ...config.defaultLineStyle };
      } else if (layerData.type === "polygon" && !layerData.polygonStyle) {
        layerData.polygonStyle = { ...config.defaultPolygonStyle };
      }
      if (layerData.layerEffectsEnabled === undefined) {
        layerData.layerEffectsEnabled = true;
      }

      const layerFeatures = featuresByLayer.get(layerSnapshot.id) || [];
      layerFeatures.forEach((feature) => {
        const geometry = config.geoJSONToArcGISGeometry(feature.geometry, spatialReference);
        if (!geometry) return;
        const { _pulse, ...attributes } = feature.properties || {};
        const graphic = new Graphic({ geometry, attributes });
        if (layerData.type === "text") {
          graphic.symbol = {
            type: "text",
            text: layerData.textContent || "Text",
            color: layerData.textColor || "#22323a",
            font: {
              size: layerData.textSize || 14,
              family: layerData.textFontFamily || "sans-serif",
              style: layerData.textItalic ? "italic" : "normal",
              decoration: layerData.textUnderline ? "underline" : "none"
            }
          };
        }
        config.ensureGeometryCache(layerData, graphic);
        newLayer.add(graphic);
      });

      if (layerData.type !== "text") {
        config.applyLayerStyle(layerData);
      }
      config.applyLayerEffects(layerData);
      config.addGraphicsLayer(layerData);
    }

    config.updateLayersList();
    config.updateTimeline();
    config.updateAnimationOptions();
    if (targetExtent) {
      await config.view.when?.();
      if (typeof config.view.whenLayerView === "function" && layersToAwait.length) {
        await Promise.all(
          layersToAwait.map((layer) => config.view.whenLayerView(layer).catch(() => undefined))
        );
      }
      await config.view.goTo(targetExtent, { animate: false }).catch(() => undefined);
    }
    config.goToStart();
    if (!config.isApplyingHistory() && config.hasPlayableAnimation()) {
      config.startAnimation();
    }
  } catch (error) {
    console.warn("Unable to apply project snapshot.", error);
    config.setProjectError("Unable to load the project snapshot.");
  } finally {
    config.setIsRestoringProject(false);
    config.scheduleProjectSave();
  }
};

export { applyProjectSnapshot, buildProjectSnapshot };
