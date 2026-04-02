import Extent from "@arcgis/core/geometry/Extent";
import Graphic from "@arcgis/core/Graphic";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { LayerAnimation, LayerData, LineStyle, PointKeyframe, PointStyle, PolygonStyle } from "../types";

import type { ProjectLayerSnapshot, ProjectSnapshot } from "./constants";
import { PROJECT_VERSION, defaultVolumeStyle } from "./constants";
import {
  getParticleStyle,
  isParticleLayer,
  isParticleLayerType,
  normalizeParticleLayerType,
  setParticleStyle
} from "./particles";

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

const extractCoordinatePair = (coords: any): [number, number] | null => {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === "number") {
    const x = Number(coords[0]);
    const y = Number(coords[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  }
  for (const value of coords) {
    const nested = extractCoordinatePair(value);
    if (nested) return nested;
  }
  return null;
};

const hasLikelyGeographicCoordinates = (features: ProjectSnapshot["features"] | undefined) => {
  if (!Array.isArray(features) || !features.length) return false;
  const sampleSize = Math.min(features.length, 50);
  for (let index = 0; index < sampleSize; index += 1) {
    const geometry = features[index]?.geometry;
    const pair = extractCoordinatePair(geometry?.coordinates);
    if (!pair) continue;
    const [x, y] = pair;
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      return true;
    }
  }
  return false;
};

const buildProjectSnapshot = (config: SnapshotBuildConfig): ProjectSnapshot | null => {
  if (!config.view) return null;
  const isSceneView = String((config.view as any)?.type || "") === "3d";
  const spatialReference = config.view?.spatialReference
    ? {
        wkid: config.view.spatialReference.isWebMercator
          ? 4326
          : config.view.spatialReference.wkid
      }
    : undefined;

  const viewTrackLayer = config.graphicsLayers.find((layerData) => layerData.isViewTrack);
  const savableLayers = config.graphicsLayers.filter((layerData) => !layerData.isViewTrack);
  const layerIds = new Map<LayerData, string>();
  const viewTrackKeyframes =
    viewTrackLayer?.pointKeyframes?.map((frame) => {
      const easing: PointKeyframe["easing"] =
        frame.easing === "ease-in"
          ? "ease-in"
          : frame.easing === "ease-out"
            ? "ease-out"
            : frame.easing === "ease-in-out"
              ? "ease-in-out"
              : frame.easing === "linear"
                ? "linear"
                : undefined;
      return {
        time: Number(frame.time),
        x: Number(frame.x),
        y: Number(frame.y),
        z: Number.isFinite(Number(frame.z)) ? Number(frame.z) : undefined,
        heading: Number.isFinite(Number(frame.heading)) ? Number(frame.heading) : undefined,
        tilt: Number.isFinite(Number(frame.tilt)) ? Number(frame.tilt) : undefined,
        fov: Number.isFinite(Number(frame.fov)) ? Number(frame.fov) : undefined,
        rotation: Number.isFinite(Number(frame.rotation)) ? Number(frame.rotation) : undefined,
        scale: Number.isFinite(Number(frame.scale)) ? Number(frame.scale) : undefined,
        easing,
        spatialReference: frame.spatialReference
          ? {
              wkid: Number(frame.spatialReference?.wkid) || undefined,
              latestWkid: Number(frame.spatialReference?.latestWkid) || undefined
            }
          : undefined
      };
    }) ?? [];

  const layers: ProjectLayerSnapshot[] = savableLayers.map((layerData, index) => {
    const runtimeId = String(layerData.layer?.id || "").trim();
    const layerId = runtimeId || `layer-${index}`;
    layerIds.set(layerData, layerId);
    const particleStyle = isParticleLayer(layerData) ? getParticleStyle(layerData) : undefined;
    return {
      id: layerId,
      name: layerData.name,
      type: normalizeParticleLayerType(layerData.type),
      animations: layerData.animations.map((anim) => ({ ...anim })),
      pointKeyframes: layerData.pointKeyframes?.map((frame) => ({ ...frame })),
      pointStyle: layerData.pointStyle ? { ...layerData.pointStyle } : undefined,
      pointFollowTerrain3D: layerData.pointFollowTerrain3D,
      lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
      lineFollowTerrain3D: layerData.lineFollowTerrain3D,
      polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
      polygonZOffset: layerData.polygonZOffset,
      particleStyle: particleStyle ? { ...particleStyle } : undefined,
      volumeStyle: particleStyle ? { ...particleStyle } : undefined,
      textContent: layerData.textContent,
      textSize: layerData.textSize,
      textColor: layerData.textColor,
      textFontFamily: layerData.textFontFamily,
      textItalic: layerData.textItalic,
      textUnderline: layerData.textUnderline,
      textRenderMode: layerData.textRenderMode,
      textCalloutLine: layerData.textCalloutLine,
      textDepth: layerData.textDepth,
      textFixedToWorld: layerData.textFixedToWorld,
      textWorldHeight: layerData.textWorldHeight,
      textWorldRotation: layerData.textWorldRotation,
      featureLayerUrl: layerData.featureLayerUrl,
      featureFields: layerData.featureFields?.map((field) => ({ ...field })),
      featureField: layerData.featureField,
      featureFieldType: layerData.featureFieldType,
      featureFieldStats: layerData.featureFieldStats ? { ...layerData.featureFieldStats } : undefined,
      featureVisualVariable: layerData.featureVisualVariable,
      featureHideNulls: layerData.featureHideNulls,
      featureKeepVisible: layerData.featureKeepVisible,
      customAttribution: layerData.customAttribution,
      layerBlendMode: layerData.layerBlendMode,
      layerEffectSettings: layerData.layerEffectSettings
        ? { ...layerData.layerEffectSettings }
        : undefined,
      layerEffectsEnabled: layerData.layerEffectsEnabled
    };
  });

  const features: ProjectSnapshot["features"] = [];
  savableLayers.forEach((layerData, index) => {
      if (layerData.type === "feature") return;
    const layerId = layerIds.get(layerData) || `layer-${index}`;
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
  const google3DTilesToggle = document.getElementById(
    "basemap-google-3d-tiles-toggle"
  ) as HTMLInputElement | null;
  const customWidthInput = document.getElementById("custom-width") as any;
  const customHeightInput = document.getElementById("custom-height") as any;
  const customWidth = Number(customWidthInput?.value);
  const customHeight = Number(customHeightInput?.value);
  const backgroundColor = basemapBackgroundInput?.value || "#ffffff";
  const backgroundTransparent = Boolean(basemapBackgroundTransparentInput?.checked);
  const basemapLabelsVisible = basemapLabelsToggle ? Boolean(basemapLabelsToggle.checked) : true;
  const google3DTilesEnabled = google3DTilesToggle ? Boolean(google3DTilesToggle.checked) : false;
  const camera = (config.view as any)?.camera;
  const cameraPosition = camera?.position;
  const cameraSnapshot =
    isSceneView &&
    Number.isFinite(Number(cameraPosition?.x)) &&
    Number.isFinite(Number(cameraPosition?.y)) &&
    Number.isFinite(Number(cameraPosition?.z))
      ? {
          position: {
            x: Number(cameraPosition.x),
            y: Number(cameraPosition.y),
            z: Number(cameraPosition.z),
            spatialReference: cameraPosition?.spatialReference
              ? {
                  wkid: Number(cameraPosition.spatialReference?.wkid) || undefined,
                  latestWkid: Number(cameraPosition.spatialReference?.latestWkid) || undefined
                }
              : undefined
          },
          heading: Number(camera?.heading ?? 0),
          tilt: Number(camera?.tilt ?? 0)
        }
      : undefined;

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
          google3DTilesEnabled,
          viewTrackKeyframes,
          backgroundColor,
          backgroundTransparent,
          mode: isSceneView ? "3d" : "2d",
          camera: cameraSnapshot,
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
  let targetCamera: any = null;

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
    const google3DTilesToggle = document.getElementById(
      "basemap-google-3d-tiles-toggle"
    ) as HTMLInputElement | null;
    if (google3DTilesToggle) {
      google3DTilesToggle.checked = meta.app?.google3DTilesEnabled === true;
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
    if (meta.app?.camera?.position) {
      const pos = meta.app.camera.position;
      if (
        Number.isFinite(Number(pos.x)) &&
        Number.isFinite(Number(pos.y)) &&
        Number.isFinite(Number(pos.z))
      ) {
        targetCamera = {
          position: {
            x: Number(pos.x),
            y: Number(pos.y),
            z: Number(pos.z),
            spatialReference: pos.spatialReference?.wkid
              ? { wkid: Number(pos.spatialReference.wkid) }
              : config.view.spatialReference
          },
          heading: Number(meta.app.camera.heading ?? 0),
          tilt: Number(meta.app.camera.tilt ?? 0)
        };
      }
    }

    const storedWkid = Number(meta.spatialReference?.wkid);
    const likelyGeographic = hasLikelyGeographicCoordinates(snapshot.features);
    const shouldForceWgs84 =
      likelyGeographic &&
      Number.isFinite(storedWkid) &&
      storedWkid !== 4326 &&
      storedWkid !== 4269;

    const spatialReference = shouldForceWgs84
      ? { wkid: 4326 }
      : Number.isFinite(storedWkid)
        ? { wkid: storedWkid }
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
          featureLayer = new FeatureLayer({ url: layerSnapshot.featureLayerUrl, id: layerSnapshot.id });
          await featureLayer.load();
        } catch (error) {
          console.warn("Unable to load FeatureLayer from project.", error);
          continue;
        }

        config.view.map.add(featureLayer);
        layersToAwait.push(featureLayer);
      const particleStyle = isParticleLayerType(layerSnapshot.type)
        ? getParticleStyle(layerSnapshot as any)
        : undefined;
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
          customAttribution: layerSnapshot.customAttribution,
          pointStyle: layerSnapshot.pointStyle ? { ...layerSnapshot.pointStyle } : undefined,
          pointFollowTerrain3D: layerSnapshot.pointFollowTerrain3D,
          lineStyle: layerSnapshot.lineStyle ? { ...layerSnapshot.lineStyle } : undefined,
          lineFollowTerrain3D: layerSnapshot.lineFollowTerrain3D,
          polygonStyle: layerSnapshot.polygonStyle ? { ...layerSnapshot.polygonStyle } : undefined,
          polygonZOffset: Number.isFinite(Number(layerSnapshot.polygonZOffset))
            ? Number(layerSnapshot.polygonZOffset)
            : undefined,
          particleStyle: particleStyle ? { ...particleStyle } : undefined,
          volumeStyle: particleStyle ? { ...particleStyle } : undefined,
          layerBlendMode: layerSnapshot.layerBlendMode,
          layerEffectSettings: layerSnapshot.layerEffectSettings
            ? { ...layerSnapshot.layerEffectSettings }
            : undefined,
          layerEffectsEnabled: layerSnapshot.layerEffectsEnabled
        };
        if (layerData.customAttribution) {
          layerData.layer.attribution = layerData.customAttribution;
        }

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
        if (featureLayer.geometryType === "polygon" && !Number.isFinite(Number(layerData.polygonZOffset))) {
          layerData.polygonZOffset = 0;
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
        id: layerSnapshot.id,
        title: config.sanitizePlainText(layerSnapshot.name, "Layer")
      });
      config.view.map.add(newLayer);
      layersToAwait.push(newLayer);

      const particleStyle = isParticleLayerType(layerSnapshot.type)
        ? getParticleStyle(layerSnapshot as any)
        : undefined;
      const layerData: LayerData = {
        layer: newLayer,
        name: config.sanitizePlainText(layerSnapshot.name, "Layer"),
        type: normalizeParticleLayerType(layerSnapshot.type),
        color: "#0a4c66",
        animations: layerSnapshot.animations?.length
          ? layerSnapshot.animations.map((anim) => ({ ...anim }))
          : [config.createPlaceholderAnimation()],
        pointKeyframes: layerSnapshot.pointKeyframes?.map((frame) => ({ ...frame })),
        pointStyle: layerSnapshot.pointStyle ? { ...layerSnapshot.pointStyle } : undefined,
        pointFollowTerrain3D: layerSnapshot.pointFollowTerrain3D,
        lineStyle: layerSnapshot.lineStyle ? { ...layerSnapshot.lineStyle } : undefined,
        lineFollowTerrain3D: layerSnapshot.lineFollowTerrain3D,
        polygonStyle: layerSnapshot.polygonStyle ? { ...layerSnapshot.polygonStyle } : undefined,
        polygonZOffset: Number.isFinite(Number(layerSnapshot.polygonZOffset))
          ? Number(layerSnapshot.polygonZOffset)
          : undefined,
        particleStyle: particleStyle ? { ...particleStyle } : undefined,
        volumeStyle: particleStyle ? { ...particleStyle } : undefined,
        textContent: layerSnapshot.textContent,
        textSize: layerSnapshot.textSize,
        textColor: layerSnapshot.textColor,
        textFontFamily: layerSnapshot.textFontFamily,
        textItalic: layerSnapshot.textItalic,
        textUnderline: layerSnapshot.textUnderline,
        textRenderMode: layerSnapshot.textRenderMode,
        textCalloutLine: layerSnapshot.textCalloutLine,
        textDepth: layerSnapshot.textDepth,
        textFixedToWorld: layerSnapshot.textFixedToWorld,
        textWorldHeight: layerSnapshot.textWorldHeight,
        textWorldRotation: layerSnapshot.textWorldRotation,
        customAttribution: layerSnapshot.customAttribution,
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
      } else if (isParticleLayer(layerData) && !layerData.particleStyle && !layerData.volumeStyle) {
        setParticleStyle(layerData, defaultVolumeStyle);
      }
      if (layerData.type === "polygon" && !Number.isFinite(Number(layerData.polygonZOffset))) {
        layerData.polygonZOffset = 0;
      }
      if (layerData.layerEffectsEnabled === undefined) {
        layerData.layerEffectsEnabled = true;
      }
      if (layerData.customAttribution) {
        layerData.layer.attribution = layerData.customAttribution;
      }

      const layerFeatures = featuresByLayer.get(layerSnapshot.id) || [];
      layerFeatures.forEach((feature) => {
        const geometry = config.geoJSONToArcGISGeometry(feature.geometry, spatialReference);
        if (!geometry) return;
        const { _pulse, ...attributes } = feature.properties || {};
        const graphic = new Graphic({ geometry, attributes });
        config.ensureGeometryCache(layerData, graphic);
        newLayer.add(graphic);
      });

      config.applyLayerStyle(layerData);
      config.applyLayerEffects(layerData);
      config.addGraphicsLayer(layerData);
    }

    config.updateLayersList();
    config.updateTimeline();
    config.updateAnimationOptions();
    if (targetCamera && String((config.view as any)?.type || "") === "3d") {
      await config.view.when?.();
      if (typeof config.view.whenLayerView === "function" && layersToAwait.length) {
        await Promise.all(
          layersToAwait.map((layer) => config.view.whenLayerView(layer).catch(() => undefined))
        );
      }
      await config.view.goTo(targetCamera, { animate: false }).catch(() => undefined);
    } else if (targetExtent) {
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
