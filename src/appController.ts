import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Sketch from "@arcgis/core/widgets/Sketch";

import { animationTypes } from "./animationTypes";
import { applyAnimationsAtTime as applyAnimationsAtTimeFromState } from "./app/animationPlayback";
import {
  createPlaceholderAnimation,
  hasPointKeyframes,
  hasRealAnimations,
  isPlaceholderAnimation
} from "./app/animationUtils";
import {
  handleCustomDimensions as handleCustomDimensionsFromState,
  resetMapWrapperSize as resetMapWrapperSizeFromState,
  rotateMap as rotateMapFromState,
  scheduleAspectRatioUpdate as scheduleAspectRatioUpdateFromState
} from "./app/aspectRatio";
import type { AspectRatioConfig, AspectRatioState } from "./app/aspectRatio";
import { bindConfirmDialogListeners, openConfirmDialog } from "./app/confirmDialog";
import {
  DEFAULT_CIRCLE_SIZE,
  DEFAULT_PIN_Y_OFFSET,
  DEFAULT_PIN_SIZE,
  ENABLE_PROJECT_STORAGE,
  EXPORT_WARNING_ANIMATIONS,
  EXPORT_WARNING_DURATION,
  defaultLineStyle,
  defaultPointStyle,
  defaultPolygonStyle,
  getAutoPinYOffset,
  normalizeBasemap,
  sanitizePlainText
} from "./app/constants";
import type { ProjectSnapshot } from "./app/constants";
import {
  startExportRecording as startExportRecordingFromState,
  updateExportButtonLabel
} from "./app/export";
import type { ExportConfig, ExportState } from "./app/export";
import { handleAddFeatureLayer as handleAddFeatureLayerFromState } from "./app/featureLayerAdd";
import type { FeatureLayerConfig, FeatureLayerState } from "./app/featureLayerAdd";
import { queueHistorySnapshot, redoHistory, resetHistory, undoHistory } from "./app/history";
import type { HistoryConfig, HistoryState } from "./app/history";
import { importCsv as importCsvFromState, importGeoJson as importGeoJsonFromState } from "./app/importers";
import type { ImportConfig } from "./app/importers";
import { setupResponsiveLayout } from "./app/layout";
import { createLoadingOverlayController } from "./app/loading";
import { createPlaybackController } from "./app/playback";
import {
  applyProjectSnapshot as applyProjectSnapshotFromState,
  buildProjectSnapshot as buildProjectSnapshotFromState
} from "./app/snapshot";
import {
  canUseLocalStorage,
  clearProjectStorage,
  ensureStorageConsent,
  initializeStorageConsentState,
  loadProjectFromStorage,
  loadRecentProjectsFromStorage,
  loadStoredProjectName,
  saveProjectToStorage,
  setProjectNameStorage
} from "./app/storage";
import type { StorageState } from "./app/storage";
import { createTimelineController } from "./app/timeline";
import type { TimelineState } from "./app/timeline";
import { zoomToLayer as zoomToLayerFromState, zoomToLayers as zoomToLayersFromState } from "./app/zoom";
import type { ZoomConfig } from "./app/zoom";
import { startRecording as startCanvasRecording, stopRecording as stopCanvasRecording } from "./canvasRecorder";
import { getEl } from "./dom";
import type {
  LayerData,
  LayerEffectSettings,
  LayerType,
  LineStyle,
  PointKeyframe,
  PointStyle
} from "./types";
import { buildAnimationSettingsSnapshot } from "./utils/animationSettings";
import { buildLayerEffectString, defaultLayerEffectSettings, isDefaultEffectSettings } from "./utils/effects";

let hasBooted = false;
let view: any = null;
let graphicsLayers: LayerData[] = [];
let selectedLayerIndex = -1;
let animationSettingsHighlightTimeout: number | null = null;
let isPlaying = false;
let animationFrameId: number | null = null;
let currentTime = 0;
let currentLayout: "default" | "mobile" | "tablet" | "custom" = "default";
let hasInitialized = false;
let projectName = "Untitled";
let isAddingFeatureLayer = false;

let isRestoringProject = false;
let projectSaveTimer: number | null = null;
let pendingTextPlacement: { layerIndex: number } | null = null;
let textPlacementHandle: { remove: () => void } | null = null;
let activeTextLayerIndex: number | null = null;
let sketch: Sketch | null = null;
let sketchHasUpdateHandler = false;
let currentAspectRatio: { width: number; height: number } | null = null;
let isRotated = false;
let isDrawing = false;
const exportState: ExportState = { isExporting: false };
let pendingImportType: "geojson" | "csv" | null = null;
let lastPointSizeInput = DEFAULT_PIN_SIZE;
const storageState: StorageState = {
  localStorageAllowed: false,
  hasCheckedStorageConsent: false
};
const historyState: HistoryState = {
  historyStack: [],
  redoStack: [],
  historyTimer: null,
  isApplyingHistory: false
};
const layoutState = {
  responsiveMediaQuery: null as MediaQueryList | null,
  hasAppliedMobileDefaultLayout: false
};
const timelineState: TimelineState = {
  timelineZoom: 50,
  timelineZoomAuto: true,
  timelineDurationOverride: null,
  selectedTimelineClip: null,
  selectedTimelineAnimation: null,
  isScrubbingTimeline: false,
  timelinePanelWidth: 300,
  timelinePanelResizeState: null,
  isSyncingTimelineScroll: false,
  timelineSnapEnabled: true,
  timelineGridVisible: true,
  dragState: null,
  keyframeDragState: null
};
let updatePlayheadRef: () => void = () => undefined;
let syncAnimationStartInputRef: () => void = () => undefined;
let applyAnimationsAtTimeRef: (time: number) => void = () => undefined;
let zoomToLayerRef: (layerData: LayerData) => void = () => undefined;
let scheduleProjectSaveRef: () => void = () => undefined;
let buildProjectSnapshotRef: () => ProjectSnapshot | null = () => {
  throw new Error("buildProjectSnapshot not initialized");
};
let zoomToLayersRef: (layers: LayerData[]) => void = () => undefined;
const loadingOverlay = createLoadingOverlayController();
const timelineController = createTimelineController(timelineState, {
  getEl,
  getGraphicsLayers: () => graphicsLayers,
  getSelectedLayerIndex: () => selectedLayerIndex,
  getCurrentTime: () => currentTime,
  setCurrentTime: (value) => {
    currentTime = value;
  },
  updatePlayhead: () => updatePlayheadRef(),
  syncAnimationStartInput: () => syncAnimationStartInputRef(),
  applyAnimationsAtTime: (time) => applyAnimationsAtTimeRef(time),
  resetAnimationGeometryCaches,
  updatePrimaryActionsState,
  updateLayersList,
  updateAnimationOptions,
  updateExportWarning,
  selectLayer,
  removeLayer,
  duplicateLayer,
  zoomToLayer: (layerData) => zoomToLayerRef(layerData),
  scheduleProjectSave: () => scheduleProjectSaveRef(),
  sanitizePlainText,
  setCalciteValue,
  upsertPointKeyframe,
  hasPointKeyframes,
  removeAnimationAt
});
const {
  updateTimeline,
  handleTimelineDurationChange,
  handleTimelineDurationAutoFit,
  toggleTimelineSnap,
  toggleTimelineGrid,
  duplicateSelectedTimelineAnimation,
  removeSelectedTimelineAnimation,
  initTimelineResizer,
  initTimelineScrollSync,
  startTimelinePanelResize,
  handleTimelineMouseDown,
  zoomInTimeline,
  zoomOutTimeline,
  scrollTimelineToLayer,
  getTimelineDuration
} = timelineController;
const playbackController = createPlaybackController(
  {
    getIsPlaying: () => isPlaying,
    setIsPlaying: (value) => {
      isPlaying = value;
    },
    getCurrentTime: () => currentTime,
    setCurrentTime: (value) => {
      currentTime = value;
    },
    getAnimationFrameId: () => animationFrameId,
    setAnimationFrameId: (value) => {
      animationFrameId = value;
    }
  },
  {
    getTimelineDuration: () => timelineController.getTimelineDuration(),
    getTimelineZoom: () => timelineController.getTimelineZoom(),
    getSketch: () => sketch,
    setSketchUpdateOnGraphicClick,
    getEl,
    applyAnimationsAtTime: (time) => applyAnimationsAtTimeRef(time),
    resetAnimationGeometryCaches,
    getGraphicsLayers: () => graphicsLayers,
    hasPointKeyframes,
    getPointKeyframeAtTime,
    defaultPointStyle,
    isExporting: () => exportState.isExporting,
    stopExportRecording: () => {
      if (!exportState.isExporting) return;
      exportState.isExporting = false;
      document.body.classList.remove("is-exporting");
      stopCanvasRecording();
    }
  }
);
const {
  updatePlayhead,
  syncAnimationStartInput,
  goToStart,
  goToEnd,
  handlePlayFromStart,
  togglePlayAnimation,
  startAnimation,
  stopAnimation
} = playbackController;
updatePlayheadRef = updatePlayhead;
syncAnimationStartInputRef = syncAnimationStartInput;
const exportConfig: ExportConfig = {
  getView: () => view,
  isPlaying: () => isPlaying,
  stopAnimation,
  startAnimation,
  goToStart,
  setExportUiError,
  startCanvasRecording,
  stopCanvasRecording
};
const startExportRecording = () => startExportRecordingFromState(exportState, exportConfig);
const importConfig: ImportConfig = {
  getView: () => view,
  createGraphicForType,
  createImportedLayer,
  zoomToLayers: (layers) => zoomToLayersRef(layers)
};
const animationPlaybackConfig = {
  getGraphicsLayers: () => graphicsLayers,
  defaultPointStyle,
  hasPointKeyframes,
  getPointKeyframeAtTime,
  applyFeatureLayerAnimation,
  isPlaying: () => isPlaying,
  isScrubbingTimeline: () => timelineController.isScrubbingTimeline()
};
const applyAnimationsAtTime = (time: number) => applyAnimationsAtTimeFromState(animationPlaybackConfig, time);
applyAnimationsAtTimeRef = applyAnimationsAtTime;
const featureLayerState: FeatureLayerState = {
  getView: () => view,
  getIsAdding: () => isAddingFeatureLayer,
  setIsAdding: (value) => {
    isAddingFeatureLayer = value;
  },
  addLayerData: (layerData) => {
    graphicsLayers.push(layerData);
    return graphicsLayers.length - 1;
  }
};
const featureLayerConfig: FeatureLayerConfig = {
  getEl,
  isValidFeatureLayerUrl,
  setFeatureLayerError,
  sanitizePlainText,
  createPlaceholderAnimation,
  getFeatureLayerFields,
  updateFeatureFieldStats,
  applyFeatureLayerDefinition,
  applyFeatureLayerAnimation,
  zoomToLayer: (layerData) => zoomToLayerRef(layerData),
  selectLayer,
  updateTimeline,
  scheduleProjectSave: () => scheduleProjectSaveRef(),
  defaultPointStyle,
  defaultLineStyle,
  defaultPolygonStyle
};
const handleAddFeatureLayer = () => handleAddFeatureLayerFromState(featureLayerState, featureLayerConfig);
const aspectRatioState: AspectRatioState = {
  getCurrentAspectRatio: () => currentAspectRatio,
  setCurrentAspectRatio: (value) => {
    currentAspectRatio = value;
  },
  getIsRotated: () => isRotated,
  setIsRotated: (value) => {
    isRotated = value;
  }
};
const aspectRatioConfig: AspectRatioConfig = {
  getEl,
  getView: () => view,
  scheduleProjectSave: () => scheduleProjectSaveRef()
};
const rotateMap = () => rotateMapFromState(aspectRatioState, aspectRatioConfig);
const resetMapWrapperSize = () => resetMapWrapperSizeFromState(aspectRatioConfig);
const scheduleAspectRatioUpdate = () =>
  scheduleAspectRatioUpdateFromState(aspectRatioState, aspectRatioConfig);
const handleCustomDimensions = () => handleCustomDimensionsFromState(aspectRatioState, aspectRatioConfig);
const zoomConfig: ZoomConfig = {
  getView: () => view
};
const zoomToLayer = (layerData: LayerData) => zoomToLayerFromState(zoomConfig, layerData);
zoomToLayerRef = zoomToLayer;
const zoomToLayers = (layers: LayerData[]) => zoomToLayersFromState(zoomConfig, layers);
zoomToLayersRef = zoomToLayers;

function setSketchUpdateOnGraphicClick(value: boolean) {
  if (!sketch) return;
  const sketchAny = sketch as any;
  if (sketchAny?.updateOnGraphicClick !== undefined) {
    sketchAny.updateOnGraphicClick = value;
  }
}

const buildProjectSnapshot = () => {
  return buildProjectSnapshotFromState({
    view,
    graphicsLayers,
    projectName,
    currentLayout,
    timelineDurationOverride: timelineController.getTimelineDurationOverride(),
    isRotated,
    getEl,
    ensureGeometryCache,
    arcgisGeometryToGeoJSON
  });
};
buildProjectSnapshotRef = buildProjectSnapshot;

async function applyProjectSnapshot(snapshot: unknown) {
  await applyProjectSnapshotFromState(
    {
      view,
      getGraphicsLayers: () => graphicsLayers,
      setGraphicsLayers: (next) => {
        graphicsLayers = next;
      },
      addGraphicsLayer: (layerData) => {
        graphicsLayers.push(layerData);
      },
      setSelectedLayerIndex: (index) => {
        selectedLayerIndex = index;
      },
      setTimelineDurationOverride: (value) => {
        timelineController.setTimelineDurationOverride(value);
      },
      setProjectName,
      setProjectError,
      setIsRestoringProject: (value) => {
        isRestoringProject = value;
      },
      setIsRotated: (value) => {
        isRotated = value;
      },
      resetHistoryState: () => {
        historyState.historyStack = [];
        historyState.redoStack = [];
      },
      stopAnimation,
      updateLayersList,
      updateTimeline,
      updateAnimationOptions,
      goToStart,
      startAnimation,
      hasPlayableAnimation,
      isApplyingHistory: () => historyState.isApplyingHistory,
      getCurrentTime: () => currentTime,
      getCurrentAspectRatio: () => currentAspectRatio,
      scheduleAspectRatioUpdate,
      setCurrentLayout: (layout) => {
        currentLayout = layout;
      },
      handleLayoutChange,
      getEl,
      setCalciteValue,
      normalizeBasemap,
      handleBasemapChange,
      createPlaceholderAnimation,
      getFeatureLayerFields,
      updateFeatureFieldStats,
      applyFeatureLayerDefinition,
      applyFeatureLayerAnimation,
      applyLayerEffects,
      applyLayerStyle,
      ensureGeometryCache,
      sanitizePlainText,
      defaultPointStyle,
      defaultLineStyle,
      defaultPolygonStyle,
      geoJSONToArcGISGeometry,
      scheduleProjectSave
    },
    snapshot as ProjectSnapshot
  );
}

const storageConfig = {
  setProjectStatus,
  setProjectError,
  updateRecentProjectsUI,
  applyProjectSnapshot,
  buildProjectSnapshot: () => buildProjectSnapshotRef()
};
const historyConfig: HistoryConfig = {
  buildProjectSnapshot: () => buildProjectSnapshotRef(),
  applyProjectSnapshot,
  updateHistoryControls,
  setProjectError,
  isRestoringProject: () => isRestoringProject
};


const scheduleProjectSave = () => {
  if (!ENABLE_PROJECT_STORAGE) return;
  if (isRestoringProject) return;
  setProjectStatus("dirty");
  queueHistorySnapshot(historyState, historyConfig);
  if (!storageState.localStorageAllowed) return;
  if (projectSaveTimer) {
    window.clearTimeout(projectSaveTimer);
  }
  projectSaveTimer = window.setTimeout(() => {
    projectSaveTimer = null;
    saveProjectToStorage(storageState, storageConfig, projectName, Boolean(view));
  }, 300);
};
scheduleProjectSaveRef = scheduleProjectSave;

function setProjectStatus(state: "saved" | "dirty") {
  const badge = document.getElementById("project-status");
  if (!badge) return;
  badge.textContent = state === "saved" ? "Saved" : "Unsaved";
  badge.classList.toggle("project-status-dirty", state === "dirty");
}

function setProjectError(message: string | null) {
  const errorEl = document.getElementById("project-error");
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.classList.remove("show");
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function setExportUiError(message: string | null) {
  const errorEl = document.getElementById("export-error");
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.classList.remove("show");
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function setFeatureLayerError(message: string | null) {
  const errorEl = document.getElementById("feature-layer-error");
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.classList.remove("show");
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function isValidFeatureLayerUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.pathname.toLowerCase().includes("featureserver");
  } catch {
    return false;
  }
}

function setProjectName(value: string, shouldSave = true) {
  projectName = sanitizePlainText(value, "Untitled");
  const input = document.getElementById("project-name-input") as any;
  if (input && String(input.value) !== projectName) {
    setCalciteValue(input as HTMLElement, projectName);
  }
  if (shouldSave && canUseLocalStorage(storageState)) {
    setProjectNameStorage(storageState, projectName);
  }
}

function updateHistoryControls() {
  const undoBtn = document.getElementById("timeline-undo-btn");
  const redoBtn = document.getElementById("timeline-redo-btn");
  if (undoBtn) {
    const canUndo = historyState.historyStack.length > 1;
    undoBtn.toggleAttribute("disabled", !canUndo);
  }
  if (redoBtn) {
    const canRedo = historyState.redoStack.length > 0;
    redoBtn.toggleAttribute("disabled", !canRedo);
  }
}

function updateRecentProjectsUI() {
  const select = document.getElementById("project-recent-select") as any;
  if (!select) return;
  const recents = loadRecentProjectsFromStorage(storageState);
  const loadButton = document.getElementById("project-recent-load-btn");
  if (loadButton) {
    loadButton.toggleAttribute("disabled", recents.length === 0);
  }
  const clearButton = document.getElementById("project-recent-clear-btn");
  if (clearButton) {
    clearButton.toggleAttribute("disabled", recents.length === 0);
  }
  select.innerHTML = "";
  if (!recents.length) {
    const option = document.createElement("calcite-option");
    option.value = "";
    option.textContent = "No recent projects";
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    return;
  }
  recents.forEach((entry) => {
    const option = document.createElement("calcite-option");
    option.value = entry.id;
    option.textContent = `${entry.name} (${new Date(entry.savedAt).toLocaleString()})`;
    if (!select.value) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function updateExportWarning() {
  const warningEl = document.getElementById("export-warning");
  if (!warningEl) return;
  const duration = getTimelineDuration();
  const animationCount = graphicsLayers.reduce((count, layer) => {
    return (
      count +
      layer.animations.filter((anim) => !isPlaceholderAnimation(anim)).length +
      (layer.pointKeyframes?.length || 0)
    );
  }, 0);
  if (duration >= EXPORT_WARNING_DURATION || animationCount >= EXPORT_WARNING_ANIMATIONS) {
    warningEl.textContent =
      "Large exports can be slow or memory heavy. Consider trimming the duration or simplifying animations.";
    warningEl.classList.add("show");
  } else {
    warningEl.textContent = "";
    warningEl.classList.remove("show");
  }
}

function setDeleteLayerButtonVisible(visible: boolean) {
  const button = document.getElementById("delete-layer-btn");
  if (!button) return;
  button.classList.toggle("show", visible);
}

async function resetProject() {
  if (!view) return;
  if (graphicsLayers.length > 0) {
    const shouldReset = await openConfirmDialog({
      heading: "New project",
      message: "Creating a new project will remove all graphics/animations.",
      confirmText: "Create new project",
      confirmKind: "brand"
    });
    if (!shouldReset) return;
  }
  stopAnimation();
  graphicsLayers.forEach((layerData) => {
    view.map.remove(layerData.layer);
  });
  graphicsLayers = [];
  selectedLayerIndex = -1;
  timelineController.clearSelectedTimelineAnimation();
  timelineController.setTimelineDurationOverride(null);
  setProjectName("Untitled");
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  setDeleteLayerButtonVisible(false);
  setProjectStatus("saved");
  resetHistory(historyState, historyConfig);
  if (!ENABLE_PROJECT_STORAGE) return;
  clearProjectStorage(storageState);
}
const pointPathStyles: Record<string, string> = {
  home: "M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z",
  "map-pin":
    "M12 2c-3.3 0-6 2.7-6 6 0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6zm0 8.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 5.5 12 5.5s2.5 1.1 2.5 2.5S13.4 10.5 12 10.5z",
  star: "M12 2l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17l-5.9 3.1 1.2-6.5L2.5 8.9 9.1 8z",
  flag: "M5 3h10l-1.5 4 1.5 4H5v8H3V3z"
};

function hasPlayableAnimation() {
  return graphicsLayers.some(
    (layerData) => hasRealAnimations(layerData) || hasPointKeyframes(layerData)
  );
}

function updatePrimaryActionsState() {
  const hasGraphics = graphicsLayers.some((layerData) => {
    const graphics = (layerData.layer as any)?.graphics;
    const count = graphics?.length ?? graphics?.items?.length ?? 0;
    return count > 0;
  });
  const newProjectButton = document.getElementById("new-project-btn");
  const mapActionButtons = document.getElementById("map-action-buttons");
  if (mapActionButtons) {
    mapActionButtons.style.display = hasGraphics ? "flex" : "none";
  }
  if (newProjectButton) {
    newProjectButton.style.display = hasGraphics ? "inline-flex" : "none";
  }

  const exportButton = document.getElementById("export-btn");
  if (exportButton) {
    if (hasPlayableAnimation()) {
      exportButton.removeAttribute("disabled");
      exportButton.removeAttribute("title");
    } else {
      exportButton.setAttribute("disabled", "");
      exportButton.setAttribute("title", "Add at least one animation to enable export.");
    }
  }

  const exportTooltip = document.getElementById("export-tooltip");
  if (exportTooltip) {
    exportTooltip.hidden = hasPlayableAnimation();
  }
}

function upsertPointKeyframe(layerData: LayerData, geometry: Point, time: number) {
  const next: PointKeyframe = {
    time,
    x: geometry.x,
    y: geometry.y,
    spatialReference: geometry.spatialReference
  };
  const keyframes = layerData.pointKeyframes ? [...layerData.pointKeyframes] : [];
  const existingIndex = keyframes.findIndex((frame) => Math.abs(frame.time - time) < 0.001);
  if (existingIndex >= 0) {
    keyframes[existingIndex] = next;
  } else {
    keyframes.push(next);
  }
  keyframes.sort((a, b) => a.time - b.time);
  layerData.pointKeyframes = keyframes;
  scheduleProjectSave();
}

function getPointKeyframeAtTime(layerData: LayerData, time: number) {
  const keyframes = layerData.pointKeyframes ?? [];
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0];
  if (time <= keyframes[0].time) return keyframes[0];
  if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    const start = keyframes[i];
    const end = keyframes[i + 1];
    if (time >= start.time && time <= end.time) {
      const span = end.time - start.time;
      if (span <= 0) return end;
      const t = (time - start.time) / span;
      return {
        time,
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        spatialReference: start.spatialReference || end.spatialReference
      };
    }
  }

  return keyframes[keyframes.length - 1];
}

function ensurePlaceholderAnimation(layerData: LayerData) {
  if (!hasRealAnimations(layerData)) {
    layerData.animations = [createPlaceholderAnimation()];
  }
}

export function bootApp() {
  if (hasBooted) return;
  hasBooted = true;
  loadingOverlay.showLoadingOverlay();
  updateExportButtonLabel();

  const mapEl = document.querySelector("#arcgisMap") as any;
  if (!mapEl) return;

  if (mapEl.view) {
    view = mapEl.view;
    initializeApp();
    loadingOverlay.finishLoadingOverlay();
  }

  mapEl.addEventListener("arcgisViewReadyChange", (event: any) => {
    view = event.target.view;
    initializeApp();
    loadingOverlay.finishLoadingOverlay();
  });
}

export function getAnimationSettingsSnapshot() {
  return buildAnimationSettingsSnapshot(graphicsLayers, timelineController.getTimelineDurationOverride());
}

function arcgisGeometryToGeoJSON(geometry: any) {
  if (!geometry) return null;
  if (geometry.type === "point") {
    return { type: "Point", coordinates: [geometry.x, geometry.y] };
  }
  if (geometry.type === "polyline") {
    const paths = geometry.paths ?? [];
    if (paths.length === 1) {
      return { type: "LineString", coordinates: paths[0] };
    }
    return { type: "MultiLineString", coordinates: paths };
  }
  if (geometry.type === "polygon") {
    const rings = geometry.rings ?? [];
    return { type: "Polygon", coordinates: rings };
  }
  return null;
}

function geoJSONToArcGISGeometry(geometry: any, spatialReference: any) {
  if (!geometry) return null;
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates ?? [];
    return new Point({ x, y, spatialReference });
  }
  if (geometry.type === "LineString") {
    return new Polyline({ paths: [geometry.coordinates ?? []], spatialReference });
  }
  if (geometry.type === "MultiLineString") {
    return new Polyline({ paths: geometry.coordinates ?? [], spatialReference });
  }
  if (geometry.type === "Polygon") {
    return new Polygon({ rings: geometry.coordinates ?? [], spatialReference });
  }
  if (geometry.type === "MultiPolygon") {
    const rings = (geometry.coordinates ?? []).flat();
    return new Polygon({ rings, spatialReference });
  }
  return null;
}

function initializeApp() {
  if (hasInitialized) return;
  hasInitialized = true;
  setupResponsiveLayout(layoutState, {
    handleLayoutChange,
    attachAnimationPanelTo,
    getSelectedLayerIndex: () => selectedLayerIndex
  });
  setupEventListeners();
  setProjectStatus("saved");
  if (ENABLE_PROJECT_STORAGE) {
    initializeStorageConsentState(storageState);
    if (canUseLocalStorage(storageState)) {
      const storedName = loadStoredProjectName(storageState);
      if (storedName) {
        setProjectName(storedName, false);
      }
    }
    updateRecentProjectsUI();
    loadProjectFromStorage(storageState, storageConfig);
  } else {
    setProjectName(projectName, false);
  }
  if (view) {
    reactiveUtils.watch(() => view.extent, () => scheduleProjectSave());
  }
  updateTimeline();
  updateAnimationOptions();
  updateExportWarning();
  resetHistory(historyState, historyConfig);
}

function setupEventListeners() {
  document.querySelectorAll("calcite-tab-title").forEach((tab) => {
    tab.addEventListener("calciteTabTitleSelect", handleLayoutChange as EventListener);
    tab.addEventListener("click", handleLayoutChange as EventListener);
  });

  getEl("custom-width").addEventListener("calciteInputNumberChange", handleCustomDimensions);
  getEl("custom-height").addEventListener("calciteInputNumberChange", handleCustomDimensions);

  getEl("add-point-btn").addEventListener("click", () => startDrawing("point"));
  getEl("add-line-btn").addEventListener("click", () => startDrawing("polyline"));
  getEl("add-polygon-btn").addEventListener("click", () => startDrawing("polygon"));
  getEl("add-text-btn").addEventListener("click", () => startDrawing("text"));
  getEl("import-toggle-btn").addEventListener("click", toggleImportOptions);
  getEl("import-geojson-btn").addEventListener("click", () => handleImportClick("geojson"));
  getEl("import-csv-btn").addEventListener("click", () => handleImportClick("csv"));
  getEl("import-file-input").addEventListener("change", handleImportFileChange);
  const projectNameInput = document.getElementById("project-name-input");
  if (projectNameInput) {
    projectNameInput.addEventListener("calciteInputChange", (event: Event) => {
      const target = event.target as any;
      setProjectName(target?.value || "", true);
      scheduleProjectSave();
    });
  }

  getEl("add-feature-layer-btn").addEventListener("click", handleAddFeatureLayer);
  getEl("feature-layer-url").addEventListener("calciteInputInput", () => setFeatureLayerError(null));

  getEl("basemap-select").addEventListener("calciteSelectChange", handleBasemapChange as EventListener);


  getEl("style-confirm").addEventListener("click", confirmStyleSettings);
  getEl("text-settings-confirm").addEventListener("click", confirmTextSettings);
  getEl("text-settings-cancel").addEventListener("click", cancelTextSettings);

  getEl("feature-field-select").addEventListener("calciteSelectChange", handleFeatureFieldChange as EventListener);
  getEl("feature-visual-select").addEventListener("calciteSelectChange", handleFeatureVisualChange as EventListener);
  getEl("feature-hide-nulls").addEventListener("calciteSwitchChange", handleFeatureHideNullsChange as EventListener);
  getEl("feature-fade-out").addEventListener(
    "calciteSwitchChange",
    handleFeatureFadeOutChange as EventListener
  );
  getEl("feature-style-btn").addEventListener("click", openStyleModal);

  getEl("point-style-options").addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest(".style-option-btn") as HTMLElement | null;
    if (!button) return;
    const selectedValue = button.dataset.value || "";
    const sizeInput = getEl("point-size-input") as any;
    const currentSize = Number(sizeInput?.value);
    const safeCurrentSize = Number.isFinite(currentSize) ? currentSize : DEFAULT_PIN_SIZE;
    const currentAutoYOffset = getAutoPinYOffset(safeCurrentSize);
    const yOffsetInput = getEl("point-yoffset-input") as any;
    const currentYOffset = Number(yOffsetInput?.value);
    let nextSize = safeCurrentSize;
    if (selectedValue === "map-pin" && (!Number.isFinite(currentSize) || currentSize === DEFAULT_CIRCLE_SIZE)) {
      setCalciteValue(sizeInput, DEFAULT_PIN_SIZE);
      nextSize = DEFAULT_PIN_SIZE;
    } else if (selectedValue === "circle" && (!Number.isFinite(currentSize) || currentSize === DEFAULT_PIN_SIZE)) {
      setCalciteValue(sizeInput, DEFAULT_CIRCLE_SIZE);
      nextSize = DEFAULT_CIRCLE_SIZE;
    }
    const nextAutoYOffset = getAutoPinYOffset(nextSize);
    const isAutoYOffset =
      Number.isFinite(currentYOffset) && Math.abs(currentYOffset - currentAutoYOffset) < 0.01;
    if (selectedValue === "map-pin" && (!Number.isFinite(currentYOffset) || currentYOffset === 0 || isAutoYOffset)) {
      setCalciteValue(yOffsetInput, nextAutoYOffset);
    } else if (selectedValue === "circle" && (currentYOffset === DEFAULT_PIN_Y_OFFSET || isAutoYOffset)) {
      setCalciteValue(yOffsetInput, 0);
    }
    lastPointSizeInput = nextSize;
    const container = getEl("point-style-options");
    container.querySelectorAll(".style-option-btn").forEach((el) => {
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
    });
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    applyStyleSettings(false);
  });
  getEl("point-size-input").addEventListener("calciteSliderInput", () => {
    const sizeInput = getEl("point-size-input") as any;
    const nextSize = Number(sizeInput?.value);
    const yOffsetInput = getEl("point-yoffset-input") as any;
    const currentYOffset = Number(yOffsetInput?.value);
    const prevAutoYOffset = getAutoPinYOffset(lastPointSizeInput);
    const isAutoYOffset =
      Number.isFinite(currentYOffset) && Math.abs(currentYOffset - prevAutoYOffset) < 0.01;
    if (getSelectedPointStyle() === "map-pin" && Number.isFinite(nextSize) && (isAutoYOffset || currentYOffset === 0)) {
      setCalciteValue(yOffsetInput, getAutoPinYOffset(nextSize));
    }
    if (Number.isFinite(nextSize)) {
      lastPointSizeInput = nextSize;
    }
    applyStyleSettings(false);
  });
  getEl("point-fill-color-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("point-fill-color", event?.target?.value || "");
    applyStyleSettings(false);
  });
  getEl("point-outline-color-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("point-outline-color", event?.target?.value || "");
    applyStyleSettings(false);
  });
  getEl("point-outline-width").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("point-angle-input").addEventListener("calciteInputNumberChange", () => applyStyleSettings(false));
  getEl("point-xoffset-input").addEventListener("calciteInputNumberChange", () => applyStyleSettings(false));
  getEl("point-yoffset-input").addEventListener("calciteInputNumberChange", () => applyStyleSettings(false));

  getEl("line-style-options").addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest(".style-option-btn") as HTMLElement | null;
    if (!button) return;
    const container = getEl("line-style-options");
    container.querySelectorAll(".style-option-btn").forEach((el) => {
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
    });
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    applyStyleSettings(false);
  });
  getEl("line-width-input").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("line-color-input-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("line-color-input", event?.target?.value || "");
    applyStyleSettings(false);
  });

  getEl("polygon-fill-style-options").addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest(".style-option-btn") as HTMLElement | null;
    if (!button) return;
    const container = getEl("polygon-fill-style-options");
    container.querySelectorAll(".style-option-btn").forEach((el) => {
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
    });
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    applyStyleSettings(false);
  });
  getEl("polygon-outline-style-select").addEventListener("calciteSelectChange", () =>
    applyStyleSettings(false)
  );
  getEl("polygon-fill-color-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("polygon-fill-color", event?.target?.value || "");
    applyStyleSettings(false);
  });
  getEl("polygon-outline-color-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("polygon-outline-color", event?.target?.value || "");
    applyStyleSettings(false);
  });
  getEl("polygon-outline-width").addEventListener("calciteInputNumberChange", () => applyStyleSettings(false));

  getEl("layer-blend-mode-select").addEventListener("calciteSelectChange", () =>
    applyStyleSettings(false)
  );
  getEl("effect-brightness").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-contrast").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-grayscale").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-hue-rotate").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-invert").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-opacity").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-saturate").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-sepia").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-blur").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("effect-drop-shadow-offset-x").addEventListener("calciteSliderInput", () =>
    applyStyleSettings(false)
  );
  getEl("effect-drop-shadow-offset-y").addEventListener("calciteSliderInput", () =>
    applyStyleSettings(false)
  );
  getEl("effect-drop-shadow-blur").addEventListener("calciteSliderInput", () =>
    applyStyleSettings(false)
  );
  getEl("effect-drop-shadow-color-picker").addEventListener("calciteColorPickerChange", (event: any) => {
    updateColorPickerSwatch("effect-drop-shadow-color", event?.target?.value || "");
    applyStyleSettings(false);
  });

  const handleTextContentInput = (event?: Event) => {
    const value = (event?.target as any)?.value;
    applyTextSettings(false, value !== undefined ? { content: String(value) } : undefined);
  };
  getEl("text-content-input").addEventListener("calciteInputInput", handleTextContentInput);
  getEl("text-content-input").addEventListener("calciteInputChange", handleTextContentInput);
  getEl("text-content-input").addEventListener("input", handleTextContentInput);
  getEl("text-size-slider").addEventListener("calciteSliderInput", () => applyTextSettings(false));
  getEl("text-color-input").addEventListener("input", () => applyTextSettings(false));

  getEl("play-button").addEventListener("click", handlePlayFromStart);
  getEl("rotation-button").addEventListener("click", rotateMap);
  getEl("new-project-btn").addEventListener("click", resetProject);
  getEl("delete-layer-btn").addEventListener("click", () => {
    if (selectedLayerIndex >= 0) {
      removeLayer(selectedLayerIndex);
    }
  });
  getEl("export-btn").addEventListener("click", startExportRecording);

  getEl("timeline-play-btn").addEventListener("click", togglePlayAnimation);
  getEl("timeline-save-btn").addEventListener("click", async () => {
    await ensureStorageConsent(storageState, openConfirmDialog);
    if (storageState.localStorageAllowed) {
      saveProjectToStorage(storageState, storageConfig, projectName, Boolean(view));
    }
  });
  getEl("timeline-duplicate-btn").addEventListener("click", duplicateSelectedTimelineAnimation);
  getEl("timeline-start-btn").addEventListener("click", goToStart);
  getEl("timeline-end-btn").addEventListener("click", goToEnd);
  getEl("timeline-delete-clip-btn").addEventListener("click", removeSelectedTimelineAnimation);
  getEl("timeline-duration").addEventListener(
    "calciteInputNumberChange",
    handleTimelineDurationChange as EventListener
  );
  getEl("timeline-duration-autofit").addEventListener("click", handleTimelineDurationAutoFit);
  getEl("timeline-snap-toggle").addEventListener("click", toggleTimelineSnap);
  getEl("timeline-grid-toggle").addEventListener("click", toggleTimelineGrid);
  getEl("timeline-zoom-in").addEventListener("click", zoomInTimeline);
  getEl("timeline-zoom-out").addEventListener("click", zoomOutTimeline);
  document.addEventListener("keydown", handleGlobalKeyDown);
  initTimelineResizer();
  initTimelineScrollSync();
  const timelinePanelResizer = document.getElementById("timeline-panel-resizer");
  if (timelinePanelResizer) {
    timelinePanelResizer.addEventListener("mousedown", startTimelinePanelResize);
  }

  getEl("timeline-tracks-container").addEventListener("mousedown", handleTimelineMouseDown);
  window.addEventListener("resize", () => {
    if (currentAspectRatio) {
      scheduleAspectRatioUpdate();
    }
    if (timelineState.timelineZoomAuto) {
      updateTimeline();
    }
  });

  if (view) {
    view.on("click", handleMapClick);
    view.on("double-click", handleMapDoubleClick);
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (event.key === "Delete" || event.key === "Backspace") {
      removeSelectedTimelineAnimation();
    }
  });

  bindConfirmDialogListeners();
}

function handleLayoutChange(event: Event) {
  const target = event.target as HTMLElement | null;
  const layout = target?.getAttribute("data-layout");
  if (!layout) return;

  const mapContainer = getEl("map-container");
  const mapWrapper = getEl("map-wrapper");
  const rotationButton = getEl("rotation-button");

  switch (layout) {
    case "default":
      mapContainer.classList.add("has-padding");
      mapWrapper.classList.remove("no-shadow");
      rotationButton.classList.remove("show");
      isRotated = false;
      currentAspectRatio = null;
      resetMapWrapperSize();
      break;
    case "mobile":
      mapContainer.classList.add("has-padding");
      mapWrapper.classList.remove("no-shadow");
      rotationButton.classList.add("show");
      isRotated = false;
      currentAspectRatio = { width: 9, height: 16 };
      scheduleAspectRatioUpdate();
      break;
    case "tablet":
      mapContainer.classList.add("has-padding");
      mapWrapper.classList.remove("no-shadow");
      rotationButton.classList.add("show");
      isRotated = false;
      currentAspectRatio = { width: 3, height: 4 };
      scheduleAspectRatioUpdate();
      break;
    case "custom":
      mapContainer.classList.add("has-padding");
      mapWrapper.classList.remove("no-shadow");
      rotationButton.classList.add("show");
      isRotated = false;
      handleCustomDimensions();
      break;
  }

  currentLayout = layout as any;
  scheduleProjectSave();

  setTimeout(() => {
    if (view && typeof view.resize === "function") {
      view.resize();
    }
  }, 350);
}

function handleBasemapChange() {
  if (!view?.map) return;
  const select = getEl("basemap-select") as any;
  const value = normalizeBasemap(String(select?.value || "gray-vector"));
  if (value === "none") {
    view.map.basemap = null as any;
  } else {
    view.map.basemap = value;
  }
  scheduleProjectSave();
}


function handleGlobalKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag.startsWith("CALCITE-INPUT") ||
      tag === "CALCITE-SELECT" ||
      target.isContentEditable
    ) {
      return;
    }
  }
  const isModifier = event.ctrlKey || event.metaKey;
  if (!isModifier) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      void redoHistory(historyState, historyConfig);
    } else {
      void undoHistory(historyState, historyConfig);
    }
  } else if (key === "y") {
    event.preventDefault();
    void redoHistory(historyState, historyConfig);
  }
}

function toggleImportOptions() {
  const advanced = getEl("layer-import-advanced");
  const toggle = getEl("import-toggle-btn") as HTMLButtonElement;
  const isOpen = advanced.classList.toggle("show");
  toggle.textContent = isOpen ? "Show less" : "Show more";
  toggle.setAttribute("aria-expanded", String(isOpen));
}

function handleImportClick(type: "geojson" | "csv") {
  const input = getEl("import-file-input") as HTMLInputElement;
  pendingImportType = type;
  if (type === "geojson") {
    input.accept = ".geojson,.json,application/geo+json,application/json";
  } else {
    input.accept = ".csv,text/csv";
  }
  input.value = "";
  input.click();
}

function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !pendingImportType) return;

  const importType = pendingImportType;
  pendingImportType = null;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    if (importType === "geojson") {
      importGeoJsonFromState(importConfig, file.name, text);
    } else {
      importCsvFromState(importConfig, file.name, text);
    }
  };
  reader.readAsText(file);
}

function getFeatureLayerFields(layer: FeatureLayer) {
  return (layer.fields || [])
    .filter((field) => {
      const type = String(field.type || "");
      return (
        type === "double" ||
        type === "single" ||
        type === "integer" ||
        type === "small-integer" ||
        type === "long" ||
        type === "short" ||
        type === "date"
      );
    })
    .map((field) => ({ name: field.name, type: String(field.type || "") }));
}

async function updateFeatureFieldStats(layerData: LayerData) {
  const layer = layerData.layer as FeatureLayer;
  const field = layerData.featureField;
  if (!field) return false;

  let stats: any;
  try {
    const where = layerData.featureHideNulls ? `${field} IS NOT NULL` : "1=1";
    stats = await layer.queryFeatures({
      where,
      outStatistics: [
        {
          statisticType: "min",
          onStatisticField: field,
          outStatisticFieldName: "min_value"
        },
        {
          statisticType: "max",
          onStatisticField: field,
          outStatisticFieldName: "max_value"
        }
      ],
      returnGeometry: false
    } as any);
  } catch (error) {
    return false;
  }

  const attrs = stats?.features?.[0]?.attributes ?? {};
  const minValue = Number(attrs.min_value);
  const maxValue = Number(attrs.max_value);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return false;
  }

  layerData.featureFieldStats = {
    min: minValue,
    max: maxValue
  };
  layerData.featureLastValue = undefined;
  return true;
}

function applyFeatureLayerDefinition(layerData: LayerData) {
  const layer = layerData.layer as FeatureLayer;
  const field = layerData.featureField;
  if (!field) return;
  layer.definitionExpression = layerData.featureHideNulls ? `${field} IS NOT NULL` : "1=1";
}

function buildFeatureBaseSymbol(layerData: LayerData, visualType: string) {
  const geometryType = (layerData.layer as FeatureLayer).geometryType;
  if (geometryType === "point" || geometryType === "multipoint") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    return buildPointSymbol(style);
  }
  if (geometryType === "polyline") {
    const style = layerData.lineStyle ?? defaultLineStyle;
    const base = buildLineSymbol(style);
    if (visualType === "opacity") {
      base.color = style.color;
    }
    return base;
  }
  if (geometryType === "polygon") {
    const style = layerData.polygonStyle ?? defaultPolygonStyle;
    const fillColor = parseColorToRgba(style.color);
    const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
    const outlineColor = parseColorToRgba(style.outlineColor);
    const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
    return {
      type: "simple-fill",
      style: style.style as any,
      color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha],
      outline: {
        color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
        width: style.outlineWidth,
        style: normalizeLineStyle(style.outlineStyle ?? "solid") as any
      }
    };
  }
  return buildPointSymbol(defaultPointStyle);
}

function applyFeatureLayerRenderer(layerData: LayerData, value: number) {
  const field = layerData.featureField;
  const stats = layerData.featureFieldStats;
  if (!field || !stats) return;

  const layer = layerData.layer as FeatureLayer;
  const min = stats.min;
  const max = stats.max;
  const span = max - min;
  const safeSpan = span == 0 ? 1 : span;

  const fieldType = layerData.featureFieldType;
  const visualType = layerData.featureVisualVariable ?? "opacity";
  const toStopValue = (val: number) =>
    fieldType === "date" && visualType !== "opacity" ? new Date(val) : val;
  let stops: any[] = [];

  if (visualType === "opacity") {
    const endOpacity = layerData.featureKeepVisible ? 1 : 0;
    const epsilon = Math.max((stats.max - stats.min) * 0.001, 0.00001);
    const midRaw =
      !layerData.featureKeepVisible && value >= stats.max
        ? stats.max - epsilon
        : value;
    const midValue = Math.max(stats.min, Math.min(midRaw, stats.max));
    stops = [
      { value: toStopValue(min), opacity: 0 },
      { value: toStopValue(midValue), opacity: 1 },
      { value: toStopValue(max), opacity: endOpacity }
    ];
  } else if (visualType === "size") {
    stops = [
      { value: toStopValue(min), size: 4 },
      { value: toStopValue(value), size: 24 },
      { value: toStopValue(max), size: 4 }
    ];
  } else if (visualType === "color") {
    stops = [
      { value: toStopValue(min), color: "#d6e4e1" },
      { value: toStopValue(value), color: "#0a4c66" },
      { value: toStopValue(max), color: "#d6e4e1" }
    ];
  }

  layer.renderer = {
    type: "simple",
    symbol: buildFeatureBaseSymbol(layerData, visualType),
    visualVariables: [
      {
        type: visualType,
        field,
        stops
      }
    ]
  } as any;

  if (safeSpan > 0) {
    layerData.featureLastValue = value;
  }
}

function applyFeatureLayerAnimation(layerData: LayerData, time: number) {
  const anim = layerData.animations.find((entry) => entry.type === "field");
  const stats = layerData.featureFieldStats;
  if (!anim || !stats) return;

  const span = anim.duration || 0;
  if (span <= 0) return;

  const t = Math.min(1, Math.max(0, (time - anim.start) / span));
  const value = stats.min + (stats.max - stats.min) * t;

  if (layerData.featureLastValue != undefined) {
    const delta = Math.abs(layerData.featureLastValue - value);
    const threshold =
      layerData.featureVisualVariable === "opacity"
        ? 0
        : Math.max((stats.max - stats.min) / 800, 0.00001);
    if (delta < threshold) return;
  }

  applyFeatureLayerRenderer(layerData, value);
}

function handleFeatureFieldChange() {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type !== "feature") return;

  const select = getEl("feature-field-select") as any;
  const nextField = String(select.value || "");
  const fieldInfo = layerData.featureFields?.find((field) => field.name === nextField);
  layerData.featureField = nextField;
  layerData.featureFieldType = fieldInfo?.type;

  updateFeatureFieldStats(layerData).then((ok) => {
    if (!ok) {
      setFeatureLayerError("Unable to compute min/max for that field. Try another field.");
    } else {
      setFeatureLayerError(null);
    }
    applyFeatureLayerDefinition(layerData);
    applyFeatureLayerAnimation(layerData, currentTime);
    scheduleProjectSave();
  });
}

function handleFeatureVisualChange() {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type !== "feature") return;

  const select = getEl("feature-visual-select") as any;
  layerData.featureVisualVariable = String(select.value || "opacity") as any;
  layerData.featureLastValue = undefined;
  applyFeatureLayerAnimation(layerData, currentTime);
  scheduleProjectSave();
}

function handleFeatureHideNullsChange(event: Event) {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type !== "feature") return;

  const target = event.target as any;
  layerData.featureHideNulls = Boolean(target?.checked);
  applyFeatureLayerDefinition(layerData);
  scheduleProjectSave();
}

function handleFeatureFadeOutChange(event: Event) {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type !== "feature") return;

  const target = event.target as any;
  layerData.featureKeepVisible = !target?.checked;
  layerData.featureLastValue = undefined;
  applyFeatureLayerAnimation(layerData, currentTime);
  scheduleProjectSave();
}

function createImportedLayer(type: LayerType, name: string, graphics: Graphic[]): LayerData | null {
  if (!view) return null;
  const safeName = sanitizePlainText(name, `${type.charAt(0).toUpperCase() + type.slice(1)} Layer`);
  const newLayer = new GraphicsLayer({
    title: safeName
  });
  graphics.forEach((graphic) => newLayer.add(graphic));
  view.map.add(newLayer);

  const layerData: LayerData = {
    layer: newLayer,
    name: safeName,
    type,
    color: "#0a4c66",
    animations: [createPlaceholderAnimation()],
    pointKeyframes: []
  };

  if (type === "point") {
    layerData.pointStyle = { ...defaultPointStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polyline") {
    layerData.lineStyle = { ...defaultLineStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polygon") {
    layerData.polygonStyle = { ...defaultPolygonStyle };
    layerData.layerEffectsEnabled = true;
  }

  graphicsLayers.push(layerData);
  selectLayer(graphicsLayers.length - 1);
  scheduleProjectSave();
  return layerData;
}

function createGraphicForType(
  type: LayerType,
  geometry: any,
  attributes?: Record<string, any>
) {
  const graphic = new Graphic({ geometry, attributes });
  if (type === "point") {
    const style = defaultPointStyle;
    graphic.symbol = buildPointSymbol(style);
  } else if (type === "polyline") {
    graphic.symbol = buildLineSymbol(defaultLineStyle);
  } else if (type === "polygon") {
    const fillColor = parseColorToRgba(defaultPolygonStyle.color);
    const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
    const outlineColor = parseColorToRgba(defaultPolygonStyle.outlineColor);
    const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
    graphic.symbol = {
      type: "simple-fill",
      style: defaultPolygonStyle.style as any,
      color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha],
      outline: {
        color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
        width: defaultPolygonStyle.outlineWidth,
        style: normalizeLineStyle(defaultPolygonStyle.outlineStyle ?? "solid") as any
      }
    };
  }
  return graphic;
}



function beginTextPlacement(layerIndex: number) {
  if (!view) return;
  const layerData = graphicsLayers[layerIndex];
  if (!layerData || layerData.type !== "text") return;
  if (textPlacementHandle) {
    textPlacementHandle.remove();
    textPlacementHandle = null;
  }

  const drawInstructions = getEl("draw-instructions");
  drawInstructions.classList.add("show");
  drawInstructions.querySelector("p")!.textContent = "Click on the map to place text.";

  textPlacementHandle = view.on("click", (event: any) => {
    const graphic = new Graphic({
      geometry: event.mapPoint,
      symbol: {
        type: "text",
        text: layerData.textContent || "Text",
        color: layerData.textColor || "#22323a",
        font: { size: layerData.textSize || 14, family: "sans-serif" }
      }
    });

    layerData.layer.add(graphic);
    drawInstructions.classList.remove("show");
    isDrawing = false;
    pendingTextPlacement = null;
    selectLayer(layerIndex);
    scheduleProjectSave();
    if (textPlacementHandle) {
      textPlacementHandle.remove();
      textPlacementHandle = null;
    }
  });
}

async function startDrawing(type: LayerType) {
  if (!view) return;
  isDrawing = true;

  const layerName = `${type.charAt(0).toUpperCase() + type.slice(1)} ${graphicsLayers.length + 1}`;
  const newLayer = new GraphicsLayer({
    title: layerName
  });
  const layerIndex = graphicsLayers.length;

  view.map.add(newLayer);
  const layerData: LayerData = {
    layer: newLayer,
    name: layerName,
    type,
    color: "#0a4c66",
    animations: [createPlaceholderAnimation()],
    pointKeyframes: []
  };

  if (type === "point") {
    layerData.pointStyle = { ...defaultPointStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polyline") {
    layerData.lineStyle = { ...defaultLineStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polygon") {
    layerData.polygonStyle = { ...defaultPolygonStyle };
    layerData.layerEffectsEnabled = true;
  }

  graphicsLayers.push(layerData);

  if (!sketch) {
    sketch = new Sketch({
      view,
      layer: newLayer,
      creationMode: "update"
    });
    setSketchUpdateOnGraphicClick(true);
  } else {
    sketch.layer = newLayer;
  }
  if (sketch && !sketchHasUpdateHandler) {
    sketch.on("update", handleSketchUpdate);
    sketchHasUpdateHandler = true;
  }

  if (type === "text") {
    layerData.textContent = "Text";
    layerData.textSize = 14;
    layerData.textColor = "#22323a";
    pendingTextPlacement = { layerIndex };
    selectLayer(layerIndex, false);
    openTextSettingsModal();
    beginTextPlacement(layerIndex);
    return;
  } else {
    const toolMap: Record<string, string> = {
      point: "point",
      polyline: "polyline",
      polygon: "polygon"
    };

    const mode = "click";
    sketch.create(toolMap[type] as any, {
      mode
    });

    const drawInstructions = getEl("draw-instructions");
    drawInstructions.classList.add("show");
    drawInstructions.querySelector("p")!.textContent =
      type === "point" ? "Click on the map to place a point." : "Click to draw. Double-click to finish.";

    sketch.on("create", (event: any) => {
      if (event.state === "complete") {
        const graphic = event.graphic;
            if (type === "point") {
              const style = layerData.pointStyle ?? defaultPointStyle;
              graphic.symbol = buildPointSymbol(style);
            } else if (type === "polyline") {
              const style = layerData.lineStyle ?? defaultLineStyle;
              graphic.symbol = buildLineSymbol(style);
            } else if (type === "polygon") {
              const style = layerData.polygonStyle ?? defaultPolygonStyle;
              const fillColor = parseColorToRgba(style.color);
              const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
              const outlineColor = parseColorToRgba(style.outlineColor);
              const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
              graphic.symbol = {
                type: "simple-fill",
                style: style.style,
                color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha],
                outline: {
                  color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
                  width: style.outlineWidth,
                  style: normalizeLineStyle(style.outlineStyle ?? "solid") as any
                }
              };
            }

        ensureGeometryCache(layerData, graphic);
        drawInstructions.classList.remove("show");
        isDrawing = false;
        selectLayer(layerIndex);
        scheduleProjectSave();
      }
    });
  }
}

function updateLayersList() {
  const layersAccordion = getEl("layers-accordion");
  attachAnimationPanelTo();
  layersAccordion.innerHTML = "";

  graphicsLayers.forEach((layerData, index) => {
    const item = document.createElement("div");
    item.className = "layer-item";
    if (index === selectedLayerIndex) {
      item.classList.add("expanded");
    }

    const header = document.createElement("div");
    header.className = "layer-item-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "layer-item-header-left";

    const icon = document.createElement("calcite-icon");
    icon.setAttribute("icon", getIconForType(layerData.type));
    icon.setAttribute("scale", "s");
    headerLeft.appendChild(icon);

    const heading = document.createElement("span");
    heading.className = "layer-item-heading";
    heading.textContent = layerData.name;
    headerLeft.appendChild(heading);

    header.appendChild(headerLeft);

    const actionsEnd = document.createElement("div");
    actionsEnd.className = "layer-actions";

    const addAnimationChip = document.createElement("calcite-chip");
    addAnimationChip.setAttribute("scale", "s");
    addAnimationChip.setAttribute("kind", "neutral");
    addAnimationChip.className = "layer-add-animation-chip";
    addAnimationChip.textContent = "Add animation";
    addAnimationChip.addEventListener("click", (event) => {
      event.stopPropagation();
      if (index === selectedLayerIndex) {
        updateAnimationOptions();
        highlightAnimationPanel();
        return;
      }
      selectLayer(index);
    });
    actionsEnd.appendChild(addAnimationChip);

    let styleAction: HTMLElement | null = null;
    if (layerData.type !== "feature") {
      styleAction = createLayerAction("paint-bucket", "Style", () => {
        selectLayer(index, false);
        openStyleModal();
      });
      actionsEnd.appendChild(styleAction);
    }

    const deleteAction = createLayerAction("trash", "Delete", () => {
      removeLayer(index);
    });
    deleteAction.classList.add("layer-action-delete");

    actionsEnd.appendChild(deleteAction);

    if (layerData.type === "text" && styleAction) {
      styleAction.setAttribute("text", "Text");
    }

    const content = document.createElement("div");
    content.className = "layer-item-content";

    if (index === selectedLayerIndex) {
      const host = document.createElement("div");
      host.id = `animation-settings-host-${index}`;
      content.appendChild(host);
    }

    header.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("calcite-action")) return;
      if (target.closest("#animation-settings-panel")) return;
      selectLayer(index);
    });

    header.appendChild(actionsEnd);
    item.appendChild(header);
    item.appendChild(content);
    layersAccordion.appendChild(item);
  });

  updatePrimaryActionsState();
}
function getIconForType(type: LayerType) {
  switch (type) {
    case "point":
      return "pin";
    case "polyline":
      return "line";
    case "polygon":
      return "polygon";
    case "text":
      return "text-large";
    case "feature":
      return "database";
    default:
      return "layer";
  }
}

function createLayerAction(icon: string, text: string, action: () => void) {
  const actionButton = document.createElement("calcite-action");
  actionButton.setAttribute("icon", icon);
  actionButton.setAttribute("text", text);
  actionButton.setAttribute("scale", "s");
  actionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return actionButton;
}

function selectLayer(index: number, focusGraphic = true) {
  if (index < 0 || index >= graphicsLayers.length) return;
  selectedLayerIndex = index;
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  setDeleteLayerButtonVisible(true);

  const layerData = graphicsLayers[index];
  if (layerData.type === "feature") {
    if (isPlaying) {
      stopAnimation();
    }
    return;
  }
  if (isPlaying && (layerData.type === "polyline" || layerData.type === "polygon")) {
    stopAnimation();
    restoreLayerGeometry(layerData);
  }

  if (!sketch && view) {
    sketch = new Sketch({
      view,
      layer: layerData.layer,
      creationMode: "update"
    });
    setSketchUpdateOnGraphicClick(true);
  }

  if (!sketch) return;
  sketch.layer = layerData.layer;
  const allowEditing = !isPlaying;
  setSketchUpdateOnGraphicClick(allowEditing);
  if (!allowEditing) {
    sketch.cancel();
  }
  if (!sketchHasUpdateHandler) {
    sketch.on("update", handleSketchUpdate);
    sketchHasUpdateHandler = true;
  }

  if (focusGraphic && !hasPathAnimation(layerData)) {
    const graphic =
      (layerData.layer.graphics as any).getItemAt?.(0) ??
      layerData.layer.graphics?.items?.[0];
    if (graphic && allowEditing) {
      restoreLayerGeometry(layerData);
      sketch.update(graphic);
    }
  }
}

async function confirmDeleteLayer(layerData: LayerData, hostId?: string) {
  if (hasRealAnimations(layerData) || hasPointKeyframes(layerData)) {
    return await openConfirmDialog({
      heading: "Delete layer",
      message: "This layer has animations. Are you sure you want to delete it?",
      confirmText: "Delete layer",
      confirmKind: "danger",
      hostId
    });
  }
  return true;
}

async function removeLayer(index: number, options?: { confirmHostId?: string }) {
  const layerData = graphicsLayers[index];
  if (!(await confirmDeleteLayer(layerData, options?.confirmHostId))) return;
  view.map.remove(layerData.layer);
  graphicsLayers.splice(index, 1);

  if (selectedLayerIndex === index) {
    selectedLayerIndex = -1;
    setDeleteLayerButtonVisible(false);
  } else if (selectedLayerIndex > index) {
    selectedLayerIndex--;
  }

  if (timelineState.selectedTimelineAnimation) {
    if (timelineState.selectedTimelineAnimation.layerIdx === index) {
      timelineController.clearSelectedTimelineAnimation();
    } else if (timelineState.selectedTimelineAnimation.layerIdx > index) {
      timelineState.selectedTimelineAnimation = {
        layerIdx: timelineState.selectedTimelineAnimation.layerIdx - 1,
        animIdx: timelineState.selectedTimelineAnimation.animIdx
      };
    }
  }

  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  scheduleProjectSave();
}

function getDuplicateLayerName(base: string) {
  const safeBase = sanitizePlainText(base, "Layer");
  let name = `${safeBase} Copy`;
  let counter = 2;
  while (graphicsLayers.some((layer) => layer.name === name)) {
    name = `${safeBase} Copy ${counter}`;
    counter += 1;
  }
  return name;
}

async function duplicateLayer(index: number) {
  const layerData = graphicsLayers[index];
  if (!layerData || !view) return;
  const nextName = getDuplicateLayerName(layerData.name);

  if (layerData.type === "feature") {
    if (!layerData.featureLayerUrl) {
      setProjectError("Feature layer URL is missing.");
      return;
    }
    let featureLayer: FeatureLayer;
    try {
      featureLayer = new FeatureLayer({ url: layerData.featureLayerUrl });
      await featureLayer.load();
    } catch (error) {
      console.warn("Unable to duplicate FeatureLayer.", error);
      setProjectError("Unable to duplicate the FeatureLayer.");
      return;
    }
    view.map.add(featureLayer);
    const duplicate: LayerData = {
      layer: featureLayer,
      name: nextName,
      type: "feature",
      animations: layerData.animations.map((anim) => ({ ...anim })),
      featureLayerUrl: layerData.featureLayerUrl,
      featureFields: layerData.featureFields?.map((field) => ({ ...field })),
      featureField: layerData.featureField,
      featureFieldType: layerData.featureFieldType,
      featureFieldStats: layerData.featureFieldStats ? { ...layerData.featureFieldStats } : undefined,
      featureVisualVariable: layerData.featureVisualVariable,
      featureHideNulls: layerData.featureHideNulls,
      featureKeepVisible: layerData.featureKeepVisible,
      pointStyle: layerData.pointStyle ? { ...layerData.pointStyle } : undefined,
      lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
      polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
      layerBlendMode: layerData.layerBlendMode,
      layerEffectSettings: layerData.layerEffectSettings ? { ...layerData.layerEffectSettings } : undefined,
      layerEffectsEnabled: layerData.layerEffectsEnabled
    };
    if (!duplicate.featureFields || !duplicate.featureFields.length) {
      duplicate.featureFields = getFeatureLayerFields(featureLayer);
    }
    graphicsLayers.push(duplicate);
    selectLayer(graphicsLayers.length - 1);
    applyFeatureLayerDefinition(duplicate);
    applyFeatureLayerAnimation(duplicate, currentTime);
    updateTimeline();
    scheduleProjectSave();
    return;
  }

  const newLayer = new GraphicsLayer({ title: nextName });
  layerData.layer.graphics.forEach((graphic: any) => {
    const clone = typeof graphic.clone === "function" ? graphic.clone() : new Graphic({ geometry: graphic.geometry });
    if (graphic.attributes) {
      clone.attributes = { ...graphic.attributes };
    }
    newLayer.add(clone);
  });
  view.map.add(newLayer);

  const duplicate: LayerData = {
    layer: newLayer,
    name: nextName,
    type: layerData.type,
    animations: layerData.animations.map((anim) => ({ ...anim })),
    pointKeyframes: layerData.pointKeyframes?.map((frame) => ({ ...frame })),
    pointStyle: layerData.pointStyle ? { ...layerData.pointStyle } : undefined,
    lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
    polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
    textContent: layerData.textContent,
    textSize: layerData.textSize,
    textColor: layerData.textColor,
    layerBlendMode: layerData.layerBlendMode,
    layerEffectSettings: layerData.layerEffectSettings ? { ...layerData.layerEffectSettings } : undefined,
    layerEffectsEnabled: layerData.layerEffectsEnabled
  };
  if (layerData.type === "point") {
    duplicate.pointStyle = duplicate.pointStyle ?? { ...defaultPointStyle };
  } else if (layerData.type === "polyline") {
    duplicate.lineStyle = duplicate.lineStyle ?? { ...defaultLineStyle };
  } else if (layerData.type === "polygon") {
    duplicate.polygonStyle = duplicate.polygonStyle ?? { ...defaultPolygonStyle };
  }

  graphicsLayers.push(duplicate);
  selectLayer(graphicsLayers.length - 1);
  applyLayerStyle(duplicate);
  applyLayerEffects(duplicate);
  updateTimeline();
  scheduleProjectSave();
}

async function handleMapClick(event: any) {
  if (!view || isDrawing) return;
  const response = await view.hitTest(event);
  const hit = response.results.find((result: any) =>
    graphicsLayers.some((layerData) => layerData.layer === result.graphic?.layer)
  );

  if (!hit) {
    selectedLayerIndex = -1;
    updateLayersList();
    updateTimeline();
    updateAnimationOptions();
    setDeleteLayerButtonVisible(false);
    return;
  }

  const layerIndex = graphicsLayers.findIndex(
    (layerData) => layerData.layer === hit.graphic.layer
  );

  if (layerIndex >= 0) {
    if (isPlaying) {
      stopAnimation();
    }
    const layerData = graphicsLayers[layerIndex];
    if (layerData) {
      restoreLayerGeometry(layerData);
    }
    selectLayer(layerIndex, !layerData || !hasPathAnimation(layerData));
  }
}

async function handleMapDoubleClick(event: any) {
  if (!view || isDrawing) return;
  event.stopPropagation?.();
  event.preventDefault?.();

  const response = await view.hitTest(event);
  const hit = response.results.find((result: any) => {
    const graphic = result.graphic;
    return graphic?.symbol?.type === "text";
  });

  if (!hit) return;
  const layerIndex = graphicsLayers.findIndex(
    (layerData) => layerData.layer === hit.graphic.layer
  );
  if (layerIndex < 0) return;

  selectLayer(layerIndex, false);
  openTextSettingsModal();
}

function openStyleModal() {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type === "text") {
    openTextSettingsModal();
    return;
  }

  const effectsToggle = document.getElementById("style-effects-toggle");
  if (effectsToggle && !effectsToggle.dataset.listenerBound) {
    effectsToggle.addEventListener("click", toggleStyleEffects);
    effectsToggle.dataset.listenerBound = "true";
  }

  const styleType = getStyleTypeForLayer(layerData);
  setStyleSectionVisibility(styleType, layerData.type === "feature", styleType !== null);

  if (styleType === "point") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    setPointStyleSelection(style.style);
    setCalciteValue(getEl("point-size-input"), style.size);
    lastPointSizeInput = Number(style.size) || DEFAULT_PIN_SIZE;
    setColorPickerValue("point-fill-color", style.color, 1);
    setColorPickerValue("point-outline-color", style.outlineColor, 1);
    setCalciteValue(getEl("point-outline-width"), style.outlineWidth);
    setCalciteValue(getEl("point-angle-input"), style.angle ?? 0);
    setCalciteValue(getEl("point-xoffset-input"), style.xoffset ?? 0);
    setCalciteValue(getEl("point-yoffset-input"), style.yoffset ?? 0);
    updatePointAnimationPreview(style.color, style.outlineColor, style.style);
    updatePointStyleOptionColors(style.color, style.outlineColor);
  } else if (styleType === "polyline") {
    const style = layerData.lineStyle ?? defaultLineStyle;
    setLineStyleSelection(style.style);
    setCalciteValue(getEl("line-width-input"), style.width);
    setColorPickerValue("line-color-input", style.color, 1);
    updateLineAnimationPreview(style.color, style.style);
  } else if (styleType === "polygon") {
    const style = layerData.polygonStyle ?? defaultPolygonStyle;
    setPolygonFillStyleSelection(style.style);
    setColorPickerValue("polygon-fill-color", style.color, 0.3);
    setColorPickerValue("polygon-outline-color", style.outlineColor, 1);
    setCalciteValue(getEl("polygon-outline-style-select"), style.outlineStyle ?? "solid");
    setCalciteValue(getEl("polygon-outline-width"), style.outlineWidth);
    updatePolygonStyleOptionColors(style.color, style.outlineColor);
  }

  const effectSettings = layerData.layerEffectSettings ?? defaultLayerEffectSettings;
  setCalciteValue(getEl("layer-blend-mode-select"), layerData.layerBlendMode ?? "normal");
  setCalciteValue(getEl("effect-brightness"), effectSettings.brightness);
  setCalciteValue(getEl("effect-contrast"), effectSettings.contrast);
  setCalciteValue(getEl("effect-grayscale"), effectSettings.grayscale);
  setCalciteValue(getEl("effect-hue-rotate"), effectSettings.hueRotate);
  setCalciteValue(getEl("effect-invert"), effectSettings.invert);
  setCalciteValue(getEl("effect-opacity"), effectSettings.opacity);
  setCalciteValue(getEl("effect-saturate"), effectSettings.saturate);
  setCalciteValue(getEl("effect-sepia"), effectSettings.sepia);
  setCalciteValue(getEl("effect-blur"), effectSettings.blur);
  setCalciteValue(getEl("effect-drop-shadow-offset-x"), effectSettings.dropShadowOffsetX);
  setCalciteValue(getEl("effect-drop-shadow-offset-y"), effectSettings.dropShadowOffsetY);
  setCalciteValue(getEl("effect-drop-shadow-blur"), effectSettings.dropShadowBlur);
  setColorPickerValue("effect-drop-shadow-color", effectSettings.dropShadowColor, 1);

  (getEl("style-settings-modal") as any).open = true;

  const effectsAdvanced = getEl("style-effects-advanced");
  const effectsToggleEl = getEl("style-effects-toggle");
  effectsAdvanced.classList.remove("show");
  effectsToggleEl.textContent = "Show more";
  effectsToggleEl.setAttribute("aria-expanded", "false");
}

function confirmStyleSettings() {
  applyStyleSettings(true);
}

function readEffectSettingsFromInputs(): LayerEffectSettings {
  return {
    brightness: Number((getEl("effect-brightness") as any).value) || defaultLayerEffectSettings.brightness,
    contrast: Number((getEl("effect-contrast") as any).value) || defaultLayerEffectSettings.contrast,
    grayscale: Number((getEl("effect-grayscale") as any).value) || defaultLayerEffectSettings.grayscale,
    hueRotate: Number((getEl("effect-hue-rotate") as any).value) || defaultLayerEffectSettings.hueRotate,
    invert: Number((getEl("effect-invert") as any).value) || defaultLayerEffectSettings.invert,
    opacity: Number((getEl("effect-opacity") as any).value) || defaultLayerEffectSettings.opacity,
    saturate: Number((getEl("effect-saturate") as any).value) || defaultLayerEffectSettings.saturate,
    sepia: Number((getEl("effect-sepia") as any).value) || defaultLayerEffectSettings.sepia,
    blur: Number((getEl("effect-blur") as any).value) || defaultLayerEffectSettings.blur,
    dropShadowOffsetX:
      Number((getEl("effect-drop-shadow-offset-x") as any).value) ||
      defaultLayerEffectSettings.dropShadowOffsetX,
    dropShadowOffsetY:
      Number((getEl("effect-drop-shadow-offset-y") as any).value) ||
      defaultLayerEffectSettings.dropShadowOffsetY,
    dropShadowBlur:
      Number((getEl("effect-drop-shadow-blur") as any).value) ||
      defaultLayerEffectSettings.dropShadowBlur,
    dropShadowColor:
      getColorFromPicker("effect-drop-shadow-color", 1) ||
      defaultLayerEffectSettings.dropShadowColor
  };
}


function applyLayerEffects(layerData: LayerData) {
  const blend = layerData.layerBlendMode || "normal";
  layerData.layer.blendMode = blend;

  const settings = layerData.layerEffectSettings ?? defaultLayerEffectSettings;
  const enabled = layerData.layerEffectsEnabled !== false;
  if (!enabled || isDefaultEffectSettings(settings)) {
    layerData.layer.effect = "";
    return;
  }
  layerData.layer.effect = buildLayerEffectString(settings);
}

function applyStyleSettings(shouldClose: boolean) {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  const styleType = getStyleTypeForLayer(layerData);

  if (styleType === "point") {
    const selected = getSelectedPointStyle();
    layerData.pointStyle = {
      style: selected || defaultPointStyle.style,
      size: Number((getEl("point-size-input") as any).value) || defaultPointStyle.size,
      color: getColorFromPicker("point-fill-color", 1),
      outlineColor: getColorFromPicker("point-outline-color", 1),
      outlineWidth: readNumber((getEl("point-outline-width") as any).value, defaultPointStyle.outlineWidth),
      angle: Number((getEl("point-angle-input") as any).value) || 0,
      xoffset: Number((getEl("point-xoffset-input") as any).value) || 0,
      yoffset: Number((getEl("point-yoffset-input") as any).value) || 0
    };
    updatePointAnimationPreview(
      layerData.pointStyle.color,
      layerData.pointStyle.outlineColor,
      layerData.pointStyle.style
    );
    updatePointStyleOptionColors(layerData.pointStyle.color, layerData.pointStyle.outlineColor);
  } else if (styleType === "polyline") {
    const selected = getSelectedLineStyle();
    layerData.lineStyle = {
      style: selected || defaultLineStyle.style,
      width: readNumber((getEl("line-width-input") as any).value, defaultLineStyle.width),
      color: getColorFromPicker("line-color-input", 1)
    };
    updateLineAnimationPreview(layerData.lineStyle.color, layerData.lineStyle.style);
  } else if (styleType === "polygon") {
    const selectedFill = getSelectedPolygonFillStyle();
    layerData.polygonStyle = {
      style: selectedFill || defaultPolygonStyle.style,
      color: getColorFromPicker("polygon-fill-color", 0.3),
      outlineColor: getColorFromPicker("polygon-outline-color", 1),
      outlineWidth: readNumber((getEl("polygon-outline-width") as any).value, defaultPolygonStyle.outlineWidth),
      outlineStyle: String((getEl("polygon-outline-style-select") as any).value || "solid")
    };
    updatePolygonAnimationPreview(layerData.polygonStyle.color, layerData.polygonStyle.outlineColor);
    updatePolygonStyleOptionColors(layerData.polygonStyle.color, layerData.polygonStyle.outlineColor);
  }

  layerData.layerBlendMode = String((getEl("layer-blend-mode-select") as any).value || "normal");
  layerData.layerEffectSettings = readEffectSettingsFromInputs();
  layerData.layerEffectsEnabled = true;

  if (layerData.type === "feature") {
    layerData.featureLastValue = undefined;
    applyFeatureLayerAnimation(layerData, currentTime);
  } else {
    applyLayerStyle(layerData);
  }
  applyLayerEffects(layerData);
  scheduleProjectSave();
  if (shouldClose) {
    closeModal("style-settings-modal");
  }
}

function toggleStyleEffects() {
  const effectsAdvanced = getEl("style-effects-advanced");
  const effectsToggle = getEl("style-effects-toggle");
  const isOpen = effectsAdvanced.classList.toggle("show");
  effectsToggle.textContent = isOpen ? "Show less" : "Show more";
  effectsToggle.setAttribute("aria-expanded", String(isOpen));
}

function buildPointSymbol(style: PointStyle) {
  const path = pointPathStyles[style.style];
  const outlineWidth = Number(style.outlineWidth) || 0;
  const outline =
    outlineWidth > 0
      ? { color: style.outlineColor, width: outlineWidth }
      : (() => {
          const rgba = parseColorToRgba(style.outlineColor);
          return { color: [rgba.r, rgba.g, rgba.b, 0], width: 0 };
        })();
  const symbol: any = {
    type: "simple-marker",
    style: path ? "path" : style.style,
    color: style.color,
    size: style.size,
    angle: style.angle ?? 0,
    xoffset: style.xoffset ?? 0,
    yoffset: style.yoffset ?? 0,
    outline
  };
  if (path) {
    symbol.path = path;
  }
  return symbol;
}

function applyLayerStyle(layerData: LayerData) {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (layerData.type === "point") {
      const style = layerData.pointStyle ?? defaultPointStyle;
      graphic.symbol = buildPointSymbol(style);
      return;
    }
    const symbol = graphic.symbol?.clone?.();
    if (!symbol) {
      if (layerData.type === "polyline") {
        const style = layerData.lineStyle ?? defaultLineStyle;
        graphic.symbol = buildLineSymbol(style);
      } else if (layerData.type === "polygon") {
        const style = layerData.polygonStyle ?? defaultPolygonStyle;
        const fillColor = parseColorToRgba(style.color);
        const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
        const outlineColor = parseColorToRgba(style.outlineColor);
        const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
        graphic.symbol = {
          type: "simple-fill",
          style: style.style,
          color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha],
          outline: {
            color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
            width: style.outlineWidth,
            style: normalizeLineStyle(style.outlineStyle ?? "solid") as any
          }
        };
      }
      return;
    }

    if (layerData.type === "polyline" && symbol.type === "simple-line") {
      const style = layerData.lineStyle ?? defaultLineStyle;
      applyLineStyle(symbol, style);
    } else if (layerData.type === "polygon" && symbol.type === "simple-fill") {
      const style = layerData.polygonStyle ?? defaultPolygonStyle;
      const fillColor = parseColorToRgba(style.color);
      const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
      const outlineColor = parseColorToRgba(style.outlineColor);
      const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
      symbol.style = style.style;
      symbol.color = [fillColor.r, fillColor.g, fillColor.b, fillAlpha];
      symbol.outline.color = [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha];
      symbol.outline.width = style.outlineWidth;
      symbol.outline.style = normalizeLineStyle(style.outlineStyle ?? "solid") as any;
    }

    graphic.symbol = symbol;
  });
}

function ensureGeometryCache(layerData: LayerData, graphic: any) {
  if (!graphic?.geometry) return;
  if (layerData.type !== "polyline" && layerData.type !== "polygon") return;
  if (!graphic.__originalGeometry) {
    graphic.__originalGeometry = graphic.geometry.clone();
  }
  if (graphic.__densifiedGeometry) {
    delete graphic.__densifiedGeometry;
  }
  if (graphic.__fillMaxInset) {
    delete graphic.__fillMaxInset;
  }
}

function refreshGeometryCache(layerData: LayerData, graphic: any) {
  if (!graphic?.geometry) return;
  if (layerData.type !== "polyline" && layerData.type !== "polygon") return;
  graphic.__originalGeometry = graphic.geometry.clone();
  if (graphic.__densifiedGeometry) {
    delete graphic.__densifiedGeometry;
  }
  if (graphic.__fillMaxInset) {
    delete graphic.__fillMaxInset;
  }
}

function handleSketchUpdate(event: any) {
  if (event.state !== "complete") return;
  const graphics = event.graphics ?? (event.graphic ? [event.graphic] : []);
  graphics.forEach((graphic: any) => {
    const layerData = graphicsLayers.find((entry) => entry.layer === graphic.layer);
    if (!layerData) return;
    refreshGeometryCache(layerData, graphic);
  });
  scheduleProjectSave();
}

function hasPathAnimation(layerData: LayerData) {
  return layerData.animations.some(
    (anim) => anim.type === "draw" || anim.type === "drawReverse" || anim.type === "fill"
  );
}

function getFeatureStyleType(layerData: LayerData) {
  const geometryType = (layerData.layer as FeatureLayer).geometryType;
  if (geometryType === "polyline") return "polyline";
  if (geometryType === "polygon") return "polygon";
  return "point";
}

function getStyleTypeForLayer(layerData: LayerData) {
  if (layerData.type === "feature") {
    return getFeatureStyleType(layerData);
  }
  return layerData.type === "text" ? null : layerData.type;
}

function setStyleSectionVisibility(
  type: "point" | "polyline" | "polygon" | null,
  showFeatureExtras: boolean,
  showEffects: boolean
) {
  const pointSection = getEl("point-style-section");
  const lineSection = getEl("line-style-section");
  const polygonSection = getEl("polygon-style-section");
  const pointAdvanced = getEl("point-advanced-section");
  const polygonOutlineStyle = getEl("polygon-outline-style-row");
  const effectsSection = getEl("layer-effects-section");

  pointSection.style.display = type === "point" ? "block" : "none";
  lineSection.style.display = type === "polyline" ? "block" : "none";
  polygonSection.style.display = type === "polygon" ? "block" : "none";
  effectsSection.style.display = showEffects ? "block" : "none";

  pointAdvanced.style.display = showFeatureExtras && type === "point" ? "block" : "none";
  polygonOutlineStyle.style.display = showFeatureExtras && type === "polygon" ? "block" : "none";
}

function setCalciteValue(element: HTMLElement, value: string | number) {
  (element as any).value = String(value);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (val: number) => Math.max(0, Math.min(255, Math.round(val))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseColorToRgba(color: string) {
  if (!color) {
    return { r: 0, g: 122, b: 194, a: 1 };
  }

  const trimmed = color.trim();
  if (trimmed.startsWith("rgba")) {
    const match = trimmed.match(/rgba\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(",").map((part) => part.trim());
      const [r, g, b, a] = parts;
      return {
        r: Number(r) || 0,
        g: Number(g) || 0,
        b: Number(b) || 0,
        a: clamp(Number(a), 0, 1)
      };
    }
  }

  if (trimmed.startsWith("rgb")) {
    const match = trimmed.match(/rgb\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(",").map((part) => part.trim());
      const [r, g, b] = parts;
      return {
        r: Number(r) || 0,
        g: Number(g) || 0,
        b: Number(b) || 0,
        a: 1
      };
    }
  }

  const hex = trimmed.replace("#", "");
  if (hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }

  return { r: 0, g: 122, b: 194, a: 1 };
}

function setColorPickerValue(colorId: string, color: string, fallbackAlpha: number) {
  const rgba = parseColorToRgba(color);
  const picker = document.getElementById(`${colorId}-picker`) as any;
  const alpha = Number.isFinite(rgba.a) ? rgba.a : fallbackAlpha;
  const safeAlpha = clamp(alpha, 0, 1);
  const hex = rgbToHex(rgba.r, rgba.g, rgba.b);
  const hexAlpha = rgbToHexWithAlpha(rgba.r, rgba.g, rgba.b, safeAlpha);
  if (picker) {
    picker.value = safeAlpha < 1 ? hexAlpha : hex;
  }
  updateColorPickerSwatch(colorId, safeAlpha < 1 ? `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${safeAlpha})` : hex);
}

function rgbToHexWithAlpha(r: number, g: number, b: number, a: number) {
  const clamped = clamp(a, 0, 1);
  const alphaHex = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `${rgbToHex(r, g, b)}${alphaHex}`;
}

function getColorFromPicker(colorId: string, fallbackAlpha: number) {
  const picker = document.getElementById(`${colorId}-picker`) as any;
  const raw = String(picker?.value || "");
  const rgba = parseColorToRgba(raw);
  const alpha = Number.isFinite(rgba.a) ? rgba.a : fallbackAlpha;
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${clamp(alpha, 0, 1)})`;
}

function updateColorPickerSwatch(colorId: string, color: string) {
  const swatch = document.getElementById(colorId) as HTMLElement | null;
  if (!swatch) return;
  swatch.style.background = color;
}

function setPointStyleSelection(value: string) {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  updatePointStyleOptionColors(
    getColorFromPicker("point-fill-color", 1),
    getColorFromPicker("point-outline-color", 1)
  );
  const buttons = Array.from(container.querySelectorAll(".style-option-btn")) as HTMLElement[];
  buttons.forEach((button) => {
    const selected = button.dataset.value === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function getSelectedPointStyle() {
  const selected = document.querySelector("#point-style-options .style-option-btn.selected") as HTMLElement | null;
  return selected?.dataset.value || "";
}

function setPolygonFillStyleSelection(value: string) {
  const container = document.getElementById("polygon-fill-style-options");
  if (!container) return;
  updatePolygonStyleOptionColors(
    getColorFromPicker("polygon-fill-color", 0.3),
    getColorFromPicker("polygon-outline-color", 1)
  );
  const buttons = Array.from(container.querySelectorAll(".style-option-btn")) as HTMLElement[];
  buttons.forEach((button) => {
    const selected = button.dataset.value === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function getSelectedPolygonFillStyle() {
  const selected = document.querySelector(
    "#polygon-fill-style-options .style-option-btn.selected"
  ) as HTMLElement | null;
  return selected?.dataset.value || "";
}

function updateLineAnimationPreview(color: string, style: string) {
  const container = document.getElementById("animation-type-options");
  if (!container) return;
  container.style.setProperty("--preview-color", color);
  const previews = Array.from(container.querySelectorAll(".animation-type-preview--polyline")) as HTMLElement[];
  previews.forEach((preview) => {
    Array.from(preview.classList)
      .filter((cls) => cls.startsWith("line-style-"))
      .forEach((cls) => preview.classList.remove(cls));
    preview.classList.add(`line-style-${style}`);
  });
}

function updatePointAnimationPreview(color: string, outlineColor: string, style: string) {
  const container = document.getElementById("animation-type-options");
  if (!container) return;
  container.style.setProperty("--preview-color", color);
  container.style.setProperty("--preview-outline-color", outlineColor);
  const previews = Array.from(container.querySelectorAll(".animation-type-preview--point")) as HTMLElement[];
  previews.forEach((preview) => {
    Array.from(preview.classList)
      .filter((cls) => cls.startsWith("point-style-"))
      .forEach((cls) => preview.classList.remove(cls));
    preview.classList.add(`point-style-${style}`);
  });

}

function updatePointStyleOptionColors(color: string, outlineColor: string) {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  container.style.setProperty("--preview-point-color", color);
  container.style.setProperty("--preview-point-outline", outlineColor);
}

function updatePolygonAnimationPreview(fillColor: string, outlineColor: string) {
  const container = document.getElementById("animation-type-options");
  if (!container) return;
  container.style.setProperty("--preview-fill-color", fillColor);
  container.style.setProperty("--preview-outline-color", outlineColor);
}

function updatePolygonStyleOptionColors(fillColor: string, outlineColor: string) {
  const container = document.getElementById("polygon-fill-style-options");
  if (!container) return;
  container.style.setProperty("--preview-polygon-fill", fillColor);
  container.style.setProperty("--preview-polygon-outline", outlineColor);
}

function setLineStyleSelection(value: string) {
  const container = document.getElementById("line-style-options");
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll(".style-option-btn")) as HTMLElement[];
  buttons.forEach((button) => {
    const selected = button.dataset.value === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function getSelectedLineStyle() {
  const selected = document.querySelector("#line-style-options .style-option-btn.selected") as HTMLElement | null;
  return selected?.dataset.value || "";
}

function buildLineSymbol(style: LineStyle) {
  const symbol: any = {
    type: "simple-line",
    style: normalizeLineStyle(style.style),
    color: style.color,
    width: style.width
  };
  const marker = buildLineMarker(style.style, style.color);
  symbol.marker = marker ?? null;
  return symbol;
}

function applyLineStyle(symbol: any, style: LineStyle) {
  symbol.style = normalizeLineStyle(style.style);
  symbol.width = style.width;
  symbol.color = style.color;
  symbol.marker = buildLineMarker(style.style, style.color);
}

function normalizeLineStyle(style: string) {
  if (style.startsWith("arrow-")) {
    return "solid";
  }
  return style;
}

function buildLineMarker(style: string, color: string) {
  if (!style.startsWith("arrow-")) return null;
  let placement: "begin" | "end" | "begin-end" = "end";
  if (style === "arrow-start") {
    placement = "begin";
  } else if (style === "arrow-both") {
    placement = "begin-end";
  }

  return {
    type: "line-marker",
    style: "arrow",
    placement,
    color
  };
}

function openTextSettingsModal() {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];

  (getEl("text-content-input") as any).value = layerData.textContent || "Text";
  (getEl("text-size-slider") as any).value = layerData.textSize || 14;
  (getEl("text-color-input") as HTMLInputElement).value = layerData.textColor || "#22323a";
  activeTextLayerIndex = selectedLayerIndex;

  (getEl("text-settings-modal") as any).open = true;
}

function confirmTextSettings() {
  applyTextSettings(true);
  if (pendingTextPlacement && selectedLayerIndex === pendingTextPlacement.layerIndex) {
    beginTextPlacement(pendingTextPlacement.layerIndex);
  }
}

function cancelTextSettings() {
  pendingTextPlacement = null;
  isDrawing = false;
  if (textPlacementHandle) {
    textPlacementHandle.remove();
    textPlacementHandle = null;
  }
  activeTextLayerIndex = null;
  closeModal("text-settings-modal");
}

function applyTextSettings(
  shouldClose: boolean,
  overrides?: { content?: string; size?: number; color?: string }
) {
  const layerIndex = activeTextLayerIndex ?? selectedLayerIndex;
  if (layerIndex < 0) return;
  const layerData = graphicsLayers[layerIndex];
  if (!layerData || layerData.type !== "text") return;

  const contentInput = getEl("text-content-input") as any;
    const rawContent = overrides?.content ?? String(contentInput?.value ?? "");
    const content = sanitizePlainText(rawContent, "Text");
  const sizeInput = getEl("text-size-slider") as any;
  const size = overrides?.size ?? Number(sizeInput?.value);
  const colorInput = getEl("text-color-input") as HTMLInputElement;
  const color = overrides?.color ?? colorInput.value;

  layerData.textContent = content;
  layerData.textSize = Number.isFinite(size) ? size : layerData.textSize;
  layerData.textColor = color;

  layerData.layer.graphics.forEach((graphic: any) => {
    const symbol = graphic.symbol?.clone?.() ?? graphic.symbol;
    if (!symbol) return;
    if (symbol.type !== "text" && symbol.text === undefined) return;
    symbol.text = content;
    if (symbol.font) {
      symbol.font.size = layerData.textSize ?? 14;
    } else {
      symbol.font = { size: layerData.textSize ?? 14, family: "sans-serif" };
    }
    symbol.color = color;
    graphic.symbol = symbol;
  });

  scheduleProjectSave();

  if (shouldClose) {
    activeTextLayerIndex = null;
    closeModal("text-settings-modal");
  }
}

function updateAnimationOptions() {
  if (selectedLayerIndex < 0) {
    setAnimationPanelVisible(false);
    attachAnimationPanelTo();
    return;
  }
  setAnimationPanelVisible(true);
  attachAnimationPanelTo(`animation-settings-host-${selectedLayerIndex}`);
  syncAnimationStartInput();
  const layerData = graphicsLayers[selectedLayerIndex];

  const optionsContainer = document.getElementById("animation-type-options");
  if (!optionsContainer) return;
  optionsContainer.innerHTML = "";

  const types = animationTypes[layerData.type] || animationTypes.point;
  types.forEach((type) => {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "animation-type-option";
    optionButton.dataset.value = type.value;
    optionButton.addEventListener("click", (event) => {
      event.stopPropagation();
      addAnimation(type.value);
    });

    const preview = document.createElement("span");
    preview.className = `animation-type-preview animation-type-preview--${layerData.type} animation-type-preview--${type.value}`;
    optionButton.appendChild(preview);
    optionButton.appendChild(document.createTextNode(type.label));
    optionsContainer.appendChild(optionButton);
  });

  if (layerData.type === "polyline") {
    const style = layerData.lineStyle ?? defaultLineStyle;
    updateLineAnimationPreview(style.color, style.style);
  } else if (layerData.type === "point") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    updatePointAnimationPreview(style.color, style.outlineColor, style.style);
  } else if (layerData.type === "polygon") {
    const style = layerData.polygonStyle ?? defaultPolygonStyle;
    updatePolygonAnimationPreview(style.color, style.outlineColor);
  }

  const featureSettings = getEl("feature-animation-settings");
  if (layerData.type === "feature") {
    featureSettings.style.display = "block";
    const featureAnim = layerData.animations.find(
      (entry) => entry.type === "field" && !isPlaceholderAnimation(entry)
    );
    const featureDuration = featureAnim ? featureAnim.duration : getTimelineDuration();
    const featureStart = featureAnim ? featureAnim.start : 0;
    const durationInput = document.getElementById("animation-duration-input");
    const startInput = document.getElementById("animation-start-input");
    if (durationInput) {
      setCalciteValue(durationInput as HTMLElement, featureDuration);
    }
    if (startInput) {
      setCalciteValue(startInput as HTMLElement, featureStart);
    }
    const fieldSelect = getEl("feature-field-select") as any;
    fieldSelect.innerHTML = "";
    (layerData.featureFields ?? []).forEach((field) => {
      const option = document.createElement("calcite-option");
      option.value = field.name;
      option.textContent = field.name;
      fieldSelect.appendChild(option);
    });
    if (!layerData.featureField && layerData.featureFields?.length) {
      layerData.featureField = layerData.featureFields[0].name;
      layerData.featureFieldType = layerData.featureFields[0].type;
    }
    if (layerData.featureField) {
      fieldSelect.value = layerData.featureField;
    }

    const visualSelect = getEl("feature-visual-select") as any;
    const sizeOption = visualSelect.querySelector("calcite-option[value=\"size\"]") as any;
    const isPolygon = (layerData.layer as FeatureLayer).geometryType === "polygon";
    if (sizeOption) {
      sizeOption.disabled = isPolygon;
      sizeOption.hidden = isPolygon;
    }
    if (isPolygon && (layerData.featureVisualVariable ?? "opacity") === "size") {
      layerData.featureVisualVariable = "opacity";
    }
    visualSelect.value = layerData.featureVisualVariable ?? "opacity";
    const hideNullsSwitch = getEl("feature-hide-nulls") as any;
    hideNullsSwitch.checked = Boolean(layerData.featureHideNulls);
    const fadeOutSwitch = getEl("feature-fade-out") as any;
    fadeOutSwitch.checked = !layerData.featureKeepVisible;
  } else {
    featureSettings.style.display = "none";
  }

  updateAnimationsList();
}

function setAnimationPanelVisible(visible: boolean) {
  const panel = document.getElementById("animation-settings-panel");
  if (!panel) return;
  panel.classList.toggle("show", visible);
  const mobileContainer = document.getElementById("mobile-animation-suggestions");
  if (mobileContainer) {
    mobileContainer.classList.toggle("has-animation-suggestions", visible);
  }
}

function highlightAnimationPanel() {
  const panel = document.getElementById("animation-settings-panel");
  if (!panel || !panel.classList.contains("show")) return;
  panel.classList.remove("is-highlighted");
  void panel.offsetWidth;
  panel.classList.add("is-highlighted");
  if (animationSettingsHighlightTimeout !== null) {
    window.clearTimeout(animationSettingsHighlightTimeout);
  }
  animationSettingsHighlightTimeout = window.setTimeout(() => {
    panel.classList.remove("is-highlighted");
    animationSettingsHighlightTimeout = null;
  }, 800);
}

function attachAnimationPanelTo(hostId?: string) {
  const panel = document.getElementById("animation-settings-panel");
  const stash = document.getElementById("animation-settings-stash");
  if (!panel || !stash) return;
  if (!hostId) {
    stash.appendChild(panel);
    return;
  }
  const host = document.getElementById(hostId);
  if (!host) {
    stash.appendChild(panel);
    return;
  }
  host.appendChild(panel);
}

function updateAnimationsList() {
  const listDiv = document.getElementById("current-animations-list");
  const container = document.getElementById("animations-container");
  if (!listDiv || !container) return;
  const layerData = graphicsLayers[selectedLayerIndex];

  container.innerHTML = "";

  if (!layerData) {
    listDiv.style.display = "none";
    return;
  }

  if (!hasRealAnimations(layerData)) {
    listDiv.style.display = "none";
    return;
  }

  listDiv.style.display = "block";

  layerData.animations.forEach((anim, index) => {
    if (isPlaceholderAnimation(anim)) {
      return;
    }
    const item = document.createElement("div");
    item.className = "animation-item";
    item.innerHTML = `
      <span>${anim.type} (${anim.start}s - ${(anim.start + anim.duration).toFixed(1)}s)</span>
      <span class="animation-item-remove" data-index="${index}">x</span>
    `;
    item
      .querySelector(".animation-item-remove")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        removeAnimation(index);
      });
    container.appendChild(item);
  });
}

function addAnimation(typeOverride?: string) {
  if (selectedLayerIndex < 0) return;

  const type = typeOverride || String(document.querySelector(".animation-type-option")?.getAttribute("data-value") || "");
  const durationInput = document.getElementById("animation-duration-input") as any;
  const startInput = document.getElementById("animation-start-input") as any;
  const duration = durationInput ? Number(durationInput.value) || 1.2 : 1.2;
  let start = startInput ? Number(startInput.value) || 0 : currentTime;

  const layerData = graphicsLayers[selectedLayerIndex];
  if (layerData.type === "feature") {
    layerData.animations = [
      {
        type: "field",
        duration,
        start
      }
    ];
    applyFeatureLayerAnimation(layerData, currentTime);
    updateAnimationsList();
    updateTimeline();
    updateLayersList();
    updateAnimationOptions();
    scrollTimelineToLayer(selectedLayerIndex);
    scheduleProjectSave();
    return;
  }

  layerData.animations = layerData.animations.filter((anim) => !isPlaceholderAnimation(anim));
  if (
    timelineState.selectedTimelineAnimation &&
    timelineState.selectedTimelineAnimation.layerIdx === selectedLayerIndex &&
    layerData.animations[timelineState.selectedTimelineAnimation.animIdx]
  ) {
    const selectedAnim = layerData.animations[timelineState.selectedTimelineAnimation.animIdx];
    if (!isPlaceholderAnimation(selectedAnim)) {
      start = selectedAnim.start + selectedAnim.duration;
    }
  }
  start = timelineController.getNextNonOverlappingStart(layerData, start, duration);
  start = timelineController.snapTimeToGridCeil(start);
  layerData.animations.push({
    type,
    duration,
    start
  });

  updateAnimationsList();
  updateTimeline();
  updateLayersList();
  updateAnimationOptions();
  scrollTimelineToLayer(selectedLayerIndex);
  scheduleProjectSave();
}

function removeAnimation(animIndex: number) {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  layerData.animations.splice(animIndex, 1);
  ensurePlaceholderAnimation(layerData);
  updateAnimationsList();
  updateTimeline();
  if (layerData.type === "feature") {
    applyFeatureLayerAnimation(layerData, currentTime);
  }
  scheduleProjectSave();
}

function removeAnimationAt(layerIdx: number, animIdx: number) {
  const layerData = graphicsLayers[layerIdx];
  if (!layerData) return;
  layerData.animations.splice(animIdx, 1);
  ensurePlaceholderAnimation(layerData);
  updateAnimationsList();
  updateTimeline();
  if (layerData.type === "feature") {
    applyFeatureLayerAnimation(layerData, currentTime);
  }
  scheduleProjectSave();
}

function closeModal(modalId: string) {
  (getEl(modalId) as any).open = false;
}
function resetAnimationGeometryCaches() {
  graphicsLayers.forEach((layerData) => {
    if (layerData.type !== "polyline" && layerData.type !== "polygon") return;
    layerData.layer.graphics.forEach((graphic: any) => {
      if (!graphic?.geometry) return;
      if (!graphic.__originalGeometry) {
        graphic.__originalGeometry = graphic.geometry.clone();
      }
      graphic.geometry = graphic.__originalGeometry.clone();
      if (graphic.__densifiedGeometry) {
        delete graphic.__densifiedGeometry;
      }
      if (graphic.__fillMaxInset) {
        delete graphic.__fillMaxInset;
      }
    });
  });
}

function restoreLayerGeometry(layerData: LayerData) {
  if (layerData.type !== "polyline" && layerData.type !== "polygon") return;
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic?.geometry) return;
    if (graphic.__originalGeometry) {
      graphic.geometry = graphic.__originalGeometry.clone();
    }
    if (graphic.__densifiedGeometry) {
      delete graphic.__densifiedGeometry;
    }
  });
}
