import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Point from "@arcgis/core/geometry/Point";
import Graphic from "@arcgis/core/Graphic";
import Color from "@arcgis/core/Color";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import IntegratedMesh3DTilesLayer from "@arcgis/core/layers/IntegratedMesh3DTilesLayer";
import Portal from "@arcgis/core/portal/Portal";
import PortalQueryParams from "@arcgis/core/portal/PortalQueryParams";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import WebStyleSymbol from "@arcgis/core/symbols/WebStyleSymbol";
import { sqlName } from "@arcgis/core/core/sql";
import Glow from "@arcgis/core/webscene/Glow";

import "gif.js/dist/gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";

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
  HISTORY_LIMIT,
  APP_VERSION,
  defaultLineStyle,
  defaultPointStyle,
  defaultPolygonStyle,
  getAutoPinYOffset,
  normalizeBasemap,
  sanitizePlainText
} from "./app/constants";
import type { ProjectSnapshot } from "./app/constants";
import { createBootController } from "./app/bootstrap";
import type { ArcgisViewHostElement, ViewMode } from "./app/bootstrap";
import {
  arcgisGeometryToGeoJSON,
  geoJSONToArcGISGeometry,
  prepareLayerGeometryForSketch,
  toGeographicGeometry,
  toViewGeometry
} from "./app/geometryInterop";
import "jszip/dist/jszip.min.js";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import ffmpegCoreUrl from "@ffmpeg/core?url";
import ffmpegWasmUrl from "@ffmpeg/core/wasm?url";
let ffmpegClassWorkerUrl: string | null = null;
let ffmpegCoreBaseUrl: string | null = null;
const THUMBTACK_3D_STYLE = "thumbtack3d";
const PULSE_SELECTION_HIGHLIGHT_NAME = "pulse-selection";
const DYNAMIC_WEBSTYLE_STYLE_PREFIX = "model-webstyle::";
const POINT_WEBSTYLE_PRESET_STYLES = [
  "EsriRealisticTransportationStyle",
  "EsriRealisticStreetSceneStyle",
  "EsriThematicShapesStyle",
  "EsriIconsStyle",
  "EsriInfrastructureStyle",
  "EsriRealisticTreesStyle",
  "EsriRealisticFoliageStyle",
  "EsriRealisticSignsandSignalsStyle",
  "EsriRealisticSportsStyle"
] as const;
const pointStyleAliases: Record<string, string> = {
  "model-webstyle": "square",
  "model-car": "phosphor-car",
  "model-bus": "phosphor-bus",
  "model-train": "phosphor-train",
  "model-boat": "phosphor-boat",
  "model-airplane": "phosphor-airplane"
};
const pointModelSymbols3D: Record<string, { styleName: string; name: string }> = {
  "model-car": { styleName: "EsriRealisticTransportationStyle", name: "Audi_A6" },
  "model-bus": { styleName: "EsriRealisticTransportationStyle", name: "Bus" },
  "model-train": { styleName: "EsriRealisticTransportationStyle", name: "High_Speed_Train" },
  "model-boat": { styleName: "EsriRealisticTransportationStyle", name: "Motorboat" },
  "model-airplane": { styleName: "EsriRealisticTransportationStyle", name: "Airplane_Small_Passenger" }
};
const resolvedPointModelSymbolCache = new Map<string, Promise<any | null>>();
const webStyleSymbolNameCache = new Map<string, Promise<string[]>>();
let pointWebStyleCatalogLoadPromise: Promise<void> | null = null;
const loadedPointWebStyleCatalogNames = new Set<string>();
const supportedLinePatternStyles3D = new Set([
  "solid",
  "dash",
  "dot",
  "dash-dot",
  "short-dash",
  "short-dot",
  "short-dash-dot",
  "short-dash-dot-dot",
  "long-dash",
  "long-dash-dot",
  "long-dash-dot-dot",
  "none"
]);
const supportedFillPatternStyles3D = new Set([
  "solid",
  "backward-diagonal",
  "forward-diagonal",
  "diagonal-cross",
  "cross",
  "horizontal",
  "vertical",
  "none"
]);
const supportedFillStyles2D = new Set([
  "solid",
  "backward-diagonal",
  "forward-diagonal",
  "diagonal-cross",
  "cross",
  "horizontal",
  "vertical",
  "none"
]);
const polygonWaterStyles3D: Record<
  string,
  { waterbodySize: "small" | "medium" | "large"; waveStrength: "calm" | "rippled" | "slight" | "moderate"; waveDirection: number | null }
> = {
  "water-calm": {
    waterbodySize: "small",
    waveStrength: "calm",
    waveDirection: null
  },
  "water-rippled": {
    waterbodySize: "medium",
    waveStrength: "rippled",
    waveDirection: 45
  },
  "water-slight": {
    waterbodySize: "medium",
    waveStrength: "slight",
    waveDirection: 120
  },
  "water-moderate": {
    waterbodySize: "large",
    waveStrength: "moderate",
    waveDirection: 180
  }
};

function resolvePointStyleKey(style: string) {
  if (style.startsWith(DYNAMIC_WEBSTYLE_STYLE_PREFIX)) {
    return pointStyleAliases["model-webstyle"] ?? "circle";
  }
  return pointStyleAliases[style] ?? style;
}

function isPointStyle3DOptionValue(style: string) {
  return String(style || "").startsWith("model-");
}

function encodeDynamicWebStyleKey(styleName: string, name: string) {
  return `${DYNAMIC_WEBSTYLE_STYLE_PREFIX}${encodeURIComponent(styleName)}::${encodeURIComponent(name)}`;
}

function parseDynamicWebStyleKey(style: string): { styleName: string; name: string } | null {
  if (!style.startsWith(DYNAMIC_WEBSTYLE_STYLE_PREFIX)) return null;
  const payload = style.slice(DYNAMIC_WEBSTYLE_STYLE_PREFIX.length);
  const separatorIndex = payload.indexOf("::");
  if (separatorIndex < 0) return null;
  try {
    const encodedStyleName = payload.slice(0, separatorIndex);
    const encodedName = payload.slice(separatorIndex + 2);
    const styleName = decodeURIComponent(encodedStyleName || "").trim();
    const name = decodeURIComponent(encodedName || "").trim();
    if (!styleName || !name) return null;
    return { styleName, name };
  } catch {
    return null;
  }
}

const webglAnimationTypes = new Set([
  "neonTrail",
  "glow",
  "glowPulse",
  "electricFlicker",
  "heatHaze",
  "scanline",
  "sparkEmit",
  "weldTrail",
  "flightRoute",
  "flightRouteCartoon",
  "waypointRoute",
  "waypointRouteCartoon",
  "arrowMarch",
  "barrageOfArrows",
  "jitterSketch",
  "noiseDissolve",
  "ghostTrail",
  "dartHit",
  "fireworks",
  "crossetteShell",
  "mineShellCombo",
  "breathe",
  "pixelate",
  "timeGradient",
  "prismShift"
]);

const appendCacheBust = (url: string) => {
  if (!APP_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_VERSION)}`;
};

async function resolveFfmpegWorkerUrl() {
  if (ffmpegClassWorkerUrl) return ffmpegClassWorkerUrl;
  const baseUrl = import.meta.env.BASE_URL || "/";
  const docBase = typeof document !== "undefined" ? document.baseURI : window.location.href;
  const candidates = [
    appendCacheBust(new URL("ffmpeg-worker.js", docBase).toString()),
    appendCacheBust(new URL("ffmpeg-worker.js", new URL(baseUrl, window.location.origin)).toString()),
    appendCacheBust(new URL("/ffmpeg-worker.js", window.location.origin).toString())
  ];
  const failures: Array<{ url: string; status?: number; contentType?: string }> = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && !contentType.includes("text/html")) {
        if (import.meta.env.DEV) {
          console.info("[ffmpeg] worker resolved", url);
        }
        ffmpegClassWorkerUrl = url;
        return url;
      }
      failures.push({ url, status: response.status, contentType });
    } catch {
      // try next candidate
    }
  }
  if (import.meta.env.DEV) {
    console.error("[ffmpeg] worker resolution failed", failures);
  }
  ffmpegClassWorkerUrl = candidates[0];
  return ffmpegClassWorkerUrl;
}

async function resolveFfmpegCoreBaseUrl() {
  if (ffmpegCoreBaseUrl) return ffmpegCoreBaseUrl;
  const baseUrl = import.meta.env.BASE_URL || "/";
  const docBase = typeof document !== "undefined" ? document.baseURI : window.location.href;
  const candidates = [
    new URL("ffmpeg-core/", docBase).toString(),
    new URL("ffmpeg-core/", new URL(baseUrl, window.location.origin)).toString(),
    new URL("/ffmpeg-core/", window.location.origin).toString()
  ];
  const failures: Array<{ url: string; status?: number; contentType?: string }> = [];
  for (const base of candidates) {
    const testUrl = appendCacheBust(new URL("ffmpeg-core.js", base).toString());
    try {
      const response = await fetch(testUrl, { method: "GET", cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && !contentType.includes("text/html")) {
        if (import.meta.env.DEV) {
          console.info("[ffmpeg] core resolved", base);
        }
        ffmpegCoreBaseUrl = base;
        return base;
      }
      failures.push({ url: testUrl, status: response.status, contentType });
    } catch {
      // try next candidate
    }
  }
  if (import.meta.env.DEV) {
    console.error("[ffmpeg] core resolution failed", failures);
  }
  ffmpegCoreBaseUrl = candidates[0];
  return ffmpegCoreBaseUrl;
}
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
  handleExportProject,
  handleImportProjectClick,
  handleProjectFileChange
} from "./app/projectIo";
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
import { getEl } from "./dom";
import type {
  LayerData,
  LayerEffectSettings,
  LayerType,
  LineStyle,
  PointKeyframe,
  PointKeyframeEasing,
  PointStyle
} from "./types";
import { buildAnimationSettingsSnapshot } from "./utils/animationSettings";
import { buildLayerEffectString, defaultLayerEffectSettings, isDefaultEffectSettings } from "./utils/effects";

type ExportState = {
  isExporting: boolean;
};

let view: any = null;
let currentViewMode: ViewMode = "2d";
let isSwitchingViewMode = false;
let map2DHostEl: ArcgisViewHostElement | null = null;
let scene3DHostEl: ArcgisViewHostElement | null = null;
let graphicsLayers: LayerData[] = [];
let selectedLayerIndex = -1;
let animationSettingsHighlightTimeout: number | null = null;
let isPlaying = false;
let animationFrameId: number | null = null;
let currentTime = 0;
let currentLayout: "default" | "mobile" | "tablet" | "custom" = "default";
let hasInitialized = false;
let projectName = "Pulse Project Export";
let isAddingFeatureLayer = false;

let isRestoringProject = false;
let projectSaveTimer: number | null = null;
let thumbtackParallaxRafId: number | null = null;
let pendingTextPlacement: { layerIndex: number } | null = null;
let textPlacementHandle: { remove: () => void } | null = null;
let activeTextLayerIndex: number | null = null;
const aiPromptStorageKey = "pulse.ai.lastPrompt";
const aiModelStorageKey = "pulse.ai.lastModel";
let sketch: SketchViewModel | null = null;
let sketchCreateHandle: { remove: () => void } | null = null;
let sketchUpdateHandle: { remove: () => void } | null = null;
let activeSketchCreateLayerIndex: number | null = null;
let currentAspectRatio: { width: number; height: number } | null = null;
let isRotated = false;
let isDrawing = false;
let compassElement: HTMLElement | null = null;
let compassRotationHandle: { remove: () => void } | null = null;
let compassDebounceId: number | null = null;
let hasCompassActivation = false;
let google3DTilesLayer: IntegratedMesh3DTilesLayer | null = null;
let google3DTilesByokApiKey: string | null = null;
let hasWarnedMissingGoogle3DTilesKey = false;
let isApplyingViewTrackMotion = false;
let clearViewTrackMotionTimer: number | null = null;
let isVertexEditing = false;
let suppressNextMapClick = false;
const exportState: ExportState = { isExporting: false };
let isFrameExporting = false;
let exportDownloadUrl: string | null = null;
let exportDownloadExtension: string | null = null;
let exportDefaultPreview: { type: "image" | "video"; src: string } | null = null;
let exportCancelRequested = false;
let exportResolutionRestore: (() => void) | null = null;
let exportConstraintRestore: (() => void) | null = null;
let activeGifEncoder: any | null = null;
let exportExtentSnapshot: any | null = null;
let preExportExtentSnapshot: any | null = null;
let preExportViewpoint: any | null = null;
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;
let pendingImportType: "geojson" | "csv" | null = null;
let lastPointSizeInput = DEFAULT_PIN_SIZE;
let projectStatusTimer: number | null = null;
let mapContextMenuEl: HTMLElement | null = null;
let mapContextMenuItemsEl: HTMLElement | null = null;
let mapContextMenuTitleEl: HTMLElement | null = null;
let mapContextMenuInitialized = false;
let mapContextMenuContainerEl: HTMLElement | null = null;
let mapContextMenuDragHandle: { remove: () => void } | null = null;
let mapContextMenuWheelHandle: { remove: () => void } | null = null;
let mapContextMenuGlobalHandlersBound = false;
let mapContextMenuScreenPoint: { x: number; y: number } | null = null;
let mapContextMenuMapPoint: Point | null = null;
let mapContextMenuLayerIndex: number | null = null;
let viewExtentWatchHandle: { remove: () => void } | null = null;
let viewClickHandle: { remove: () => void } | null = null;
let viewDoubleClickHandle: { remove: () => void } | null = null;
let isStorageQuotaWarningActive = false;
let worldCountriesLayer: FeatureLayer | null = null;
let worldCountriesLayerPromise: Promise<FeatureLayer> | null = null;

const WORLD_COUNTRIES_GENERALIZED_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0";
const WORLD_COUNTRIES_ATTRIBUTION_FALLBACK =
  "Sources: Esri; Garmin International, Inc.; U.S. Central Intelligence Agency (The World Factbook); National Geographic Society";

type MapContextMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type MapContextMenuEntry = MapContextMenuItem | { type: "divider" };

const CAMERA_FOV_MIN = 20;
const CAMERA_FOV_MAX = 120;
const CAMERA_FX_LEVEL_MIN = 0;
const CAMERA_FX_LEVEL_MAX = 100;
const CAMERA_FX_JITTER_MIN = 0;
const CAMERA_FX_JITTER_MAX = 12;
const SCENE_ALTITUDE_MIN = 0;
const SCENE_ALTITUDE_MAX = 20_000_000;
const SCENE_ONLY_BASEMAPS = new Set([
  "topo-3d",
  "navigation-3d",
  "navigation-dark-3d",
  "osm-3d",
  "gray-3d",
  "dark-gray-3d",
  "streets-3d",
  "streets-dark-3d"
]);
const GOOGLE_3D_TILES_BASEMAPS = new Set(["satellite", "hybrid"]);
const GOOGLE_3D_TILES_LAYER_ID = "google-photorealistic-3d-tiles";
const GOOGLE_3D_TILES_LAYER_TITLE = "Google Photorealistic 3D Tiles";
const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
const GOOGLE_3D_TILES_BETA_NOTICE =
  "Using Google tiles at your own risk - currently in BETA and you need to attribute Google 3D tiles if you export/share the video.";
const VIEW_TRACK_LAYER_ID = "pulse-view-track";
type SceneQualityProfile = "low" | "medium" | "high";
type SceneAtmosphereQuality = "low" | "high";

type CameraStudioSettings = {
  fov: number;
  qualityProfile: SceneQualityProfile;
  atmosphereQuality: SceneAtmosphereQuality;
  glowEnabled: boolean;
  glowIntensity: number;
  cinematicFxEnabled: boolean;
  noiseLevel: number;
  scanlineLevel: number;
  vignetteLevel: number;
  jitter: number;
  chromaticAberration: number;
};

const cameraStudioSettings: CameraStudioSettings = {
  fov: 55,
  qualityProfile: "high",
  atmosphereQuality: "high",
  glowEnabled: true,
  glowIntensity: 1,
  cinematicFxEnabled: false,
  noiseLevel: 42,
  scanlineLevel: 38,
  vignetteLevel: 44,
  jitter: 2.5,
  chromaticAberration: 2.2
};
let cameraKeyframeEasing: PointKeyframeEasing = "linear";

let sceneCameraStudioControlsBound = false;
let sceneCameraFxOverlayCanvas: HTMLCanvasElement | null = null;
let sceneCameraFxOverlayContext: CanvasRenderingContext2D | null = null;
let sceneCameraFxAnimationFrame: number | null = null;
let sceneDaylightPersistenceBound = false;

async function handleAutoSaveAction() {
  await ensureStorageConsent(storageState, openConfirmDialog);
  if (!storageState.localStorageAllowed) return;
  saveProjectToStorage(storageState, storageConfig, projectName, Boolean(view));
  const autoSaveButton = document.getElementById("menu-auto-save-btn");
  if (autoSaveButton) {
    autoSaveButton.style.display = "none";
  }
}
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
  selectedTimelineKeyframe: null,
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
let restartPlaybackFromStartRef: () => void = () => undefined;
let zoomToLayerRef: (layerData: LayerData) => void = () => undefined;
let scheduleProjectSaveRef: () => void = () => undefined;
let buildProjectSnapshotRef: () => ProjectSnapshot | null = () => {
  throw new Error("buildProjectSnapshot not initialized");
};
let zoomToLayersRef: (layers: LayerData[]) => void = () => undefined;
const loadingOverlay = createLoadingOverlayController();
const bootController = createBootController({
  resolveHosts: () => ({
    mapHost: document.querySelector("#arcgisMap") as ArcgisViewHostElement | null,
    sceneHost: document.querySelector("#arcgisScene") as ArcgisViewHostElement | null
  }),
  getCurrentViewMode: () => currentViewMode,
  onHostsResolved: ({ mapHost, sceneHost }) => {
    map2DHostEl = mapHost;
    scene3DHostEl = sceneHost;
  },
  onBootReady: () => {
    loadingOverlay.showLoadingOverlay();
    setMapHostVisibility(currentViewMode);
    setSceneModeButtonLabel();
    updateBasemapOptionsForViewMode(currentViewMode);
    bindSceneDaylightPersistence();
  },
  onViewReady: (nextView, mode) => {
    if (!view || currentViewMode === mode) {
      view = nextView as any;
      if (!hasInitialized) {
        initializeApp();
        loadingOverlay.finishLoadingOverlay();
      } else if (currentViewMode === mode) {
        bindActiveViewHandlers();
      }
    }
  },
  onSceneViewDetected: (sceneView) => {
    if (sceneView) {
      applySceneCameraStudioSettings(sceneView as any);
    }
  },
  onBootFailure: (message) => {
    console.error(message);
  }
});
const timelineController = createTimelineController(timelineState, {
  getEl,
  getGraphicsLayers: () => graphicsLayers,
  getSelectedLayerIndex: () => selectedLayerIndex,
  isPlaying: () => isPlaying,
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
  moveLayer,
  removeLayer,
  duplicateLayer,
  zoomToLayer: (layerData) => zoomToLayerRef(layerData),
  scheduleProjectSave: () => scheduleProjectSaveRef(),
  sanitizePlainText,
  setCalciteValue,
  upsertPointKeyframe,
  upsertLayerKeyframeAtCurrentTime,
  hasPointKeyframes,
  removeAnimationAt,
  removePointKeyframeAt,
  restartPlaybackFromStart: () => restartPlaybackFromStartRef()
});
const {
  updateTimeline,
  handleTimelineDurationChange,
  handleTimelineDurationAutoFit,
  handleTimelineKeyframeEasingChange,
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
restartPlaybackFromStartRef = handlePlayFromStart;
const projectIoConfig = {
  getEl,
  buildProjectSnapshot: () => buildProjectSnapshotRef(),
  getProjectFileName: () => {
    const safeName = sanitizePlainText(projectName, "Pulse Project Export")
      .replace(/[<>:"/\\|?*]/g, "")
      .trim();
    return `${safeName || "Pulse Project Export"}.json`;
  },
  setProjectError,
  applyProjectSnapshot
};
const importConfig: ImportConfig = {
  getView: () => view,
  createGraphicForType,
  createImportedLayer,
  zoomToLayers: (layers) => zoomToLayersRef(layers),
  applyProjectSnapshot,
  setProjectError
};
const animationPlaybackConfig = {
  getView: () => view,
  getGraphicsLayers: () => graphicsLayers,
  defaultPointStyle,
  hasPointKeyframes,
  getPointKeyframeAtTime,
  applyFeatureLayerAnimation,
  isPlaying: () => isPlaying,
  isScrubbingTimeline: () => timelineController.isScrubbingTimeline()
};
const applyAnimationsAtTime = (time: number) => {
  applyAnimationsAtTimeFromState(animationPlaybackConfig, time);
  applyViewTrackAnimationAtTime(time);
  scheduleThumbtackParallaxUpdate();
};
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
  defaultPolygonStyle,
  applyLayerModeProperties
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
  sketch.updateOnGraphicClick = value;
}

function syncSketchModeOptions() {
  if (!sketch) return;
  const enableZ = currentViewMode === "3d";
  const defaultUpdateOptions = sketch.defaultUpdateOptions ?? {};
  sketch.defaultUpdateOptions = {
    ...defaultUpdateOptions,
    enableZ
  };
  const defaultCreateOptions = sketch.defaultCreateOptions ?? {};
  sketch.defaultCreateOptions = {
    ...defaultCreateOptions,
    hasZ: enableZ
  };
}

function getSelectionManager() {
  return (view as any)?.selectionManager ?? null;
}

function ensureSelectionHighlightOptions() {
  if (!view?.highlights?.find || !view?.highlights?.add) return;
  const hasPulseHighlight = view.highlights.find((entry: any) => entry?.name === PULSE_SELECTION_HIGHLIGHT_NAME);
  if (hasPulseHighlight) return;
  view.highlights.add(
    {
      name: PULSE_SELECTION_HIGHLIGHT_NAME,
      color: [10, 76, 102, 1],
      haloOpacity: 0.95,
      fillOpacity: 0.28
    } as any,
    0
  );
}

function syncSelectionManagerSources() {
  const manager = getSelectionManager();
  if (!manager) return;
  ensureSelectionHighlightOptions();
  manager.view = view;
  manager.highlightEnabled = true;
  manager.highlightName = PULSE_SELECTION_HIGHLIGHT_NAME;
  manager.sources = graphicsLayers
    .filter((layerData) => !isViewTrackLayer(layerData))
    .map((layerData) => layerData.layer);
}

function clearSelectionManagerSelection() {
  const manager = getSelectionManager();
  if (!manager) return;
  manager.clear();
}

function setSelectionManagerSelection(layerData: LayerData | null, graphics: any[] = []) {
  const manager = getSelectionManager();
  if (!manager) return;
  syncSelectionManagerSources();
  manager.clear();
  if (!layerData || !graphics.length) return;
  manager.replace(layerData.layer, graphics);
}

function ensureSketchViewModel(layer: GraphicsLayer) {
  if (!view) return null;
  if (!sketch) {
    sketch = new SketchViewModel({
      view,
      layer,
      creationMode: "update"
    });
    sketchUpdateHandle = sketch.on("update", handleSketchUpdate);
    sketchCreateHandle = sketch.on("create", (event: any) => {
      const layerIndex = activeSketchCreateLayerIndex;
      if (!event || layerIndex === null || layerIndex === undefined) return;
      const layerData = graphicsLayers[layerIndex];
      if (!layerData) return;
      if (event.state !== "complete") {
        if (event.state === "cancel") {
          isDrawing = false;
          setDrawInfoBoxVisible(false);
          activeSketchCreateLayerIndex = null;
        }
        return;
      }
      const graphic = event.graphic;
      if (!graphic) return;
      graphic.geometry = toGeographicGeometry(graphic.geometry);
      if (layerData.type === "point") {
        const style = layerData.pointStyle ?? defaultPointStyle;
        graphic.symbol = buildPointSymbolForCurrentView(style);
        if (currentViewMode === "3d" && getPointWebStyleSymbolSpec(style)) {
          void applyPointModelSymbolToLayer(layerData, style);
        }
      } else if (layerData.type === "polyline") {
        const style = layerData.lineStyle ?? defaultLineStyle;
        graphic.symbol = buildLineSymbolForCurrentView(style);
      } else if (layerData.type === "polygon") {
        const style = layerData.polygonStyle ?? defaultPolygonStyle;
        graphic.symbol = buildPolygonSymbolForCurrentView(style);
      }
      ensureGeometryCache(layerData, graphic);
      isDrawing = false;
      setDrawInfoBoxVisible(false);
      selectLayer(layerIndex);
      scheduleProjectSave();
      activeSketchCreateLayerIndex = null;
    });
  } else {
    sketch.view = view;
    sketch.layer = layer;
  }
  setSketchUpdateOnGraphicClick(true);
  updateSnappingOptions();
  syncSketchModeOptions();
  return sketch;
}

function setDrawInfoBoxVisible(visible: boolean) {
  const infoBox = document.getElementById("draw-info-box");
  if (!infoBox) return;
  infoBox.classList.toggle("is-active", visible);
}

function getMapHostElement(mode: ViewMode): any {
  return mode === "3d" ? scene3DHostEl : map2DHostEl;
}

function setMapHostVisibility(mode: ViewMode) {
  const map2D = getMapHostElement("2d") as HTMLElement | null;
  const scene3D = getMapHostElement("3d") as HTMLElement | null;
  const show2D = mode === "2d";
  if (map2D) {
    map2D.toggleAttribute("hidden", !show2D);
    map2D.setAttribute("aria-hidden", show2D ? "false" : "true");
  }
  if (scene3D) {
    scene3D.toggleAttribute("hidden", show2D);
    scene3D.setAttribute("aria-hidden", show2D ? "true" : "false");
  }
}

function setSceneModeButtonLabel() {
  const button = document.getElementById("scene-mode-btn") as any;
  if (!button) return;
  const to3D = currentViewMode === "2d";
  button.textContent = to3D ? "3D Mode" : "2D Mode";
  button.setAttribute("icon-start", to3D ? "globe" : "map");
  button.setAttribute("aria-label", to3D ? "Switch to 3D mode" : "Switch to 2D mode");
  button.setAttribute("title", to3D ? "Switch to 3D mode" : "Switch to 2D mode");
  button.classList.add("show");
}

function getSceneView3D() {
  const sceneView = scene3DHostEl?.view as any;
  if (!sceneView || String(sceneView?.type) !== "3d") {
    return null;
  }
  return sceneView;
}

function createSeededRandom(seed: number) {
  let state = ((Math.floor(seed) >>> 0) ^ 0x9e3779b9) >>> 0;
  if (state === 0) {
    state = 1;
  }
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967295;
  };
}

function shouldRenderSceneCameraFxOverlay() {
  return currentViewMode === "3d" && cameraStudioSettings.cinematicFxEnabled;
}

function ensureSceneCameraFxOverlayCanvas() {
  const wrapper = document.getElementById("map-wrapper");
  if (!wrapper) return null;
  if (!sceneCameraFxOverlayCanvas || !sceneCameraFxOverlayCanvas.isConnected) {
    const canvas = document.createElement("canvas");
    canvas.id = "scene-camera-fx-overlay";
    canvas.className = "scene-camera-fx-overlay";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("hidden", "");
    wrapper.appendChild(canvas);
    sceneCameraFxOverlayCanvas = canvas;
    sceneCameraFxOverlayContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  const width = Math.max(1, Math.round(wrapper.clientWidth || Number((view as any)?.width) || 1));
  const height = Math.max(1, Math.round(wrapper.clientHeight || Number((view as any)?.height) || 1));
  if (sceneCameraFxOverlayCanvas.width !== width) {
    sceneCameraFxOverlayCanvas.width = width;
  }
  if (sceneCameraFxOverlayCanvas.height !== height) {
    sceneCameraFxOverlayCanvas.height = height;
  }
  return sceneCameraFxOverlayCanvas;
}

function drawSceneCameraFxArtifacts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
  options?: { includeTearing?: boolean }
) {
  const noiseStrength = clamp(cameraStudioSettings.noiseLevel / CAMERA_FX_LEVEL_MAX, 0, 1);
  const scanlineStrength = clamp(cameraStudioSettings.scanlineLevel / CAMERA_FX_LEVEL_MAX, 0, 1);
  const vignetteStrength = clamp(cameraStudioSettings.vignetteLevel / CAMERA_FX_LEVEL_MAX, 0, 1);
  const jitterStrength = clamp(cameraStudioSettings.jitter, CAMERA_FX_JITTER_MIN, CAMERA_FX_JITTER_MAX);

  if (noiseStrength > 0.001) {
    const tileSize = 96;
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = tileSize;
    noiseCanvas.height = tileSize;
    const noiseContext = noiseCanvas.getContext("2d", { willReadFrequently: true });
    if (noiseContext) {
      const imageData = noiseContext.createImageData(tileSize, tileSize);
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        const shade = Math.floor(random() * 255);
        data[i] = shade;
        data[i + 1] = shade;
        data[i + 2] = shade;
        data[i + 3] = 255;
      }
      noiseContext.putImageData(imageData, 0, 0);
      const pattern = ctx.createPattern(noiseCanvas, "repeat");
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.04 + noiseStrength * 0.2;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
  }

  if (scanlineStrength > 0.001) {
    const lineSpacing = 2;
    const darkAlpha = Math.min(0.26, 0.03 + scanlineStrength * 0.16);
    ctx.save();
    ctx.strokeStyle = `rgba(0, 0, 0, ${darkAlpha.toFixed(3)})`;
    ctx.lineWidth = 1;
    for (let y = 0.5; y < height; y += lineSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const tintAlpha = Math.min(0.12, 0.01 + scanlineStrength * 0.05);
    ctx.strokeStyle = `rgba(120, 255, 220, ${tintAlpha.toFixed(3)})`;
    for (let y = 1.5; y < height; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (options?.includeTearing && jitterStrength > 0.001) {
    const tears = Math.max(1, Math.round(jitterStrength * 0.7));
    for (let i = 0; i < tears; i += 1) {
      const y = Math.floor(random() * height);
      const bandHeight = Math.max(1, Math.floor(1 + random() * (3 + jitterStrength * 0.8)));
      const alpha = 0.02 + random() * 0.12;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, y, width, bandHeight);
    }
  }

  if (vignetteStrength > 0.001) {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.22,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.7
    );
    const vignetteAlpha = Math.min(0.85, 0.06 + vignetteStrength * 0.64);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteAlpha.toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function applySceneCameraStudioPostFxToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frameSeed: number,
  sourceViewType?: string
) {
  const viewType = String(sourceViewType || currentViewMode);
  if (!cameraStudioSettings.cinematicFxEnabled || viewType !== "3d") return;
  if (width <= 0 || height <= 0) return;

  const random = createSeededRandom(frameSeed);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) return;
  sourceContext.drawImage(ctx.canvas, 0, 0, width, height);

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  const jitterStrength = clamp(cameraStudioSettings.jitter, CAMERA_FX_JITTER_MIN, CAMERA_FX_JITTER_MAX);
  const baseShiftX = jitterStrength > 0.001 ? (random() * 2 - 1) * jitterStrength : 0;
  const baseShiftY = jitterStrength > 0.001 ? (random() * 2 - 1) * jitterStrength * 0.18 : 0;
  ctx.drawImage(sourceCanvas, baseShiftX, baseShiftY, width, height);

  if (jitterStrength > 0.001) {
    const tearCount = Math.max(1, Math.round(jitterStrength * 0.45 + random() * 2));
    for (let i = 0; i < tearCount; i += 1) {
      const bandHeight = Math.max(1, Math.floor(2 + random() * (4 + jitterStrength)));
      const maxY = Math.max(0, height - bandHeight - 1);
      const y = Math.floor(random() * (maxY + 1));
      const shift = (random() * 2 - 1) * (0.8 + jitterStrength * 1.7);
      ctx.drawImage(sourceCanvas, 0, y, width, bandHeight, shift, y, width, bandHeight);
    }
  }

  const chromaticStrength = clamp(cameraStudioSettings.chromaticAberration, CAMERA_FX_JITTER_MIN, CAMERA_FX_JITTER_MAX);
  if (chromaticStrength > 0.001) {
    const shift = 0.4 + chromaticStrength;
    const colorAlpha = Math.min(0.28, 0.04 + chromaticStrength * 0.05);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = colorAlpha;
    ctx.filter = "sepia(1) saturate(6) hue-rotate(-22deg)";
    ctx.drawImage(sourceCanvas, -shift, 0, width, height);
    ctx.filter = "sepia(1) saturate(6) hue-rotate(210deg)";
    ctx.drawImage(sourceCanvas, shift, 0, width, height);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  drawSceneCameraFxArtifacts(ctx, width, height, random, {
    includeTearing: jitterStrength > 0.001
  });

  ctx.restore();
}

function renderSceneCameraFxOverlayFrame() {
  const canvas = ensureSceneCameraFxOverlayCanvas();
  if (!canvas || !sceneCameraFxOverlayContext) return;

  if (!shouldRenderSceneCameraFxOverlay()) {
    canvas.setAttribute("hidden", "");
    sceneCameraFxOverlayContext.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  canvas.removeAttribute("hidden");
  const random = createSeededRandom(performance.now() * 1000);
  sceneCameraFxOverlayContext.clearRect(0, 0, canvas.width, canvas.height);
  drawSceneCameraFxArtifacts(sceneCameraFxOverlayContext, canvas.width, canvas.height, random, {
    includeTearing: true
  });
}

function stopSceneCameraFxOverlayLoop() {
  if (sceneCameraFxAnimationFrame !== null) {
    window.cancelAnimationFrame(sceneCameraFxAnimationFrame);
    sceneCameraFxAnimationFrame = null;
  }
}

function tickSceneCameraFxOverlayLoop() {
  if (!shouldRenderSceneCameraFxOverlay()) {
    stopSceneCameraFxOverlayLoop();
    renderSceneCameraFxOverlayFrame();
    return;
  }
  renderSceneCameraFxOverlayFrame();
  sceneCameraFxAnimationFrame = window.requestAnimationFrame(tickSceneCameraFxOverlayLoop);
}

function updateSceneCameraFxOverlayState() {
  if (!shouldRenderSceneCameraFxOverlay()) {
    stopSceneCameraFxOverlayLoop();
    renderSceneCameraFxOverlayFrame();
    return;
  }
  renderSceneCameraFxOverlayFrame();
  if (sceneCameraFxAnimationFrame === null) {
    sceneCameraFxAnimationFrame = window.requestAnimationFrame(tickSceneCameraFxOverlayLoop);
  }
}

function updateSceneCameraStudioReadouts() {
  const fovReadout = document.getElementById("scene-camera-fov-value");
  if (fovReadout) {
    fovReadout.textContent = `${Math.round(cameraStudioSettings.fov)}deg`;
  }
  const noiseReadout = document.getElementById("scene-camera-fx-noise-value");
  if (noiseReadout) {
    noiseReadout.textContent = `${Math.round(cameraStudioSettings.noiseLevel)}%`;
  }
  const scanlineReadout = document.getElementById("scene-camera-fx-scanline-value");
  if (scanlineReadout) {
    scanlineReadout.textContent = `${Math.round(cameraStudioSettings.scanlineLevel)}%`;
  }
  const vignetteReadout = document.getElementById("scene-camera-fx-vignette-value");
  if (vignetteReadout) {
    vignetteReadout.textContent = `${Math.round(cameraStudioSettings.vignetteLevel)}%`;
  }
  const jitterReadout = document.getElementById("scene-camera-fx-jitter-value");
  if (jitterReadout) {
    jitterReadout.textContent = `${cameraStudioSettings.jitter.toFixed(1)} px`;
  }
  const chromaticReadout = document.getElementById("scene-camera-fx-chromatic-value");
  if (chromaticReadout) {
    chromaticReadout.textContent = `${cameraStudioSettings.chromaticAberration.toFixed(1)} px`;
  }
}

function syncSceneCameraStudioControlValues() {
  const fovSlider = document.getElementById("scene-camera-fov") as HTMLElement | null;
  if (fovSlider) {
    setCalciteValue(fovSlider, Math.round(cameraStudioSettings.fov));
  }
  const qualitySelect = document.getElementById("scene-quality-profile") as HTMLElement | null;
  if (qualitySelect) {
    setCalciteValue(qualitySelect, cameraStudioSettings.qualityProfile);
  }
  const atmosphereQualitySelect = document.getElementById("scene-atmosphere-quality") as HTMLElement | null;
  if (atmosphereQualitySelect) {
    setCalciteValue(atmosphereQualitySelect, cameraStudioSettings.atmosphereQuality);
  }
  const noiseSlider = document.getElementById("scene-camera-fx-noise") as HTMLElement | null;
  if (noiseSlider) {
    setCalciteValue(noiseSlider, Math.round(cameraStudioSettings.noiseLevel));
  }
  const scanlineSlider = document.getElementById("scene-camera-fx-scanline") as HTMLElement | null;
  if (scanlineSlider) {
    setCalciteValue(scanlineSlider, Math.round(cameraStudioSettings.scanlineLevel));
  }
  const vignetteSlider = document.getElementById("scene-camera-fx-vignette") as HTMLElement | null;
  if (vignetteSlider) {
    setCalciteValue(vignetteSlider, Math.round(cameraStudioSettings.vignetteLevel));
  }
  const jitterSlider = document.getElementById("scene-camera-fx-jitter") as HTMLElement | null;
  if (jitterSlider) {
    setCalciteValue(jitterSlider, Number(cameraStudioSettings.jitter.toFixed(1)));
  }
  const chromaticSlider = document.getElementById("scene-camera-fx-chromatic") as HTMLElement | null;
  if (chromaticSlider) {
    setCalciteValue(chromaticSlider, Number(cameraStudioSettings.chromaticAberration.toFixed(1)));
  }
  const cinematicFxSwitch = document.getElementById("scene-camera-fx-enabled") as any;
  if (cinematicFxSwitch) {
    cinematicFxSwitch.checked = cameraStudioSettings.cinematicFxEnabled;
  }
  const glowSwitch = document.getElementById("scene-glow-enabled") as any;
  if (glowSwitch) {
    glowSwitch.checked = cameraStudioSettings.glowEnabled;
  }
  updateSceneCameraStudioReadouts();
}

function applySceneCameraStudioSettings(sceneViewOverride?: any) {
  const sceneView = sceneViewOverride ?? getSceneView3D();
  if (sceneView && String(sceneView.type) === "3d") {
    const constraints = (sceneView as any).constraints;
    const altitude = constraints?.altitude as any;
    const hasAltitudeRange =
      Number(altitude?.min) === SCENE_ALTITUDE_MIN && Number(altitude?.max) === SCENE_ALTITUDE_MAX;
    if (!hasAltitudeRange) {
      (sceneView as any).constraints = {
        ...(constraints ?? {}),
        altitude: {
          ...(typeof altitude === "object" && altitude ? altitude : {}),
          min: SCENE_ALTITUDE_MIN,
          max: SCENE_ALTITUDE_MAX
        }
      };
    }

    const qualityProfile = cameraStudioSettings.qualityProfile;
    if (sceneView.qualityProfile !== qualityProfile) {
      sceneView.qualityProfile = qualityProfile;
    }
    if (scene3DHostEl && scene3DHostEl.getAttribute("quality-profile") !== qualityProfile) {
      scene3DHostEl.setAttribute("quality-profile", qualityProfile);
    }

    const lighting = sceneView.environment?.lighting as any;
    const currentGlowIntensity = Number(lighting?.glow?.intensity);
    const glowIntensity = clamp(readNumber(cameraStudioSettings.glowIntensity, 1), 0, 20);
    cameraStudioSettings.glowIntensity = glowIntensity;
    const shouldEnableGlow = cameraStudioSettings.glowEnabled;
    if (lighting) {
      if (
        shouldEnableGlow &&
        (!lighting.glow ||
          !Number.isFinite(currentGlowIntensity) ||
          Math.abs(currentGlowIntensity - glowIntensity) > 0.001)
      ) {
        // Update only the glow property so current sun/virtual mode and time remain unchanged.
        lighting.glow = new Glow({ intensity: glowIntensity });
      } else if (!shouldEnableGlow && lighting.glow) {
        lighting.glow = null;
      }
    } else if (shouldEnableGlow) {
      sceneView.environment = {
        ...(sceneView.environment || {}),
        lighting: {
          type: "sun",
          glow: new Glow({ intensity: glowIntensity })
        }
      };
    }

    const atmosphereQuality = cameraStudioSettings.atmosphereQuality;
    const atmosphere = sceneView.environment?.atmosphere as any;
    if (atmosphere && typeof atmosphere === "object") {
      if (String(atmosphere.quality || "") !== atmosphereQuality) {
        try {
          atmosphere.quality = atmosphereQuality;
        } catch {
          // ignore environments that do not expose atmosphere quality
        }
      }
    } else {
      sceneView.environment = {
        ...(sceneView.environment || {}),
        atmosphere: {
          ...(typeof atmosphere === "object" && atmosphere ? atmosphere : {}),
          quality: atmosphereQuality
        }
      };
    }

    const clampedFov = clamp(cameraStudioSettings.fov, CAMERA_FOV_MIN, CAMERA_FOV_MAX);
    cameraStudioSettings.fov = clampedFov;
    const camera = sceneView.camera?.clone?.();
    if (camera) {
      const existingFov = Number(camera.fov);
      if (!Number.isFinite(existingFov) || Math.abs(existingFov - clampedFov) > 0.01) {
        camera.fov = clampedFov;
        sceneView.camera = camera;
      }
    }
  }
  updateSceneCameraFxOverlayState();
}

function captureSceneSettingsSnapshot(sceneViewOverride?: any) {
  const sceneView = sceneViewOverride ?? getSceneView3D();
  if (!sceneView || String(sceneView.type) !== "3d") return null;
  const lighting = sceneView.environment?.lighting as any;
  const lightingSnapshot: Record<string, unknown> = {};
  const lightingType = String(lighting?.type || "");
  if (lightingType === "sun" || lightingType === "virtual") {
    lightingSnapshot.type = lightingType;
  }
  const lightingDateRaw = lighting?.date;
  const lightingDate = lightingDateRaw instanceof Date ? lightingDateRaw : new Date(lightingDateRaw);
  if (Number.isFinite(lightingDate.getTime())) {
    lightingSnapshot.date = lightingDate.toISOString();
  }
  const displayUTCOffset = Number(lighting?.displayUTCOffset);
  if (Number.isFinite(displayUTCOffset)) {
    lightingSnapshot.displayUTCOffset = displayUTCOffset;
  }
  if (typeof lighting?.directShadowsEnabled === "boolean") {
    lightingSnapshot.directShadowsEnabled = Boolean(lighting.directShadowsEnabled);
  }
  const glowIntensity = Number(lighting?.glow?.intensity);
  if (Number.isFinite(glowIntensity)) {
    lightingSnapshot.glowIntensity = glowIntensity;
  }
  return {
    cameraStudio: { ...cameraStudioSettings },
    lighting: Object.keys(lightingSnapshot).length ? lightingSnapshot : undefined
  };
}

function applySceneSettingsSnapshot(sceneSettings: any, sceneViewOverride?: any) {
  if (!sceneSettings || typeof sceneSettings !== "object") return;
  const cameraStudio = sceneSettings.cameraStudio;
  if (cameraStudio && typeof cameraStudio === "object") {
    cameraStudioSettings.fov = clamp(
      readNumber(cameraStudio.fov, cameraStudioSettings.fov),
      CAMERA_FOV_MIN,
      CAMERA_FOV_MAX
    );
    cameraStudioSettings.qualityProfile = readSceneQualityProfile(
      cameraStudio.qualityProfile,
      cameraStudioSettings.qualityProfile
    );
    cameraStudioSettings.atmosphereQuality = readSceneAtmosphereQuality(
      cameraStudio.atmosphereQuality,
      cameraStudioSettings.atmosphereQuality
    );
    if (typeof cameraStudio.glowEnabled === "boolean") {
      cameraStudioSettings.glowEnabled = cameraStudio.glowEnabled;
    }
    cameraStudioSettings.glowIntensity = clamp(
      readNumber(cameraStudio.glowIntensity, cameraStudioSettings.glowIntensity),
      0,
      20
    );
    if (typeof cameraStudio.cinematicFxEnabled === "boolean") {
      cameraStudioSettings.cinematicFxEnabled = cameraStudio.cinematicFxEnabled;
    }
    cameraStudioSettings.noiseLevel = clamp(
      readNumber(cameraStudio.noiseLevel, cameraStudioSettings.noiseLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    cameraStudioSettings.scanlineLevel = clamp(
      readNumber(cameraStudio.scanlineLevel, cameraStudioSettings.scanlineLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    cameraStudioSettings.vignetteLevel = clamp(
      readNumber(cameraStudio.vignetteLevel, cameraStudioSettings.vignetteLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    cameraStudioSettings.jitter = clamp(
      readNumber(cameraStudio.jitter, cameraStudioSettings.jitter),
      CAMERA_FX_JITTER_MIN,
      CAMERA_FX_JITTER_MAX
    );
    cameraStudioSettings.chromaticAberration = clamp(
      readNumber(cameraStudio.chromaticAberration, cameraStudioSettings.chromaticAberration),
      CAMERA_FX_JITTER_MIN,
      CAMERA_FX_JITTER_MAX
    );
  }

  const sceneView = sceneViewOverride ?? getSceneView3D();
  if (sceneView && String(sceneView.type) === "3d") {
    const lighting = sceneView.environment?.lighting as any;
    const savedLighting = sceneSettings.lighting;
    if (lighting && savedLighting && typeof savedLighting === "object") {
      const savedType = String(savedLighting.type || "");
      if (savedType === "sun" || savedType === "virtual") {
        lighting.type = savedType;
      }
      const savedGlowIntensity = Number(savedLighting.glowIntensity);
      if (Number.isFinite(savedGlowIntensity)) {
        cameraStudioSettings.glowIntensity = clamp(savedGlowIntensity, 0, 20);
      }
      if (typeof savedLighting.directShadowsEnabled === "boolean") {
        lighting.directShadowsEnabled = Boolean(savedLighting.directShadowsEnabled);
      }
      if ("displayUTCOffset" in savedLighting && "displayUTCOffset" in lighting) {
        const offset = Number(savedLighting.displayUTCOffset);
        if (Number.isFinite(offset)) {
          lighting.displayUTCOffset = offset;
        }
      }
      const effectiveLightingType = String(lighting?.type || savedType || "");
      if (effectiveLightingType !== "virtual") {
        const savedDateRaw = savedLighting.date;
        const savedDate = savedDateRaw ? new Date(String(savedDateRaw)) : null;
        if (savedDate && Number.isFinite(savedDate.getTime()) && "date" in lighting) {
          lighting.date = savedDate;
        }
      }
    }
  }
  syncSceneCameraStudioControlValues();
  applySceneCameraStudioSettings(sceneView);
}

function bindSceneCameraStudioControls() {
  if (sceneCameraStudioControlsBound) return;
  const fovSlider = document.getElementById("scene-camera-fov") as any;
  const qualitySelect = document.getElementById("scene-quality-profile") as any;
  const atmosphereQualitySelect = document.getElementById("scene-atmosphere-quality") as any;
  const glowSwitch = document.getElementById("scene-glow-enabled") as any;
  const cinematicFxSwitch = document.getElementById("scene-camera-fx-enabled") as any;
  const noiseSlider = document.getElementById("scene-camera-fx-noise") as any;
  const scanlineSlider = document.getElementById("scene-camera-fx-scanline") as any;
  const vignetteSlider = document.getElementById("scene-camera-fx-vignette") as any;
  const jitterSlider = document.getElementById("scene-camera-fx-jitter") as any;
  const chromaticSlider = document.getElementById("scene-camera-fx-chromatic") as any;
  if (!fovSlider || !qualitySelect || !atmosphereQualitySelect || !glowSwitch) return;
  if (!cinematicFxSwitch || !noiseSlider || !scanlineSlider || !vignetteSlider) return;
  if (!jitterSlider || !chromaticSlider) return;
  sceneCameraStudioControlsBound = true;

  syncSceneCameraStudioControlValues();

  const handleFovUpdate = () => {
    cameraStudioSettings.fov = clamp(
      readNumber(fovSlider.value, cameraStudioSettings.fov),
      CAMERA_FOV_MIN,
      CAMERA_FOV_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleNoiseUpdate = () => {
    cameraStudioSettings.noiseLevel = clamp(
      readNumber(noiseSlider.value, cameraStudioSettings.noiseLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleScanlineUpdate = () => {
    cameraStudioSettings.scanlineLevel = clamp(
      readNumber(scanlineSlider.value, cameraStudioSettings.scanlineLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleVignetteUpdate = () => {
    cameraStudioSettings.vignetteLevel = clamp(
      readNumber(vignetteSlider.value, cameraStudioSettings.vignetteLevel),
      CAMERA_FX_LEVEL_MIN,
      CAMERA_FX_LEVEL_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleJitterUpdate = () => {
    cameraStudioSettings.jitter = clamp(
      readNumber(jitterSlider.value, cameraStudioSettings.jitter),
      CAMERA_FX_JITTER_MIN,
      CAMERA_FX_JITTER_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleChromaticUpdate = () => {
    cameraStudioSettings.chromaticAberration = clamp(
      readNumber(chromaticSlider.value, cameraStudioSettings.chromaticAberration),
      CAMERA_FX_JITTER_MIN,
      CAMERA_FX_JITTER_MAX
    );
    updateSceneCameraStudioReadouts();
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleQualityChange = () => {
    cameraStudioSettings.qualityProfile = readSceneQualityProfile(
      qualitySelect.value,
      cameraStudioSettings.qualityProfile
    );
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleAtmosphereQualityChange = () => {
    cameraStudioSettings.atmosphereQuality = readSceneAtmosphereQuality(
      atmosphereQualitySelect.value,
      cameraStudioSettings.atmosphereQuality
    );
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleGlowToggle = () => {
    cameraStudioSettings.glowEnabled = Boolean(glowSwitch.checked);
    applySceneCameraStudioSettings();
    scheduleProjectSave();
  };

  const handleCinematicFxToggle = () => {
    cameraStudioSettings.cinematicFxEnabled = Boolean(cinematicFxSwitch.checked);
    applySceneCameraStudioSettings();
    updatePrimaryActionsState();
    scheduleProjectSave();
  };

  fovSlider.addEventListener("calciteSliderInput", handleFovUpdate);
  fovSlider.addEventListener("calciteSliderChange", handleFovUpdate);
  qualitySelect.addEventListener("calciteSelectChange", handleQualityChange);
  atmosphereQualitySelect.addEventListener("calciteSelectChange", handleAtmosphereQualityChange);
  glowSwitch.addEventListener("calciteSwitchChange", handleGlowToggle);
  noiseSlider.addEventListener("calciteSliderInput", handleNoiseUpdate);
  noiseSlider.addEventListener("calciteSliderChange", handleNoiseUpdate);
  scanlineSlider.addEventListener("calciteSliderInput", handleScanlineUpdate);
  scanlineSlider.addEventListener("calciteSliderChange", handleScanlineUpdate);
  vignetteSlider.addEventListener("calciteSliderInput", handleVignetteUpdate);
  vignetteSlider.addEventListener("calciteSliderChange", handleVignetteUpdate);
  jitterSlider.addEventListener("calciteSliderInput", handleJitterUpdate);
  jitterSlider.addEventListener("calciteSliderChange", handleJitterUpdate);
  chromaticSlider.addEventListener("calciteSliderInput", handleChromaticUpdate);
  chromaticSlider.addEventListener("calciteSliderChange", handleChromaticUpdate);
  cinematicFxSwitch.addEventListener("calciteSwitchChange", handleCinematicFxToggle);
}

function bindSceneDaylightPersistence() {
  if (sceneDaylightPersistenceBound) return;
  const daylightEl = document.getElementById("scene-daylight");
  if (!daylightEl) return;
  sceneDaylightPersistenceBound = true;
  daylightEl.addEventListener("arcgisPropertyChange", () => {
    scheduleProjectSave();
  });
}

function ensureWorldElevationGround(map: any) {
  if (!map) return;
  const groundAny = map.ground as any;
  const hasGroundLayers =
    Boolean(groundAny) &&
    Number(groundAny?.layers?.length ?? groundAny?.layers?.items?.length ?? 0) > 0;
  if (!groundAny || !hasGroundLayers) {
    map.ground = "world-elevation";
  }
}

async function waitForHostView(mode: ViewMode) {
  const host = getMapHostElement(mode);
  if (!host) return null;
  if (host.view) return host.view;
  return await new Promise<any>((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(host.view ?? null), 8000);
    const onReady = (event: any) => {
      window.clearTimeout(timeoutId);
      host.removeEventListener("arcgisViewReadyChange", onReady);
      resolve(event?.target?.view ?? host.view ?? null);
    };
    host.addEventListener("arcgisViewReadyChange", onReady);
  });
}

function ensureCompassElement() {
  const nextCompass =
    (document.getElementById(currentViewMode === "3d" ? "scene-compass" : "map-compass") as HTMLElement | null) ??
    null;
  if (compassElement && compassElement !== nextCompass) {
    compassElement.setAttribute("hidden", "");
    compassElement.setAttribute("aria-hidden", "true");
  }
  compassElement = nextCompass;
  if (compassElement) {
    if (view) {
      (compassElement as any).view = view;
    }
    compassElement.setAttribute("hidden", "");
    compassElement.setAttribute("aria-hidden", "true");
  }
}

function updateCompassVisibility(rotation: number) {
  ensureCompassElement();
  if (!compassElement) return;
  const rotated = Math.abs(rotation) > 0.5;
  if (rotated) {
    hasCompassActivation = true;
  }
  if (hasCompassActivation && rotated) {
    compassElement.removeAttribute("hidden");
    compassElement.setAttribute("aria-hidden", "false");
  } else {
    compassElement.setAttribute("hidden", "");
    compassElement.setAttribute("aria-hidden", "true");
  }
}

function scheduleCompassVisibility(rotation: number) {
  if (compassDebounceId) {
    window.clearTimeout(compassDebounceId);
  }
  compassDebounceId = window.setTimeout(() => {
    updateCompassVisibility(rotation);
  }, 150);
}

function setupCompassWatcher(force = false) {
  if (!view) return;
  if (force && compassRotationHandle) {
    compassRotationHandle.remove();
    compassRotationHandle = null;
  }
  if (compassRotationHandle) return;
  ensureCompassElement();
  if (compassElement && (compassElement as any).view !== view) {
    (compassElement as any).view = view;
  }
  compassRotationHandle = reactiveUtils.watch(() => view.rotation, (rotation) => {
    scheduleCompassVisibility(Number(rotation) || 0);
  });
  scheduleCompassVisibility(Number(view.rotation) || 0);
}

function setDrawInfoBoxText(text: string) {
  const infoBox = document.getElementById("draw-info-box");
  if (!infoBox) return;
  infoBox.textContent = text;
}

function closeMapContextMenu() {
  if (!mapContextMenuEl) return;
  mapContextMenuEl.classList.remove("is-open");
  mapContextMenuEl.setAttribute("aria-hidden", "true");
  mapContextMenuMapPoint = null;
  mapContextMenuLayerIndex = null;
  mapContextMenuScreenPoint = null;
}

function getViewScreenPoint(event: MouseEvent) {
  if (!view) return null;
  const container = view.container as HTMLElement | null;
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

async function getHitLayerIndex(screenPoint: { x: number; y: number }) {
  if (!view) return -1;
  const response = await view.hitTest(screenPoint as any);
  const hit = response.results.find((result: any) =>
    graphicsLayers.some((layerData) => layerData.layer === result.graphic?.layer)
  );
  if (!hit?.graphic?.layer) return -1;
  return graphicsLayers.findIndex((layerData) => layerData.layer === hit.graphic.layer);
}

function renderMapContextMenu(title: string, entries: MapContextMenuEntry[]) {
  if (!mapContextMenuEl || !mapContextMenuItemsEl || !mapContextMenuTitleEl) return;
  const itemsEl = mapContextMenuItemsEl;
  mapContextMenuTitleEl.textContent = title;
  itemsEl.innerHTML = "";
  const isDividerEntry = (entry: MapContextMenuEntry): entry is { type: "divider" } =>
    "type" in entry && entry.type === "divider";
  entries.forEach((entry) => {
    if (isDividerEntry(entry)) {
      const divider = document.createElement("div");
      divider.className = "map-context-menu-divider";
      itemsEl.appendChild(divider);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-context-menu-item";
    button.textContent = entry.label;
    if (entry.danger) {
      button.classList.add("danger");
    }
    if (entry.disabled) {
      button.disabled = true;
    }
    button.addEventListener("click", () => {
      if (button.disabled) return;
      closeMapContextMenu();
      entry.onSelect();
    });
    itemsEl.appendChild(button);
  });
}

function positionMapContextMenu(clientX: number, clientY: number) {
  if (!mapContextMenuEl) return;
  const container = document.getElementById("map-container");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const padding = 12;
  let left = clientX - rect.left;
  let top = clientY - rect.top;

  mapContextMenuEl.style.left = `${left}px`;
  mapContextMenuEl.style.top = `${top}px`;

  const menuWidth = mapContextMenuEl.offsetWidth;
  const menuHeight = mapContextMenuEl.offsetHeight;
  const maxLeft = rect.width - menuWidth - padding;
  const maxTop = rect.height - menuHeight - padding;

  left = Math.max(padding, Math.min(left, maxLeft));
  top = Math.max(padding, Math.min(top, maxTop));
  mapContextMenuEl.style.left = `${left}px`;
  mapContextMenuEl.style.top = `${top}px`;
}

function openMapContextMenu(
  clientX: number,
  clientY: number,
  title: string,
  entries: MapContextMenuEntry[]
) {
  if (!mapContextMenuEl) return;
  renderMapContextMenu(title, entries);
  mapContextMenuEl.classList.add("is-open");
  mapContextMenuEl.setAttribute("aria-hidden", "false");
  positionMapContextMenu(clientX, clientY);
}

async function handleMapContextMenu(event: MouseEvent) {
  if (!view || isDrawing || isVertexEditing) return;
  event.preventDefault();
  event.stopPropagation();
  const screenPoint = getViewScreenPoint(event);
  if (!screenPoint) return;

  const mapPoint = view.toMap(screenPoint as any) as Point | null;
  mapContextMenuMapPoint = mapPoint;
  mapContextMenuScreenPoint = { x: event.clientX, y: event.clientY };

  const layerIndex = await getHitLayerIndex(screenPoint);
  mapContextMenuLayerIndex = layerIndex >= 0 ? layerIndex : null;

  if (layerIndex >= 0) {
    const layerData = graphicsLayers[layerIndex];
    const isLockedLayer = isViewTrackLayer(layerData);
    const lockedBottomIndex = graphicsLayers.findIndex((layer) => isViewTrackLayer(layer));
    const lowestMovableIndex = lockedBottomIndex >= 0 ? lockedBottomIndex + 1 : 0;
    const isTopLayer = layerIndex === graphicsLayers.length - 1;
    const isBottomLayer = layerIndex === lowestMovableIndex;
    const styleLabel = layerData.type === "text" ? "Text settings" : "Style & effects";
    const entries: MapContextMenuEntry[] = [
      {
        label: "Select layer",
        onSelect: () => selectLayer(layerIndex)
      },
      {
        label: styleLabel,
        onSelect: () => {
          selectLayer(layerIndex, false);
          if (layerData.type === "text") {
            openTextSettingsModal();
          } else {
            openStyleModal();
          }
        },
        disabled: isLockedLayer
      },
      {
        label: "Zoom to layer",
        onSelect: () => zoomToLayer(layerData),
        disabled: isLockedLayer
      },
      {
        label: "Send to top",
        onSelect: () => moveLayerToIndex(layerIndex, graphicsLayers.length - 1),
        disabled: isLockedLayer || isTopLayer
      },
      {
        label: "Send to bottom",
        onSelect: () => moveLayerToIndex(layerIndex, lowestMovableIndex),
        disabled: isLockedLayer || isBottomLayer
      },
      { type: "divider" },
      {
        label: "Duplicate layer",
        onSelect: () => void duplicateLayer(layerIndex),
        disabled: isLockedLayer
      },
      {
        label: "Delete layer",
        onSelect: () => void removeLayer(layerIndex),
        disabled: isLockedLayer,
        danger: true
      }
    ];
    openMapContextMenu(event.clientX, event.clientY, layerData.name || "Layer", entries);
    return;
  }

  const hasMapPoint = Boolean(mapPoint);
  const entries: MapContextMenuEntry[] = [
    {
      label: "Add point",
      onSelect: () => void startDrawing("point")
    },
    {
      label: "Add line",
      onSelect: () => void startDrawing("polyline")
    },
    {
      label: "Add polygon",
      onSelect: () => void startDrawing("polygon")
    },
    {
      label: "Add country polygon (generalized)",
      onSelect: () => void addCountryPolygonFromPoint(mapPoint),
      disabled: !hasMapPoint
    },
    {
      label: "Add text",
      onSelect: () => void startDrawing("text")
    },
    { type: "divider" },
    {
      label: "Center map here",
      onSelect: () => {
        if (!view || !mapPoint) return;
        view.goTo({ center: mapPoint });
      },
      disabled: !hasMapPoint
    },
    {
      label: "Zoom in",
      onSelect: () => {
        if (!view) return;
        view.goTo({ center: mapPoint ?? view.center, zoom: view.zoom + 1 });
      }
    },
    {
      label: "Zoom out",
      onSelect: () => {
        if (!view) return;
        view.goTo({ center: mapPoint ?? view.center, zoom: view.zoom - 1 });
      }
    }
  ];

  openMapContextMenu(event.clientX, event.clientY, "Map", entries);
}

function initMapContextMenu() {
  if (!mapContextMenuInitialized) {
    mapContextMenuInitialized = true;
    mapContextMenuEl = document.getElementById("map-context-menu");
    mapContextMenuItemsEl = document.getElementById("map-context-menu-items");
    mapContextMenuTitleEl = document.getElementById("map-context-menu-title");
  }
  if (!mapContextMenuEl || !mapContextMenuItemsEl || !mapContextMenuTitleEl || !view) return;
  if (!mapContextMenuGlobalHandlersBound) {
    mapContextMenuGlobalHandlersBound = true;
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 2) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("#map-context-menu")) return;
        closeMapContextMenu();
      },
      true
    );
    window.addEventListener("blur", closeMapContextMenu);
  }
  if (mapContextMenuContainerEl) {
    mapContextMenuContainerEl.removeEventListener("contextmenu", handleMapContextMenu);
  }
  mapContextMenuContainerEl = view.container as HTMLElement | null;
  mapContextMenuContainerEl?.addEventListener("contextmenu", handleMapContextMenu);
  if (mapContextMenuDragHandle) {
    mapContextMenuDragHandle.remove();
    mapContextMenuDragHandle = null;
  }
  if (mapContextMenuWheelHandle) {
    mapContextMenuWheelHandle.remove();
    mapContextMenuWheelHandle = null;
  }
  mapContextMenuDragHandle = view.on("drag", closeMapContextMenu);
  mapContextMenuWheelHandle = view.on("mouse-wheel", closeMapContextMenu);
}

function updateSnappingOptions() {
  if (!view) return;
  const sources = graphicsLayers
    .filter((layerData) => !isViewTrackLayer(layerData))
    .map((layerData) => ({ layer: layerData.layer }));
  const viewAny = view as any;
  if (viewAny?.snappingOptions) {
    viewAny.snappingOptions.enabled = true;
    viewAny.snappingOptions.featureSources = sources;
  }
  if (sketch?.snappingOptions) {
    sketch.snappingOptions.enabled = true;
    sketch.snappingOptions.featureSources = sources as any;
  }
  syncSelectionManagerSources();
}

function resetSketchForCurrentView() {
  if (!sketch) return;
  try {
    sketch.cancel();
  } catch {
    // ignore
  }
  sketch.destroy?.();
  sketch = null;
  if (sketchUpdateHandle) {
    sketchUpdateHandle.remove();
    sketchUpdateHandle = null;
  }
  if (sketchCreateHandle) {
    sketchCreateHandle.remove();
    sketchCreateHandle = null;
  }
  activeSketchCreateLayerIndex = null;
  isVertexEditing = false;
}

function bindActiveViewHandlers() {
  if (!view) return;
  if (viewExtentWatchHandle) {
    viewExtentWatchHandle.remove();
    viewExtentWatchHandle = null;
  }
  viewExtentWatchHandle = reactiveUtils.watch(() => view.extent, () => {
    if (!isApplyingViewTrackMotion && !isPlaying && !exportState.isExporting) {
      scheduleProjectSave();
    }
    scheduleThumbtackParallaxUpdate();
  });
  if (viewClickHandle) {
    viewClickHandle.remove();
    viewClickHandle = null;
  }
  if (viewDoubleClickHandle) {
    viewDoubleClickHandle.remove();
    viewDoubleClickHandle = null;
  }
  viewClickHandle = view.on("click", handleMapClick);
  viewDoubleClickHandle = view.on("double-click", handleMapDoubleClick);
  setupCompassWatcher(true);
  initMapContextMenu();
  updateSnappingOptions();
  updateExportResolutionLabel(view as any);
}

function applyLayerModeProperties(layerData: LayerData) {
  if (!layerData?.layer) return;
  if (currentViewMode !== "3d") {
    if ((layerData.layer as any).elevationInfo) {
      (layerData.layer as any).elevationInfo = null;
    }
    return;
  }
  const layerAny = layerData.layer as any;
  const geometryType = layerData.type === "feature" ? String(layerAny.geometryType || "") : layerData.type;
  if (geometryType === "polygon") {
    const polygonOffset = Number(layerData.polygonZOffset);
    layerAny.elevationInfo = {
      mode: "relative-to-ground",
      offset: Number.isFinite(polygonOffset) ? polygonOffset : 0
    };
    return;
  }
  if (geometryType === "polyline") {
    layerAny.elevationInfo =
      layerData.type === "polyline"
        ? { mode: "relative-to-ground", offset: 1 }
        : { mode: "on-the-ground" };
    return;
  }
  if (geometryType === "point" || geometryType === "multipoint") {
    const followTerrain = layerData.pointFollowTerrain3D !== false;
    layerAny.elevationInfo = followTerrain
      ? { mode: "relative-to-ground", offset: 0.5 }
      : { mode: "absolute-height" };
    return;
  }
  layerAny.elevationInfo = { mode: "relative-to-ground", offset: 0.5 };
}

function applyViewModeToAllLayers() {
  graphicsLayers.forEach((layerData) => {
    applyLayerModeProperties(layerData);
    if (layerData.type === "feature") {
      layerData.featureLastValue = undefined;
      applyFeatureLayerAnimation(layerData, currentTime);
      applyLayerEffects(layerData);
      return;
    }
    if (layerData.type === "text") {
      applyTextSymbols(layerData);
      applyLayerEffects(layerData);
      return;
    }
    applyLayerStyle(layerData);
    applyLayerEffects(layerData);
  });
}

async function setViewMode(mode: ViewMode, options?: { skipSave?: boolean; preserveViewpoint?: boolean }) {
  if (isSwitchingViewMode) return;
  if (mode === currentViewMode && view) {
    setSceneModeButtonLabel();
    updateBasemapOptionsForViewMode(mode);
    ensureViewTrackLayer();
    syncViewTrackLayerName(mode);
    updateLayersList();
    updateTimeline();
    updateAnimationOptions();
    filterPointStyles();
    updateGoogle3DTilesToggleVisibility();
    ensureGoogle3DTilesLayerState();
    return;
  }
  const targetHost = getMapHostElement(mode);
  if (!targetHost) return;
  isSwitchingViewMode = true;
  try {
    closeMapContextMenu();
    const previousViewpoint =
      options?.preserveViewpoint === false ? null : view?.viewpoint?.clone?.() ?? null;
    const sharedMap = view?.map ?? map2DHostEl?.map ?? scene3DHostEl?.map ?? null;
    if (sharedMap) {
      if (mode === "3d") {
        ensureWorldElevationGround(sharedMap);
      }
      if (map2DHostEl) {
        map2DHostEl.map = sharedMap;
      }
      if (scene3DHostEl) {
        scene3DHostEl.map = sharedMap;
      }
    }
    setMapHostVisibility(mode);
    const targetView = await waitForHostView(mode);
    if (!targetView) return;
    if (sharedMap && targetView.map !== sharedMap) {
      targetView.map = sharedMap;
    }
    if (previousViewpoint && typeof targetView.goTo === "function") {
      await targetView.goTo(previousViewpoint, { animate: false }).catch(() => undefined);
    }
    view = targetView;
    currentViewMode = mode;
    setSceneModeButtonLabel();
    updateBasemapOptionsForViewMode(mode);
    if (mode === "3d") {
      applySceneCameraStudioSettings(targetView);
    } else {
      applySceneCameraStudioSettings(getSceneView3D());
    }
    resetSketchForCurrentView();
    bindActiveViewHandlers();
    ensureViewTrackLayer();
    syncViewTrackLayerName(mode);
    applyViewModeToAllLayers();
    updateLayersList();
    updateTimeline();
    updateAnimationOptions();
    filterPointStyles();
    if (selectedLayerIndex >= 0) {
      selectLayer(selectedLayerIndex, false);
    }
    updateBasemapBackgroundControls();
    updateGoogle3DTilesToggleVisibility();
    ensureGoogle3DTilesLayerState();
    scheduleBasemapLabelsVisibility();
    if (!options?.skipSave) {
      scheduleProjectSave();
    }
  } finally {
    isSwitchingViewMode = false;
  }
}

async function toggleViewMode() {
  const nextMode: ViewMode = currentViewMode === "2d" ? "3d" : "2d";
  await setViewMode(nextMode);
}

const buildProjectSnapshot = () => {
  const snapshot = buildProjectSnapshotFromState({
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
  if (snapshot?.properties?._pulse?.app) {
    const sceneSettings = captureSceneSettingsSnapshot();
    if (sceneSettings) {
      (snapshot.properties._pulse.app as any).scene = sceneSettings;
    }
  }
  return snapshot;
};
buildProjectSnapshotRef = buildProjectSnapshot;

async function applyProjectSnapshot(snapshot: unknown) {
  const snapshotMode = (snapshot as any)?.properties?._pulse?.app?.mode;
  if (snapshotMode === "2d" || snapshotMode === "3d") {
    await setViewMode(snapshotMode, { skipSave: true, preserveViewpoint: false });
  }
  if (view) {
    const overlayLayers = graphicsLayers.flatMap((layerData) => getLayerOverlayLayers(layerData));
    if (overlayLayers.length) {
      view.map.removeMany(overlayLayers);
    }
    graphicsLayers.forEach((layerData) => {
      delete (layerData as any).__arrowLayer;
      delete (layerData as any).__barrageLayer;
      delete (layerData as any).__dartLayer;
      delete (layerData as any).__weldSparkLayer;
      delete (layerData as any).__flightLayer;
      delete (layerData as any).__waypointLayer;
      delete (layerData as any).__fireworksLayer;
    });
  }
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
  applyViewTrackKeyframesSnapshot((snapshot as any)?.properties?._pulse?.app?.viewTrackKeyframes);
  syncViewTrackLayerName(currentViewMode);
  applySceneSettingsSnapshot((snapshot as any)?.properties?._pulse?.app?.scene, getSceneView3D());
  applyViewTrackAnimationAtTime(currentTime);
  applyViewModeToAllLayers();
  updateSnappingOptions();
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  clearSelectionManagerSelection();
  setSceneModeButtonLabel();
}

const storageConfig = {
  setProjectStatus,
  setProjectError,
  setProjectStorageWarning,
  updateRecentProjectsUI,
  applyProjectSnapshot,
  buildProjectSnapshot: () => buildProjectSnapshotRef()
};
const historyConfig: HistoryConfig = {
  buildProjectSnapshot: () => buildProjectSnapshotRef(),
  applyProjectSnapshot,
  updateHistoryControls,
  setProjectError,
  isRestoringProject: () => isRestoringProject,
  getHistoryLimit: () => (isStorageQuotaWarningActive ? 2 : HISTORY_LIMIT)
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
  if (projectStatusTimer) {
    window.clearTimeout(projectStatusTimer);
  }
  const applyStatus = () => {
    const label = state === "saved" ? "Saved" : "Edited";
    const textEl = badge.querySelector<HTMLElement>("[data-status-text]");
    if (textEl) {
      textEl.textContent = label;
    } else {
      badge.textContent = label;
    }
    badge.setAttribute("aria-label", label);
    badge.setAttribute("title", label);
    badge.classList.toggle("project-status-dirty", state === "dirty");
  };
  if (state === "saved") {
    projectStatusTimer = window.setTimeout(() => {
      projectStatusTimer = null;
      applyStatus();
    }, 250);
  } else {
    applyStatus();
  }
}

function setProjectStorageWarning(visible: boolean) {
  const warning = document.getElementById("project-status-warning");
  if (!warning) return;
  warning.toggleAttribute("hidden", !visible);
  isStorageQuotaWarningActive = visible;
  if (visible) {
    historyState.historyStack = historyState.historyStack.slice(-2);
    historyState.redoStack = historyState.redoStack.slice(-2);
    updateHistoryControls();
  }
  if (visible) {
    const message = "Storage full. Export to GeoJSON to save.";
    warning.setAttribute("title", message);
    warning.setAttribute("aria-label", message);
  }
}

function updateAutoSaveButtonVisibility() {
  const autoSaveButton = document.getElementById("menu-auto-save-btn");
  if (!autoSaveButton) return;
  autoSaveButton.style.display = storageState.localStorageAllowed ? "none" : "";
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

function flashProjectError(message: string, duration = 3200) {
  setProjectError(message);
  window.setTimeout(() => {
    const current = document.getElementById("project-error")?.textContent?.trim() || "";
    if (current === message) {
      setProjectError(null);
    }
  }, duration);
}

function resolveCountryName(attributes?: Record<string, any>) {
  if (!attributes) return "";
  const candidates = new Set([
    "country",
    "country_name",
    "countryname",
    "country_aff",
    "countryaff",
    "admin",
    "name",
    "name_long",
    "name_en",
    "cntry_name",
    "cntryname"
  ]);
  const entries = Object.entries(attributes);
  for (const [key, value] of entries) {
    if (!value || typeof value !== "string") continue;
    const normalized = key.replace(/\s+/g, "").toLowerCase();
    if (candidates.has(normalized)) {
      return value.trim();
    }
  }
  for (const [, value] of entries) {
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
  }
  return "";
}

async function getWorldCountriesLayer() {
  if (worldCountriesLayer) return worldCountriesLayer;
  if (!worldCountriesLayerPromise) {
    const layer = new FeatureLayer({
      url: WORLD_COUNTRIES_GENERALIZED_URL
    });
    worldCountriesLayerPromise = layer
      .load()
      .then(() => {
        worldCountriesLayer = layer;
        return layer;
      })
      .catch((error) => {
        worldCountriesLayerPromise = null;
        throw error;
      });
  }
  return worldCountriesLayerPromise;
}

async function addCountryPolygonFromPoint(mapPoint: Point | null) {
  if (!view || !mapPoint) {
    flashProjectError("Click on the map to choose a location first.");
    return;
  }
  try {
    const countryLayer = await getWorldCountriesLayer();
    const result = await countryLayer.queryFeatures({
      geometry: mapPoint,
      spatialRelationship: "intersects",
      outFields: ["*"],
      returnGeometry: true,
      outSpatialReference: view.spatialReference,
      num: 1
    });

    const feature = result?.features?.[0];
    const geometry = feature?.geometry;
    if (!feature || !geometry || geometry.type !== "polygon") {
      flashProjectError("No country found there. Try clicking on land.");
      return;
    }

    const countryName = resolveCountryName(feature.attributes);
    const layerName = countryName ? `Country: ${countryName}` : "Country polygon";
    const graphic = createGraphicForType("polygon", geometry, feature.attributes);
    const layerData = createImportedLayer("polygon", layerName, [graphic]);
    if (!layerData) return;

    const attribution =
      String((countryLayer as any).attribution || "").trim() ||
      String((countryLayer as any).copyrightText || "").trim() ||
      WORLD_COUNTRIES_ATTRIBUTION_FALLBACK;
    layerData.customAttribution = attribution;
    layerData.layer.attribution = attribution;
    scheduleExportAttributionRefresh();
  } catch (error) {
    console.error("Failed to fetch country geometry", error);
    flashProjectError("Could not fetch country geometry. Please try again.");
  }
}

function setGifExportStatus(message: string | null, allowHtml = false) {
  const statusEl = document.getElementById("gif-export-status");
  if (!statusEl) return;
  if (!message) {
    statusEl.textContent = "";
    statusEl.innerHTML = "";
    return;
  }
  if (allowHtml) {
    statusEl.innerHTML = message;
  } else {
    statusEl.textContent = message;
  }
}

function setExportButtonDisabled(disabled: boolean) {
  const button = document.getElementById("export-action-btn");
  if (!button) return;
  button.toggleAttribute("disabled", disabled);
}

function isExportCancelError(error: unknown) {
  if (exportCancelRequested) return true;
  return error instanceof Error && error.message === "Export cancelled";
}

function clearGifThumbnails() {
  const container = document.getElementById("gif-thumbnails");
  if (!container) return;
  container.innerHTML = "";
}

function hideGifPreview() {
  const preview = document.getElementById("gif-preview");
  if (preview) {
    preview.classList.remove("show");
    preview.classList.remove("video");
  }
  const img = document.getElementById("gif-preview-img") as HTMLImageElement | null;
  if (img) {
    img.src = "";
    delete img.dataset.gifSrc;
  }
  const video = document.getElementById("gif-preview-video") as HTMLVideoElement | null;
  if (video) {
    video.pause();
    video.src = "";
  }
}

function setGifPreview(src: string, mode: "gif" | "frame", type: "image" | "video" = "image") {
  const preview = document.getElementById("gif-preview");
  const img = document.getElementById("gif-preview-img") as HTMLImageElement | null;
  const video = document.getElementById("gif-preview-video") as HTMLVideoElement | null;
  if (preview) {
    preview.classList.add("show");
    preview.setAttribute("data-preview-mode", mode);
    preview.classList.toggle("video", type === "video");
  }
  if (img) img.src = type === "image" ? src : "";
  if (video) {
    video.onerror = null;
    if (type === "video") {
      video.onerror = () => {
        if (exportDownloadExtension !== "mp4") return;
        setGifExportStatus(
          'looks like codecs are not available. Try refreshing the page and exporting again.',
          true
        );
      };
      video.src = src;
      video.load();
    } else {
      video.pause();
      video.src = "";
    }
  }
  const closeBtn = document.getElementById("gif-preview-close");
  if (closeBtn) {
    closeBtn.style.display = mode === "frame" ? "inline-flex" : "none";
  }
}

function resetGifPreviewToGif() {
  if (!exportDefaultPreview) return;
  document.querySelectorAll("#gif-thumbnails .gif-thumb.is-selected").forEach((thumb) => {
    thumb.classList.remove("is-selected");
  });
  setGifPreview(exportDefaultPreview.src, "gif", exportDefaultPreview.type);
}

function clearGifDownloadUrl() {
  if (exportDownloadUrl) {
    URL.revokeObjectURL(exportDownloadUrl);
    exportDownloadUrl = null;
  }
  exportDownloadExtension = null;
  exportDefaultPreview = null;
  const downloadBtn = document.getElementById("gif-download-btn");
  if (downloadBtn) {
    downloadBtn.textContent = "Download";
    downloadBtn.setAttribute("disabled", "");
  }
}

function getGifExportFileName() {
  const safeName = sanitizePlainText(projectName, "pulse-recording")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
  const extension = exportDownloadExtension || "gif";
  return `${safeName || "pulse-recording"}.${extension}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

const waitForNextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const waitForMs = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });

const getScreenshotDataUrl = (screenshot: any) => {
  const direct =
    (typeof screenshot?.dataUrl === "string" && screenshot.dataUrl) ||
    (typeof screenshot?.screenshot?.dataUrl === "string" && screenshot.screenshot.dataUrl) ||
    "";
  if (direct) {
    return direct;
  }
  const raw =
    (typeof screenshot?.data === "string" && screenshot.data) ||
    (typeof screenshot?.screenshot?.data === "string" && screenshot.screenshot.data) ||
    "";
  if (!raw.length) return "";
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
};

const takeScreenshotDataUrl = async (viewAny: any, width: number, height: number, attempt = 0) => {
  const screenshot = await viewAny.takeScreenshot({
    format: "png",
    width,
    height
  });
  const dataUrl = getScreenshotDataUrl(screenshot);
  if (dataUrl) return dataUrl;
  if (attempt >= 3) {
    throw new Error("Empty screenshot data");
  }
  await new Promise((resolve) => window.setTimeout(resolve, 200));
  await reactiveUtils.whenOnce(() => !viewAny.updating);
  return takeScreenshotDataUrl(viewAny, width, height, attempt + 1);
};

function getGifExportFps() {
  const input = document.getElementById("gif-fps-input") as any;
  const raw = Number(input?.value);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(60, Math.round(raw)));
}

function getExportQualityLevel() {
  const slider = document.getElementById("export-quality-slider") as any;
  const raw = Number(slider?.value);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(4, Math.round(raw)));
}

function updateExportControlsForFormat() {
  const formatSelect = document.getElementById("export-format-select") as any;
  const format = String(formatSelect?.value || "gif");
  const qualitySlider = document.getElementById("export-quality-slider");
  if (qualitySlider) {
    const disableQuality = format === "png";
    qualitySlider.toggleAttribute("disabled", disableQuality);
  }
}

function setExportPreviewFullscreen(isFullscreen: boolean) {
  const modal = document.getElementById("export-preview-modal");
  if (modal) {
    modal.classList.toggle("export-preview-fullscreen", isFullscreen);
  }
}

function getDefaultExportResolution(viewAny: any) {
  const mapWrapper = document.getElementById("map-wrapper");
  const width = Math.round(Number(viewAny?.width || mapWrapper?.clientWidth || viewAny?.container?.clientWidth || 0));
  const height = Math.round(Number(viewAny?.height || mapWrapper?.clientHeight || viewAny?.container?.clientHeight || 0));
  return { width, height };
}

function updateExportResolutionLabel(viewAny: any) {
  const select = document.getElementById("export-resolution-select") as any;
  if (!select) return;
  const option = select.querySelector('calcite-option[value="default"]') as HTMLElement | null;
  if (!option) return;
  const { width, height } = getDefaultExportResolution(viewAny);
  if (width && height) {
    option.textContent = `Default (current map resolution ${width} x ${height})`;
  } else {
    option.textContent = "Default (current map resolution)";
  }
}

function updateBasemapOptionsForViewMode(mode: ViewMode = currentViewMode) {
  const select = document.getElementById("basemap-select") as any;
  if (!select) return;
  const isSceneMode = mode === "3d";
  const sceneOnlyOptions = Array.from(
    select.querySelectorAll("calcite-option[data-scene-only]")
  ) as Array<HTMLElement & { disabled?: boolean }>;
  sceneOnlyOptions.forEach((option) => {
    option.toggleAttribute("hidden", !isSceneMode);
    option.setAttribute("aria-hidden", isSceneMode ? "false" : "true");
    option.disabled = !isSceneMode;
  });
  const selectedValue = String(select.value || "");
  if (!isSceneMode && SCENE_ONLY_BASEMAPS.has(selectedValue)) {
    select.value = "gray-vector";
    if (view?.map) {
      handleBasemapChange();
    }
  }
}

function getBasemapBackgroundColor() {
  const input = document.getElementById("basemap-bg-color") as HTMLInputElement | null;
  const raw = input?.value || "#ffffff";
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#ffffff";
}

function getBasemapBackgroundTransparent() {
  const input = document.getElementById("basemap-bg-transparent") as HTMLInputElement | null;
  return Boolean(input?.checked);
}

function handleBasemapBackgroundChange(forcedColor?: string) {
  const select = document.getElementById("basemap-select") as any;
  const rawValue = String(select?.value || "");
  const normalized = normalizeBasemap(rawValue || "gray-vector");
  const isNone = rawValue === "none" || normalized === "none";
  if (!isNone) {
    resetBasemapBackgroundColor();
    return;
  }
  if (getBasemapBackgroundTransparent()) {
    applyBasemapBackgroundColor("transparent");
  } else {
    const color = forcedColor || getBasemapBackgroundColor();
    applyBasemapBackgroundColor(color);
  }
  requestAnimationFrame(() => {
    if (getBasemapBackgroundTransparent()) {
      applyBasemapBackgroundColor("transparent");
    } else {
      const color = forcedColor || getBasemapBackgroundColor();
      applyBasemapBackgroundColor(color);
    }
  });
}

function getBasemapLabelsVisible() {
  const input = document.getElementById("basemap-labels-toggle") as HTMLInputElement | null;
  return input ? Boolean(input.checked) : true;
}

function isSceneOnlyBasemapSelected() {
  const select = document.getElementById("basemap-select") as any;
  const selected = normalizeBasemap(String(select?.value || "gray-vector"));
  return SCENE_ONLY_BASEMAPS.has(selected);
}

function getGoogle3DTilesApiKey() {
  return google3DTilesByokApiKey;
}

function promptForGoogle3DTilesByokApiKey() {
  const acknowledged = window.confirm(
    `${GOOGLE_3D_TILES_BETA_NOTICE}\n\nPress OK to continue and enter your Google Maps API key.`
  );
  if (!acknowledged) {
    return null;
  }
  const raw = window.prompt(
    "Enter your Google Maps API key for Google 3D Tiles (BYOK). It is stored for this browser session only.",
    google3DTilesByokApiKey || ""
  );
  const apiKey = String(raw || "").trim();
  if (!apiKey) {
    return null;
  }
  google3DTilesByokApiKey = apiKey;
  return apiKey;
}

function getGoogle3DTilesToggle() {
  return document.getElementById("basemap-google-3d-tiles-toggle") as any;
}

function isGoogle3DTilesBasemapEligible() {
  const select = document.getElementById("basemap-select") as any;
  const selected = normalizeBasemap(String(select?.value || "gray-vector"));
  return GOOGLE_3D_TILES_BASEMAPS.has(selected);
}

function shouldEnableGoogle3DTilesLayer() {
  const toggle = getGoogle3DTilesToggle();
  return currentViewMode === "3d" && isGoogle3DTilesBasemapEligible() && Boolean(toggle?.checked);
}

function applyGoogle3DTilesCustomParameters(layer: IntegratedMesh3DTilesLayer, apiKey: string) {
  (layer as any).customParameters = {
    key: apiKey,
    f: null
  };
  (layer as any).refresh?.();
}

function removeGoogle3DTilesLayer() {
  if (!view?.map) return;
  const mapLayer = view.map.findLayerById?.(GOOGLE_3D_TILES_LAYER_ID);
  if (mapLayer) {
    view.map.remove(mapLayer);
  }
}

function ensureGoogle3DTilesLayerState() {
  if (!view?.map) return;
  if (!shouldEnableGoogle3DTilesLayer()) {
    removeGoogle3DTilesLayer();
    return;
  }

  const apiKey = getGoogle3DTilesApiKey();
  if (!apiKey) {
    if (!hasWarnedMissingGoogle3DTilesKey) {
      hasWarnedMissingGoogle3DTilesKey = true;
      console.warn("Google 3D Tiles is enabled but no BYOK API key is available for this session.");
    }
    const toggle = getGoogle3DTilesToggle();
    if (toggle) {
      toggle.checked = false;
    }
    removeGoogle3DTilesLayer();
    return;
  }

  hasWarnedMissingGoogle3DTilesKey = false;
  if (!google3DTilesLayer) {
    google3DTilesLayer = new IntegratedMesh3DTilesLayer({
      id: GOOGLE_3D_TILES_LAYER_ID,
      title: GOOGLE_3D_TILES_LAYER_TITLE,
      url: GOOGLE_3D_TILES_ROOT_URL,
      listMode: "hide"
    });
    applyGoogle3DTilesCustomParameters(google3DTilesLayer, apiKey);
  } else {
    const currentKey = String(((google3DTilesLayer as any).customParameters as any)?.key || "");
    if (currentKey !== apiKey) {
      applyGoogle3DTilesCustomParameters(google3DTilesLayer, apiKey);
    }
  }

  const existing = view.map.findLayerById?.(GOOGLE_3D_TILES_LAYER_ID);
  if (existing && existing !== google3DTilesLayer) {
    view.map.remove(existing);
  }
  if (!view.map.layers?.includes?.(google3DTilesLayer)) {
    view.map.add(google3DTilesLayer, 0);
  }
}

function updateGoogle3DTilesToggleVisibility() {
  const toggleWrap = document.querySelector(".basemap-google-3d-toggle") as HTMLElement | null;
  const toggle = getGoogle3DTilesToggle();
  if (!toggleWrap || !toggle) return;
  const isEligible = currentViewMode === "3d" && isGoogle3DTilesBasemapEligible();

  if (isEligible) {
    toggleWrap.removeAttribute("hidden");
    toggleWrap.setAttribute("aria-hidden", "false");
  } else {
    toggleWrap.setAttribute("hidden", "");
    toggleWrap.setAttribute("aria-hidden", "true");
  }

  toggle.disabled = false;
  toggleWrap.setAttribute("title", GOOGLE_3D_TILES_BETA_NOTICE);
}

function getBasemapReferenceLayers(basemap: any) {
  if (!basemap?.referenceLayers) return [] as any[];
  const layers: any[] = [];
  basemap.referenceLayers.forEach?.((layer: any) => {
    layers.push(layer);
  });
  return layers;
}

function getBasemapBaseLayers(basemap: any) {
  if (!basemap?.baseLayers) return [] as any[];
  const layers: any[] = [];
  basemap.baseLayers.forEach?.((layer: any) => {
    layers.push(layer);
  });
  return layers;
}

function isLikely3DBasemapLayer(layer: any) {
  const layerType = String(layer?.type || "").toLowerCase();
  if (layerType.includes("scene") || layerType.includes("integrated") || layerType.includes("point-cloud")) {
    return false;
  }
  const descriptor = [
    layer?.title,
    layer?.id,
    layer?.portalItem?.title,
    layer?.portalItem?.id,
    layer?.url
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /(building|buildings|3d|mesh|integrated mesh|voxel)/.test(descriptor);
}

function isLikelyLabelLayer(layer: any) {
  if (isLikely3DBasemapLayer(layer)) {
    return false;
  }
  const descriptor = [
    layer?.title,
    layer?.id,
    layer?.portalItem?.title,
    layer?.portalItem?.id,
    layer?.url
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /(label|labels|annotation|reference|place|places|boundar)/.test(descriptor);
}

function getBasemapLabelReferenceLayers(basemap: any) {
  const referenceLayers = getBasemapReferenceLayers(basemap);
  const baseLayers = getBasemapBaseLayers(basemap);
  const likelyLabelRefLayers = referenceLayers.filter((layer) => isLikelyLabelLayer(layer));
  const likelyLabelBaseLayers = baseLayers.filter((layer) => isLikelyLabelLayer(layer));
  if (likelyLabelRefLayers.length > 0 || likelyLabelBaseLayers.length > 0) {
    return [...likelyLabelRefLayers, ...likelyLabelBaseLayers];
  }

  const safeReferenceLayers = referenceLayers.filter((layer) => !isLikely3DBasemapLayer(layer));
  if (safeReferenceLayers.length > 0) {
    return safeReferenceLayers;
  }

  // For non-scene basemaps, preserve legacy behavior.
  if (!isSceneOnlyBasemapSelected()) {
    return referenceLayers;
  }
  return [];
}

function applyBasemapLabelsVisibility() {
  if (!view?.map?.basemap) return;
  const basemap = view.map.basemap;
  const visible = getBasemapLabelsVisible();
  const targetLayers = getBasemapLabelReferenceLayers(basemap);
  targetLayers.forEach((layer: any) => {
    layer.visible = visible;
  });
}

function updateBasemapLabelsToggleVisibility() {
  const toggleWrap = document.querySelector(".basemap-labels-toggle") as HTMLElement | null;
  if (!toggleWrap) return;
  const basemap = view?.map?.basemap;
  const layerCount = getBasemapLabelReferenceLayers(basemap).length;
  const supportsLabels = Boolean(basemap) && layerCount > 0;
  if (supportsLabels) {
    toggleWrap.removeAttribute("hidden");
    toggleWrap.setAttribute("aria-hidden", "false");
  } else {
    toggleWrap.setAttribute("hidden", "");
    toggleWrap.setAttribute("aria-hidden", "true");
  }
}

function scheduleBasemapLabelsVisibility() {
  if (!view?.map) return;
  const basemap = view.map.basemap;
  if (!basemap) {
    updateBasemapLabelsToggleVisibility();
    return;
  }
  const apply = () => {
    updateBasemapLabelsToggleVisibility();
    applyBasemapLabelsVisibility();
  };
  const loadResult = basemap?.load?.();
  if (loadResult && typeof (loadResult as Promise<void>).then === "function") {
    (loadResult as Promise<void>).then(apply).catch(apply);
  } else {
    apply();
  }
}

function applyBasemapBackgroundColor(color: string) {
  if (!view) return;
  const viewAny = view as any;
  const resolvedColor = color === "transparent" ? new Color([0, 0, 0, 0]) : new Color(color);
  if (viewAny.background && "color" in viewAny.background) {
    viewAny.background.color = resolvedColor;
  } else {
    viewAny.background = { type: "color", color: resolvedColor };
  }
  viewAny.background = { type: "color", color: resolvedColor };
  if ("environment" in viewAny) {
    const env = viewAny.environment || {};
    viewAny.environment = { ...env, background: { type: "color", color: resolvedColor } };
  }
  const mapWrapper = document.getElementById("map-wrapper");
  if (mapWrapper) {
    mapWrapper.style.background = color;
    mapWrapper.style.setProperty("background-color", color, "important");
  }
  const hosts = [document.getElementById("arcgisMap"), document.getElementById("arcgisScene")].filter(Boolean);
  hosts.forEach((host) => {
    (host as HTMLElement).style.background = color;
    (host as HTMLElement).style.setProperty("background-color", color, "important");
    const surface = findInShadow(host as HTMLElement, ".esri-view-surface");
    if (surface) {
      surface.style.background = color;
    }
    const root = findInShadow(host as HTMLElement, ".esri-view-root");
    if (root) {
      root.style.background = color;
    }
  });
  const container = viewAny?.container as HTMLElement | null;
  if (container) {
    container.style.background = color;
  }
  viewAny.requestRender?.();
}

function resetBasemapBackgroundColor() {
  const mapWrapper = document.getElementById("map-wrapper");
  if (mapWrapper) {
    mapWrapper.style.background = "";
    mapWrapper.style.removeProperty("background-color");
  }
  const hosts = [document.getElementById("arcgisMap"), document.getElementById("arcgisScene")].filter(Boolean);
  hosts.forEach((host) => {
    (host as HTMLElement).style.background = "";
    (host as HTMLElement).style.removeProperty("background-color");
    const surface = findInShadow(host as HTMLElement, ".esri-view-surface");
    if (surface) {
      surface.style.background = "";
    }
    const root = findInShadow(host as HTMLElement, ".esri-view-root");
    if (root) {
      root.style.background = "";
    }
  });
  const container = (view as any)?.container as HTMLElement | null;
  if (container) {
    container.style.background = "";
  }
}

  function updateBasemapBackgroundControls() {
    const select = document.getElementById("basemap-select") as any;
    const picker = document.getElementById("basemap-bg-picker");
    const rawValue = String(select?.value || "");
    const normalized = normalizeBasemap(rawValue || "gray-vector");
    const isNone = rawValue === "none" || normalized === "none";
  if (picker) {
    if (isNone) {
      picker.classList.add("show");
      (picker as HTMLElement).hidden = false;
      (picker as HTMLElement).style.display = "inline-flex";
    } else {
      picker.classList.remove("show");
      (picker as HTMLElement).hidden = true;
      (picker as HTMLElement).style.display = "none";
    }
    if (isNone) {
      picker.removeAttribute("aria-hidden");
    } else {
      picker.setAttribute("aria-hidden", "true");
    }
  }
  handleBasemapBackgroundChange();
}

function updateExportResolutionControls() {
  const select = document.getElementById("export-resolution-select") as any;
  const customWrap = document.getElementById("export-resolution-custom");
  const value = String(select?.value || "default");
  if (customWrap) {
    customWrap.classList.toggle("show", value === "custom");
  }
  applyExportResolutionAspect();
}

function getExportResolution() {
  const select = document.getElementById("export-resolution-select") as any;
  const value = String(select?.value || "default");
  if (value === "instagram") {
    return { width: 1080, height: 1080, isDefault: false };
  }
  if (value === "720p") {
    return { width: 1280, height: 720, isDefault: false };
  }
  if (value === "1080p") {
    return { width: 1920, height: 1080, isDefault: false };
  }
  if (value === "4k") {
    return { width: 3840, height: 2160, isDefault: false };
  }
  if (value === "custom") {
    const widthInput = document.getElementById("export-resolution-width") as any;
    const heightInput = document.getElementById("export-resolution-height") as any;
    const rawWidth = Number(widthInput?.value);
    const rawHeight = Number(heightInput?.value);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : 1000;
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : 1000;
    return { width, height, isDefault: false };
  }
  const viewAny = view as any;
  const { width, height } = getDefaultExportResolution(viewAny);
  return { width, height, isDefault: true };
}

function applyExportResolutionAspect() {
  const resolution = getExportResolution();
  const mapContainer = getEl("map-container");
  const mapWrapper = getEl("map-wrapper");
  const rotationButton = document.getElementById("rotation-button");

  if (resolution.isDefault || !resolution.width || !resolution.height) {
    currentAspectRatio = null;
    isRotated = false;
    resetMapWrapperSize();
    mapContainer.classList.remove("has-padding");
    mapWrapper.classList.add("no-shadow");
    if (rotationButton) {
      rotationButton.classList.remove("show");
    }
    return;
  }

  mapContainer.classList.add("has-padding");
  mapWrapper.classList.remove("no-shadow");
  isRotated = false;
  currentAspectRatio = { width: resolution.width, height: resolution.height };
  scheduleAspectRatioUpdate();
  if (rotationButton) {
    rotationButton.classList.add("show");
  }
}
function applyExportResolutionOverride(width: number, height: number) {
  const mapWrapper = getEl("map-wrapper");
  const mapContainer = getEl("map-container");
  const previous = {
    width: mapWrapper.style.width,
    height: mapWrapper.style.height,
    maxWidth: mapWrapper.style.maxWidth,
    maxHeight: mapWrapper.style.maxHeight,
    hadPadding: mapContainer.classList.contains("has-padding")
  };
  mapWrapper.style.width = `${Math.max(1, Math.round(width))}px`;
  mapWrapper.style.height = `${Math.max(1, Math.round(height))}px`;
  mapWrapper.style.maxWidth = mapWrapper.style.width;
  mapWrapper.style.maxHeight = mapWrapper.style.height;
  mapContainer.classList.remove("has-padding");
  document.body.classList.add("is-exporting-resolution");
  if (view && typeof view.resize === "function") {
    view.resize();
  }
  return () => {
    mapWrapper.style.width = previous.width;
    mapWrapper.style.height = previous.height;
    mapWrapper.style.maxWidth = previous.maxWidth;
    mapWrapper.style.maxHeight = previous.maxHeight;
    if (previous.hadPadding) {
      mapContainer.classList.add("has-padding");
    }
    document.body.classList.remove("is-exporting-resolution");
    if (view && typeof view.resize === "function") {
      view.resize();
    }
  };
}

function applyExportExtentConstraint(extent: any) {
  if (!view || !extent || !(view as any).constraints) return null;
  const previous = (view as any).constraints;
  const next = { ...previous, geometry: extent };
  (view as any).constraints = next;
  return () => {
    (view as any).constraints = previous;
  };
}

function showExportPreviewModal() {
  const modal = document.getElementById("export-preview-modal") as any;
  if (modal && "open" in modal) {
    modal.open = true;
  }
  scheduleExportAttributionRefresh();
}

function hideExportPreviewModal() {
  const modal = document.getElementById("export-preview-modal") as any;
  if (modal && "open" in modal) {
    modal.open = false;
  }
  setExportPreviewFullscreen(false);
}

function updateExportAttribution() {
  updateGeneralizedCountryNotice();
  const attributionEl = document.getElementById("export-attribution-text");
  if (!attributionEl) return;
  const sourceText = findMapAttributionText();
  const suffix = sourceText ? ` Data attribution: ${sourceText}` : "";
  attributionEl.textContent = `Made with Pulse and Powered by Esri.${suffix}`;
}

function updateGeneralizedCountryNotice() {
  const noteEl = document.getElementById("export-attribution-note");
  const noteText = document.getElementById("export-attribution-note-text");
  if (!noteEl || !noteText) return;
  noteText.textContent = WORLD_COUNTRIES_ATTRIBUTION_FALLBACK;
}

function scheduleExportAttributionRefresh() {
  updateExportAttribution();
  let attempts = 0;
  const maxAttempts = 12;
  const tick = () => {
    attempts += 1;
    updateExportAttribution();
    if (attempts < maxAttempts && !findMapAttributionText()) {
      window.setTimeout(tick, 250);
    }
  };
  window.setTimeout(tick, 250);
}

function mergeAttributionStrings(...parts: Array<string | null | undefined>) {
  const sources = new Set<string>();
  const add = (raw?: string | null) => {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return;
    value
      .split(/[,;]\s*/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => sources.add(item));
  };
  parts.forEach((part) => add(part));
  return Array.from(sources).join("; ");
}

function attributionItemsToText(items: ReadonlyArray<{ text?: string }> | null | undefined) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("; ");
}

function findMapAttributionText() {
  const fromView = attributionItemsToText((view as any)?.attributionItems);
  const fromHosts = [document.getElementById("arcgisMap"), document.getElementById("arcgisScene")]
    .map((host) => attributionItemsToText((host as any)?.attributionItems))
    .filter(Boolean)
    .join("; ");
  const fromLayers = collectMapAttributions();
  return mergeAttributionStrings(fromView, fromHosts, fromLayers);
}

function collectMapAttributions() {
  if (!view?.map) return "";
  const sources = new Set<string>();

  const addAttribution = (raw: unknown) => {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return;
    value
      .split(/[,;]\s*/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => sources.add(item));
  };

  const tryAddLayer = (layer: any) => {
    if (!layer) return;
    addAttribution(layer.attribution);
    if (Array.isArray(layer?.sublayers)) {
      layer.sublayers.forEach((sub: any) => tryAddLayer(sub));
    } else if (layer?.sublayers?.forEach) {
      layer.sublayers.forEach((sub: any) => tryAddLayer(sub));
    }
  };

  const mapLayers = view?.map?.allLayers;
  if (mapLayers?.forEach) {
    mapLayers.forEach((layer: any) => tryAddLayer(layer));
  } else if (Array.isArray(mapLayers)) {
    mapLayers.forEach((layer) => tryAddLayer(layer));
  }

  const basemap = view?.map?.basemap;
  if (basemap) {
    const baseLayers = basemap?.baseLayers;
    if (baseLayers?.forEach) baseLayers.forEach((layer: any) => tryAddLayer(layer));
    const referenceLayers = basemap?.referenceLayers;
    if (referenceLayers?.forEach) referenceLayers.forEach((layer: any) => tryAddLayer(layer));
  }
  if (Array.isArray(graphicsLayers)) {
    graphicsLayers.forEach((layerData) => {
      if (!layerData) return;
      addAttribution(layerData.customAttribution);
      addAttribution(layerData.layer?.attribution);
    });
  }

  return Array.from(sources).join("; ");
}

function findInShadow(root: Element | ShadowRoot, selector: string): HTMLElement | null {
  const direct = root.querySelector(selector) as HTMLElement | null;
  if (direct) return direct;
  const children = Array.from(root.querySelectorAll("*"));
  for (const child of children) {
    const shadow = (child as HTMLElement).shadowRoot;
    if (shadow) {
      const found = findInShadow(shadow, selector);
      if (found) return found;
    }
  }
  return null;
}

async function restoreExportExtent(options?: { animate?: boolean; waitMs?: number }) {
  if (!exportExtentSnapshot || !view) return;
  const animate = options?.animate ?? false;
  const waitMs = options?.waitMs ?? 0;
  if (typeof view.goTo === "function") {
    try {
      await view.goTo(exportExtentSnapshot, { animate });
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      if (name !== "view:goto-interrupted" && !exportCancelRequested) {
        throw error;
      }
    }
  } else if ("extent" in view) {
    view.extent = exportExtentSnapshot;
  }
  if (waitMs > 0) {
    await waitForMs(waitMs);
  }
  await reactiveUtils.whenOnce(() => !(view as any)?.updating);
}

async function cancelFrameExport() {
  if (!isFrameExporting && !exportState.isExporting) return;
  exportCancelRequested = true;
  setGifExportStatus("Cancelling export...");
  if (activeGifEncoder) {
    try {
      activeGifEncoder.abort();
    } catch {
      // no-op
    }
  }
    if (exportResolutionRestore) {
      exportResolutionRestore();
      exportResolutionRestore = null;
    }
    if (exportConstraintRestore) {
      exportConstraintRestore();
      exportConstraintRestore = null;
    }
    if (preExportViewpoint && view?.goTo) {
      try {
        await view.goTo(preExportViewpoint, { animate: false });
      } catch {
        // ignore
      }
    } else if (preExportExtentSnapshot) {
      exportExtentSnapshot = preExportExtentSnapshot;
      await restoreExportExtent({ animate: false });
    }
    preExportExtentSnapshot = null;
    preExportViewpoint = null;
    setExportPreviewFullscreen(false);
  }

async function captureFrames(targetWidth?: number, targetHeight?: number) {
  const viewAny = view as any;
  if (!viewAny?.takeScreenshot) {
    setGifExportStatus("Map view is not ready yet.");
    return;
  }

  const fps = getGifExportFps();
  if (isPlaying) {
    stopAnimation();
  }

  const duration = getTimelineDuration();
  const steps = Math.max(1, Math.ceil(duration * fps));
  const totalFrames = steps + 1;
  const delay = Math.round(1000 / fps);
    const width = Number(targetWidth || viewAny.width || viewAny.container?.clientWidth || 0);
    const height = Number(targetHeight || viewAny.height || viewAny.container?.clientHeight || 0);

  if (!width || !height) {
    setGifExportStatus("Unable to determine map size for export.");
    return;
  }

  const frames: string[] = [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    setGifExportStatus("Unable to prepare GIF renderer.");
    return;
  }

  await viewAny.when?.();

  const previousScrubState = timelineState.isScrubbingTimeline;
  timelineState.isScrubbingTimeline = true;
  resetAnimationGeometryCaches();

  try {
    for (let i = 0; i <= steps; i += 1) {
      if (exportCancelRequested) {
        throw new Error("Export cancelled");
      }
      const time = (i / steps) * duration;
      currentTime = time;
      updatePlayhead();
      syncAnimationStartInput();
      applyAnimationsAtTime(time);

      await waitForNextFrame();
      await reactiveUtils.whenOnce(() => !viewAny.updating);
      if (exportCancelRequested) {
        throw new Error("Export cancelled");
      }

      const dataUrl = await takeScreenshotDataUrl(viewAny, width, height);
      const img = await loadImage(dataUrl);

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      applySceneCameraStudioPostFxToCanvas(ctx, width, height, i + 1, String(viewAny?.type || currentViewMode));
      const frameDataUrl = canvas.toDataURL("image/png");
      frames.push(frameDataUrl);

      const thumb = document.createElement("img");
      thumb.className = "gif-thumb";
      thumb.src = frameDataUrl;
      thumb.alt = `Frame ${i + 1}`;
      document.getElementById("gif-thumbnails")?.appendChild(thumb);

      setGifExportStatus(`Captured ${i + 1} / ${totalFrames} frames...`);
    }
  } finally {
    timelineState.isScrubbingTimeline = previousScrubState;
  }

  return { frames, fps, delay, width, height, totalFrames };
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function ensureGifEncoder() {
  let GIF = (window as any).GIF;
  if (GIF) return GIF;
  try {
    const mod = await import("gif.js/dist/gif.js");
    GIF = (mod as any)?.default || (mod as any)?.GIF || (window as any).GIF;
  } catch (error) {
    console.warn("Unable to load GIF encoder module.", error);
  }
  GIF = GIF || (window as any).GIF;
  return GIF;
}

async function encodeGifFromFrames(
  frames: string[],
  fps: number,
  width: number,
  height: number,
  qualityLevel: number
) {
  if (exportCancelRequested) {
    throw new Error("Export cancelled");
  }
  const gifQuality = qualityLevel === 4 ? 1 : qualityLevel === 3 ? 5 : qualityLevel === 2 ? 10 : 20;
  const GIF = await ensureGifEncoder();
  if (!GIF) {
    throw new Error("GIF encoder unavailable.");
  }
  const gif = new GIF({
    workers: 2,
    workerScript: gifWorkerUrl,
    quality: gifQuality,
    width,
    height,
    repeat: 0
  });
  activeGifEncoder = gif;

  gif.on("progress", (progress: number) => {
    const percent = Math.round(progress * 100);
    setGifExportStatus(`Encoding GIF... ${percent}%`);
  });

  const delay = Math.round(1000 / fps);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Unable to prepare GIF renderer.");
  }

  for (const frame of frames) {
    if (exportCancelRequested) {
      throw new Error("Export cancelled");
    }
    const img = await loadImage(frame);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    gif.addFrame(canvas, { delay, copy: true });
  }

  return new Promise<Blob>((resolve, reject) => {
    gif.on("finished", (blob: Blob) => resolve(blob));
    gif.on("abort", () => reject(new Error("GIF export aborted")));
    gif.render();
  });
}

async function encodeWebmFromFrames(
  frames: string[],
  fps: number,
  width: number,
  height: number,
  qualityLevel: number
) {
  if (exportCancelRequested) {
    throw new Error("Export cancelled");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Unable to prepare WebM renderer.");
  }

  const bitrate =
    qualityLevel === 4 ? 8_000_000 : qualityLevel === 3 ? 5_000_000 : qualityLevel === 2 ? 3_000_000 : 1_500_000;
  const stream = canvas.captureStream(fps);
  const options: MediaRecorderOptions = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? { mimeType: "video/webm;codecs=vp9", bitsPerSecond: bitrate }
    : { mimeType: "video/webm", bitsPerSecond: bitrate };
  const recorder = new MediaRecorder(stream, options);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const recordPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });

  const images: HTMLImageElement[] = [];
  for (const frame of frames) {
    if (exportCancelRequested) {
      throw new Error("Export cancelled");
    }
    images.push(await loadImage(frame));
  }

  recorder.start();
  const frameInterval = 1000 / fps;
  const startTime = performance.now();
  for (let i = 0; i < images.length; i += 1) {
    if (exportCancelRequested) {
      recorder.stop();
      throw new Error("Export cancelled");
    }
    const img = images[i];
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const targetTime = startTime + i * frameInterval;
    const delay = targetTime - performance.now();
    if (delay > 0) {
      await sleep(delay);
    }
  }
  recorder.stop();

  return recordPromise;
}

async function encodePngZip(frames: string[]) {
  const JSZip = (window as any).JSZip;
  if (!JSZip) {
    throw new Error("ZIP encoder unavailable.");
  }
  const zip = new JSZip();
  for (let i = 0; i < frames.length; i += 1) {
    if (exportCancelRequested) {
      throw new Error("Export cancelled");
    }
    const response = await fetch(frames[i]);
    const blob = await response.blob();
    const name = `frame-${String(i + 1).padStart(4, "0")}.png`;
    zip.file(name, blob);
  }
  return zip.generateAsync({ type: "blob" });
}

async function encodeMp4FromFrames(frames: string[], fps: number, qualityLevel: number) {
  if (exportCancelRequested) {
    throw new Error("Export cancelled");
  }
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
  }
  if (!ffmpegLoaded) {
    setGifExportStatus("Loading MP4 encoder...");
    const workerUrl = appendCacheBust(await resolveFfmpegWorkerUrl());
    let coreURL = ffmpegCoreUrl;
    let wasmURL = ffmpegWasmUrl;
    if (!coreURL || !wasmURL) {
      const coreBase = await resolveFfmpegCoreBaseUrl();
      coreURL = new URL("ffmpeg-core.js", coreBase).toString();
      wasmURL = new URL("ffmpeg-core.wasm", coreBase).toString();
    }
    coreURL = appendCacheBust(coreURL);
    wasmURL = appendCacheBust(wasmURL);
    await ffmpegInstance.load({ classWorkerURL: workerUrl, coreURL, wasmURL });
    ffmpegLoaded = true;
  }

  for (let i = 0; i < frames.length; i += 1) {
    if (exportCancelRequested) {
      throw new Error("Export cancelled");
    }
    const name = `frame-${String(i + 1).padStart(4, "0")}.png`;
    await ffmpegInstance.writeFile(name, await fetchFile(frames[i]));
  }

  setGifExportStatus("Encoding MP4...");
  const crf = qualityLevel === 4 ? 18 : qualityLevel === 3 ? 22 : qualityLevel === 2 ? 26 : 30;
  const qscale = qualityLevel === 4 ? 2 : qualityLevel === 3 ? 5 : qualityLevel === 2 ? 8 : 12;
  const ffmpeg = ffmpegInstance;
  if (!ffmpeg) {
    throw new Error("FFmpeg not initialized.");
  }
  const tryEncode = async (codec: "libx264" | "mpeg4") => {
    const args =
      codec === "libx264"
        ? [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            "frame-%04d.png",
            "-c:v",
            "libx264",
            "-crf",
            String(crf),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "faststart",
            "out.mp4"
          ]
        : [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            "frame-%04d.png",
            "-c:v",
            "mpeg4",
            "-q:v",
            String(qscale),
            "-pix_fmt",
            "yuv420p",
            "-tag:v",
            "mp4v",
            "-movflags",
            "faststart",
            "out.mp4"
          ];
    const result = await ffmpeg.exec(args);
    return result;
  };

  let result = await tryEncode("libx264");
  let codecUsed: "libx264" | "mpeg4" = "libx264";
  if (result !== 0) {
    result = await tryEncode("mpeg4");
    codecUsed = "mpeg4";
  }
  if (result !== 0) {
    throw new Error(`FFmpeg failed (code ${result}).`);
  }

  const data = await ffmpeg.readFile("out.mp4");
  const dataAny = data as unknown;
  let bytes: Uint8Array;
  if (dataAny instanceof Uint8Array) {
    bytes = dataAny;
  } else if (dataAny instanceof ArrayBuffer) {
    bytes = new Uint8Array(dataAny);
  } else if (typeof dataAny === "string") {
    bytes = new TextEncoder().encode(dataAny);
  } else {
    bytes = new Uint8Array(dataAny as ArrayBufferLike);
  }
  if (bytes.byteLength === 0) {
    throw new Error("FFmpeg produced empty output.");
  }
  const safeBytes = Uint8Array.from(bytes);
  const blob = new Blob([safeBytes.buffer], { type: "video/mp4" });
  return { blob, codec: codecUsed };
}

function collapseSceneExpandPanelsForExport() {
  const panelIds = ["scene-camera-studio-expand", "scene-daylight-expand"];
  const states = panelIds
    .map((id) => {
      const el = document.getElementById(id) as any;
      if (!el) return null;
      const wasExpanded = Boolean(el.expanded || el.hasAttribute?.("expanded"));
      if (wasExpanded) {
        el.expanded = false;
        el.removeAttribute?.("expanded");
      }
      return { el, wasExpanded };
    })
    .filter(Boolean) as Array<{ el: any; wasExpanded: boolean }>;

  return () => {
    states.forEach(({ el, wasExpanded }) => {
      if (!el) return;
      el.expanded = wasExpanded;
      if (wasExpanded) {
        el.setAttribute?.("expanded", "");
      } else {
        el.removeAttribute?.("expanded");
      }
    });
  };
}

async function startFrameExport() {
  if (isFrameExporting || exportState.isExporting) return;
  if (!canExportProject()) {
    setGifExportStatus("Add an animation, camera keyframe, or camera FX to enable export.");
    return;
  }

  const formatSelect = document.getElementById("export-format-select") as any;
  const format = String(formatSelect?.value || "gif") as "gif" | "webm" | "png" | "mp4";
  const resolution = getExportResolution();
  const shouldCollapseScenePanels = format === "webm" || format === "mp4";
  const restoreSceneExpandPanels = shouldCollapseScenePanels ? collapseSceneExpandPanelsForExport() : null;

  isFrameExporting = true;
  exportState.isExporting = true;
  exportCancelRequested = false;
  clearExportSelection();
  showExportPreviewModal();
  setExportPreviewFullscreen(!resolution.isDefault);
  const cancelBtn = document.getElementById("export-cancel-btn");
  if (cancelBtn) {
    cancelBtn.removeAttribute("hidden");
  }
  setExportButtonDisabled(true);
  setGifExportStatus("Preparing export...");
  clearGifThumbnails();
  hideGifPreview();
  clearGifDownloadUrl();
  const closeBtn = document.getElementById("export-preview-close");
  if (closeBtn) {
    closeBtn.setAttribute("disabled", "");
  }
    document.body.classList.add("is-exporting");

    try {
      if (view?.extent) {
        preExportExtentSnapshot = typeof view.extent.clone === "function" ? view.extent.clone() : view.extent;
        exportExtentSnapshot = preExportExtentSnapshot;
      }
      if (view?.viewpoint) {
        const vpAny = view.viewpoint as any;
        preExportViewpoint = typeof vpAny?.clone === "function" ? vpAny.clone() : vpAny;
      }
      if (preExportExtentSnapshot) {
        exportConstraintRestore = applyExportExtentConstraint(preExportExtentSnapshot) || null;
      }
      if (!resolution.isDefault && resolution.width && resolution.height) {
        await waitForNextFrame();
        if (preExportViewpoint && view?.goTo) {
          try {
            await view.goTo(preExportViewpoint, { animate: false });
          } catch {
            // ignore
          }
        } else {
          await restoreExportExtent({ animate: false, waitMs: 250 });
        }
      }
      const capture = await captureFrames(resolution.width, resolution.height);
    if (!capture) {
      throw new Error("Unable to capture frames.");
    }

    const { frames, fps, width, height, totalFrames } = capture;
    const quality = getExportQualityLevel();
    if (exportCancelRequested) {
      throw new Error("Export cancelled");
    }
    setGifExportStatus(`Captured ${frames.length} frames...`);

    let blob: Blob;
    let previewType: "image" | "video" = "image";
    let previewSrc = frames[0] || "";
    let extension = "gif";
    let useFramePreview = false;

    if (format === "gif") {
      blob = await encodeGifFromFrames(frames, fps, width, height, quality);
      extension = "gif";
      previewType = "image";
    } else if (format === "webm") {
      blob = await encodeWebmFromFrames(frames, fps, width, height, quality);
      extension = "webm";
      previewType = "video";
    } else if (format === "png") {
      blob = await encodePngZip(frames);
      extension = "zip";
      previewType = "image";
    } else {
      const mp4Result = await encodeMp4FromFrames(frames, fps, quality);
      blob = mp4Result.blob;
      extension = "mp4";
      previewType = "video";
      if (mp4Result.codec === "mpeg4") {
        previewType = "image";
        previewSrc = frames[0] || "";
        useFramePreview = true;
        setGifExportStatus("MP4 generated with MPEG-4 codec. Preview may not be available in this browser.");
      }
    }

    clearGifDownloadUrl();
    exportDownloadExtension = extension;
    exportDownloadUrl = URL.createObjectURL(blob);
    if (format === "png" || useFramePreview) {
      previewSrc = frames[0] || "";
    } else {
      previewSrc = exportDownloadUrl;
    }
    exportDefaultPreview = { type: previewType, src: previewSrc };
    setGifPreview(previewSrc, "gif", previewType);
    const downloadBtn = document.getElementById("gif-download-btn");
    if (downloadBtn) {
      downloadBtn.textContent = `Download .${extension} (${formatBytes(blob.size)})`;
      downloadBtn.removeAttribute("disabled");
    }
      if (format === "mp4") {
        setGifExportStatus(
          `Ready (${totalFrames} frames @ ${fps} fps). Sometimes when exporting as .mp4 you will not have the correct codecs for the browser to play it. Downloading the video may still work. You can even upload it into other platforms often. Downloading as WebM is preferred if possible.`,
          true
        );
      } else {
        setGifExportStatus(`Ready (${totalFrames} frames @ ${fps} fps).`);
      }
  } catch (error) {
    if (isExportCancelError(error)) {
      setGifExportStatus("Export cancelled.");
    } else {
      console.error("Export failed.", error);
      setGifExportStatus("Export failed. Please try again.");
    }
    } finally {
      isFrameExporting = false;
      exportState.isExporting = false;
      setExportButtonDisabled(false);
      if (exportResolutionRestore) {
        exportResolutionRestore();
        exportResolutionRestore = null;
      }
      if (exportConstraintRestore) {
        exportConstraintRestore();
        exportConstraintRestore = null;
      }
      activeGifEncoder = null;
      exportCancelRequested = false;
      if (preExportViewpoint && view?.goTo) {
        try {
          await view.goTo(preExportViewpoint, { animate: false });
        } catch {
          // ignore
        }
      } else if (preExportExtentSnapshot) {
        exportExtentSnapshot = preExportExtentSnapshot;
        await restoreExportExtent({ animate: false });
      }
      preExportExtentSnapshot = null;
      preExportViewpoint = null;
      exportExtentSnapshot = null;
    const cancelBtn = document.getElementById("export-cancel-btn");
    if (cancelBtn) {
      cancelBtn.setAttribute("hidden", "");
    }
    const closeBtn = document.getElementById("export-preview-close");
    if (closeBtn) {
      closeBtn.removeAttribute("disabled");
    }
    document.body.classList.remove("is-exporting");
    restoreSceneExpandPanels?.();
  }
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

function clearExportSelection() {
  selectedLayerIndex = -1;
  timelineController.clearSelectedTimelineAnimation();
  setDeleteLayerButtonVisible(false);
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  clearSelectionManagerSelection();
  if (sketch) {
    sketch.cancel();
  }
  const viewAny = view as any;
  viewAny?.popup?.close?.();
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

function getLayerOverlayLayers(layerData: LayerData) {
  return [
    (layerData as any).__arrowLayer,
    (layerData as any).__barrageLayer,
    (layerData as any).__dartLayer,
    (layerData as any).__weldSparkLayer,
    (layerData as any).__flightLayer,
    (layerData as any).__waypointLayer,
    (layerData as any).__fireworksLayer
  ].filter(Boolean);
}

function clearLayerOverlayLayers(layerData: LayerData) {
  if (!view) return;
  const overlays = getLayerOverlayLayers(layerData);
  if (overlays.length) {
    view.map.removeMany(overlays);
  }
  delete (layerData as any).__arrowLayer;
  delete (layerData as any).__barrageLayer;
  delete (layerData as any).__dartLayer;
  delete (layerData as any).__weldSparkLayer;
  delete (layerData as any).__flightLayer;
  delete (layerData as any).__waypointLayer;
  delete (layerData as any).__fireworksLayer;
}

async function resetProject() {
  if (!view) return;
  const hasProjectContent = graphicsLayers.some(
    (layerData) => !isViewTrackLayer(layerData) || hasRealAnimations(layerData) || hasPointKeyframes(layerData)
  );
  if (hasProjectContent) {
    const shouldReset = await openConfirmDialog({
      heading: "New project",
      message: "Creating a new project will remove all graphics/animations.",
      confirmText: "Create new project",
      confirmKind: "brand"
    });
    if (!shouldReset) return;
  }
  stopAnimation();
  isRestoringProject = true;
  if (projectSaveTimer) {
    window.clearTimeout(projectSaveTimer);
    projectSaveTimer = null;
  }
  if (sketch) {
    sketch.cancel();
    sketch.layer = null;
  }
  view.graphics?.removeAll?.();
  view.map.removeMany(graphicsLayers.map((layerData) => layerData.layer));
  const overlayLayers = graphicsLayers.flatMap((layerData) => getLayerOverlayLayers(layerData));
  if (overlayLayers.length) {
    view.map.removeMany(overlayLayers);
  }
  graphicsLayers.forEach((layerData) => {
    delete (layerData as any).__arrowLayer;
    delete (layerData as any).__barrageLayer;
    delete (layerData as any).__dartLayer;
    delete (layerData as any).__weldSparkLayer;
    delete (layerData as any).__flightLayer;
    delete (layerData as any).__waypointLayer;
    delete (layerData as any).__fireworksLayer;
  });
  graphicsLayers = [];
  ensureViewTrackLayer();
  syncViewTrackLayerName(currentViewMode);
  clearSelectionManagerSelection();
  selectedLayerIndex = -1;
  isDrawing = false;
  setDrawInfoBoxVisible(false);
  updateSnappingOptions();
  timelineController.clearSelectedTimelineAnimation();
  timelineController.setTimelineDurationOverride(null);
  setProjectName("Untitled");
  const exportResolutionSelect = document.getElementById("export-resolution-select") as any;
  if (exportResolutionSelect) {
    exportResolutionSelect.value = "default";
    updateExportResolutionControls();
  } else {
    applyExportResolutionAspect();
  }
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  setDeleteLayerButtonVisible(false);
  setProjectStatus("saved");
  resetHistory(historyState, historyConfig);
  if (ENABLE_PROJECT_STORAGE) {
    clearProjectStorage(storageState);
  }
  isRestoringProject = false;
}
const pointPathStyles: Record<string, string> = {
  "thumbtack3d": "M3 9.5 L8.4 12.3 L17.5 12.3 L22 14 L17.5 15.7 L8.4 15.7 L3 18.5 L5.1 14 Z",
  "home": "M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z",
  "map-pin": "M12 2c-3.3 0-6 2.7-6 6 0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6zm0 8.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 5.5 12 5.5s2.5 1.1 2.5 2.5S13.4 10.5 12 10.5z",
  "star": "M12 2l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17l-5.9 3.1 1.2-6.5L2.5 8.9 9.1 8z",
  "hexagon": "M12 2l7 4v12l-7 4-7-4V6z",
  "pentagon": "M12 2l9 7-3.5 11H6.5L3 9z",
  "octagon": "M7 2h10l5 5v10l-5 5H7l-5-5V7z",
  "heart": "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z",
  "drop": "M12 2s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z",
  "shield": "M12 2l8 4v6c0 5-3.5 9-8 12-4.5-3-8-7-8-12V6z",
  "flag": "M5 3h10l-1.5 4 1.5 4H5v8H3V3z",
  "phosphor-map-pin": "M512 256c-88.366 0-160 71.634-160 160s71.634 160 160 160c88.366 0 160-71.634 160-160v0c0-88.366-71.634-160-160-160v0zM512 512c-53.019 0-96-42.981-96-96s42.981-96 96-96c53.019 0 96 42.981 96 96v0c0 53.019-42.981 96-96 96v0zM512 64c-194.313 0.228-351.772 157.687-352 351.978l-0 0.022c0 125.6 58.040 258.72 168 385 49.439 56.891 103.776 107.23 163.073 151.265l2.727 1.935c5.116 3.623 11.485 5.791 18.36 5.791s13.244-2.168 18.46-5.858l-0.1 0.067c61.893-45.975 116.125-96.311 164.414-151.945l1.066-1.255c109.8-126.28 168-259.4 168-385-0.228-194.313-157.687-351.772-351.978-352l-0.022-0zM512 888c-66.12-52-288-243-288-472 0-159.058 128.942-288 288-288s288 128.942 288 288v0c0 228.92-221.88 420-288 472z",
  "phosphor-map-pin-line": "M800 896h-197.84c33.451-29.949 64.1-60.966 92.774-93.756l1.066-1.244c109.8-126.28 168-259.4 168-385 0-194.404-157.596-352-352-352s-352 157.596-352 352v0c0 125.6 58.040 258.72 168 385 29.738 34.032 60.388 65.049 92.828 94.109l1.012 0.891h-197.84c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h576c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM224 416c0-159.058 128.942-288 288-288s288 128.942 288 288v0c0 228.92-221.88 420-288 472-66.12-52-288-243.080-288-472zM672 416c0-88.366-71.634-160-160-160s-160 71.634-160 160c0 88.366 71.634 160 160 160v0c88.366 0 160-71.634 160-160v0zM416 416c0-53.019 42.981-96 96-96s96 42.981 96 96c0 53.019-42.981 96-96 96v0c-53.019 0-96-42.981-96-96v0z",
  "phosphor-map-pin-plus": "M512 64c-194.313 0.228-351.772 157.687-352 351.978l-0 0.022c0 125.6 58.040 258.72 168 385 49.439 56.891 103.776 107.23 163.073 151.265l2.727 1.935c5.116 3.623 11.485 5.791 18.36 5.791s13.244-2.168 18.46-5.858l-0.1 0.067c61.893-45.975 116.125-96.311 164.414-151.945l1.066-1.255c109.8-126.28 168-259.4 168-385-0.228-194.313-157.687-351.772-351.978-352l-0.022-0zM512 888c-66.12-52-288-243-288-472 0-159.058 128.942-288 288-288s288 128.942 288 288v0c0 228.92-221.88 420-288 472zM672 416c0 17.673-14.327 32-32 32v0h-96v96c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-96h-96c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h96v-96c0-17.673 14.327-32 32-32s32 14.327 32 32v0 96h96c17.673 0 32 14.327 32 32v0z",
  "phosphor-map-pin-simple": "M736 288c0-0.007 0-0.015 0-0.023 0-123.712-100.288-224-224-224s-224 100.288-224 224c0 112.422 82.819 205.501 190.774 221.553l1.226 0.15v418.32c0 17.673 14.327 32 32 32s32-14.327 32-32v0-418.32c109.097-16.348 191.827-109.326 192-221.662l0-0.018zM512 448c-88.366 0-160-71.634-160-160s71.634-160 160-160c88.366 0 160 71.634 160 160v0c0 88.366-71.634 160-160 160v0z",
  "phosphor-map-pin-simple-line": "M864 832h-320v-290.32c109.181-16.202 192-109.28 192-221.703 0-123.712-100.288-224-224-224s-224 100.288-224 224c0 112.422 82.819 205.501 190.775 221.553l1.225 0.15v290.32h-320c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h704c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM352 320c0-88.366 71.634-160 160-160s160 71.634 160 160c0 88.366-71.634 160-160 160v0c-88.366 0-160-71.634-160-160v0z",
  "phosphor-map-trifold": "M915.68 198.76c-5.368-4.214-12.221-6.758-19.668-6.758-2.76 0-5.439 0.349-7.994 1.006l0.222-0.048-244.52 61.12-245.4-122.72c-4.162-2.121-9.077-3.364-14.283-3.364-2.769 0-5.456 0.352-8.019 1.013l0.222-0.049-256 64c-14.031 3.594-24.238 16.125-24.24 31.040l-0 0v576c0.003 17.671 14.329 31.995 32 31.995 2.756 0 5.43-0.348 7.982-1.003l-0.222 0.048 244.52-61.12 245.4 122.72c4.177 2.105 9.102 3.344 14.315 3.36l0.005 0c2.757-0.002 5.431-0.352 7.982-1.008l-0.222 0.048 256-64c14.031-3.594 24.238-16.125 24.24-31.040l0-0v-576c0-0.002 0-0.005 0-0.007 0-10.221-4.792-19.322-12.251-25.181l-0.069-0.052zM416 211.76l192 96v504.48l-192-96zM160 249l192-48v510l-192 48zM864 775l-192 48v-510l192-48z",
  "phosphor-navigation-arrow": "M949.32 424.84l-704.32-261.040c-6.21-2.21-13.374-3.486-20.835-3.486-35.346 0-64 28.654-64 64 0 7.406 1.258 14.519 3.572 21.135l-0.137-0.449c0.056 0.248 0.124 0.461 0.21 0.666l-0.010-0.026 261.040 703.68c8.741 25.040 32.156 42.683 59.691 42.683 0.207 0 0.414-0.001 0.62-0.003l-0.032 0h1.2c28.254-0.223 52.067-18.987 59.883-44.713l0.117-0.447 0.24-0.8 87.36-312 312.8-87.6c26.379-8.302 45.177-32.541 45.177-61.169 0-27.711-17.611-51.308-42.251-60.21l-0.446-0.141zM599.36 577.2c-10.764 3.091-19.069 11.396-22.104 21.934l-0.056 0.226-92 328.64-0.24-0.68-260.96-703.32 703.92 261.12z",
  "phosphor-compass": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM689.68 291.36l-256 128c-6.217 3.169-11.151 8.103-14.236 14.138l-0.084 0.182-128 256c-2.133 4.172-3.383 9.1-3.383 14.32 0 17.673 14.327 32 32 32 0.008 0 0.016-0 0.024-0l-0.001 0c5.218-0.008 10.144-1.248 14.506-3.445l-0.186 0.085 256-128c6.217-3.169 11.151-8.103 14.236-14.138l0.084-0.182 128-256c2.147-4.183 3.406-9.128 3.406-14.366 0-17.673-14.327-32-32-32-5.238 0-10.182 1.259-14.547 3.49l0.181-0.084zM552 552l-160.44 80.44 80.44-160.44 160.6-80.28z",
  "phosphor-compass-rose": "M999.76 480.96l-108.2-27.040c-25.933-166.066-155.414-295.547-319.318-321.201l-2.162-0.279-27.040-108c-3.601-14.023-16.13-24.221-31.040-24.221s-27.439 10.198-30.992 23.999l-0.048 0.222-27.040 108.2c-166.066 25.933-295.547 155.414-321.201 319.318l-0.279 2.162-108 27.040c-14.023 3.601-24.221 16.13-24.221 31.040s10.198 27.439 23.999 30.992l0.222 0.048 108.2 27.040c25.933 166.066 155.414 295.547 319.318 321.201l2.162 0.279 27.040 108.2c3.601 14.023 16.13 24.221 31.040 24.221s27.439-10.198 30.992-23.999l0.048-0.222 27.040-108.2c166.066-25.933 295.547-155.414 321.201-319.318l0.279-2.162 108.2-27.040c14.023-3.601 24.221-16.13 24.221-31.040s-10.198-27.439-23.999-30.992l-0.222-0.048zM617.8 572.56l-60.56-60.56 60.56-60.56 242.2 60.56zM406.2 572.56l-242.2-60.56 242.28-60.56 60.48 60.56zM823.080 436.8l-188.68-47.2-47.2-188.68c116.833 28.809 207.071 119.047 235.421 233.685l0.459 2.195zM572.56 406.2l-60.56 60.56-60.56-60.56 60.56-242.2zM436.8 200.92l-47.2 188.68-188.68 47.2c28.809-116.833 119.047-207.071 233.685-235.421l2.195-0.459zM200.8 587.2l188.8 47.2 47.2 188.68c-116.833-28.809-207.071-119.047-235.421-233.685l-0.459-2.195zM451.32 617.8l60.68-60.56 60.56 60.56-60.56 242.2zM587.080 823.080l47.2-188.68 188.68-47.2c-28.789 116.804-118.977 207.032-233.564 235.42l-2.196 0.46z",
  "phosphor-crosshair": "M928 480h-33.36c-16.329-186.717-163.923-334.311-349.188-350.537l-1.452-0.103v-33.36c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 33.36c-186.717 16.329-334.311 163.923-350.537 349.188l-0.103 1.452h-33.36c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h33.36c16.329 186.717 163.923 334.311 349.188 350.537l1.452 0.103v33.36c0 17.673 14.327 32 32 32s32-14.327 32-32v0-33.36c186.717-16.329 334.311-163.923 350.537-349.188l0.103-1.452h33.36c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM544 830.4v-30.4c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 30.4c-151.349-15.895-270.505-135.051-286.281-285.009l-0.119-1.391h30.4c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-30.4c15.895-151.349 135.051-270.505 285.009-286.281l1.391-0.119v30.4c0 17.673 14.327 32 32 32s32-14.327 32-32v0-30.4c151.349 15.895 270.505 135.051 286.281 285.009l0.119 1.391h-30.4c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h30.4c-15.895 151.349-135.051 270.505-285.009 286.281l-1.391 0.119zM512 352c-88.366 0-160 71.634-160 160s71.634 160 160 160c88.366 0 160-71.634 160-160v0c0-88.366-71.634-160-160-160v0zM512 608c-53.019 0-96-42.981-96-96s42.981-96 96-96c53.019 0 96 42.981 96 96v0c0 53.019-42.981 96-96 96v0z",
  "phosphor-crosshair-simple": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM544 862.52v-126.52c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 126.52c-169.036-16.113-302.407-149.484-318.41-317.097l-0.11-1.423h126.52c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-126.52c16.113-169.036 149.484-302.407 317.097-318.41l1.423-0.11v126.52c0 17.673 14.327 32 32 32s32-14.327 32-32v0-126.52c169.036 16.113 302.407 149.484 318.41 317.097l0.11 1.423h-126.52c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h126.52c-16.113 169.036-149.484 302.407-317.097 318.41l-1.423 0.11z",
  "phosphor-push-pin": "M941.28 325.48l-242.76-242.72c-11.582-11.585-27.584-18.75-45.26-18.75s-33.678 7.166-45.26 18.75l-0 0-214.52 215.2c-42.64-13.36-140-29.48-241.6 52.56-14.623 11.827-23.895 29.769-23.895 49.876 0 17.668 7.159 33.664 18.735 45.245l193.28 193.2-170.64 170.52c-5.794 5.794-9.378 13.799-9.378 22.64 0 17.683 14.335 32.018 32.018 32.018 8.841 0 16.846-3.584 22.64-9.378l0-0 170.52-170.64 193.16 193.16c11.575 11.622 27.585 18.82 45.276 18.84l0.004 0c1.52 0 3 0 4.52 0 19.079-1.361 35.679-10.93 46.444-25.16l0.116-0.16c78.56-104.4 71-189.28 52.76-240l213.88-214.68c11.573-11.58 18.73-27.574 18.73-45.24 0-17.686-7.174-33.696-18.77-45.279l-0.001-0.001zM896 370.76v0l-229.080 229.84c-5.766 5.787-9.33 13.77-9.33 22.585 0 5.21 1.245 10.13 3.454 14.477l-0.084-0.182c37.84 75.72-7.2 154.36-37.36 194.48l-431.6-431.64c48.32-38.96 94.56-49.24 129.92-49.24 0.651-0.010 1.42-0.015 2.191-0.015 22.812 0 44.513 4.759 64.164 13.337l-1.034-0.402c4.172 2.133 9.101 3.384 14.322 3.384 8.862 0 16.883-3.602 22.677-9.423l0.001-0.001 229.040-229.96 242.72 242.72z",
  "phosphor-push-pin-simple": "M864 672h-37.16l-84.68-480h25.84c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-512c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h25.84l-84.68 480h-37.16c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h320v224c0 17.673 14.327 32 32 32s32-14.327 32-32v0-224h320c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM346.84 192h330.32l84.68 480h-499.68z",
  "phosphor-push-pin-slash": "M215.68 138.48c-5.889-6.617-14.429-10.764-23.938-10.764-17.673 0-32 14.327-32 32 0 8.434 3.263 16.106 8.595 21.823l-0.017-0.019 101.16 111.28c-45.301 10.352-84.855 30.464-117.924 58.081l0.444-0.361c-14.623 11.827-23.895 29.769-23.895 49.876 0 17.668 7.159 33.664 18.735 45.245l193.16 193.2-170.64 170.52c-5.794 5.794-9.378 13.799-9.378 22.64 0 17.683 14.335 32.018 32.018 32.018 8.841 0 16.846-3.584 22.64-9.378l0-0 170.52-170.64 193.16 193.16c11.575 11.622 27.585 18.82 45.276 18.84l0.004 0c1.52 0 3 0 4.52 0 19.079-1.361 35.679-10.93 46.444-25.16l0.116-0.16c17.94-23.41 33.487-50.122 45.441-78.71l0.879-2.37 87.36 96c5.889 6.617 14.429 10.764 23.938 10.764 17.673 0 32-14.327 32-32 0-8.434-3.263-16.106-8.595-21.823l0.017 0.019zM623.6 832l-431.6-431.68c40.92-33 84.8-49.44 130.64-49.080l348.64 383.52c-8.92 39.48-30.32 74.16-47.68 97.24zM941.28 416l-178.56 179.16c-5.794 5.809-13.808 9.404-22.66 9.404-17.675 0-32.004-14.329-32.004-32.004 0-8.823 3.57-16.811 9.344-22.601l178.599-179.159-242.72-242.8-164.88 165.4c-5.732 5.473-13.514 8.841-22.083 8.841-17.673 0-32-14.327-32-32 0-8.529 3.337-16.279 8.777-22.015l-0.013 0.014 164.92-165.44c11.582-11.585 27.584-18.75 45.26-18.75s33.678 7.166 45.26 18.75l242.76 242.72c11.573 11.58 18.73 27.574 18.73 45.24s-7.157 33.66-18.731 45.24l0-0z",
  "phosphor-push-pin-simple-slash": "M333 160c0-17.673 14.327-32 32-32v0h403c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-25.84l75 425.2c0.307 1.664 0.482 3.578 0.482 5.533 0 15.695-11.299 28.75-26.206 31.477l-0.196 0.030c-1.674 0.331-3.6 0.52-5.569 0.52-0.011 0-0.022-0-0.033-0l0.002 0c-15.694-0.017-28.742-11.329-31.451-26.245l-0.029-0.195-77-436.32h-312c-0.048 0-0.104 0-0.16 0-17.673 0-32-14.327-32-32 0-0 0-0 0-0l-0 0zM853.52 887.68c-5.661 5.158-13.221 8.317-21.52 8.317-9.373 0-17.805-4.030-23.657-10.451l-0.023-0.025-135.92-149.52h-128.4v224c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-224h-320c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h37.16l67.8-384-96.64-106.48c-5.315-5.698-8.578-13.37-8.578-21.804 0-17.673 14.327-32 32-32 9.509 0 18.049 4.147 23.91 10.732l0.028 0.032 640 704c5.158 5.661 8.317 13.221 8.317 21.52 0 9.373-4.030 17.805-10.451 23.657l-0.025 0.023zM614.2 672l-294.84-324.32-57.2 324.32z",
  "phosphor-path": "M800 672c-59.317 0.058-109.201 40.379-123.797 95.104l-0.203 0.896h-388c-70.692 0-128-57.308-128-128s57.308-128 128-128v0h384c88.366 0 160-71.634 160-160s-71.634-160-160-160v0h-384c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h384c53.019 0 96 42.981 96 96s-42.981 96-96 96v0h-384c-106.039 0-192 85.961-192 192s85.961 192 192 192v0h388c14.719 55.647 64.615 96 123.935 96 70.692 0 128-57.308 128-128 0-70.67-57.271-127.963-127.932-128l-0.004-0zM800 864c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0z",
  "phosphor-flag": "M171.040 200c-6.735 5.861-10.984 14.429-11.040 23.99l-0 0.010v672c0 17.673 14.327 32 32 32s32-14.327 32-32v0-176.92c107.16-84.64 199.48-39 305.8 13.64 65.6 32.44 136.24 67.4 212 67.4 55.72 0 114.16-19 175.28-72 6.735-5.861 10.984-14.429 11.040-23.99l0-0.010v-480.12c-0.043-17.641-14.353-31.924-32-31.924-8.091 0-15.481 3.003-21.116 7.955l0.036-0.031c-112 96.92-206.88 49.96-316.84-4.48-113.92-56.48-243.080-120.36-387.16 4.48zM864 689c-107.16 84.64-199.48 38.96-305.8-13.64-100-49.4-211.24-104.52-334.2-33.6v-402.6c107.16-84.64 199.48-39 305.8 13.6 100 49.4 211.28 104.52 334.2 33.6z",
  "phosphor-flag-banner": "M955.040 206.92c-5.757-9.017-15.709-14.912-27.039-14.92l-768.001-0c-0.007-0-0.016-0-0.025-0-17.673 0-32 14.327-32 32 0 8.843 3.587 16.848 9.385 22.64l0 0 169.4 169.36-169.4 169.36c-5.798 5.792-9.385 13.797-9.385 22.64 0 17.673 14.327 32 32 32 0.009 0 0.018-0 0.027-0l534.479 0-115.36 242.24c-2.178 4.209-3.455 9.187-3.455 14.464 0 17.673 14.327 32 32 32 12.945 0 24.094-7.686 29.134-18.744l0.082-0.2 320-672c1.96-4.024 3.105-8.753 3.105-13.751 0-6.338-1.843-12.246-5.022-17.217l0.077 0.128zM724.92 576h-487.68l137.4-137.36c5.798-5.792 9.385-13.797 9.385-22.64s-3.587-16.848-9.385-22.64l-137.4-137.36h640z",
  "phosphor-flag-checkered": "M909.28 195c-3.885-1.808-8.435-2.863-13.23-2.863-8.058 0-15.421 2.979-21.047 7.895l0.038-0.032c-112 96.88-206.88 49.92-316.84-4.52-113.92-56.44-243.080-120.32-387.16 4.52-6.735 5.861-10.984 14.429-11.040 23.99l-0 0.010v672c0 17.673 14.327 32 32 32s32-14.327 32-32v0-176.92c107.16-84.64 199.48-39 305.8 13.64 113.96 56.36 243.080 120.24 387.16-4.52 6.735-5.861 10.984-14.429 11.040-23.99l0-0.010v-480.2c-0.047-12.813-7.618-23.847-18.523-28.918l-0.197-0.082zM864 286.4v162.6c-56 44.24-108 52.88-160 43.52v-175.16c11.144 1.832 23.986 2.878 37.074 2.878 45.372 0 87.805-12.58 124.003-34.442l-1.077 0.603zM640 301.44v172c-26.64-10.68-53.72-24-81.8-37.92-35.28-17.48-72-35.64-110.2-48.72v-172c26.64 10.64 53.72 24 81.8 37.92 35.28 17.48 72.040 35.64 110.2 48.72zM384 195.64v175.12c-11.125-1.825-23.947-2.868-37.012-2.868-45.396 0-87.851 12.591-124.063 34.471l1.076-0.603v-162.64c56-44.24 108-52.84 160-43.48zM346.32 608c-45.151 0.081-87.359 12.605-123.401 34.324l1.081-0.604v-162.6c56-44.24 108-52.88 160-43.52v175.2c-11.303-1.754-24.36-2.771-37.65-2.8l-0.030-0zM448 626.68v-172c26.64 10.64 53.72 24 81.8 37.92 35.28 17.48 72 35.6 110.2 48.68v172c-26.64-10.68-53.72-24-81.8-37.92-35.28-17.48-72.040-35.6-110.2-48.68zM704 732.48v-175.2c11.284 1.777 24.335 2.822 37.62 2.88l0.060 0c45.168-0.144 87.369-12.721 123.397-34.484l-1.077 0.604v162.72c-56 44.24-108 52.84-160 43.48z",
  "phosphor-flag-pennant": "M970.52 385.76l-736-256c-3.134-1.127-6.751-1.779-10.52-1.779-17.673 0-32 14.327-32 32 0 0.007 0 0.013 0 0.020l-0-0.001v704c0 17.673 14.327 32 32 32s32-14.327 32-32v0-169.24l714.52-248.52c12.64-4.469 21.534-16.316 21.534-30.24s-8.893-25.771-21.31-30.171l-0.224-0.069zM256 627v-422l606.6 211z",
  "phosphor-car": "M960 416h-43.2l-111.12-250c-10.218-22.576-32.548-38-58.48-38l-470.4-0c-25.932 0-48.262 15.424-58.317 37.598l-0.163 0.402-111.12 250h-43.2c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v320c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-64h384v64c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-320h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM276.8 192h470.4l99.56 224h-669.52zM256 800h-96v-64h96zM768 800v-64h96v64zM864 672h-704v-192h704zM224 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM672 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0z",
  "phosphor-car-simple": "M960 416h-43.2l-111.12-250c-10.218-22.576-32.548-38-58.48-38l-470.4-0c-25.932 0-48.262 15.424-58.317 37.598l-0.163 0.402-111.12 250h-43.2c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v320c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-64h384v64c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-320h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM276.8 192h470.4l99.56 224h-669.52zM864 800h-96v-96c0-17.673-14.327-32-32-32v0h-448c-17.673 0-32 14.327-32 32v0 96h-96v-320h704z",
  "phosphor-taxi": "M960 416h-45.44l-109.56-191.76c-11.239-19.399-31.9-32.239-55.56-32.24l-87.76-0-48-119.76c-9.609-23.773-32.499-40.24-59.236-40.24-0.043 0-0.087 0-0.13 0l0.007-0h-84.64c-0.061-0-0.132-0-0.204-0-26.737 0-49.628 16.467-59.083 39.813l-0.153 0.427-47.92 119.76h-87.76c-23.66 0.001-44.321 12.841-55.396 31.933l-0.164 0.307-109.56 191.76h-45.44c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v320c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-64h384v64c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-320h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM469.68 96h84.64l38.4 96h-161.44zM274.56 256h474.88l91.4 160h-657.68zM256 800h-96v-64h96zM768 800v-64h96v64zM864 672h-704v-192h704zM224 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM672 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0z",
  "phosphor-bus": "M736 128h-448c-70.692 0-128 57.308-128 128v0 576c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-64h256v64c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-576c0-70.692-57.308-128-128-128v0zM224 704v-224h576v224zM224 320h576v96h-576zM288 192h448c35.346 0 64 28.654 64 64v0h-576c0-35.346 28.654-64 64-64v0zM320 832h-96v-64h96zM704 832v-64h96v64zM416 592c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0zM704 592c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0zM992 320v96c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-96c0-17.673 14.327-32 32-32s32 14.327 32 32v0zM96 320v96c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-96c0-17.673 14.327-32 32-32s32 14.327 32 32v0z",
  "phosphor-train": "M736 96h-448c-70.692 0-128 57.308-128 128v0 512c0 70.692 57.308 128 128 128v0h32l-57.6 76.8c-3.996 5.281-6.4 11.96-6.4 19.2 0 17.673 14.327 32 32 32 10.433 0 19.7-4.993 25.542-12.72l0.058-0.080 86.4-115.2h224l86.4 115.2c5.9 7.807 15.167 12.8 25.6 12.8 17.673 0 32-14.327 32-32 0-7.24-2.404-13.919-6.458-19.28l0.058 0.080-57.6-76.8h32c70.692 0 128-57.308 128-128v0-512c0-70.692-57.308-128-128-128v0zM224 480v-160h256v160zM544 320h256v160h-256zM288 160h448c35.346 0 64 28.654 64 64v0 32h-576v-32c0-35.346 28.654-64 64-64v0zM736 800h-448c-35.346 0-64-28.654-64-64v0-192h576v192c0 35.346-28.654 64-64 64v0zM384 688c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0zM736 688c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0z",
  "phosphor-tram": "M736 192h-192v-96h128c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-320c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h128v96h-192c-70.692 0-128 57.308-128 128v0 416c0 70.692 57.308 128 128 128v0h32l-57.6 76.8c-3.996 5.281-6.4 11.96-6.4 19.2 0 17.673 14.327 32 32 32 10.433 0 19.7-4.993 25.542-12.72l0.058-0.080 86.4-115.2h224l86.4 115.2c5.9 7.807 15.167 12.8 25.6 12.8 17.673 0 32-14.327 32-32 0-7.24-2.404-13.919-6.458-19.28l0.058 0.080-57.6-76.8h32c70.692 0 128-57.308 128-128v0-416c0-70.692-57.308-128-128-128v0zM288 256h448c35.346 0 64 28.654 64 64v0 160h-576v-160c0-35.346 28.654-64 64-64v0zM736 800h-448c-35.346 0-64-28.654-64-64v0-192h576v192c0 35.346-28.654 64-64 64v0zM384 688c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0zM736 688c0 26.51-21.49 48-48 48s-48-21.49-48-48c0-26.51 21.49-48 48-48v0c26.51 0 48 21.49 48 48v0z",
  "phosphor-subway": "M896 384v448c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-448c-0.137-123.657-100.343-223.863-223.987-224l-192.013-0c-123.657 0.137-223.863 100.343-224 223.987l-0 0.013v448c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-448c0.182-158.985 129.015-287.818 287.983-288l192.017-0c158.985 0.182 287.818 129.015 288 287.983l0 0.017zM736 384v288c-0.007 46.347-32.855 85.019-76.54 94.013l-0.62 0.107 9.8 19.56c2.131 4.172 3.38 9.1 3.38 14.32 0 17.684-14.336 32.020-32.020 32.020-12.465 0-23.266-7.122-28.556-17.519l-0.084-0.182-23.12-46.32h-152.48l-23.12 46.32c-5.374 10.579-16.175 17.7-28.64 17.7-17.684 0-32.020-14.336-32.020-32.020 0-5.22 1.249-10.148 3.464-14.502l-0.084 0.182 9.8-19.56c-44.305-9.101-77.153-47.774-77.16-94.119l-0-0.001v-288c0-53.019 42.981-96 96-96v0h256c53.019 0 96 42.981 96 96v0zM352 384v192h320v-192c0-17.673-14.327-32-32-32v0h-256c-17.673 0-32 14.327-32 32v0zM480 640v64h64v-64zM384 704h32v-64h-64v32c0 17.673 14.327 32 32 32v0zM672 672v-32h-64v64h32c17.673 0 32-14.327 32-32v0z",
  "phosphor-airplane": "M942.32 515.36l-302.32-151.12v-172.24c0-70.692-57.308-128-128-128s-128 57.308-128 128v0 172.24l-302.32 151.12c-10.567 5.373-17.68 16.164-17.68 28.617 0 0.008 0 0.016 0 0.024l-0-0.001v128c0.010 17.665 14.333 31.982 32 31.982 2.222 0 4.392-0.227 6.487-0.658l-0.207 0.036 281.72-56.32v75.72l-54.64 54.6c-5.783 5.79-9.36 13.785-9.36 22.615 0 0.009 0 0.018 0 0.027l-0-0.001v128c-0 0.016-0 0.036-0 0.055 0 17.673 14.327 32 32 32 4.325 0 8.449-0.858 12.213-2.413l-0.213 0.078 148-59.24 148 59.24c3.551 1.477 7.675 2.335 12 2.335 17.673 0 32-14.327 32-32 0-0.019-0-0.039-0-0.058l0 0.003v-128c0-0.007 0-0.016 0-0.025 0-8.83-3.577-16.825-9.36-22.615l0 0-54.64-54.6v-75.72l281.72 56.32c1.888 0.396 4.058 0.622 6.28 0.622 17.667 0 31.99-14.317 32-31.981l0-0.001v-128c0-0.007 0-0.015 0-0.023 0-12.453-7.113-23.245-17.498-28.533l-0.182-0.084zM896 632.96l-281.72-56.32c-1.888-0.396-4.058-0.622-6.28-0.622-17.667 0-31.99 14.317-32 31.981l-0 0.001v128c-0 0.007-0 0.016-0 0.025 0 8.83 3.577 16.825 9.36 22.615l-0-0 54.64 54.6v67.48l-116-46.44c-3.517-1.447-7.601-2.287-11.88-2.287s-8.363 0.84-12.094 2.364l0.214-0.077-116.24 46.44v-67.48l54.64-54.6c5.783-5.79 9.36-13.785 9.36-22.615 0-0.009-0-0.018-0-0.027l0 0.001v-128c-0.010-17.665-14.333-31.982-32-31.982-2.222 0-4.392 0.227-6.487 0.658l0.207-0.036-281.72 56.32v-69.2l302.32-151.12c10.567-5.373 17.68-16.164 17.68-28.617 0-0.008-0-0.016-0-0.024l0 0.001v-192c0-35.346 28.654-64 64-64s64 28.654 64 64v0 192c-0 0.007-0 0.015-0 0.023 0 12.453 7.113 23.245 17.498 28.533l0.182 0.084 302.32 151.12z",
  "phosphor-airplane-landing": "M1024 864c0 17.673-14.327 32-32 32v0h-576c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h576c17.673 0 32 14.327 32 32v0zM919.36 766.8l-706.52-197.84c-67.863-19.63-116.675-81.132-116.84-154.061l-0-0.019v-222.88c-0-0.001-0-0.003-0-0.005 0-35.346 28.654-64 64-64 7.241 0 14.2 1.202 20.691 3.418l-0.451-0.134 21.88 7.28c9.334 3.167 16.597 10.259 19.928 19.258l0.072 0.222 42.4 117.48 119.48 34.040v-117.56c-0-0.001-0-0.003-0-0.005 0-35.346 28.654-64 64-64 7.241 0 14.2 1.202 20.691 3.418l-0.451-0.134 21.88 7.28c8.824 3.002 15.774 9.495 19.321 17.791l0.079 0.209 90 214.52 243.36 68c68.012 19.552 116.959 81.138 117.12 154.181l0 0.019v142.72c-0.007 17.668-14.331 31.988-32 31.988-3.076 0-6.051-0.434-8.866-1.244l0.226 0.056zM896 593.28c-0.12-43.844-29.502-80.792-69.64-92.352l-0.68-0.168-258.28-72c-9.518-2.711-17.082-9.462-20.841-18.232l-0.079-0.208-90.48-215.64-8-2.68v160c0 0.007 0 0.014 0 0.022 0 17.673-14.327 32-32 32-3.12 0-6.135-0.446-8.986-1.279l0.226 0.057-176-50.16c-9.973-2.923-17.786-10.303-21.249-19.778l-0.071-0.222-42.76-118.28-7.16-2.36v222.88c0.112 43.777 29.399 80.684 69.439 92.311l0.681 0.169 665.88 186.44z",
  "phosphor-airplane-takeoff": "M704 864c0 17.673-14.327 32-32 32v0h-576c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h576c17.673 0 32 14.327 32 32v0zM991.44 372.6c-1.777 9.216-7.304 16.882-14.897 21.48l-0.143 0.080-589.64 352c-23.202 13.833-51.159 22.030-81.026 22.080l-0.014 0c-42.298-0.050-80.723-16.596-109.193-43.549l0.073 0.069-0.48-0.48-144.12-141.080c-12.287-11.685-19.929-28.154-19.929-46.409 0-25.89 15.373-48.189 37.489-58.268l0.401-0.163 12-5.88c4.115-2.066 8.968-3.275 14.102-3.275 3.656 0 7.17 0.613 10.443 1.743l-0.225-0.068 113.040 38.16 80.68-48.8-87.32-84.76c-12.706-11.733-20.635-28.475-20.635-47.069 0-26.222 15.77-48.761 38.344-58.65l0.411-0.161 1.28-0.52 28.6-10.84c3.322-1.277 7.164-2.017 11.18-2.017s7.858 0.74 11.4 2.090l-0.22-0.074 215.76 79.28 206.28-123.12c23.277-14.077 51.397-22.407 81.462-22.407 49.779 0 94.224 22.835 123.432 58.601l0.227 0.286 0.48 0.6 74.56 95.56c4.209 5.366 6.749 12.215 6.749 19.657 0 2.087-0.2 4.128-0.582 6.104l0.032-0.201zM912.48 357.8l-52-66.68c-17.651-21.475-44.216-35.066-73.955-35.066-17.994 0-34.826 4.976-49.196 13.626l0.431-0.24-219.2 130.88c-4.701 2.833-10.376 4.508-16.443 4.508-3.961 0-7.755-0.714-11.26-2.021l0.223 0.073-219.080-80.56-16 6.12 0.84 0.8 117.44 113.96c5.986 5.821 9.7 13.952 9.7 22.95 0 11.545-6.114 21.662-15.281 27.29l-0.139 0.080-128.84 77.96c-4.718 2.894-10.431 4.608-16.544 4.608-3.671 0-7.197-0.618-10.481-1.756l0.225 0.068-114.68-38.68-0.76 0.4-1.48 0.68c0.196 0.141 0.367 0.299 0.517 0.476l0.003 0.004 144 141.040c17.027 16.029 40.028 25.88 65.33 25.88 17.827 0 34.512-4.89 48.787-13.401l-0.437 0.242z",
  "phosphor-bicycle": "M832 448c-0.025-0-0.054-0-0.084-0-24.307 0-47.554 4.535-68.943 12.804l1.306-0.444-100.56-172.36h104.28c17.673 0 32 14.327 32 32v0c0 17.673 14.327 32 32 32s32-14.327 32-32v0c0-53.019-42.981-96-96-96v0h-160c-17.642 0.041-31.927 14.352-31.927 32 0 5.891 1.592 11.41 4.369 16.151l-0.082-0.151 46.6 80h-229.92l-65.4-112c-5.624-9.612-15.886-15.972-27.636-16l-0.004-0h-112c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h93.64l54.84 94.040-62.84 86.2c-25.099-12.834-54.75-20.355-86.158-20.355-106.326 0-192.52 86.194-192.52 192.52s86.194 192.52 192.52 192.52c106.326 0 192.52-86.194 192.52-192.52 0-52.309-20.862-99.746-54.72-134.444l0.038 0.039 46.36-63.6 124.68 213.6c5.362 10.598 16.17 17.737 28.646 17.737 17.673 0 32-14.327 32-32 0-6.61-2.004-12.752-5.438-17.852l0.072 0.114-121.28-208h229.92l44.76 76.68c-42.221 35.461-68.871 88.278-68.871 147.32 0 106.039 85.961 192 192 192s192-85.961 192-192c0-106.039-85.961-192-192-192-0.059 0-0.119 0-0.178 0l0.009-0zM320 640c0 0.011 0 0.023 0 0.036 0 70.692-57.308 128-128 128s-128-57.308-128-128c0-70.692 57.308-128 128-128 16.981 0 33.19 3.307 48.018 9.312l-0.858-0.307-73 100c-4.266 5.387-6.844 12.282-6.844 19.778 0 17.673 14.327 32 32 32 10.993 0 20.692-5.544 26.453-13.988l0.071-0.11 73-100c18.148 21.869 29.16 50.228 29.16 81.158 0 0.043-0 0.085-0 0.128l0-0.006zM832 768c-70.65-0.056-127.902-57.342-127.902-128 0-35.531 14.477-67.68 37.854-90.872l0.008-0.008 62.4 106.88c5.362 10.598 16.17 17.737 28.646 17.737 17.673 0 32-14.327 32-32 0-6.61-2.004-12.752-5.438-17.852l0.072 0.114-62.44-107.16c10.447-3.072 22.45-4.84 34.866-4.84 70.692 0 128 57.308 128 128s-57.308 128-128 128c-0.023 0-0.046-0-0.069-0l0.004 0z",
  "phosphor-motorcycle": "M864 480c-9.34 0.022-18.476 0.821-27.369 2.337l0.969-0.137-23.28-60.56c14.923-3.576 32.059-5.631 49.674-5.64l0.006-0c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-76.48l-53.64-139.48c-4.746-12.105-16.325-20.52-29.87-20.52-0.004 0-0.007 0-0.011 0l-127.999-0c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h106.040l36.92 96h-110.96c-74 0-134 17.24-173.48 49.84-10.884 8.836-24.909 14.188-40.184 14.188-9.744 0-18.98-2.178-27.247-6.073l0.391 0.165c-42.32-19.24-242.96-100.8-260.64-107.72l-22.84-8.96c-5.823-2.619-12.578-4.533-19.656-5.405l-0.344-0.035c-17.64 0.044-31.923 14.354-31.923 32 0 13.516 8.379 25.074 20.226 29.764l0.217 0.076c1.84 0.72 188.76 73.2 288.52 118.52 15.637 7.291 33.949 11.544 53.253 11.544 30.802 0 59.075-10.829 81.219-28.888l-0.233 0.184c19.44-16 58.28-35.2 132.76-35.2h75.28c-45.779 36.964-79.688 86.964-96.182 144.335l-0.498 2.025c-7.954 26.592-32.198 45.642-60.892 45.642-0.164 0-0.329-0.001-0.493-0.002l0.025 0h-208.48c-15.408-73.554-79.729-128-156.767-128-88.366 0-160 71.634-160 160s71.634 160 160 160c77.038 0 141.36-54.446 156.584-126.958l0.183-1.042h208.48c0.084 0 0.182 0 0.281 0 57.941 0 106.864-38.606 122.451-91.498l0.228-0.903c16.761-58.291 54.936-105.753 105.25-134.3l1.11-0.58 23.28 60.52c-44.63 28.888-73.746 78.424-73.746 134.76 0 88.366 71.634 160 160 160s160-71.634 160-160c0-88.366-71.634-160-160-160-0.047 0-0.094 0-0.141 0l0.007-0zM160 672h90.48c-13.577 37.605-48.961 64-90.51 64-53.019 0-96-42.981-96-96s42.981-96 96-96c41.549 0 76.933 26.395 90.298 63.332l0.211 0.668h-90.48c-17.673 0-32 14.327-32 32s14.327 32 32 32v0zM864 736c-52.968-0.068-95.881-43.023-95.881-96 0-29.118 12.964-55.208 33.434-72.814l0.127-0.106 32.44 84.4c4.746 12.11 16.33 20.529 29.88 20.529 17.678 0 32.009-14.331 32.009-32.009 0-4.128-0.782-8.074-2.205-11.697l0.075 0.217-32.48-84.52h2.6c53.019 0 96 42.981 96 96s-42.981 96-96 96v0z",
  "phosphor-scooter": "M848 544c-4.72 0-9.4 0.24-14.040 0.68l-131.6-394.8c-4.368-12.822-16.305-21.88-30.358-21.88-0.001 0-0.002 0-0.003 0l-128-0c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h104.92l69.76 209.24-221.84 270.76h-177.76c-8.348-72.321-69.229-127.949-143.103-127.949-79.529 0-144 64.471-144 144s64.471 144 144 144c62.342 0 115.432-39.617 135.466-95.048l0.317-1.003h200.24c0.002 0 0.004 0 0.007 0 9.95 0 18.84-4.542 24.709-11.665l0.044-0.055 205.84-251.24 30.64 92c-41.687 25.722-69.054 71.145-69.054 122.96 0 79.529 64.471 144 144 144s144-64.471 144-144c0-79.529-64.471-144-144-144-0.065 0-0.131 0-0.196 0l0.010-0zM176 768c-44.183 0-80-35.817-80-80s35.817-80 80-80c44.183 0 80 35.817 80 80v0c0 44.183-35.817 80-80 80v0zM848 768c-44.183 0-80-35.817-80-80s35.817-80 80-80c44.183 0 80 35.817 80 80v0c0 44.183-35.817 80-80 80v0z",
  "phosphor-boat": "M884.24 442.36l-52.24-17.44v-200.92c0-35.346-28.654-64-64-64v0h-224v-64c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 64h-224c-35.346 0-64 28.654-64 64v0 200.92l-52.24 17.44c-25.643 8.735-43.76 32.61-43.76 60.715 0 0.002 0 0.003 0 0.005l-0-0v104.92c0 246.16 391.56 346.88 408.24 351.040 2.33 0.607 5.004 0.955 7.76 0.955s5.43-0.348 7.982-1.003l-0.222 0.048c16.68-4.16 408.24-104.88 408.24-351.040v-104.92c0-0.001 0-0.003 0-0.005 0-28.106-18.117-51.98-43.31-60.582l-0.45-0.134zM256 224h512v179.6l-245.88-81.96c-3.020-1.041-6.5-1.642-10.12-1.642s-7.1 0.601-10.345 1.709l0.225-0.067-245.88 81.96zM864 608c0 99.64-94.72 172-174.2 215.32-50.679 27.559-109.662 51.922-171.35 69.945l-6.45 1.615c-67.738-19.435-126.382-43.57-181.599-73.257l4.839 2.377c-144.84-78.6-175.24-160.84-175.24-216v-104.92l320-106.68v275.6c0 17.673 14.327 32 32 32s32-14.327 32-32v0-275.6l320 106.68z",
  "phosphor-truck": "M1021.68 468l-56-140c-9.668-23.645-32.494-40-59.141-40-0.077 0-0.154 0-0.231 0l0.012-0h-138.32v-32c0-17.673-14.327-32-32-32v0h-608c-35.346 0-64 28.654-64 64v0 448c0 35.346 28.654 64 64 64v0h68c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h200c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h68c35.346 0 64-28.654 64-64v0-256c0-0.025 0-0.054 0-0.084 0-4.295-0.852-8.39-2.397-12.127l0.077 0.211zM768 352h138.32l38.4 96h-176.72zM128 288h576v256h-576zM320 832c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM644 736h-200c-14.63-55.774-64.588-96.251-124-96.251s-109.37 40.477-123.801 95.359l-0.199 0.892h-68v-128h576v49.24c-29.355 17.188-50.963 44.911-59.795 77.862l-0.205 0.898zM768 832c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM960 736h-68c-14.799-55.621-64.683-95.942-123.994-96l-0.006-0v-128h192z",
  "phosphor-van": "M1016.28 427.16l-182.16-212.24c-11.82-14.052-29.412-22.92-49.076-22.92-0.001 0-0.003 0-0.004 0l-657.040-0c-35.346 0-64 28.654-64 64v0 448c0 35.346 28.654 64 64 64v0h68c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h200c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h68c35.346 0 64-28.654 64-64v0-256c-0.001-7.98-2.923-15.277-7.755-20.881l0.035 0.041zM922.36 416h-218.36v-160h81.040zM416 416v-160h224v160zM352 256v160h-224v-160zM320 800c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM768 800c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM892 704c-14.63-55.774-64.588-96.251-124-96.251s-109.37 40.477-123.801 95.359l-0.199 0.892h-200c-14.63-55.774-64.588-96.251-124-96.251s-109.37 40.477-123.801 95.359l-0.199 0.892h-68v-224h832v224z",
  "phosphor-cable-car": "M991.48 122.36c-2.783-15.072-15.823-26.338-31.495-26.338-1.988 0-3.934 0.181-5.821 0.528l0.197-0.030-896 160c-15.032 2.817-26.256 15.838-26.256 31.48 0 17.636 14.267 31.94 31.89 32l0.006 0c2.008-0.003 3.974-0.177 5.885-0.51l-0.205 0.030 410.32-73.32v137.8h-224c-70.692 0-128 57.308-128 128v0 256c0 70.692 57.308 128 128 128v0h512c70.692 0 128-57.308 128-128v0-256c0-70.692-57.308-128-128-128v0h-224v-149.2l421.6-75.28c15.094-2.764 26.384-15.815 26.384-31.503 0-1.999-0.183-3.956-0.534-5.854l0.030 0.197zM416 640v-192h192v192zM256 448h96v192h-160v-128c0-35.346 28.654-64 64-64v0zM768 832h-512c-35.346 0-64-28.654-64-64v0-64h640v64c0 35.346-28.654 64-64 64v0zM832 512v128h-160v-192h96c35.346 0 64 28.654 64 64v0z",
  "phosphor-anchor": "M864 544c-17.673 0-32 14.327-32 32v0c0 98.76-55.080 118.56-152.4 145.12-45.44 12.4-96.48 26.4-135.6 57.36v-266.48h128c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-128v-100c55.647-14.719 96-64.615 96-123.935 0-70.692-57.308-128-128-128s-128 57.308-128 128c0 59.321 40.353 109.217 95.107 123.734l0.893 0.201v100h-128c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h128v266.48c-39.12-30.96-90.16-44.96-135.6-57.36-97.32-26.56-152.4-46.36-152.4-145.12 0-17.673-14.327-32-32-32s-32 14.327-32 32v0c0 152.44 110.68 182.64 199.6 206.88 97.32 26.56 152.4 46.36 152.4 145.12 0 17.673 14.327 32 32 32s32-14.327 32-32v0c0-98.76 55.080-118.56 152.4-145.12 88.92-24.24 199.6-54.44 199.6-206.88 0-17.673-14.327-32-32-32v0zM448 224c0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64v0c-35.346 0-64-28.654-64-64v0z",
  "phosphor-lifebuoy": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM668.4 623.16c22.257-30.87 35.597-69.457 35.597-111.16s-13.34-80.29-35.985-111.727l0.388 0.567 114-113.96c50.766 60.498 81.604 139.208 81.604 225.12s-30.838 164.622-82.048 225.663l0.444-0.543zM384 512c0-70.692 57.308-128 128-128s128 57.308 128 128c0 70.692-57.308 128-128 128v0c-70.692 0-128-57.308-128-128v0zM737.12 241.6l-113.96 114c-30.87-22.257-69.457-35.597-111.16-35.597s-80.29 13.34-111.727 35.985l0.567-0.388-113.96-114c60.498-50.766 139.208-81.604 225.12-81.604s164.622 30.838 225.663 82.048l-0.543-0.444zM241.6 286.88l114 113.96c-22.257 30.87-35.597 69.457-35.597 111.16s13.34 80.29 35.985 111.727l-0.388-0.567-114 113.96c-50.766-60.498-81.604-139.208-81.604-225.12s30.838-164.622 82.048-225.663l-0.444 0.543zM286.88 782.4l113.96-114c30.87 22.257 69.457 35.597 111.16 35.597s80.29-13.34 111.727-35.985l-0.567 0.388 113.96 114c-60.498 50.766-139.208 81.604-225.12 81.604s-164.622-30.838-225.663-82.048l0.543 0.444z",
  "phosphor-lighthouse": "M832 320c-17.673 0-32 14.327-32 32v0 64h-44.6l-19.4-195.2c-0.873-8.333-4.827-15.606-10.685-20.77l-0.035-0.030-172.32-153.16c-11.013-9.223-25.332-14.824-40.96-14.824s-29.947 5.601-41.060 14.906l0.1-0.082-0.8 0.68-171.52 152.48c-5.893 5.194-9.847 12.467-10.708 20.661l-0.012 0.139-19.4 195.2h-44.6v-64c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 96c0 17.673 14.327 32 32 32v0h70.16l-37.88 377.92c-0.184 1.823-0.289 3.939-0.289 6.080 0 35.346 28.654 64 64 64 0.003 0 0.007-0 0.010-0l447.999 0c35.34-0.009 63.985-28.659 63.985-64 0-2.197-0.111-4.369-0.327-6.509l0.022 0.269-37.84-377.76h70.16c17.673 0 32-14.327 32-32v0-96c0-17.673-14.327-32-32-32v0zM512 96l108 96h-216zM348.96 256h326.080l16 160h-147.040v-64c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 64h-147.080zM288 864l16-160h416l16 160zM713.56 640h-403.12l16-160h371.040z",
  "phosphor-house": "M877.24 434.72l-320-320c-11.58-11.573-27.574-18.73-45.24-18.73s-33.66 7.157-45.24 18.731l-320 320c-11.588 11.504-18.76 27.441-18.76 45.054 0 0.079 0 0.159 0 0.238l-0-0.012v384c0 17.673 14.327 32 32 32v0h256c17.673 0 32-14.327 32-32v0-224h128v224c0 17.673 14.327 32 32 32v0h256c17.673 0 32-14.327 32-32v0-384c0-0.067 0-0.147 0-0.226 0-17.613-7.173-33.55-18.757-45.050l-0.004-0.004zM832 832h-192v-224c0-17.673-14.327-32-32-32v0h-192c-17.673 0-32 14.327-32 32v0 224h-192v-352l320-320 320 320z",
  "phosphor-house-simple": "M877.24 434.72l-320-320c-11.58-11.573-27.574-18.73-45.24-18.73s-33.66 7.157-45.24 18.731l-320 320c-11.588 11.504-18.76 27.441-18.76 45.054 0 0.079 0 0.159 0 0.238l-0-0.012v384c0 17.673 14.327 32 32 32v0h704c17.673 0 32-14.327 32-32v0-384c0-0.067 0-0.147 0-0.226 0-17.613-7.173-33.55-18.757-45.050l-0.004-0.004zM832 832h-640v-352l320-320 320 320z",
  "phosphor-building": "M928 896h-96v-768h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-704c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v768h-96c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h832c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM256 128h512v768h-128v-160c0-17.673-14.327-32-32-32v0h-192c-17.673 0-32 14.327-32 32v0 160h-128zM576 896h-128v-128h128zM352 256c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM544 256c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM352 416c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM544 416c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM352 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM544 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0z",
  "phosphor-building-office": "M992 832h-64v-448c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-192v-128c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-576c-17.673 0-32 14.327-32 32s14.327 32 32 32v0 640h-64c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h896c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM864 384v448h-128v-448zM224 192h448v640h-96v-192c0-17.673-14.327-32-32-32v0h-192c-17.673 0-32 14.327-32 32v0 192h-96zM512 832h-128v-160h128zM288 320c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM480 320c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM288 480c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM480 480c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0z",
  "phosphor-buildings": "M960 832h-64v-448c0-35.346-28.654-64-64-64v0h-256v-192c0-0.012 0-0.027 0-0.042 0-35.346-28.654-64-64-64-13.239 0-25.54 4.020-35.747 10.906l0.227-0.145-320 213.28c-17.272 11.643-28.48 31.132-28.48 53.238 0 0.043 0 0.085 0 0.128l-0-0.007v490.64h-64c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h896c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM832 384v448h-256v-448zM192 341.36l320-213.36v704h-320zM448 448v64c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-64c0-17.673 14.327-32 32-32s32 14.327 32 32v0zM320 448v64c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-64c0-17.673 14.327-32 32-32s32 14.327 32 32v0zM320 672v64c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-64c0-17.673 14.327-32 32-32s32 14.327 32 32v0zM448 672v64c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-64c0-17.673 14.327-32 32-32s32 14.327 32 32v0z",
  "phosphor-hospital": "M992 832h-32v-320c0-35.346-28.654-64-64-64v0h-224v-256c0-35.346-28.654-64-64-64v0h-384c-35.346 0-64 28.654-64 64v0 640h-32c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h864c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM896 512v320h-224v-320zM224 192h384v640h-64v-192c0-17.673-14.327-32-32-32v0h-192c-17.673 0-32 14.327-32 32v0 192h-64zM480 832h-128v-160h128zM288 384c0-17.673 14.327-32 32-32v0h64v-64c0-17.673 14.327-32 32-32s32 14.327 32 32v0 64h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64v64c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-64h-64c-17.673 0-32-14.327-32-32v0z",
  "phosphor-student": "M906.12 225.64l-384-128c-3.020-1.041-6.5-1.642-10.12-1.642s-7.1 0.601-10.345 1.709l0.225-0.067-384 128c-12.822 4.368-21.88 16.305-21.88 30.358 0 0.001 0 0.002 0 0.003l-0-0v320c0 17.673 14.327 32 32 32s32-14.327 32-32v0-275.6l134.36 44.76c-24.055 38.293-38.325 84.848-38.325 134.736 0 91.357 47.854 171.537 119.863 216.841l1.062 0.624c-72 28.24-134.24 79.32-179.76 149.16-3.413 5.012-5.45 11.2-5.45 17.863 0 17.673 14.327 32 32 32 11.332 0 21.287-5.89 26.973-14.775l0.077-0.128c60.28-92.48 155.48-145.48 261.2-145.48s200.92 53 261.2 145.48c5.829 8.577 15.54 14.137 26.55 14.137 17.673 0 32-14.327 32-32 0-6.342-1.845-12.252-5.027-17.225l0.077 0.128c-45.52-69.84-108-120.92-179.76-149.16 73.021-45.937 120.836-126.089 120.836-217.409 0-49.828-14.236-96.331-38.862-135.664l0.626 1.073 176.48-58.8c12.825-4.366 21.887-16.305 21.887-30.36s-9.062-25.994-21.662-30.293l-0.225-0.067zM704 480c0 0.016 0 0.035 0 0.054 0 106.039-85.961 192-192 192s-192-85.961-192-192c0-42.851 14.038-82.423 37.765-114.369l-0.365 0.515 144.48 48c3.020 1.041 6.5 1.642 10.12 1.642s7.1-0.601 10.345-1.709l-0.225 0.067 144.48-48c23.361 31.382 37.4 70.906 37.4 113.71 0 0.032-0 0.063-0 0.095l0-0.005zM512 350.28l-282.8-94.28 282.8-94.28 282.8 94.28z",
  "phosphor-graduation-cap": "M1007.040 355.76l-480-256c-4.355-2.365-9.535-3.755-15.040-3.755s-10.685 1.39-15.209 3.838l0.169-0.084-480 256c-10.163 5.497-16.95 16.076-16.95 28.24s6.787 22.743 16.781 28.156l0.169 0.084 111.040 59.24v193.68c-0 0.040-0 0.087-0 0.135 0 16.346 6.163 31.253 16.292 42.524l-0.052-0.058c52.4 58.36 169.8 156.24 367.76 156.24 1.278 0.011 2.788 0.018 4.301 0.018 67.519 0 132.032-12.868 191.22-36.286l-3.521 1.228v131.040c0 17.673 14.327 32 32 32s32-14.327 32-32v0-161.96c43-25.088 79.825-55.073 111.415-89.894l0.345-0.386c10.077-11.212 16.24-26.119 16.24-42.465 0-0.047-0-0.095-0-0.142l0 0.007v-193.68l111.040-59.24c10.163-5.497 16.95-16.076 16.95-28.24s-6.787-22.743-16.781-28.156l-0.169-0.084zM512 800c-173.080 0-274.88-84.56-320-134.84v-159.56l304.96 162.64c4.355 2.365 9.535 3.755 15.040 3.755s10.685-1.39 15.209-3.838l-0.169 0.084 176.96-94.36v185.36c-50.4 23.52-113.92 40.76-192 40.76zM832 665c-19.070 21.104-40.034 39.846-62.827 56.2l-1.173 0.8v-182.28l64-34.12zM752 475.76l-0.88-0.52-224-119.48c-4.232-2.207-9.243-3.502-14.556-3.502-17.673 0-32 14.327-32 32 0 11.974 6.577 22.413 16.316 27.899l0.16 0.083 186.96 99.76-172 91.72-412-219.72 412-219.72 412 219.72z",
  "phosphor-police-car": "M960 416h-45.44l-109.56-191.76c-11.239-19.399-31.9-32.239-55.56-32.24l-474.88-0c-23.66 0.001-44.321 12.841-55.396 31.933l-0.164 0.307-109.56 191.76h-45.44c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v320c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-64h384v64c0 35.346 28.654 64 64 64v0h96c35.346 0 64-28.654 64-64v0-320h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM274.56 256h474.88l91.4 160h-657.68zM256 800h-96v-64h96zM768 800v-64h96v64zM864 672h-704v-192h704zM224 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM672 576c0-17.673 14.327-32 32-32v0h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-64c-17.673 0-32-14.327-32-32v0zM384 96c0-17.673 14.327-32 32-32v0h192c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-192c-17.673 0-32-14.327-32-32v0z",
  "phosphor-fire-truck": "M1021.72 468l-56-140c-9.668-23.645-32.495-40.001-59.141-40.001-0.091 0-0.182 0-0.273 0.001l0.014-0h-138.32v-32c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 401.24c-29.355 17.188-50.963 44.911-59.795 77.862l-0.205 0.898h-200c-14.63-55.774-64.588-96.251-124-96.251s-109.37 40.477-123.801 95.359l-0.199 0.892h-68v-192c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 192c0 35.346 28.654 64 64 64v0h68c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h200c14.63 55.774 64.588 96.251 124 96.251s109.37-40.477 123.801-95.359l0.199-0.892h68c35.346 0 64-28.654 64-64v0-256c0-0.059 0.001-0.128 0.001-0.198 0-4.252-0.838-8.309-2.357-12.014l0.077 0.211zM906.32 352l38.4 96h-176.72v-96zM320 832c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM768 832c-35.346 0-64-28.654-64-64s28.654-64 64-64c35.346 0 64 28.654 64 64v0c0 35.346-28.654 64-64 64v0zM892 736c-14.799-55.621-64.683-95.942-123.994-96l-0.006-0v-128h192v224zM96 384c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h512c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-64v-96h64c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-512c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h64v96zM480 384h-96v-96h96zM224 288h96v96h-96z",
  "phosphor-church": "M912.48 580.56l-144.48-86.68v-77.88c0.001-0.085 0.001-0.186 0.001-0.286 0-11.783-6.368-22.078-15.85-27.632l-0.151-0.082-208-118.56v-77.44h64c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-64v-64c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 64h-64c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h64v77.44l-208 118.76c-9.633 5.636-16.001 15.931-16.001 27.714 0 0.101 0 0.201 0.001 0.302l-0-0.015v77.88l-144.48 86.48c-9.362 5.696-15.52 15.844-15.52 27.43 0 0.003 0 0.007 0 0.010l-0-0.001v256c0 17.673 14.327 32 32 32v0h320c17.673 0 32-14.327 32-32v0-192c0-17.673 14.327-32 32-32s32 14.327 32 32v0 192c0 17.673 14.327 32 32 32v0h320c17.673 0 32-14.327 32-32v0-256c0-0.003 0-0.006 0-0.010 0-11.586-6.158-21.734-15.379-27.35l-0.141-0.080zM160 626.12l96-57.6v263.48h-96zM512 576c-53.019 0-96 42.981-96 96v0 160h-96v-397.44l192-109.72 192 109.72v397.44h-96v-160c0-53.019-42.981-96-96-96v0zM864 832h-96v-263.48l96 57.6z",
  "phosphor-bank": "M96 416h96v256h-64c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h768c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-64v-256h96c17.659-0.018 31.968-14.338 31.968-32 0-11.458-6.022-21.509-15.073-27.162l-0.135-0.078-416-256c-4.768-2.976-10.558-4.74-16.76-4.74s-11.992 1.764-16.895 4.819l0.135-0.079-416 256c-9.186 5.731-15.208 15.782-15.208 27.24 0 17.662 14.308 31.982 31.966 32l0.002 0zM256 416h128v256h-128zM576 416v256h-128v-256zM768 672h-128v-256h128zM512 165.56l302.96 186.44h-605.92zM992 832c0 17.673-14.327 32-32 32v0h-896c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h896c17.673 0 32 14.327 32 32v0z",
  "phosphor-gas-pump": "M964 278.64l-77.36-77.28c-5.794-5.794-13.799-9.378-22.64-9.378-17.683 0-32.018 14.335-32.018 32.018 0 8.841 3.584 16.846 9.378 22.64l0 0 77.28 77.36c5.762 5.768 9.333 13.724 9.36 22.515l0 0.005v325.48c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-160c0-53.019-42.981-96-96-96v0h-64v-192c0-53.019-42.981-96-96-96v0h-320c-53.019 0-96 42.981-96 96v0 608h-64c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h640c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-64v-352h64c17.673 0 32 14.327 32 32v0 160c0 53.019 42.981 96 96 96s96-42.981 96-96v0-325.48c0-0.108 0.001-0.236 0.001-0.363 0-26.373-10.702-50.247-27.999-67.515l-0.001-0.001zM256 832v-608c0-17.673 14.327-32 32-32v0h320c17.673 0 32 14.327 32 32v0 608zM576 448c0 17.673-14.327 32-32 32v0h-192c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h192c17.673 0 32 14.327 32 32v0z",
  "phosphor-charging-station": "M538.48 494.040c3.458 5.035 5.523 11.262 5.523 17.971 0 4.275-0.838 8.355-2.36 12.083l0.077-0.214-64 160c-4.864 11.876-16.333 20.089-29.72 20.089-17.689 0-32.029-14.34-32.029-32.029 0-4.302 0.848-8.406 2.386-12.153l-0.078 0.213 46.44-116h-80.72c-0.016 0-0.036 0-0.055 0-17.673 0-32-14.327-32-32 0-4.325 0.858-8.449 2.413-12.213l-0.078 0.213 64-160c4.88-11.856 16.343-20.051 29.72-20.051 17.701 0 32.051 14.35 32.051 32.051 0 4.325-0.856 8.449-2.409 12.213l0.078-0.213-46.44 116h80.72c10.967 0.002 20.645 5.52 26.409 13.931l0.071 0.109zM992 346.52v325.48c0 53.019-42.981 96-96 96s-96-42.981-96-96v0-160c0-17.673-14.327-32-32-32v0h-64v352h64c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-640c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h64v-608c0-53.019 42.981-96 96-96v0h320c53.019 0 96 42.981 96 96v0 192h64c53.019 0 96 42.981 96 96v0 160c0 17.673 14.327 32 32 32s32-14.327 32-32v0-325.48c-0.027-8.796-3.598-16.752-9.36-22.52l-77.28-77.36c-5.794-5.794-9.378-13.799-9.378-22.64 0-17.683 14.335-32.018 32.018-32.018 8.841 0 16.846 3.584 22.64 9.378l-0-0 77.36 77.28c17.299 17.27 28.001 41.143 28.001 67.517 0 0.128-0 0.256-0.001 0.383l0-0.020zM640 832v-608c0-17.673-14.327-32-32-32v0h-320c-17.673 0-32 14.327-32 32v0 608z",
  "phosphor-plug-charging": "M896 224h-192v-160c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 160h-256v-160c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 160h-189.8c-25.080 0-34.2 19.12-34.2 32 0 17.673 14.327 32 32 32v0h64v352c0 88.366 71.634 160 160 160v0h128v160c0 17.673 14.327 32 32 32s32-14.327 32-32v0-160h128c88.366 0 160-71.634 160-160v0-352h64c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM672 736h-320c-53.019 0-96-42.981-96-96v0-352h512v352c0 53.019-42.981 96-96 96v0zM602.32 493.76c3.56 5.086 5.689 11.401 5.689 18.213 0 4.048-0.752 7.921-2.123 11.486l0.074-0.219-48 128c-4.685 12.253-16.345 20.797-30 20.797-17.693 0-32.037-14.343-32.037-32.037 0-4.038 0.747-7.901 2.11-11.459l-0.074 0.219 32-84.76h-81.96c-17.673-0.001-31.999-14.327-31.999-32 0-4.038 0.748-7.901 2.113-11.459l-0.074 0.219 48-128c4.685-12.253 16.345-20.797 30-20.797 17.693 0 32.037 14.343 32.037 32.037 0 4.038-0.747 7.901-2.11 11.459l0.074-0.219-32 84.76h81.96c0.008-0 0.018-0 0.027-0 10.849 0 20.438 5.399 26.224 13.657l0.068 0.103z",
  "phosphor-coffee": "M320 224v-128c0-17.673 14.327-32 32-32s32 14.327 32 32v0 128c0 17.673-14.327 32-32 32s-32-14.327-32-32v0zM480 256c17.673 0 32-14.327 32-32v0-128c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 128c0 17.673 14.327 32 32 32v0zM608 256c17.673 0 32-14.327 32-32v0-128c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 128c0 17.673 14.327 32 32 32v0zM992 480v32c-0.027 84.84-66.083 154.244-149.57 159.616l-0.47 0.024c-22.951 63.771-60.013 117.688-107.608 160.018l-0.392 0.342h98.040c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-704c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h98.16c-79.83-70.771-129.953-173.511-130.16-287.963l-0-0.037v-192c0-17.673 14.327-32 32-32v0h704c88.366 0 160 71.634 160 160v0zM800 384h-640v160c0.267 125.901 72.956 234.762 178.609 287.16l1.871 0.84h279.040c107.525-53.239 180.213-162.099 180.48-287.964l0-0.036zM928 480c-0.013-41.537-26.404-76.906-63.332-90.269l-0.668-0.211v154.48c-0.026 21.204-1.771 41.98-5.102 62.222l0.302-2.222c40.081-12.116 68.769-48.704 68.8-91.996l0-0.004z",
  "phosphor-bowl-food": "M896 416h-33.48c-17.052-180.029-167.469-319.755-350.52-319.755s-333.467 139.726-350.412 318.341l-0.108 1.414h-33.48c-17.673 0-32 14.327-32 32v0c0.304 159.522 90.048 298.012 221.744 368.025l2.256 1.095v14.88c0 35.346 28.654 64 64 64v0h256c35.346 0 64-28.654 64-64v0-14.88c133.952-71.108 223.696-209.598 224-369.078l0-0.042c0-17.673-14.327-32-32-32v0zM798.16 416h-205.68c38.584-57.306 95.917-99.43 163.064-117.81l2.016-0.47c21.126 33.835 35.577 73.952 40.478 116.967l0.122 1.313zM693.92 224.92q11 9 21.080 19c-86.166 30.913-155.148 91.911-195.677 170.044l-0.923 1.956h-118c41.023-112.618 147.047-191.638 271.565-191.92l0.035-0c7.32 0 14.64 0.36 21.92 0.92zM512 160c27.051 0.018 53.219 3.77 78.025 10.768l-2.025-0.488c-123.184 31.295-219.081 124.221-254.050 243.221l-0.63 2.499h-107.48c16.786-144.601 138.457-255.819 286.141-256l0.019-0zM658.64 768c-11.093 5.186-18.64 16.25-18.64 29.078 0 0.043 0 0.086 0 0.129l-0-0.007v34.8h-256v-34.8c0-0.036 0-0.079 0-0.122 0-12.827-7.548-23.892-18.444-28.995l-0.196-0.083c-112.504-52.667-191.689-159.828-203.888-286.566l-0.112-1.434h701.16c-12.287 128.149-91.425 235.303-201.719 287.088l-2.161 0.912z",
  "phosphor-fork-knife": "M288 352v-192c0-17.673 14.327-32 32-32s32 14.327 32 32v0 192c0 17.673-14.327 32-32 32s-32-14.327-32-32v0zM864 160v736c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-192h-192c-17.673 0-32-14.327-32-32v0c1.626-81.497 12.063-159.737 30.398-234.881l-1.518 7.361c39.12-161.96 113.28-270.52 214.52-313.88 3.715-1.634 8.047-2.585 12.6-2.585 17.668 0 31.991 14.318 32 31.984l0 0.001zM800 215.6c-128.68 98.28-153.88 337.68-158.8 424.4h158.8zM479.56 154.76c-2.381-15.526-15.643-27.279-31.65-27.279-17.673 0-32 14.327-32 32 0 2.050 0.193 4.056 0.561 5.999l-0.031-0.199 31.56 189.24c0 70.692-57.308 128-128 128s-128-57.308-128-128v0l31.52-189.24c0.337-1.744 0.53-3.749 0.53-5.799 0-17.673-14.327-32-32-32-16.007 0-29.269 11.753-31.627 27.101l-0.023 0.178-32 192c-0.255 1.533-0.4 3.299-0.4 5.099 0 0.049 0 0.099 0 0.148l-0-0.008c0.138 94.677 68.681 173.304 158.847 189.113l1.153 0.167v354.72c0 17.673 14.327 32 32 32s32-14.327 32-32v0-354.72c91.319-15.976 159.862-94.603 160-189.265l0-0.015c-0.006-1.855-0.166-3.668-0.467-5.433l0.027 0.193z",
  "phosphor-park": "M928 768h-128v-96h96c17.671-0.003 31.995-14.329 31.995-32 0-2.756-0.348-5.43-1.003-7.982l0.048 0.222-128-512c-3.601-14.023-16.13-24.221-31.040-24.221s-27.439 10.198-30.992 23.999l-0.048 0.222-128 512c-0.607 2.33-0.955 5.004-0.955 7.76 0 17.671 14.324 31.997 31.995 32l96 0v96h-256v-64h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-32v-64h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0h-352c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v64h-32c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h32v64h-96c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h832c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM768 260l87 348h-174zM256 576h160v64h-160zM256 704h160v64h-160zM464 384c61.856 0 112-50.144 112-112s-50.144-112-112-112c-61.856 0-112 50.144-112 112v0c0 61.856 50.144 112 112 112v0zM464 224c26.51 0 48 21.49 48 48s-21.49 48-48 48c-26.51 0-48-21.49-48-48v0c0-26.51 21.49-48 48-48v0z",
  "phosphor-tree": "M792.4 250.36c-47.161-110.512-154.899-186.561-280.4-186.561s-233.239 76.049-279.646 184.578l-0.754 1.983c-99.699 46.37-167.583 145.675-167.6 260.837l-0 0.003c-0.4 152.8 128 284.8 280.56 288.8 2.072 0.054 4.513 0.084 6.961 0.084 46.819 0 91.032-11.158 130.125-30.96l-1.645 0.756v158.12c0 17.673 14.327 32 32 32s32-14.327 32-32v0-158.12c37.314 18.937 81.351 30.056 127.979 30.12l0.021 0h7.28c152.72-4 281.16-136 280.72-288.8-0.017-115.164-67.901-214.47-165.834-260.101l-1.766-0.739zM677.8 736c-1.739 0.048-3.787 0.076-5.841 0.076-47.877 0-92.25-14.999-128.678-40.554l0.718 0.478v-164l174.32-87.12c10.579-5.374 17.7-16.175 17.7-28.64 0-17.684-14.336-32.020-32.020-32.020-5.22 0-10.148 1.249-14.502 3.464l0.182-0.084-145.68 72.64v-108.24c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 204.24l-145.68-72.88c-4.172-2.131-9.1-3.38-14.32-3.38-17.684 0-32.020 14.336-32.020 32.020 0 12.465 7.122 23.266 17.519 28.556l0.182 0.084 174.32 87.12v68c-35.676 25.078-80.018 40.079-127.863 40.079-2.088 0-4.169-0.029-6.243-0.085l0.306 0.007c-118.6-2.84-218.52-105.68-218.2-224.4-0-0.045-0-0.098-0-0.152 0-93.439 57.447-173.46 138.949-206.671l1.491-0.537c8.423-3.445 14.923-10.127 18.047-18.459l0.073-0.221c34.587-92.789 122.435-157.679 225.44-157.679s190.853 64.89 224.897 156.021l0.543 1.657c3.197 8.553 9.697 15.235 17.907 18.603l0.213 0.077c82.996 33.773 140.44 113.81 140.44 207.263 0 0.034-0 0.068-0 0.103l0-0.005c0.32 118.72-99.6 221.56-218.2 224.64z",
  "phosphor-mountains": "M656 320c61.856 0 112-50.144 112-112s-50.144-112-112-112c-61.856 0-112 50.144-112 112v0c0 61.856 50.144 112 112 112v0zM656 160c26.51 0 48 21.49 48 48s-21.49 48-48 48c-26.51 0-48-21.49-48-48v0c0-26.51 21.49-48 48-48v0zM1019.52 783.68l-218.24-368.32c-11.229-18.895-31.536-31.361-54.755-31.361-0.114 0-0.229 0-0.343 0.001l0.018-0c-0.098-0.001-0.215-0.001-0.331-0.001-23.205 0-43.499 12.467-54.548 31.068l-0.161 0.292-104.64 176.64-179.36-304.4c-11.33-19.009-31.781-31.544-55.16-31.544s-43.83 12.535-54.998 31.251l-0.162 0.293-292.4 496.16c-2.782 4.647-4.427 10.251-4.427 16.24 0 17.669 14.32 31.993 31.986 32l960.001 0c17.671-0.003 31.994-14.329 31.994-32 0-6.021-1.663-11.654-4.555-16.465l0.081 0.145zM352 320l94.28 160h-188.56zM88 768l132-224h264l132 224zM690.28 768l-66.64-113.12 122.56-206.88 189.8 320z",
  "phosphor-bridge": "M928 640h-128v-234.64c30.457 37.368 69.454 66.628 114.086 84.983l1.914 0.697c3.413 1.355 7.368 2.14 11.506 2.14 17.673 0 32-14.327 32-32 0-13.16-7.944-24.465-19.298-29.38l-0.207-0.080c-82.76-33.87-140.001-113.78-140.001-207.060 0-0.232 0-0.464 0.001-0.696l-0 0.036c0-17.673-14.327-32-32-32s-32 14.327-32 32v0c0 123.712-100.288 224-224 224s-224-100.288-224-224v0c0-17.673-14.327-32-32-32s-32 14.327-32 32v0c0.001 0.196 0.001 0.428 0.001 0.66 0 93.28-57.241 173.19-138.514 206.52l-1.487 0.54c-11.562 4.995-19.506 16.3-19.506 29.46 0 17.673 14.327 32 32 32 4.138 0 8.093-0.785 11.723-2.215l-0.217 0.075c46.546-19.052 85.543-48.312 115.588-85.159l0.412-0.521v234.64h-128c-17.673 0-32 14.327-32 32s14.327 32 32 32v0h128v96c0 17.673 14.327 32 32 32s32-14.327 32-32v0-96h448v96c0 17.673 14.327 32 32 32s32-14.327 32-32v0-96h128c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM576 504.8v135.2h-128v-135.2c19.23 4.577 41.308 7.201 64 7.201s44.77-2.624 65.949-7.586l-1.949 0.385zM288 404.8c25.963 31.912 57.943 57.846 94.349 76.32l1.651 0.76v158.12h-96zM640 640v-158.080c38.056-19.234 70.037-45.168 95.582-76.55l0.418-0.53v235.16z",
  "phosphor-tent": "M1021.24 755l-256-576c-5.109-11.288-16.274-19-29.24-19l-448-0c-12.853 0.022-23.927 7.618-28.998 18.562l-0.082 0.198c-0.005 0.036-0.009 0.078-0.009 0.12s0.003 0.084 0.009 0.125l-0.001-0.005v0.48l-256.16 575.52c-1.743 3.824-2.76 8.293-2.76 13 0 17.673 14.327 32 32 32l960 0c17.673-0 32-14.327 32-32 0-4.707-1.016-9.176-2.841-13.201l0.082 0.201zM256 736h-174.76l174.76-393.2zM320 736v-393.2l174.76 393.2zM564.8 736l-227.56-512h377.96l227.56 512z",
  "phosphor-bed": "M864 288h-736v-96c0-17.673-14.327-32-32-32s-32 14.327-32 32v0 640c0 17.673 14.327 32 32 32s32-14.327 32-32v0-128h832v128c0 17.673 14.327 32 32 32s32-14.327 32-32v0-384c0-88.366-71.634-160-160-160v0zM128 352h288v288h-288zM480 640v-288h384c53.019 0 96 42.981 96 96v0 192z",
  "phosphor-number-circle-zero": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM512 288c-56.92 0-104 25.76-136 74.44-25.88 39.44-40 92.56-40 149.56s14.24 110.12 40 149.56c32 48.72 78.96 74.44 136 74.44s104-25.72 136-74.44c25.88-39.44 40-92.56 40-149.56s-14.24-110.12-40-149.56c-32-48.68-79.080-74.44-136-74.44zM512 672c-88.4 0-112-100.56-112-160s23.6-160 112-160 112 100.56 112 160-23.6 160-112 160z",
  "phosphor-number-circle-one": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM560 320v384c0 17.673-14.327 32-32 32s-32-14.327-32-32v0-324l-46.24 30.84c-4.991 3.369-11.141 5.377-17.76 5.377-17.683 0-32.017-14.335-32.017-32.017 0-11.063 5.611-20.816 14.143-26.568l0.114-0.072 96-64c4.99-3.371 11.141-5.381 17.76-5.381 17.61 0 31.898 14.225 31.999 31.811l0 0.010z",
  "phosphor-number-circle-two": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM614.24 493.040l-134.24 178.96h128c17.673 0 32 14.327 32 32s-14.327 32-32 32v0h-192c-17.673 0-32-14.327-32-32 0-7.24 2.404-13.919 6.458-19.28l-0.058 0.080 172.68-230.24c7.997-10.565 12.809-23.927 12.809-38.412 0-35.346-28.654-64-64-64-27.604 0-51.127 17.476-60.107 41.968l-0.142 0.444c-4.53 12.536-16.328 21.334-30.18 21.334-17.681 0-32.014-14.333-32.014-32.014 0-3.828 0.672-7.5 1.905-10.903l-0.071 0.223c18.153-50.046 65.284-85.155 120.616-85.155 70.692 0 128 57.308 128 128 0 28.993-9.64 55.735-25.889 77.195l0.232-0.32z",
  "phosphor-number-circle-three": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM640 608c-0.021 79.513-64.484 143.964-144 143.964-40.273 0-76.684-16.532-102.817-43.18l-0.023-0.023c-6.169-5.846-10.009-14.097-10.009-23.246 0-17.673 14.327-32 32-32 9.377 0 17.813 4.034 23.666 10.46l0.023 0.026c14.531 14.816 34.759 24 57.131 24 44.183 0 80-35.817 80-80 0-44.173-35.801-79.984-79.97-80l-0.002-0c-17.669-0.005-31.991-14.33-31.991-32 0-6.875 2.168-13.244 5.858-18.46l-0.067 0.1 76.72-109.64h-130.52c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h192c17.669 0.005 31.991 14.33 31.991 32 0 6.875-2.168 13.244-5.858 18.46l0.067-0.1-84 120c53.125 22.082 89.8 73.557 89.8 133.599 0 0.014-0 0.029-0 0.043l0-0.002z",
  "phosphor-number-circle-four": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM640 576h-32v-256c-0.018-17.66-14.338-31.969-32-31.969-10.225 0-19.329 4.795-25.188 12.26l-0.052 0.069-224 288c-4.201 5.363-6.736 12.205-6.736 19.64 0 17.665 14.313 31.986 31.975 32l192.001 0v64c0 17.673 14.327 32 32 32s32-14.327 32-32v0-64h32c17.673 0 32-14.327 32-32s-14.327-32-32-32v0zM544 576h-126.56l126.56-162.72z",
  "phosphor-number-circle-five": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM475.12 352l-16.76 100.56c11.213-2.897 24.085-4.56 37.346-4.56 0.103 0 0.207 0 0.31 0l-0.016-0c79.529 0 144 64.471 144 144s-64.471 144-144 144v0c-0.695 0.012-1.515 0.019-2.336 0.019-39.247 0-74.78-15.904-100.504-41.62l0 0c-5.98-5.82-9.691-13.947-9.691-22.941 0-17.673 14.327-32 32-32 9.212 0 17.516 3.893 23.354 10.124l0.016 0.018c14.209 13.87 33.659 22.427 55.108 22.427 0.722 0 1.441-0.010 2.158-0.029l-0.106 0.002c44.183 0 80-35.817 80-80s-35.817-80-80-80v0c-0.611-0.017-1.331-0.027-2.052-0.027-21.449 0-40.899 8.556-55.124 22.442l0.016-0.015c-5.811 5.916-13.895 9.583-22.836 9.583-17.673 0-32-14.327-32-32 0-1.859 0.158-3.681 0.463-5.453l-0.027 0.19 32-192c2.622-15.257 15.752-26.719 31.56-26.72l160-0c17.673 0 32 14.327 32 32s-14.327 32-32 32v0z",
  "phosphor-number-circle-six": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM512 448c-2.44 0-4.88 0-7.28 0l66.76-111.6c2.841-4.684 4.522-10.346 4.522-16.4 0-17.674-14.328-32.002-32.002-32.002-11.62 0-21.793 6.193-27.4 15.459l-0.080 0.143-128.92 216c-12.273 20.749-19.524 45.728-19.524 72.4 0 79.529 64.471 144 144 144s144-64.471 144-144c0-79.529-64.471-144-144-144-0.027 0-0.053 0-0.080 0l0.004-0zM512 672c-44.183 0-80-35.817-80-80s35.817-80 80-80c44.183 0 80 35.817 80 80v0c0 44.183-35.817 80-80 80v0z",
  "phosphor-number-circle-seven": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM634.2 333.64c3.675 5.141 5.877 11.554 5.877 18.482 0 3.873-0.688 7.584-1.948 11.020l0.071-0.222-128 352c-4.596 12.402-16.324 21.080-30.079 21.080-0.042 0-0.085-0-0.127-0l0.007 0c-0.022 0-0.047 0-0.073 0-3.893 0-7.622-0.704-11.065-1.992l0.218 0.072c-12.402-4.596-21.081-16.324-21.081-30.080 0-3.918 0.704-7.672 1.993-11.142l-0.072 0.221 112.4-309.080h-146.32c-17.673 0-32-14.327-32-32s14.327-32 32-32v0h192c10.794 0.003 20.339 5.351 26.133 13.54l0.067 0.1z",
  "phosphor-number-circle-eight": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM599.24 493.56c25.109-23.433 40.76-56.721 40.76-93.665 0-70.692-57.308-128-128-128s-128 57.308-128 128c0 36.944 15.651 70.232 40.685 93.596l0.075 0.069c-34.645 26.573-56.76 67.987-56.76 114.565 0 79.529 64.471 144 144 144s144-64.471 144-144c0-46.578-22.115-87.992-56.417-114.313l-0.343-0.252zM448 400c0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64v0c-35.346 0-64-28.654-64-64v0zM512 688c-44.183 0-80-35.817-80-80s35.817-80 80-80c44.183 0 80 35.817 80 80v0c0 44.183-35.817 80-80 80v0z",
  "phosphor-number-circle-nine": "M512 96c-229.75 0-416 186.25-416 416s186.25 416 416 416c229.75 0 416-186.25 416-416v0c-0.25-229.65-186.35-415.75-415.976-416l-0.024-0zM512 864c-194.404 0-352-157.596-352-352s157.596-352 352-352c194.404 0 352 157.596 352 352v0c-0.228 194.313-157.687 351.772-351.978 352l-0.022 0zM584 307.28c-20.649-12.121-45.477-19.28-71.978-19.28-79.529 0-144 64.471-144 144 0 79.437 64.322 143.851 143.724 144l0.014 0q3.76 0 7.56-0.24l-66.8 112c-2.874 4.705-4.575 10.398-4.575 16.489 0 11.642 6.217 21.831 15.511 27.43l0.144 0.081c4.705 2.874 10.398 4.575 16.489 4.575 11.642 0 21.831-6.217 27.43-15.511l0.081-0.144 129.12-216.68c12.085-20.642 19.222-45.453 19.222-71.931 0-53.029-28.624-99.372-71.264-124.421l-0.677-0.368zM581.32 472v0c-14.087 24.091-39.83 40.018-69.292 40.018-44.183 0-80-35.817-80-80s35.817-80 80-80c14.716 0 28.505 3.974 40.35 10.906l-0.378-0.204c24.063 14.094 39.968 39.821 39.968 69.263 0 14.734-3.983 28.538-10.932 40.394l0.204-0.377z",
};

function hasPlayableAnimation() {
  return graphicsLayers.some(
    (layerData) => hasRealAnimations(layerData) || hasPointKeyframes(layerData)
  );
}

function hasCameraMotionKeyframes() {
  const viewTrack = getViewTrackLayerData();
  return Boolean(viewTrack && hasPointKeyframes(viewTrack));
}

function hasCameraEffectsForExport() {
  return currentViewMode === "3d" && Boolean(cameraStudioSettings.cinematicFxEnabled);
}

function canExportProject() {
  return hasPlayableAnimation() || hasCameraEffectsForExport();
}

function updatePrimaryActionsState() {
  const hasDrawableGraphics = graphicsLayers.some((layerData) => {
    if (isViewTrackLayer(layerData)) return false;
    const graphics = (layerData.layer as any)?.graphics;
    const count = graphics?.length ?? graphics?.items?.length ?? 0;
    return count > 0;
  });
  const hasCameraKeyframes = hasCameraMotionKeyframes();
  const selectedLayer = selectedLayerIndex >= 0 ? graphicsLayers[selectedLayerIndex] : null;
  const hasSelection =
    selectedLayerIndex >= 0 &&
    (!isViewTrackLayer(selectedLayer) || (selectedLayer ? hasPointKeyframes(selectedLayer) : false));
  const hasStyleableContent = hasDrawableGraphics || hasCameraKeyframes;
  const mapActionButtons = document.getElementById("map-action-buttons");
  const onboardingStep = document.getElementById("onboarding-step-draw");
  const onboardingStyleStep = document.getElementById("onboarding-step-style");
  if (mapActionButtons) {
    mapActionButtons.style.display = hasSelection ? "flex" : "none";
  }
  if (onboardingStep || onboardingStyleStep) {
    const setStepperState = (
      el: HTMLElement | null,
      options: { selected: boolean; complete?: boolean; disabled?: boolean }
    ) => {
      if (!el) return;
      if (options.complete !== undefined) {
        if (options.complete) {
          el.setAttribute("complete", "");
        } else {
          el.removeAttribute("complete");
        }
        (el as any).complete = options.complete;
      }
      if (options.disabled !== undefined) {
        if (options.disabled) {
          el.setAttribute("disabled", "");
        } else {
          el.removeAttribute("disabled");
        }
        (el as any).disabled = options.disabled;
      }
      if (options.selected) {
        el.setAttribute("selected", "");
      } else {
        el.removeAttribute("selected");
      }
      (el as any).selected = options.selected;
    };

    const onboardingExportStep = document.getElementById("onboarding-step-export");
    const exportEnabled = canExportProject();
    const hasAnimations = hasPlayableAnimation();
    if (hasStyleableContent) {
      setStepperState(onboardingStep, { selected: false, complete: true, disabled: true });
      setStepperState(onboardingStyleStep, { selected: true, disabled: false, complete: hasAnimations });
      setStepperState(onboardingExportStep, { selected: false, disabled: !exportEnabled });
    } else {
      setStepperState(onboardingStep, { selected: true, complete: false, disabled: false });
      setStepperState(onboardingStyleStep, { selected: false, disabled: true, complete: false });
      setStepperState(onboardingExportStep, { selected: false, disabled: true });
    }
  }

  const exportButton = document.getElementById("export-action-btn");
  if (exportButton) {
    if (canExportProject()) {
      exportButton.removeAttribute("disabled");
      exportButton.removeAttribute("title");
    } else {
      exportButton.setAttribute("disabled", "");
      exportButton.setAttribute("title", "Add an animation, camera keyframe, or camera FX to enable export.");
    }
  }
}

function isViewTrackLayer(layerData: LayerData | null | undefined) {
  return Boolean(layerData?.isViewTrack);
}

function getViewTrackLayerName(mode: ViewMode = currentViewMode) {
  return mode === "3d" ? "Camera" : "View";
}

function getViewTrackLayerData() {
  return graphicsLayers.find((layerData) => isViewTrackLayer(layerData)) ?? null;
}

function getCameraAnimationEasing(layerData?: LayerData | null): PointKeyframeEasing {
  if (!layerData || !isViewTrackLayer(layerData)) {
    return cameraKeyframeEasing;
  }
  const frames = layerData.pointKeyframes ?? [];
  for (const frame of frames) {
    const easing = normalizePointKeyframeEasing(frame?.easing);
    if (easing) {
      return easing;
    }
  }
  return cameraKeyframeEasing;
}

function syncCameraAnimationEasingControl(layerData?: LayerData | null) {
  const select = document.getElementById("camera-keyframe-easing") as any;
  if (!select) return;
  const easing = getCameraAnimationEasing(layerData);
  cameraKeyframeEasing = easing;
  if (String(select.value || "") !== easing) {
    setCalciteValue(select as HTMLElement, easing);
  }
}

function setCameraAnimationEasing(value: unknown) {
  const easing = normalizePointKeyframeEasing(value) ?? "linear";
  cameraKeyframeEasing = easing;
  const viewTrack = getViewTrackLayerData();
  const frames = viewTrack?.pointKeyframes;
  if (!frames?.length) return;
  frames.forEach((frame) => {
    frame.easing = easing;
  });
  updateTimeline();
  applyAnimationsAtTime(currentTime);
  scheduleProjectSave();
}

function getCurrentViewTrackKeyframe(time: number) {
  if (!view) return null;
  if (String((view as any)?.type || "") === "3d") {
    const camera = view?.camera;
    const position = view?.camera?.position;
    if (position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))) {
      const z = Number(position.z);
      const heading = Number(camera?.heading);
      const tilt = Number(camera?.tilt);
      const fov = Number(camera?.fov);
      return {
        time,
        x: Number(position.x),
        y: Number(position.y),
        z: Number.isFinite(z) ? z : undefined,
        heading: Number.isFinite(heading) ? heading : undefined,
        tilt: Number.isFinite(tilt) ? tilt : undefined,
        fov: Number.isFinite(fov) ? fov : undefined,
        spatialReference: position.spatialReference ?? view.spatialReference
      } as PointKeyframe;
    }
  }
  const center = view?.center;
  if (center && Number.isFinite(Number(center.x)) && Number.isFinite(Number(center.y))) {
    const rotation = Number((view as any)?.rotation);
    const scale = Number((view as any)?.scale);
    return {
      time,
      x: Number(center.x),
      y: Number(center.y),
      rotation: Number.isFinite(rotation) ? rotation : undefined,
      scale: Number.isFinite(scale) ? scale : undefined,
      spatialReference: center.spatialReference ?? view.spatialReference
    } as PointKeyframe;
  }
  return null;
}

function ensureViewTrackLayer() {
  if (!view?.map) return null;
  const existing = getViewTrackLayerData();
  if (existing) {
    existing.name = getViewTrackLayerName();
    existing.layer.title = existing.name;
    const existingIndex = graphicsLayers.indexOf(existing);
    if (existingIndex > 0) {
      graphicsLayers.splice(existingIndex, 1);
      graphicsLayers.unshift(existing);
      if (selectedLayerIndex === existingIndex) {
        selectedLayerIndex = 0;
      } else if (selectedLayerIndex >= 0 && selectedLayerIndex < existingIndex) {
        selectedLayerIndex += 1;
      }
      if (timelineState.selectedTimelineAnimation) {
        const { layerIdx, animIdx } = timelineState.selectedTimelineAnimation;
        timelineState.selectedTimelineAnimation = {
          layerIdx: layerIdx < existingIndex ? layerIdx + 1 : layerIdx,
          animIdx
        };
      }
      if (timelineState.selectedTimelineKeyframe) {
        const { layerIdx, keyframeIdx } = timelineState.selectedTimelineKeyframe;
        timelineState.selectedTimelineKeyframe = {
          layerIdx: layerIdx < existingIndex ? layerIdx + 1 : layerIdx,
          keyframeIdx
        };
      }
    }
    if (view.map.reorder) {
      graphicsLayers.forEach((layerData, layerIdx) => {
        view.map.reorder(layerData.layer, layerIdx);
      });
    }
    return existing;
  }

  const layer = new GraphicsLayer({
    id: VIEW_TRACK_LAYER_ID,
    title: getViewTrackLayerName(),
    visible: false,
    listMode: "hide"
  });
  view.map.add(layer, 0);

  const layerData: LayerData = {
    layer,
    name: getViewTrackLayerName(),
    type: "point",
    isViewTrack: true,
    animations: [createPlaceholderAnimation()],
    pointKeyframes: []
  };

  graphicsLayers.unshift(layerData);
  if (selectedLayerIndex >= 0) {
    selectedLayerIndex += 1;
  }
  if (timelineState.selectedTimelineAnimation) {
    timelineState.selectedTimelineAnimation = {
      layerIdx: timelineState.selectedTimelineAnimation.layerIdx + 1,
      animIdx: timelineState.selectedTimelineAnimation.animIdx
    };
  }
  if (timelineState.selectedTimelineKeyframe) {
    timelineState.selectedTimelineKeyframe = {
      layerIdx: timelineState.selectedTimelineKeyframe.layerIdx + 1,
      keyframeIdx: timelineState.selectedTimelineKeyframe.keyframeIdx
    };
  }
  return layerData;
}

function syncViewTrackLayerName(mode: ViewMode = currentViewMode) {
  const viewTrack = getViewTrackLayerData();
  if (!viewTrack) return;
  const name = getViewTrackLayerName(mode);
  viewTrack.name = name;
  viewTrack.layer.title = name;
}

function upsertLayerKeyframeAtCurrentTime(layerData: LayerData) {
  if (!layerData || layerData.type !== "point") return;
  if (isViewTrackLayer(layerData)) {
    const frame = getCurrentViewTrackKeyframe(currentTime);
    if (!frame) return;
    upsertPointKeyframe(
      layerData,
      new Point({
        x: frame.x,
        y: frame.y,
        spatialReference: frame.spatialReference ?? view?.spatialReference
      }),
      currentTime,
      {
        z: frame.z,
        heading: frame.heading,
        tilt: frame.tilt,
        fov: frame.fov,
        rotation: frame.rotation,
        scale: frame.scale,
        easing: cameraKeyframeEasing
      }
    );
    return;
  }
  const collection = layerData.layer.graphics as any;
  const graphics: any[] = Array.isArray(collection?.items)
    ? collection.items
    : typeof collection?.toArray === "function"
      ? collection.toArray()
      : [];
  const toKeyframePoint = (geometry: any): Point | null => {
    if (!geometry) return null;
    const x = Number(geometry?.x);
    const y = Number(geometry?.y);
    const z = Number(geometry?.z);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return new Point({
        x,
        y,
        spatialReference: geometry?.spatialReference ?? view?.spatialReference,
        ...(Number.isFinite(z) ? { z } : {})
      });
    }
    const firstPoint = Array.isArray(geometry?.points) ? geometry.points[0] : null;
    if (Array.isArray(firstPoint) && firstPoint.length >= 2) {
      const px = Number(firstPoint[0]);
      const py = Number(firstPoint[1]);
      const pz = Number(firstPoint[2]);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        return new Point({
          x: px,
          y: py,
          spatialReference: geometry?.spatialReference ?? view?.spatialReference,
          ...(Number.isFinite(pz) ? { z: pz } : {})
        });
      }
    }
    return null;
  };
  const firstPointGraphic = graphics.find((graphic: any) => Boolean(toKeyframePoint(graphic?.geometry)));
  const pointGeometry = toKeyframePoint(firstPointGraphic?.geometry);
  if (pointGeometry) {
    const symbolRotation = getPointSymbolRotation(firstPointGraphic?.symbol);
    const styleRotation = Number(layerData.pointStyle?.angle);
    const keyframeRotation = Number.isFinite(symbolRotation)
      ? symbolRotation
      : Number.isFinite(styleRotation)
        ? styleRotation
        : undefined;
    upsertPointKeyframe(layerData, pointGeometry, currentTime, {
      z: Number.isFinite(Number((pointGeometry as any)?.z)) ? Number((pointGeometry as any).z) : undefined,
      heading: Number.isFinite(Number(keyframeRotation)) ? Number(keyframeRotation) : undefined,
      rotation: Number.isFinite(Number(keyframeRotation)) ? Number(keyframeRotation) : undefined
    });
  }
}

function applyViewTrackAnimationAtTime(time: number) {
  if (!view) return;
  const viewTrack = getViewTrackLayerData();
  if (!viewTrack || !hasPointKeyframes(viewTrack)) return;
  const keyframe = getPointKeyframeAtTime(viewTrack, time);
  if (!keyframe) return;
  const point = new Point({
    x: keyframe.x,
    y: keyframe.y,
    spatialReference: keyframe.spatialReference ?? view.spatialReference
  });

  isApplyingViewTrackMotion = true;
  try {
    if (String(view.type) === "3d") {
      const camera = view?.camera?.clone?.();
      if (camera?.position) {
        camera.position.x = point.x;
        camera.position.y = point.y;
        if (Number.isFinite(Number(keyframe.z))) {
          camera.position.z = Number(keyframe.z);
        }
        if (point.spatialReference) {
          camera.position.spatialReference = point.spatialReference;
        }
        if (Number.isFinite(Number(keyframe.heading))) {
          camera.heading = Number(keyframe.heading);
        }
        if (Number.isFinite(Number(keyframe.tilt))) {
          camera.tilt = Number(keyframe.tilt);
        }
        if (Number.isFinite(Number(keyframe.fov))) {
          camera.fov = Number(keyframe.fov);
          cameraStudioSettings.fov = Number(keyframe.fov);
        }
        view.camera = camera;
      } else {
        void view.goTo({ center: point }, { animate: false });
      }
    } else {
      view.center = point;
      if (Number.isFinite(Number(keyframe.rotation))) {
        (view as any).rotation = Number(keyframe.rotation);
      }
      if (Number.isFinite(Number(keyframe.scale))) {
        (view as any).scale = Number(keyframe.scale);
      }
    }
  } finally {
    if (clearViewTrackMotionTimer !== null) {
      window.clearTimeout(clearViewTrackMotionTimer);
    }
    clearViewTrackMotionTimer = window.setTimeout(() => {
      isApplyingViewTrackMotion = false;
      clearViewTrackMotionTimer = null;
    }, 0);
  }
}

function applyViewTrackKeyframesSnapshot(rawFrames: any) {
  const viewTrack = ensureViewTrackLayer();
  if (!viewTrack) return;
  const isPointKeyframe = (value: PointKeyframe | null): value is PointKeyframe => value !== null;
  const frames = Array.isArray(rawFrames) ? rawFrames : [];
  viewTrack.pointKeyframes = frames
    .map((frame: any) => {
      const time = Number(frame?.time);
      const x = Number(frame?.x);
      const y = Number(frame?.y);
      if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      const z = Number(frame?.z);
      const heading = Number(frame?.heading);
      const tilt = Number(frame?.tilt);
      const fov = Number(frame?.fov);
      const rotation = Number(frame?.rotation);
      const scale = Number(frame?.scale);
      const easing = normalizePointKeyframeEasing(frame?.easing);
      return {
        time,
        x,
        y,
        z: Number.isFinite(z) ? z : undefined,
        heading: Number.isFinite(heading) ? heading : undefined,
        tilt: Number.isFinite(tilt) ? tilt : undefined,
        fov: Number.isFinite(fov) ? fov : undefined,
        rotation: Number.isFinite(rotation) ? rotation : undefined,
        scale: Number.isFinite(scale) ? scale : undefined,
        easing,
        spatialReference: frame?.spatialReference
      } as PointKeyframe;
    })
    .filter(isPointKeyframe)
    .sort((a: PointKeyframe, b: PointKeyframe) => a.time - b.time);
  const firstEasing = normalizePointKeyframeEasing(viewTrack.pointKeyframes?.[0]?.easing);
  cameraKeyframeEasing = firstEasing ?? "linear";
}

function normalizePointKeyframeEasing(value: unknown): PointKeyframeEasing | undefined {
  if (value === "ease-in") return "ease-in";
  if (value === "ease-out") return "ease-out";
  if (value === "ease-in-out") return "ease-in-out";
  if (value === "linear") return "linear";
  return undefined;
}

function upsertPointKeyframe(
  layerData: LayerData,
  geometry: Point,
  time: number,
  extras?: Partial<PointKeyframe>
) {
  const keyframes = layerData.pointKeyframes ? [...layerData.pointKeyframes] : [];
  const existingIndex = keyframes.findIndex((frame) => Math.abs(frame.time - time) < 0.001);
  const existingEasing = existingIndex >= 0 ? normalizePointKeyframeEasing(keyframes[existingIndex].easing) : undefined;
  const nextEasing = normalizePointKeyframeEasing(extras?.easing) ?? existingEasing;
  const next: PointKeyframe = {
    time,
    x: geometry.x,
    y: geometry.y,
    z: Number.isFinite(Number(extras?.z)) ? Number(extras?.z) : undefined,
    heading: Number.isFinite(Number(extras?.heading)) ? Number(extras?.heading) : undefined,
    tilt: Number.isFinite(Number(extras?.tilt)) ? Number(extras?.tilt) : undefined,
    fov: Number.isFinite(Number(extras?.fov)) ? Number(extras?.fov) : undefined,
    rotation: Number.isFinite(Number(extras?.rotation)) ? Number(extras?.rotation) : undefined,
    scale: Number.isFinite(Number(extras?.scale)) ? Number(extras?.scale) : undefined,
    easing: nextEasing,
    spatialReference: geometry.spatialReference
  };
  if (existingIndex >= 0) {
    keyframes[existingIndex] = next;
  } else {
    keyframes.push(next);
  }
  keyframes.sort((a, b) => a.time - b.time);
  layerData.pointKeyframes = keyframes;
  updatePrimaryActionsState();
  scheduleProjectSave();
}

function removePointKeyframeAt(layerIdx: number, keyframeIdx: number) {
  const layerData = graphicsLayers[layerIdx];
  if (!layerData || layerData.type !== "point") return;
  const keyframes = layerData.pointKeyframes ?? [];
  if (keyframeIdx < 0 || keyframeIdx >= keyframes.length) return;
  keyframes.splice(keyframeIdx, 1);
  layerData.pointKeyframes = keyframes;
  updateTimeline();
  updatePrimaryActionsState();
  scheduleProjectSave();
}

function interpolateNumber(startValue: unknown, endValue: unknown, t: number) {
  const start = Number(startValue);
  const end = Number(endValue);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return start + (end - start) * t;
  }
  if (Number.isFinite(start)) return start;
  if (Number.isFinite(end)) return end;
  return undefined;
}

function normalizeDegrees(value: number) {
  let next = value % 360;
  if (next < 0) {
    next += 360;
  }
  return next;
}

function interpolateAngleDegrees(startValue: unknown, endValue: unknown, t: number) {
  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return undefined;
  if (!Number.isFinite(start)) return Number.isFinite(end) ? end : undefined;
  if (!Number.isFinite(end)) return start;
  const startNorm = normalizeDegrees(start);
  const endNorm = normalizeDegrees(end);
  let delta = endNorm - startNorm;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return normalizeDegrees(startNorm + delta * t);
}

function applyPointKeyframeEasing(t: number, easing: unknown) {
  if (easing === "ease-in") {
    return t * t;
  }
  if (easing === "ease-out") {
    return 1 - (1 - t) * (1 - t);
  }
  if (easing === "ease-in-out") {
    return t * t * (3 - 2 * t);
  }
  return t;
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
      const easedT = applyPointKeyframeEasing(t, start.easing);
      return {
        time,
        x: start.x + (end.x - start.x) * easedT,
        y: start.y + (end.y - start.y) * easedT,
        z: interpolateNumber(start.z, end.z, easedT),
        heading: interpolateAngleDegrees(start.heading, end.heading, easedT),
        tilt: interpolateNumber(start.tilt, end.tilt, easedT),
        fov: interpolateNumber(start.fov, end.fov, easedT),
        rotation: interpolateAngleDegrees(start.rotation, end.rotation, easedT),
        scale: interpolateNumber(start.scale, end.scale, easedT),
        easing: normalizePointKeyframeEasing(start.easing),
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
  bootController.boot();
}

export function getAnimationSettingsSnapshot() {
  return buildAnimationSettingsSnapshot(graphicsLayers, timelineController.getTimelineDurationOverride());
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
    updateAutoSaveButtonVisibility();
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
    bindActiveViewHandlers();
    ensureViewTrackLayer();
    syncViewTrackLayerName(currentViewMode);
  }
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
    updateExportWarning();
    resetHistory(historyState, historyConfig);
    updateBasemapBackgroundControls();
    updateGoogle3DTilesToggleVisibility();
    ensureGoogle3DTilesLayerState();
    scheduleBasemapLabelsVisibility();
  }

  function setupEventListeners() {
  updateExportControlsForFormat();
  updateExportResolutionControls();
  updateExportResolutionLabel(view as any);
  bindSceneCameraStudioControls();
  document.querySelectorAll("calcite-tab-title").forEach((tab) => {
    tab.addEventListener("calciteTabTitleSelect", handleLayoutChange as EventListener);
    tab.addEventListener("click", handleLayoutChange as EventListener);
  });
  document.querySelectorAll(".layout-button").forEach((button) => {
    button.addEventListener("click", handleLayoutChange as EventListener);
    button.addEventListener("calciteButtonClick", handleLayoutChange as EventListener);
  });

  const customWidth = document.getElementById("custom-width");
  const customHeight = document.getElementById("custom-height");
  if (customWidth) {
    customWidth.addEventListener("calciteInputNumberChange", handleCustomDimensions);
  }
  if (customHeight) {
    customHeight.addEventListener("calciteInputNumberChange", handleCustomDimensions);
  }

  getEl("add-point-btn").addEventListener("click", () => startDrawing("point"));
  getEl("add-line-btn").addEventListener("click", () => startDrawing("polyline"));
  getEl("add-polygon-btn").addEventListener("click", () => startDrawing("polygon"));
  getEl("add-text-btn").addEventListener("click", () => startDrawing("text"));
  getEl("import-toggle-btn").addEventListener("click", toggleImportOptions);
  getEl("import-geojson-btn").addEventListener("click", () => handleImportClick("geojson"));
  getEl("import-csv-btn").addEventListener("click", () => handleImportClick("csv"));
  getEl("import-file-input").addEventListener("change", handleImportFileChange);
  getEl("export-resolution-select").addEventListener("calciteSelectChange", () => {
    updateExportResolutionControls();
    updateExportResolutionLabel(view as any);
  });
  const exportResolutionWidth = document.getElementById("export-resolution-width");
  const exportResolutionHeight = document.getElementById("export-resolution-height");
  if (exportResolutionWidth) {
    exportResolutionWidth.addEventListener("calciteInputNumberChange", applyExportResolutionAspect);
  }
  if (exportResolutionHeight) {
    exportResolutionHeight.addEventListener("calciteInputNumberChange", applyExportResolutionAspect);
  }
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
    const basemapBgInput = document.getElementById("basemap-bg-color");
    if (basemapBgInput) {
      basemapBgInput.addEventListener("input", (event) => {
        const target = event.target as HTMLInputElement | null;
        handleBasemapBackgroundChange(target?.value);
        updateBasemapBackgroundControls();
        scheduleProjectSave();
      });
      basemapBgInput.addEventListener("change", (event) => {
        const target = event.target as HTMLInputElement | null;
        handleBasemapBackgroundChange(target?.value);
        updateBasemapBackgroundControls();
        scheduleProjectSave();
      });
    }
    const basemapBgTransparentInput = document.getElementById("basemap-bg-transparent");
    if (basemapBgTransparentInput) {
      basemapBgTransparentInput.addEventListener("calciteSwitchChange", () => {
        updateBasemapBackgroundControls();
        scheduleProjectSave();
      });
    }
    const basemapLabelsToggle = document.getElementById("basemap-labels-toggle");
    if (basemapLabelsToggle) {
      basemapLabelsToggle.addEventListener("calciteSwitchChange", () => {
        scheduleBasemapLabelsVisibility();
        scheduleProjectSave();
      });
    }
    const google3DTilesToggle = document.getElementById("basemap-google-3d-tiles-toggle");
    if (google3DTilesToggle) {
      google3DTilesToggle.addEventListener("calciteSwitchChange", () => {
        const toggle = google3DTilesToggle as any;
        if (Boolean(toggle?.checked) && !getGoogle3DTilesApiKey()) {
          const apiKey = promptForGoogle3DTilesByokApiKey();
          if (!apiKey) {
            toggle.checked = false;
          }
        }
        ensureGoogle3DTilesLayerState();
        scheduleProjectSave();
      });
    }

  getEl("ai-ask-btn").addEventListener("click", openAiModal);
  getEl("ai-cancel-btn").addEventListener("click", closeAiModal);
  getEl("ai-clear-btn").addEventListener("click", clearAiPrompt);
  getEl("ai-generate-btn").addEventListener("click", handleAiGenerate);
  getEl("ai-prompt-input").addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void handleAiGenerate();
    }
  });

  const styleConfirm = document.getElementById("style-confirm");
  if (styleConfirm) {
    styleConfirm.addEventListener("click", confirmStyleSettings);
  }

  getEl("feature-field-select").addEventListener("calciteSelectChange", handleFeatureFieldChange as EventListener);
  getEl("feature-visual-select").addEventListener("calciteSelectChange", handleFeatureVisualChange as EventListener);
  getEl("feature-hide-nulls").addEventListener("calciteSwitchChange", handleFeatureHideNullsChange as EventListener);
  getEl("feature-fade-out").addEventListener(
    "calciteSwitchChange",
    handleFeatureFadeOutChange as EventListener
  );
  getEl("feature-style-btn").addEventListener("click", () => {
    openStyleModal();
  });

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
    const xOffsetInput = getEl("point-xoffset-input") as any;
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
    if (selectedValue !== "map-pin") {
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
  const pointStyleSearch = document.getElementById("point-style-search") as HTMLInputElement | null;
  if (pointStyleSearch) {
    pointStyleSearch.addEventListener("input", filterPointStyles);
    pointStyleSearch.addEventListener("change", filterPointStyles);
    pointStyleSearch.addEventListener("calciteInputInput", filterPointStyles as EventListener);
    pointStyleSearch.addEventListener("calciteInputChange", filterPointStyles as EventListener);
    filterPointStyles();
  }
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
  getEl("point-follow-terrain-toggle").addEventListener("calciteSwitchChange", () => applyStyleSettings(false));

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
  getEl("polygon-outline-width").addEventListener("calciteSliderInput", () => applyStyleSettings(false));
  getEl("polygon-zoffset-input").addEventListener("calciteInputNumberChange", () => applyStyleSettings(false));

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
  getEl("text-render-mode-select").addEventListener("calciteSelectChange", () => {
    const renderModeSelect = getEl("text-render-mode-select") as any;
    updateTextCalloutControlVisibility(String(renderModeSelect?.value || "scene-3d"));
    applyTextSettings(false);
  });
  getEl("text-font-select").addEventListener("calciteSelectChange", () => applyTextSettings(false));
  getEl("text-size-slider").addEventListener("calciteSliderInput", () => applyTextSettings(false));
  getEl("text-color-input").addEventListener("input", () => applyTextSettings(false));
  getEl("text-color-input").addEventListener("change", () => applyTextSettings(false));
  getEl("text-italic-toggle").addEventListener("calciteSwitchChange", () => applyTextSettings(false));
  getEl("text-underline-toggle").addEventListener("calciteSwitchChange", () => applyTextSettings(false));
  getEl("text-3d-callout-toggle").addEventListener("calciteSwitchChange", () => applyTextSettings(false));

  getEl("play-button").addEventListener("click", handlePlayFromStart);
  getEl("scene-mode-btn").addEventListener("click", () => {
    void toggleViewMode();
  });
  getEl("rotation-button").addEventListener("click", rotateMap);
  getEl("menu-new-project-btn").addEventListener("click", resetProject);
  getEl("delete-layer-btn").addEventListener("click", () => {
    if (selectedLayerIndex >= 0) {
      removeLayer(selectedLayerIndex);
    }
  });
  getEl("export-action-btn").addEventListener("click", () => {
    void startFrameExport();
  });
  getEl("export-format-select").addEventListener("calciteSelectChange", updateExportControlsForFormat);
  getEl("export-cancel-btn").addEventListener("click", () => {
    void cancelFrameExport();
  });
  getEl("export-preview-close").addEventListener("click", () => {
    if (isFrameExporting || exportState.isExporting) return;
    hideExportPreviewModal();
  });
  getEl("gif-download-btn").addEventListener("click", () => {
    if (!exportDownloadUrl) return;
    const link = document.createElement("a");
    link.href = exportDownloadUrl;
    link.download = getGifExportFileName();
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  getEl("gif-preview-close").addEventListener("click", () => {
    resetGifPreviewToGif();
  });
  getEl("export-attribution-copy").addEventListener("click", async () => {
    const attributionText =
      (document.getElementById("export-attribution-text") as HTMLElement | null)?.innerText?.trim() ||
      "";
    if (!attributionText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(attributionText);
      } else {
        const temp = document.createElement("textarea");
        temp.value = attributionText;
        temp.setAttribute("readonly", "");
        temp.style.position = "absolute";
        temp.style.left = "-9999px";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }
      const btn = document.getElementById("export-attribution-copy");
      if (btn) {
        btn.textContent = "Copied!";
        window.setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      }
    } catch {
      const btn = document.getElementById("export-attribution-copy");
      if (btn) {
        btn.textContent = "Copy failed";
        window.setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      }
    }
  });
  const gifThumbs = document.getElementById("gif-thumbnails");
  if (gifThumbs) {
    gifThumbs.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const thumb = target?.closest(".gif-thumb") as HTMLImageElement | null;
      if (!thumb) return;
      const isSelected = thumb.classList.contains("is-selected");
      document.querySelectorAll("#gif-thumbnails .gif-thumb.is-selected").forEach((el) => {
        el.classList.remove("is-selected");
      });
      if (isSelected) {
        resetGifPreviewToGif();
        return;
      }
      thumb.classList.add("is-selected");
      setGifPreview(thumb.src, "frame");
    });
    gifThumbs.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        if (Math.abs(event.deltaY) < 1) return;
        if (event.shiftKey) return;
        gifThumbs.scrollLeft += event.deltaY;
        event.preventDefault();
      },
      { passive: false }
    );
  }

  getEl("timeline-play-btn").addEventListener("click", togglePlayAnimation);
  getEl("menu-auto-save-btn").addEventListener("click", () => {
    void handleAutoSaveAction();
  });
  getEl("menu-save-as-btn").addEventListener("click", () => handleExportProject(projectIoConfig));
  getEl("menu-open-project-btn").addEventListener("click", () => handleImportProjectClick(projectIoConfig));
  getEl("project-file-input").addEventListener("change", (event: Event) =>
    handleProjectFileChange(projectIoConfig, event)
  );
  getEl("timeline-duplicate-btn").addEventListener("click", duplicateSelectedTimelineAnimation);
  getEl("timeline-start-btn").addEventListener("click", goToStart);
  getEl("timeline-end-btn").addEventListener("click", goToEnd);
  getEl("timeline-delete-clip-btn").addEventListener("click", removeSelectedTimelineAnimation);
  getEl("timeline-duration").addEventListener(
    "calciteInputNumberChange",
    handleTimelineDurationChange as EventListener
  );
  getEl("timeline-keyframe-easing").addEventListener(
    "calciteSelectChange",
    handleTimelineKeyframeEasingChange as EventListener
  );
  getEl("camera-keyframe-easing").addEventListener("calciteSelectChange", (event: Event) => {
    const value = String((event.target as any)?.value || "linear");
    setCameraAnimationEasing(value);
  });
  getEl("timeline-duration-autofit").addEventListener("click", handleTimelineDurationAutoFit);
  getEl("timeline-snap-toggle").addEventListener("click", toggleTimelineSnap);
  getEl("timeline-grid-toggle").addEventListener("click", toggleTimelineGrid);
  getEl("timeline-zoom-in").addEventListener("click", zoomInTimeline);
  getEl("timeline-zoom-out").addEventListener("click", zoomOutTimeline);
  getEl("onboarding-where-btn").addEventListener("click", () => {
    const drawGroup = document.getElementById("draw-toolbar-group");
    if (!drawGroup) return;
    drawGroup.classList.add("draw-toolbar-highlight");
    window.setTimeout(() => {
      drawGroup.classList.remove("draw-toolbar-highlight");
    }, 1600);
  });
  getEl("keyboard-shortcuts-btn").addEventListener("click", () => {
    const modal = document.getElementById("keyboard-shortcuts-modal") as any;
    if (modal) {
      modal.open = true;
    }
  });
  getEl("keyboard-shortcuts-close").addEventListener("click", () => {
    const modal = document.getElementById("keyboard-shortcuts-modal") as any;
    if (modal) {
      modal.open = false;
    }
  });
  getEl("about-pulse-btn").addEventListener("click", () => {
    const modal = document.getElementById("about-pulse-modal") as any;
    if (modal) {
      modal.open = true;
    }
  });
  getEl("about-pulse-close").addEventListener("click", () => {
    const modal = document.getElementById("about-pulse-modal") as any;
    if (modal) {
      modal.open = false;
    }
  });
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
    updateExportResolutionLabel(view as any);
  });

  document.addEventListener("keydown", (event) => {
    if (isAiModalOpen()) return;
    const target = event.target as HTMLElement | null;
    if (isEditableTarget(target)) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      removeSelectedTimelineAnimation();
    }
  });

  bindConfirmDialogListeners();
}

function handleLayoutChange(event: Event) {
  const target = (event.currentTarget as HTMLElement | null) ?? (event.target as HTMLElement | null);
  const layout = target?.getAttribute("data-layout") ?? target?.closest(".layout-button")?.getAttribute("data-layout");
  if (!layout) return;
  currentLayout = layout as any;
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
  updateBasemapBackgroundControls();
  updateGoogle3DTilesToggleVisibility();
  ensureGoogle3DTilesLayerState();
  scheduleBasemapLabelsVisibility();
  scheduleProjectSave();
}


function handleGlobalKeyDown(event: KeyboardEvent) {
  if (isAiModalOpen()) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (isEditableTarget(target)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "escape") {
    closeMapContextMenu();
    return;
  }
  if (!event.ctrlKey && !event.metaKey) {
    if (key === " ") {
      event.preventDefault();
      togglePlayAnimation();
      return;
    }
    if (key === "home") {
      event.preventDefault();
      goToStart();
      return;
    }
    if (key === "end") {
      event.preventDefault();
      goToEnd();
      return;
    }
    if (key === "1") {
      event.preventDefault();
      void startDrawing("point");
      return;
    }
    if (key === "2") {
      event.preventDefault();
      void startDrawing("polyline");
      return;
    }
    if (key === "3") {
      event.preventDefault();
      void startDrawing("polygon");
      return;
    }
    if (key === "4") {
      event.preventDefault();
      void startDrawing("text");
      return;
    }
    if (key === "m") {
      event.preventDefault();
      toggleImportOptions();
      return;
    }
    return;
  }

  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      void redoHistory(historyState, historyConfig);
    } else {
      void undoHistory(historyState, historyConfig);
    }
    return;
  }
  if (key === "y") {
    event.preventDefault();
    void redoHistory(historyState, historyConfig);
    return;
  }
  if (key === "n" && event.shiftKey) {
    event.preventDefault();
    void resetProject();
    return;
  }
  if (key === "s" && event.shiftKey) {
    event.preventDefault();
    void handleAutoSaveAction();
    return;
  }
  if (key === "o" && event.shiftKey) {
    event.preventDefault();
    handleImportProjectClick(projectIoConfig);
    return;
  }
  if (key === "e" && event.shiftKey) {
    event.preventDefault();
    handleExportProject(projectIoConfig);
    return;
  }
}

function isAiModalOpen() {
  const modal = document.getElementById("ai-ask-modal") as any;
  return Boolean(modal?.open);
}

function isEditableTarget(target: HTMLElement | null) {
  if (!target) return false;
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "CALCITE-TEXT-AREA" ||
    tag.startsWith("CALCITE-INPUT") ||
    tag === "CALCITE-SELECT" ||
    target.isContentEditable
  ) {
    return true;
  }
  return false;
}

function toggleImportOptions() {
  const advanced = getEl("layer-import-advanced");
  advanced.classList.add("show");
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

function resolveFeatureFieldName(layerData: LayerData) {
  const requested = String(layerData.featureField || "").trim();
  if (!requested) return null;
  const layer = layerData.layer as FeatureLayer;
  const match = (layer.fields || []).find((field: any) => String(field?.name || "") === requested);
  return match?.name ? String(match.name) : null;
}

function buildFeatureFieldWhereClause(fieldName: string, hideNulls = false) {
  if (!hideNulls) return "1=1";
  return `${sqlName(fieldName)} IS NOT NULL`;
}

async function updateFeatureFieldStats(layerData: LayerData) {
  const layer = layerData.layer as FeatureLayer;
  const field = resolveFeatureFieldName(layerData);
  if (!field) return false;

  let stats: any;
  try {
    const where = buildFeatureFieldWhereClause(field, layerData.featureHideNulls);
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
  const field = resolveFeatureFieldName(layerData);
  layer.definitionExpression = field
    ? buildFeatureFieldWhereClause(field, layerData.featureHideNulls)
    : "1=1";
}

function buildFeatureBaseSymbol(layerData: LayerData, visualType: string) {
  const geometryType = (layerData.layer as FeatureLayer).geometryType;
  if (geometryType === "point" || geometryType === "multipoint") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    return buildPointSymbolForCurrentView(style);
  }
  if (geometryType === "polyline") {
    const style = layerData.lineStyle ?? defaultLineStyle;
    void visualType;
    return buildLineSymbolForCurrentView(style);
  }
  if (geometryType === "polygon") {
    const style = layerData.polygonStyle ?? defaultPolygonStyle;
    return buildPolygonSymbolForCurrentView(style);
  }
  return buildPointSymbolForCurrentView(defaultPointStyle);
}

function applyFeatureLayerRenderer(layerData: LayerData, value: number) {
  applyLayerModeProperties(layerData);
  const field = resolveFeatureFieldName(layerData);
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

function applyFeatureLayerStaticRenderer(layerData: LayerData) {
  applyLayerModeProperties(layerData);
  const layer = layerData.layer as FeatureLayer;
  const visualType = layerData.featureVisualVariable ?? "opacity";
  layer.renderer = {
    type: "simple",
    symbol: buildFeatureBaseSymbol(layerData, visualType)
  } as any;
  layerData.featureLastValue = undefined;
}

function applyFeatureLayerAnimation(layerData: LayerData, time: number) {
  const anim = layerData.animations.find((entry) => entry.type === "field");
  const stats = layerData.featureFieldStats;
  if (!anim || !stats || !resolveFeatureFieldName(layerData)) {
    applyFeatureLayerStaticRenderer(layerData);
    return;
  }

  const span = anim.duration || 0;
  if (span <= 0) {
    applyFeatureLayerStaticRenderer(layerData);
    return;
  }

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
    layerData.pointFollowTerrain3D = true;
    layerData.layerEffectsEnabled = true;
  } else if (type === "polyline") {
    layerData.lineStyle = { ...defaultLineStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polygon") {
    layerData.polygonStyle = { ...defaultPolygonStyle };
    layerData.polygonZOffset = 0;
    layerData.layerEffectsEnabled = true;
  }

  applyLayerModeProperties(layerData);
  if (type === "text") {
    applyTextSymbols(layerData);
  } else {
    applyLayerStyle(layerData);
  }
  applyLayerEffects(layerData);

  graphicsLayers.push(layerData);
  updateSnappingOptions();
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
    graphic.symbol = buildPointSymbolForCurrentView(style);
  } else if (type === "polyline") {
    graphic.symbol = buildLineSymbolForCurrentView(defaultLineStyle);
  } else if (type === "polygon") {
    graphic.symbol = buildPolygonSymbolForCurrentView(defaultPolygonStyle);
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

  setDrawInfoBoxText("Click on the map to place text.");
  setDrawInfoBoxVisible(true);

  textPlacementHandle = view.on("click", (event: any) => {
    const graphic = new Graphic({
      geometry: toGeographicGeometry(event.mapPoint) as any,
      symbol: buildTextSymbolForCurrentView(layerData)
    });

    layerData.layer.add(graphic);
    isDrawing = false;
    setDrawInfoBoxVisible(false);
    pendingTextPlacement = null;
    suppressNextMapClick = true;
    selectLayer(layerIndex);
    if (sketch && !isPlaying) {
      void sketch.update(graphic).catch(() => undefined);
    }
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
  const drawInfoText =
    type === "point"
      ? "Click on the map to place a point."
      : type === "text"
        ? "Click on the map to place text."
        : "Click to draw. Double-click to finish.";
  setDrawInfoBoxText(drawInfoText);
  setDrawInfoBoxVisible(true);

  const userLayerCount = graphicsLayers.filter((layerData) => !isViewTrackLayer(layerData)).length;
  const layerName = `${type.charAt(0).toUpperCase() + type.slice(1)} ${userLayerCount + 1}`;
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
    layerData.pointFollowTerrain3D = true;
    layerData.layerEffectsEnabled = true;
  } else if (type === "polyline") {
    layerData.lineStyle = { ...defaultLineStyle };
    layerData.layerEffectsEnabled = true;
  } else if (type === "polygon") {
    layerData.polygonStyle = { ...defaultPolygonStyle };
    layerData.polygonZOffset = 0;
    layerData.layerEffectsEnabled = true;
  }

  applyLayerModeProperties(layerData);
  graphicsLayers.push(layerData);
  const sketchVm = ensureSketchViewModel(newLayer);

  if (type === "text") {
    layerData.textContent = "Text";
    layerData.textSize = 14;
    layerData.textColor = "#22323a";
    layerData.textFontFamily = "sans-serif";
    layerData.textItalic = false;
    layerData.textUnderline = false;
    layerData.textRenderMode = "scene-3d";
    layerData.textCalloutLine = false;
    pendingTextPlacement = { layerIndex };
    selectLayer(layerIndex, false);
    openTextSettingsModal();
    beginTextPlacement(layerIndex);
    return;
  } else {
    if (!sketchVm) return;
    const toolMap: Record<string, string> = {
      point: "point",
      polyline: "polyline",
      polygon: "polygon"
    };

    activeSketchCreateLayerIndex = layerIndex;
    const mode = "click";
    void sketchVm.create(toolMap[type] as any, {
      mode
    }).catch(() => {
      isDrawing = false;
      setDrawInfoBoxVisible(false);
      activeSketchCreateLayerIndex = null;
    });
  }
}

function updateLayersList() {
  const layersAccordion = getEl("layers-accordion");
  attachAnimationPanelTo();
  attachStylePanelTo();
  attachTextPanelTo();
  layersAccordion.innerHTML = "";

  const orderedLayers = [...graphicsLayers].reverse();
  orderedLayers.forEach((layerData) => {
    const index = graphicsLayers.indexOf(layerData);
    const isLockedLayer = isViewTrackLayer(layerData);
    const item = document.createElement("calcite-accordion-item");
    item.className = "layer-accordion-item";
    item.setAttribute("heading", layerData.name);
    item.setAttribute("icon-start", isLockedLayer ? (currentViewMode === "3d" ? "camera" : "map") : getIconForType(layerData.type));
    if (index === selectedLayerIndex) {
      item.setAttribute("expanded", "");
    }
    const title = document.createElement("span");
    title.setAttribute("slot", "title");
    title.textContent = layerData.name;
    item.appendChild(title);

    if (!isLockedLayer) {
      const deleteAction = createLayerAction("trash", "Delete", () => {
        removeLayer(index);
      });
      deleteAction.classList.add("layer-action-delete");
      deleteAction.setAttribute("slot", "actions-end");
      item.appendChild(deleteAction);
    }

    const content = document.createElement("div");
    content.className = "layer-item-content";

    if (index === selectedLayerIndex) {
      const animationSection = document.createElement("div");
      animationSection.className = "layer-section";

      const animationTitle = document.createElement("div");
      animationTitle.className = "layer-section-title";
      animationTitle.textContent = isLockedLayer
        ? currentViewMode === "3d"
          ? "Camera Motion"
          : "View Motion"
        : "Animation Type";
      animationSection.appendChild(animationTitle);

      const host = document.createElement("div");
      host.id = `animation-settings-host-${index}`;
      animationSection.appendChild(host);

      content.appendChild(animationSection);
      if (!isLockedLayer) {
        const styleSection = document.createElement("div");
        styleSection.className = "layer-section";

        const styleTitle = document.createElement("div");
        styleTitle.className = "layer-section-title";
        styleTitle.textContent = "Colour and styles";
        styleSection.appendChild(styleTitle);

        const styleHost = document.createElement("div");
        styleHost.id = `style-settings-host-${index}`;
        styleSection.appendChild(styleHost);
        content.appendChild(styleSection);
      }
    }

    item.appendChild(content);
    item.addEventListener("calciteAccordionItemExpand" as any, () => selectLayer(index));

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

function createLayerTextAction(text: string, action: () => void) {
  const actionButton = document.createElement("calcite-button");
  actionButton.setAttribute("scale", "s");
  actionButton.setAttribute("appearance", "transparent");
  actionButton.classList.add("layer-action-text");
  actionButton.textContent = text;
  actionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return actionButton;
}

function expandLayerAccordionSection(layerIndex: number, section: "animate" | "style") {
  void layerIndex;
  void section;
}

function selectLayer(index: number, focusGraphic = true, selectedGraphic?: any) {
  if (index < 0 || index >= graphicsLayers.length) return;
  selectedLayerIndex = index;
  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  setDeleteLayerButtonVisible(!isViewTrackLayer(graphicsLayers[index]));

  const layerData = graphicsLayers[index];
  if (isViewTrackLayer(layerData)) {
    if (sketch) {
      sketch.cancel();
      sketch.layer = null;
    }
    clearSelectionManagerSelection();
    return;
  }
  if (layerData.type === "feature") {
    if (isPlaying) {
      stopAnimation();
    }
    setSelectionManagerSelection(layerData, selectedGraphic ? [selectedGraphic] : []);
    return;
  }
  if (isPlaying && (layerData.type === "polyline" || layerData.type === "polygon")) {
    stopAnimation();
    restoreLayerGeometry(layerData);
  }

  ensureSketchViewModel(layerData.layer);

  if (!sketch) return;
  sketch.layer = layerData.layer;
  updateSnappingOptions();
  syncSketchModeOptions();
  const allowEditing = !isPlaying;
  setSketchUpdateOnGraphicClick(allowEditing);
  if (!allowEditing) {
    sketch.cancel();
  }

  if (allowEditing) {
    if (layerData.type === "polyline" || layerData.type === "polygon") {
      restoreLayerGeometry(layerData);
    }
    prepareLayerGeometryForSketch(layerData, {
      currentViewMode,
      viewSpatialReference: view?.spatialReference
    });
  }

  const graphic =
    selectedGraphic ??
    (layerData.layer.graphics as any).getItemAt?.(0) ??
    layerData.layer.graphics?.items?.[0];
  setSelectionManagerSelection(layerData, graphic ? [graphic] : []);

  if (focusGraphic && !hasPathAnimation(layerData) && graphic) {
    if (allowEditing) {
      const prepared = toViewGeometry(graphic.geometry, view?.spatialReference);
      if (prepared) {
        graphic.geometry = prepared;
      }
      void sketch.update(graphic).catch(() => undefined);
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
  if (!layerData) return;
  if (isViewTrackLayer(layerData)) return;
  if (!(await confirmDeleteLayer(layerData, options?.confirmHostId))) return;
  view.map.remove(layerData.layer);
  clearLayerOverlayLayers(layerData);
  graphicsLayers.splice(index, 1);
  updateSnappingOptions();

  if (selectedLayerIndex === index) {
    selectedLayerIndex = -1;
    setDeleteLayerButtonVisible(false);
    clearSelectionManagerSelection();
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

function moveLayer(index: number, direction: -1 | 1) {
  moveLayerToIndex(index, index + direction);
}

function moveLayerToIndex(index: number, targetIndex: number) {
  const maxIndex = graphicsLayers.length - 1;
  if (index < 0 || index > maxIndex || targetIndex < 0 || targetIndex > maxIndex || index === targetIndex) {
    return;
  }
  if (isViewTrackLayer(graphicsLayers[index])) return;
  const lockedBottomIndex = graphicsLayers.findIndex((layerData) => isViewTrackLayer(layerData));
  const minMovableIndex = lockedBottomIndex >= 0 ? lockedBottomIndex + 1 : 0;
  const clampedTargetIndex = Math.max(minMovableIndex, targetIndex);
  if (clampedTargetIndex === index) return;
  targetIndex = clampedTargetIndex;

  const [movedLayer] = graphicsLayers.splice(index, 1);
  graphicsLayers.splice(targetIndex, 0, movedLayer);

  if (selectedLayerIndex === index) {
    selectedLayerIndex = targetIndex;
  } else if (selectedLayerIndex > index && selectedLayerIndex <= targetIndex) {
    selectedLayerIndex -= 1;
  } else if (selectedLayerIndex < index && selectedLayerIndex >= targetIndex) {
    selectedLayerIndex += 1;
  }

  if (timelineState.selectedTimelineAnimation) {
    if (timelineState.selectedTimelineAnimation.layerIdx === index) {
      timelineState.selectedTimelineAnimation.layerIdx = targetIndex;
    } else if (
      timelineState.selectedTimelineAnimation.layerIdx > index &&
      timelineState.selectedTimelineAnimation.layerIdx <= targetIndex
    ) {
      timelineState.selectedTimelineAnimation.layerIdx -= 1;
    } else if (
      timelineState.selectedTimelineAnimation.layerIdx < index &&
      timelineState.selectedTimelineAnimation.layerIdx >= targetIndex
    ) {
      timelineState.selectedTimelineAnimation.layerIdx += 1;
    }
  }

  if (view?.map?.reorder) {
    graphicsLayers.forEach((layerData, layerIdx) => {
      view.map.reorder(layerData.layer, layerIdx);
    });
  }

  updateLayersList();
  updateTimeline();
  updateAnimationOptions();
  scheduleProjectSave();
  if (selectedLayerIndex >= 0) {
    scrollTimelineToLayer(selectedLayerIndex);
  }
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
  if (isViewTrackLayer(layerData)) return;
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
      pointFollowTerrain3D: layerData.pointFollowTerrain3D,
      lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
      polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
      polygonZOffset: layerData.polygonZOffset,
      layerBlendMode: layerData.layerBlendMode,
      layerEffectSettings: layerData.layerEffectSettings ? { ...layerData.layerEffectSettings } : undefined,
      layerEffectsEnabled: layerData.layerEffectsEnabled
    };
    if (!duplicate.featureFields || !duplicate.featureFields.length) {
      duplicate.featureFields = getFeatureLayerFields(featureLayer);
    }
    if (featureLayer.geometryType === "polygon" && !Number.isFinite(Number(duplicate.polygonZOffset))) {
      duplicate.polygonZOffset = 0;
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
    pointFollowTerrain3D: layerData.pointFollowTerrain3D,
    lineStyle: layerData.lineStyle ? { ...layerData.lineStyle } : undefined,
    polygonStyle: layerData.polygonStyle ? { ...layerData.polygonStyle } : undefined,
    polygonZOffset: layerData.polygonZOffset,
    textContent: layerData.textContent,
    textSize: layerData.textSize,
    textColor: layerData.textColor,
    textFontFamily: layerData.textFontFamily,
    textItalic: layerData.textItalic,
    textUnderline: layerData.textUnderline,
    textRenderMode: layerData.textRenderMode,
    textCalloutLine: layerData.textCalloutLine,
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
    duplicate.polygonZOffset = Number.isFinite(Number(duplicate.polygonZOffset))
      ? Number(duplicate.polygonZOffset)
      : 0;
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
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }
  if (event?.button === 2 || event?.native?.button === 2) return;
  closeMapContextMenu();
  const response = await view.hitTest(event);
  const hit = response.results.find((result: any) =>
    graphicsLayers.some((layerData) => layerData.layer === result.graphic?.layer)
  );

  if (!hit) {
    selectedLayerIndex = -1;
    clearSelectionManagerSelection();
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
    selectLayer(layerIndex, !layerData || !hasPathAnimation(layerData), hit.graphic);
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

  selectLayer(layerIndex, false, hit.graphic);
  openTextSettingsModal();
}

function openStyleModal() {
  if (selectedLayerIndex < 0) return;
  const layerData = graphicsLayers[selectedLayerIndex];
  if (isViewTrackLayer(layerData)) {
    attachStylePanelTo();
    attachTextPanelTo();
    return;
  }
  if (layerData.type === "text") {
    openTextSettingsModal();
    return;
  }
  attachStylePanelTo(`style-settings-host-${selectedLayerIndex}`);
  syncStylePanelFromLayer(layerData);
  expandLayerAccordionSection(selectedLayerIndex, "style");
}

function syncStylePanelFromLayer(layerData: LayerData) {
  const effectsToggle = document.getElementById("style-effects-toggle");
  if (effectsToggle && !effectsToggle.dataset.listenerBound) {
    effectsToggle.addEventListener("click", toggleStyleEffects);
    effectsToggle.dataset.listenerBound = "true";
  }

  const styleType = getStyleTypeForLayer(layerData);
  setStyleSectionVisibility(styleType, layerData.type === "feature", styleType !== null);
  // effects panel state handled below

  if (styleType === "point") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    const followTerrainToggle = document.getElementById("point-follow-terrain-toggle") as any;
    setPointStyleSelection(style.style);
    setCalciteValue(getEl("point-size-input"), style.size);
    lastPointSizeInput = Number(style.size) || DEFAULT_PIN_SIZE;
    setColorPickerValue("point-fill-color", style.color, 1);
    setColorPickerValue("point-outline-color", style.outlineColor, 1);
    setCalciteValue(getEl("point-outline-width"), style.outlineWidth);
    setCalciteValue(getEl("point-angle-input"), style.angle ?? 0);
    setCalciteValue(getEl("point-xoffset-input"), style.xoffset ?? 0);
    setCalciteValue(getEl("point-yoffset-input"), style.yoffset ?? 0);
    if (followTerrainToggle) {
      followTerrainToggle.checked = layerData.pointFollowTerrain3D !== false;
    }
    updatePointAnimationPreview(style.color, style.outlineColor, style.style);
    updatePointStyleOptionColors(style.color, style.outlineColor);
    if (currentViewMode === "3d") {
      void ensureAllPointWebStyleOptionsFor3D(style.style);
    } else {
      filterPointStyles();
    }
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
    setCalciteValue(getEl("polygon-zoffset-input"), Number(layerData.polygonZOffset) || 0);
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

  const effectsAdvanced = getEl("style-effects-advanced");
  const effectsToggleEl = getEl("style-effects-toggle");
  effectsAdvanced.classList.remove("show");
  effectsToggleEl.textContent = "Show more";
  effectsToggleEl.setAttribute("aria-expanded", "false");
}

function confirmStyleSettings() {
  applyStyleSettings(false);
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
    const xOffsetInput = getEl("point-xoffset-input") as any;
    const yOffsetInput = getEl("point-yoffset-input") as any;
    const followTerrainToggle = document.getElementById("point-follow-terrain-toggle") as any;
    layerData.pointStyle = {
      style: selected || defaultPointStyle.style,
      size: Number((getEl("point-size-input") as any).value) || defaultPointStyle.size,
      color: getColorFromPicker("point-fill-color", 1),
      outlineColor: getColorFromPicker("point-outline-color", 1),
      outlineWidth: readNumber((getEl("point-outline-width") as any).value, defaultPointStyle.outlineWidth),
      angle: Number((getEl("point-angle-input") as any).value) || 0,
      xoffset: Number(xOffsetInput.value) || 0,
      yoffset: Number(yOffsetInput.value) || 0
    };
    layerData.pointFollowTerrain3D = Boolean(followTerrainToggle?.checked ?? true);
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
    layerData.polygonZOffset = readNumber((getEl("polygon-zoffset-input") as any).value, 0);
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
}

function toggleStyleEffects() {
  const effectsAdvanced = getEl("style-effects-advanced");
  const effectsToggle = getEl("style-effects-toggle");
  const isOpen = effectsAdvanced.classList.toggle("show");
  effectsToggle.textContent = isOpen ? "Show less" : "Show more";
  effectsToggle.setAttribute("aria-expanded", String(isOpen));
}

function buildPointSymbol(style: PointStyle) {
  const resolvedStyle = resolvePointStyleKey(style.style);
  const path = pointPathStyles[resolvedStyle];
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
    style: path ? "path" : resolvedStyle,
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

function colorToCssRgba(color: { r: number; g: number; b: number; a: number }) {
  const alpha = Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function buildPointSymbolSvgHref(styleKey: string, style: PointStyle) {
  const fallbackPathByStyle: Record<string, string> = {
    diamond: "M12 2 L22 12 L12 22 L2 12 Z"
  };
  const path = pointPathStyles[styleKey] ?? fallbackPathByStyle[styleKey];
  if (!path) return null;
  const viewBoxSize = styleKey.startsWith("phosphor-") ? 1024 : 24;
  const scale = viewBoxSize / 24;
  const fillColor = parseColorToRgba(style.color);
  const outlineColor = parseColorToRgba(style.outlineColor);
  const outlineWidth = Math.max(0, Number(style.outlineWidth) || 0) * scale;
  const outlineAttrs =
    outlineWidth > 0
      ? ` stroke="${colorToCssRgba(outlineColor)}" stroke-width="${outlineWidth}" stroke-linejoin="round" stroke-linecap="round"`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"><path d="${path}" fill="${colorToCssRgba(fillColor)}"${outlineAttrs}/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getSymbolLayersArray(symbol: any): any[] {
  const symbolLayers = symbol?.symbolLayers;
  if (!symbolLayers) return [];
  if (Array.isArray(symbolLayers)) return symbolLayers;
  if (typeof symbolLayers.toArray === "function") {
    try {
      return symbolLayers.toArray();
    } catch {
      return [];
    }
  }
  return [];
}

function setSymbolLayersCollection(symbol: any, nextLayers: any[]) {
  try {
    symbol.symbolLayers = nextLayers;
    return;
  } catch {
    // fallback for Collection-backed symbolLayers
  }
  const collection = symbol?.symbolLayers;
  if (!collection) return;
  if (typeof collection.removeAll === "function") {
    collection.removeAll();
  }
  if (typeof collection.addMany === "function") {
    collection.addMany(nextLayers);
  }
}

function getPointSymbolRotation(symbol: any) {
  if (!symbol) return undefined;
  if (symbol.type === "simple-marker") {
    const angle = Number(symbol.angle);
    return Number.isFinite(angle) ? angle : undefined;
  }
  if (symbol.type === "point-3d") {
    const symbolLayers = getSymbolLayersArray(symbol);
    for (const layer of symbolLayers) {
      if (!layer) continue;
      if (layer.type === "object") {
        const heading = Number(layer.heading);
        if (Number.isFinite(heading)) {
          return heading;
        }
      }
      if (layer.type === "icon") {
        const angle = Number(layer.angle);
        if (Number.isFinite(angle)) {
          return angle;
        }
      }
    }
  }
  const fallbackAngle = Number((symbol as any)?.angle);
  return Number.isFinite(fallbackAngle) ? fallbackAngle : undefined;
}

function applyPoint3DSymbolRotation(symbol: any, angle: number) {
  if (!symbol || symbol.type !== "point-3d") return symbol;
  const rotation = Number.isFinite(angle) ? angle : 0;
  const symbolLayers = getSymbolLayersArray(symbol);
  if (!symbolLayers.length) return symbol;
  const nextLayers = symbolLayers.map((layer: any) => {
    if (!layer) return layer;
    const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
    if (nextLayer.type === "object") {
      nextLayer.heading = rotation;
      return nextLayer;
    }
    if (nextLayer.type === "icon") {
      nextLayer.angle = rotation;
      return nextLayer;
    }
    return nextLayer;
  });
  setSymbolLayersCollection(symbol, nextLayers);
  return symbol;
}

function getPointWebStyleSymbolSpec(style: PointStyle) {
  const dynamicSpec = parseDynamicWebStyleKey(style.style);
  if (dynamicSpec) {
    return dynamicSpec;
  }
  const modelSymbol = pointModelSymbols3D[style.style];
  if (modelSymbol) {
    return modelSymbol;
  }
  return null;
}

async function resolvePointModelSymbol3D(style: PointStyle) {
  const spec = getPointWebStyleSymbolSpec(style);
  if (!spec) return null;
  const cacheKey = `${spec.styleName}::${spec.name}`;
  let pending = resolvedPointModelSymbolCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      try {
        const webStyleSymbol = new WebStyleSymbol({
          styleName: spec.styleName,
          name: spec.name
        });
        const resolvedSymbol = await webStyleSymbol.fetchSymbol();
        return resolvedSymbol?.type === "point-3d" ? resolvedSymbol : null;
      } catch (error) {
        console.warn(`[symbols] Failed to resolve WebStyleSymbol ${cacheKey}`, error);
        return null;
      }
    })();
    resolvedPointModelSymbolCache.set(cacheKey, pending);
  }
  const resolved = await pending;
  if (!resolved) return null;
  return typeof resolved.clone === "function" ? resolved.clone() : resolved;
}

async function applyPointModelSymbolToLayer(layerData: LayerData, style: PointStyle) {
  if (currentViewMode !== "3d" || layerData.type !== "point") return;
  const styleKey = style.style;
  if (!getPointWebStyleSymbolSpec(style)) return;
  const resolvedBase = await resolvePointModelSymbol3D(style);
  if (!resolvedBase || currentViewMode !== "3d") return;
  const latestStyle = layerData.pointStyle ?? defaultPointStyle;
  if (latestStyle.style !== styleKey) return;
  const rotation = Number(latestStyle.angle) || 0;
  layerData.layer.graphics.forEach((graphic: any) => {
    const symbolInstance =
      typeof resolvedBase.clone === "function" ? resolvedBase.clone() : { ...resolvedBase };
    graphic.symbol = applyPoint3DSymbolRotation(symbolInstance, rotation);
  });
}

function buildPointSymbol3D(style: PointStyle) {
  const modelSymbol = getPointWebStyleSymbolSpec(style);
  if (modelSymbol) {
    return {
      type: "web-style",
      styleName: modelSymbol.styleName,
      name: modelSymbol.name
    } as any;
  }
  const resolvedStyle = resolvePointStyleKey(style.style);
  const fillColor = parseColorToRgba(style.color);
  const outlineColor = parseColorToRgba(style.outlineColor);
  const primitiveByStyle: Record<string, string> = {
    circle: "circle",
    square: "square",
    triangle: "triangle",
    cross: "cross",
    x: "x"
  };
  const size = Math.max(2, Number(style.size) || defaultPointStyle.size);
  const angle = Number(style.angle) || 0;
  const href = buildPointSymbolSvgHref(resolvedStyle, style);
  if (href) {
    return {
      type: "point-3d",
      symbolLayers: [
        {
          type: "icon",
          resource: { href },
          size,
          angle
        }
      ]
    } as any;
  }
  const primitive = primitiveByStyle[resolvedStyle] ?? "circle";
  return {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive },
        size,
        angle,
        material: {
          color: [fillColor.r, fillColor.g, fillColor.b, Number.isFinite(fillColor.a) ? fillColor.a : 1]
        },
        outline: {
          color: [
            outlineColor.r,
            outlineColor.g,
            outlineColor.b,
            Number.isFinite(outlineColor.a) ? outlineColor.a : 1
          ],
          size: Math.max(0.5, Number(style.outlineWidth) || 0)
        }
      }
    ]
  } as any;
}

function buildPointSymbolForCurrentView(style: PointStyle) {
  return currentViewMode === "3d" ? buildPointSymbol3D(style) : buildPointSymbol(style);
}

function buildPolygonSymbol2D(style: any) {
  const fillColor = parseColorToRgba(style.color);
  const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
  const outlineColor = parseColorToRgba(style.outlineColor);
  const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
  const fillStyle2D = normalizeFillStyle2D(String(style.style || "solid"));
  return {
    type: "simple-fill",
    style: fillStyle2D as any,
    color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha],
    outline: {
      color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
      width: style.outlineWidth,
      style: normalizeLineStyle(style.outlineStyle ?? "solid") as any
    }
  } as any;
}

function normalizeLinePatternStyle3D(style: string) {
  const normalized = normalizeLineStyle(style);
  return supportedLinePatternStyles3D.has(normalized) ? normalized : "solid";
}

function normalizeFillStyle2D(style: string) {
  return supportedFillStyles2D.has(style) ? style : "solid";
}

function normalizeFillPatternStyle3D(style: string) {
  return supportedFillPatternStyles3D.has(style) ? style : "solid";
}

function getPolygonWaterStyle3D(style: string) {
  return polygonWaterStyles3D[style] ?? null;
}

function buildPolygonSymbol3D(style: any) {
  const fillColor = parseColorToRgba(style.color);
  const fillAlpha = Number.isFinite(fillColor.a) ? fillColor.a : 0.3;
  const outlineColor = parseColorToRgba(style.outlineColor);
  const outlineAlpha = Number.isFinite(outlineColor.a) ? outlineColor.a : 1;
  const selectedStyle = String(style.style || "solid");
  const fillPatternStyle = normalizeFillPatternStyle3D(selectedStyle);
  const outlinePatternStyle = normalizeLinePatternStyle3D(String(style.outlineStyle ?? "solid"));
  const waterStyle = getPolygonWaterStyle3D(selectedStyle);
  if (waterStyle) {
    const outlineSize = Math.max(0.5, Number(style.outlineWidth) || 0);
    const waterLayer: any = {
      type: "water",
      color: [fillColor.r, fillColor.g, fillColor.b, Number.isFinite(fillColor.a) ? fillColor.a : 1],
      waterbodySize: waterStyle.waterbodySize,
      waveStrength: waterStyle.waveStrength,
      waveDirection: waterStyle.waveDirection
    };
    const symbolLayers: any[] = [waterLayer];
    if (outlineSize > 0) {
      const outlineLayer: any = {
        type: "fill",
        material: {
          color: [fillColor.r, fillColor.g, fillColor.b, 0]
        },
        outline: {
          color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
          size: outlineSize
        }
      };
      if (outlinePatternStyle !== "solid") {
        outlineLayer.outline.pattern = {
          type: "style",
          style: outlinePatternStyle
        };
      }
      symbolLayers.push(outlineLayer);
    }
    return {
      type: "polygon-3d",
      symbolLayers
    } as any;
  }
  const fillLayer: any = {
    type: "fill",
    material: {
      color: [fillColor.r, fillColor.g, fillColor.b, fillAlpha]
    },
    outline: {
      color: [outlineColor.r, outlineColor.g, outlineColor.b, outlineAlpha],
      size: Math.max(0.5, Number(style.outlineWidth) || 0)
    }
  };
  if (fillPatternStyle !== "solid") {
    fillLayer.pattern = {
      type: "style",
      style: fillPatternStyle
    };
  }
  if (outlinePatternStyle !== "solid") {
    fillLayer.outline.pattern = {
      type: "style",
      style: outlinePatternStyle
    };
  }
  return {
    type: "polygon-3d",
    symbolLayers: [fillLayer]
  } as any;
}

function buildPolygonSymbolForCurrentView(style: any) {
  return currentViewMode === "3d" ? buildPolygonSymbol3D(style) : buildPolygonSymbol2D(style);
}

function buildTextSymbol2D(layerData: LayerData) {
  return {
    type: "text",
    text: layerData.textContent || "Text",
    color: layerData.textColor || "#22323a",
    font: {
      size: layerData.textSize || 14,
      family: layerData.textFontFamily || "sans-serif",
      style: layerData.textItalic ? "italic" : "normal",
      decoration: layerData.textUnderline ? "underline" : "none"
    }
  } as any;
}

function buildTextSymbol3D(layerData: LayerData) {
  const color = parseColorToRgba(layerData.textColor || "#22323a");
  const symbol: any = {
    type: "point-3d",
    symbolLayers: [
      {
        type: "text",
        text: layerData.textContent || "Text",
        material: {
          color: [color.r, color.g, color.b, Number.isFinite(color.a) ? color.a : 1]
        },
        halo: {
          color: [255, 255, 255, 0.9],
          size: 1
        },
        size: Math.max(10, Number(layerData.textSize) || 14),
        font: {
          family: layerData.textFontFamily || "sans-serif",
          style: layerData.textItalic ? "italic" : "normal",
          weight: "normal"
        }
      }
    ]
  };
  if (layerData.textCalloutLine) {
    symbol.verticalOffset = {
      screenLength: 34,
      maxWorldLength: 140,
      minWorldLength: 14
    };
    symbol.callout = {
      type: "line",
      size: 1.5,
      color: [color.r, color.g, color.b, 0.9],
      border: {
        color: [255, 255, 255, 0.9]
      }
    };
  }
  return symbol as any;
}

function buildTextSymbolForCurrentView(layerData: LayerData) {
  if (currentViewMode !== "3d") {
    return buildTextSymbol2D(layerData);
  }
  return layerData.textRenderMode === "flat" ? buildTextSymbol2D(layerData) : buildTextSymbol3D(layerData);
}

function applyTextSymbols(layerData: LayerData) {
  if (layerData.type !== "text") return;
  applyLayerModeProperties(layerData);
  layerData.layer.graphics.forEach((graphic: any) => {
    graphic.symbol = buildTextSymbolForCurrentView(layerData);
  });
}

function applyThumbtackParallaxToLayer(layerData: LayerData) {
  if (!view || layerData.type !== "point" || currentViewMode === "3d") return;
  const style = layerData.pointStyle ?? defaultPointStyle;
  if (style.style !== THUMBTACK_3D_STYLE) return;
  const centerX = Number(view?.width) / 2;
  const centerY = Number(view?.height) / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || centerX <= 0 || centerY <= 0) return;

  const baseColor = parseColorToRgba(style.color);
  const outlineColor = parseColorToRgba(style.outlineColor);

  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic?.geometry || graphic.geometry.type !== "point") return;
    if (!graphic?.symbol || graphic.symbol.type !== "simple-marker") return;
    const screen = view.toScreen?.(graphic.geometry);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return;
    const nx = Math.max(-1, Math.min(1, (screen.x - centerX) / centerX));
    const ny = Math.max(-1, Math.min(1, (screen.y - centerY) / centerY));
    const depth = 1 + (-ny) * 0.08;
    const symbol = graphic.symbol.clone();
    symbol.size = (style.size || defaultPointStyle.size) * depth;
    symbol.angle = (style.angle ?? 0) + nx * 7;
    symbol.xoffset = (style.xoffset ?? 0) + nx * 2.6;
    symbol.yoffset = (style.yoffset ?? 0) + ny * 1.5;
    symbol.color = [
      Math.max(0, Math.min(255, Math.round(baseColor.r * (0.95 + nx * 0.06 - ny * 0.05)))),
      Math.max(0, Math.min(255, Math.round(baseColor.g * (0.95 + nx * 0.06 - ny * 0.05)))),
      Math.max(0, Math.min(255, Math.round(baseColor.b * (0.95 + nx * 0.06 - ny * 0.05)))),
      Number.isFinite(baseColor.a) ? baseColor.a : 1
    ];
    symbol.outline = {
      color: [outlineColor.r, outlineColor.g, outlineColor.b, Number.isFinite(outlineColor.a) ? outlineColor.a : 1],
      width: Math.max(0, Number(style.outlineWidth) || 0)
    };
    graphic.symbol = symbol;
  });
}

function scheduleThumbtackParallaxUpdate() {
  if (thumbtackParallaxRafId !== null) {
    return;
  }
  thumbtackParallaxRafId = requestAnimationFrame(() => {
    thumbtackParallaxRafId = null;
    graphicsLayers.forEach((layerData) => {
      applyThumbtackParallaxToLayer(layerData);
    });
  });
}

function applyLayerStyle(layerData: LayerData) {
  applyLayerModeProperties(layerData);
  if (layerData.type === "text") {
    applyTextSymbols(layerData);
    return;
  }
  if (layerData.type === "point") {
    const style = layerData.pointStyle ?? defaultPointStyle;
    layerData.layer.graphics.forEach((graphic: any) => {
      graphic.symbol = buildPointSymbolForCurrentView(style);
    });
    if (currentViewMode === "3d" && getPointWebStyleSymbolSpec(style)) {
      void applyPointModelSymbolToLayer(layerData, style);
      return;
    }
    if (currentViewMode !== "3d" && style.style === THUMBTACK_3D_STYLE) {
      scheduleThumbtackParallaxUpdate();
    }
    return;
  }
  layerData.layer.graphics.forEach((graphic: any) => {
    if (layerData.type === "polyline") {
      const style = layerData.lineStyle ?? defaultLineStyle;
      graphic.symbol = buildLineSymbolForCurrentView(style);
      return;
    }
    if (layerData.type === "polygon") {
      const style = layerData.polygonStyle ?? defaultPolygonStyle;
      graphic.symbol = buildPolygonSymbolForCurrentView(style);
    }
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
  const state = event?.state as string | undefined;
  const tool = String(event?.tool || "");
  if (state === "start" || state === "active") {
    isVertexEditing = tool === "reshape" || tool === "vertex" || tool === "vertex-edit";
    if (currentViewMode === "3d" && isVertexEditing) {
      const graphics = event.graphics ?? (event.graphic ? [event.graphic] : []);
      graphics.forEach((graphic: any) => {
        const layerData = graphicsLayers.find((entry) => entry.layer === graphic?.layer);
        if (!layerData || layerData.type !== "polyline") return;
        const layerAny = layerData.layer as any;
        if (String(layerAny?.elevationInfo?.mode || "") === "on-the-ground") {
          layerAny.elevationInfo = { mode: "relative-to-ground", offset: 0 };
        }
      });
    }
    return;
  }
  if (state === "complete" || state === "cancel") {
    isVertexEditing = false;
  }
  if (state !== "complete") return;
  const graphics = event.graphics ?? (event.graphic ? [event.graphic] : []);
  const touchedLayers = new Set<LayerData>();
  graphics.forEach((graphic: any) => {
    graphic.geometry = toGeographicGeometry(graphic.geometry);
    const layerData = graphicsLayers.find((entry) => entry.layer === graphic.layer);
    if (!layerData) return;
    refreshGeometryCache(layerData, graphic);
    touchedLayers.add(layerData);
  });
  touchedLayers.forEach((layerData) => {
    applyLayerModeProperties(layerData);
    clearLayerOverlayLayers(layerData);
  });
  graphicsLayers.forEach((layerData) => {
    if ((layerData.layer?.graphics?.length ?? 0) === 0) {
      clearLayerOverlayLayers(layerData);
    }
  });
  scheduleProjectSave();
}

function hasPathAnimation(layerData: LayerData) {
  return layerData.animations.some(
    (anim) =>
      anim.type === "draw" ||
      anim.type === "drawReverse" ||
      anim.type === "fill" ||
      anim.type === "neonTrail" ||
      anim.type === "weldTrail" ||
      anim.type === "flightRoute" ||
      anim.type === "flightRouteCartoon" ||
      anim.type === "waypointRoute" ||
      anim.type === "waypointRouteCartoon"
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
  const pointFollowTerrainRow = document.getElementById("point-follow-terrain-row") as HTMLElement | null;
  const polygonZOffsetRow = document.getElementById("polygon-zoffset-row") as HTMLElement | null;
  const polygonOutlineStyle = getEl("polygon-outline-style-row");
  const effectsSection = getEl("layer-effects-section");

  pointSection.style.display = type === "point" ? "block" : "none";
  lineSection.style.display = type === "polyline" ? "block" : "none";
  polygonSection.style.display = type === "polygon" ? "block" : "none";
  effectsSection.style.display = showEffects ? "block" : "none";

  pointAdvanced.style.display = type === "point" ? "block" : "none";
  if (pointFollowTerrainRow) {
    pointFollowTerrainRow.style.display = type === "point" && currentViewMode === "3d" ? "" : "none";
  }
  if (polygonZOffsetRow) {
    polygonZOffsetRow.style.display = type === "polygon" && currentViewMode === "3d" ? "" : "none";
  }
  polygonOutlineStyle.style.display = showFeatureExtras && type === "polygon" ? "block" : "none";
  if (type === "point") {
    filterPointStyles();
  }
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

function readSceneQualityProfile(value: unknown, fallback: SceneQualityProfile): SceneQualityProfile {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return fallback;
}

function readSceneAtmosphereQuality(
  value: unknown,
  fallback: SceneAtmosphereQuality
): SceneAtmosphereQuality {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "low" || normalized === "high") {
    return normalized;
  }
  return fallback;
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
  const normalizedHex = `#${hex.replace("#", "").padStart(6, "0")}`;
  const normalizedHexAlpha = `${normalizedHex}${hexAlpha.replace("#", "").slice(-2)}`;
  if (picker) {
    picker.format = "hexa";
    picker.value = normalizedHexAlpha;
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

function filterPointStyles() {
  const pointStyleSearch = document.getElementById("point-style-search") as HTMLInputElement | null;
  const container = document.getElementById("point-style-options");
  if (!container) return;
  const is3D = currentViewMode === "3d";
  const query = pointStyleSearch?.value.trim().toLowerCase() || "";

  const buttons = Array.from(container.querySelectorAll(".style-option-btn")) as HTMLElement[];
  buttons.forEach((button) => {
    const value = String(button.dataset.value || "");
    const label = button.textContent?.trim().toLowerCase() || "";
    const is3DOption = isPointStyle3DOptionValue(value);
    const matchesMode = is3D || !is3DOption;
    const matchesQuery = !query || label.includes(query);
    button.style.display = matchesMode && matchesQuery ? "" : "none";
  });

  const titles = Array.from(container.querySelectorAll(".style-option-section-title")) as HTMLElement[];
  titles.forEach((title) => {
    let next: Element | null = title.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains("style-option-section-title")) {
      if (next instanceof HTMLElement && next.style.display !== "none") {
        hasVisible = true;
        break;
      }
      next = next.nextElementSibling;
    }
    const isThreeDTitle = title.id === "point-webstyle-dynamic-title" || title.id === "point-3d-models-title";
    if (isThreeDTitle && !is3D) {
      title.style.display = "none";
      return;
    }
    title.style.display = hasVisible ? "" : "none";
  });
}

function createPointStyleButton(value: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "style-option-btn";
  button.dataset.value = value;
  const swatch = document.createElement("span");
  swatch.className = "point-style-swatch point-style-swatch--square";
  button.appendChild(swatch);
  button.appendChild(document.createTextNode(label));
  return button;
}

function clearDynamicPointStyleButtons() {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  container
    .querySelectorAll('.style-option-btn[data-webstyle-dynamic="true"]')
    .forEach((element) => element.remove());
  const title = document.getElementById("point-webstyle-dynamic-title") as HTMLElement | null;
  if (title) {
    title.style.display = "none";
  }
}

function ensurePointStyleSelectionOption(styleValue: string, label?: string) {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  const existing = Array.from(container.querySelectorAll(".style-option-btn")).find(
    (button) => (button as HTMLElement).dataset.value === styleValue
  );
  if (existing) return;
  const title = document.getElementById("point-webstyle-dynamic-title");
  if (!title || !title.parentElement) return;
  const displayName =
    label ??
    (() => {
      const dynamicSpec = parseDynamicWebStyleKey(styleValue);
      if (!dynamicSpec) return "3D WebStyle Symbol";
      return `${dynamicSpec.name} (${dynamicSpec.styleName})`;
    })();
  const button = createPointStyleButton(styleValue, displayName);
  button.dataset.webstyleDynamic = "true";
  title.parentElement.insertBefore(button, title.nextSibling);
  (title as HTMLElement).style.display = "";
}

async function fetchWebStyleSymbolNames(styleName: string) {
  const normalizedStyleName = String(styleName || "").trim();
  if (!normalizedStyleName) return [] as string[];
  let pending: Promise<string[]> | undefined = webStyleSymbolNameCache.get(normalizedStyleName);
  if (!pending) {
    pending = (async (): Promise<string[]> => {
      try {
        const portal = Portal.getDefault();
        await portal.load();
        const query = new PortalQueryParams({
          query: `owner:esri_en AND type:Style AND typekeywords:"${normalizedStyleName}"`
        });
        const results = await portal.queryItems(query);
        const item = (results?.results ?? []).find((entry: any) => {
          const keywords = Array.isArray(entry?.typeKeywords)
            ? entry.typeKeywords.map((keyword: unknown) => String(keyword || "").toLowerCase())
            : [];
          return (
            String(entry?.type || "").toLowerCase() === "style" &&
            String(entry?.owner || "").toLowerCase() === "esri_en" &&
            keywords.includes(normalizedStyleName.toLowerCase())
          );
        }) as any;
        if (!item) return [] as string[];
        if (typeof item.load === "function") {
          await item.load();
        }
        const data = (await item.fetchData?.()) as any;
        const names = Array.isArray(data?.items)
          ? data.items
              .map((entry: any) => String(entry?.name || "").trim())
              .filter((name: string) => Boolean(name))
          : [];
        const uniqueNames = Array.from(new Set<string>(names));
        return uniqueNames.sort((a, b) => a.localeCompare(b));
      } catch (error) {
        console.warn(`[symbols] Failed to load web style names for ${normalizedStyleName}`, error);
        return [] as string[];
      }
    })();
    webStyleSymbolNameCache.set(normalizedStyleName, pending);
  }
  return await pending;
}

async function loadDynamicPointWebStyleOptionsForStyles(styleNames: string[], selectedStyle?: string) {
  const normalizedStyleNames = Array.from(
    new Set(
      styleNames
        .map((styleName) => String(styleName || "").trim())
        .filter((styleName) => Boolean(styleName))
    )
  );
  clearDynamicPointStyleButtons();
  if (!normalizedStyleNames.length) {
    loadedPointWebStyleCatalogNames.clear();
    filterPointStyles();
    return;
  }
  const styleEntries = await Promise.all(
    normalizedStyleNames.map(async (styleName) => ({
      styleName,
      names: await fetchWebStyleSymbolNames(styleName)
    }))
  );
  const container = document.getElementById("point-style-options");
  const title = document.getElementById("point-webstyle-dynamic-title");
  if (!container || !title || !title.parentElement) {
    return;
  }
  const flattenedEntries = styleEntries.flatMap((entry) =>
    entry.names.map((name) => ({
      styleName: entry.styleName,
      name
    }))
  );
  if (!flattenedEntries.length) {
    loadedPointWebStyleCatalogNames.clear();
    filterPointStyles();
    return;
  }
  const parent = title.parentElement;
  const anchor = title.nextSibling;
  const fragment = document.createDocumentFragment();
  flattenedEntries.forEach(({ styleName, name }) => {
    const value = encodeDynamicWebStyleKey(styleName, name);
    const button = createPointStyleButton(
      value,
      normalizedStyleNames.length > 1 ? `${name} (${styleName})` : name
    );
    button.dataset.webstyleDynamic = "true";
    fragment.appendChild(button);
  });
  parent.insertBefore(fragment, anchor);
  title.style.display = "";
  loadedPointWebStyleCatalogNames.clear();
  normalizedStyleNames.forEach((styleName) => loadedPointWebStyleCatalogNames.add(styleName));
  if (selectedStyle) {
    ensurePointStyleSelectionOption(selectedStyle);
    setPointStyleSelection(selectedStyle);
  }
  filterPointStyles();
}

async function ensureAllPointWebStyleOptionsFor3D(selectedStyle?: string) {
  if (currentViewMode !== "3d") {
    filterPointStyles();
    return;
  }
  const dynamicSpec = selectedStyle ? parseDynamicWebStyleKey(selectedStyle) : null;
  const styleNames = Array.from(
    new Set(
      [...POINT_WEBSTYLE_PRESET_STYLES, dynamicSpec?.styleName || ""].filter((value) => Boolean(value))
    )
  );
  const container = document.getElementById("point-style-options");
  const hasDynamicButtons =
    (container?.querySelectorAll?.('.style-option-btn[data-webstyle-dynamic="true"]')?.length ?? 0) > 0;
  const hasAllStyleCatalogsLoaded = styleNames.every((styleName) =>
    loadedPointWebStyleCatalogNames.has(styleName)
  );
  if (hasDynamicButtons && hasAllStyleCatalogsLoaded) {
    if (selectedStyle) {
      ensurePointStyleSelectionOption(selectedStyle);
      setPointStyleSelection(selectedStyle);
    }
    filterPointStyles();
    return;
  }
  if (pointWebStyleCatalogLoadPromise) {
    await pointWebStyleCatalogLoadPromise;
    if (selectedStyle) {
      ensurePointStyleSelectionOption(selectedStyle);
      setPointStyleSelection(selectedStyle);
    }
    filterPointStyles();
    return;
  }
  pointWebStyleCatalogLoadPromise = loadDynamicPointWebStyleOptionsForStyles(styleNames, selectedStyle).finally(
    () => {
      pointWebStyleCatalogLoadPromise = null;
    }
  );
  await pointWebStyleCatalogLoadPromise;
}

function setPointStyleSelection(value: string) {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  if (value) {
    ensurePointStyleSelectionOption(value);
  }
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
  filterPointStyles();
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
  const containers = Array.from(
    document.querySelectorAll(".animation-type-options")
  ) as HTMLElement[];
  if (!containers.length) return;
  containers.forEach((container) => {
    container.style.setProperty("--preview-color", color);
    const previews = Array.from(
      container.querySelectorAll(".animation-type-preview--polyline")
    ) as HTMLElement[];
    previews.forEach((preview) => {
      Array.from(preview.classList)
        .filter((cls) => cls.startsWith("line-style-"))
        .forEach((cls) => preview.classList.remove(cls));
      preview.classList.add(`line-style-${style}`);
    });
  });
}

function updatePointAnimationPreview(color: string, outlineColor: string, style: string) {
  const resolvedStyle = resolvePointStyleKey(style);
  const containers = Array.from(
    document.querySelectorAll(".animation-type-options")
  ) as HTMLElement[];
  if (!containers.length) return;
  containers.forEach((container) => {
    container.style.setProperty("--preview-color", color);
    container.style.setProperty("--preview-outline-color", outlineColor);
    const previews = Array.from(
      container.querySelectorAll(".animation-type-preview--point")
    ) as HTMLElement[];
    previews.forEach((preview) => {
      const usesPointStyle =
        !preview.classList.contains("animation-type-preview--dartHit") &&
        !preview.classList.contains("animation-type-preview--fireworks") &&
        !preview.classList.contains("animation-type-preview--crossetteShell") &&
        !preview.classList.contains("animation-type-preview--mineShellCombo");
      Array.from(preview.classList)
        .filter((cls) => cls.startsWith("point-style-"))
        .forEach((cls) => preview.classList.remove(cls));
      if (usesPointStyle) {
        preview.classList.add(`point-style-${resolvedStyle}`);
      }
      const path = pointPathStyles[resolvedStyle];
      if (path && usesPointStyle) {
        const viewBox = resolvedStyle.startsWith("phosphor-") ? "0 0 1024 1024" : "0 0 24 24";
        preview.innerHTML = `<svg viewBox="${viewBox}" aria-hidden="true"><path d="${path}"></path></svg>`;
        preview.classList.add("animation-type-preview--icon");
      } else {
        preview.innerHTML = "";
        preview.classList.remove("animation-type-preview--icon");
      }
    });
  });
}

function updatePointStyleOptionColors(color: string, outlineColor: string) {
  const container = document.getElementById("point-style-options");
  if (!container) return;
  container.style.setProperty("--preview-point-color", color);
  container.style.setProperty("--preview-point-outline", outlineColor);
}

function updatePolygonAnimationPreview(fillColor: string, outlineColor: string) {
  const containers = Array.from(
    document.querySelectorAll(".animation-type-options")
  ) as HTMLElement[];
  if (!containers.length) return;
  containers.forEach((container) => {
    container.style.setProperty("--preview-fill-color", fillColor);
    container.style.setProperty("--preview-outline-color", outlineColor);
  });
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

function buildLineSymbol3D(style: LineStyle) {
  const color = parseColorToRgba(style.color);
  const alpha = Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1;
  const lineSize = Math.max(1, Number(style.width) || defaultLineStyle.width);
  const patternStyle = normalizeLinePatternStyle3D(style.style);
  const marker = buildLineMarker3D(style.style, [color.r, color.g, color.b, alpha]);
  const layer: any = {
    type: "line",
    size: lineSize,
    cap: "round",
    join: "round",
    material: {
      color: [color.r, color.g, color.b, alpha]
    }
  };
  if (patternStyle !== "solid") {
    layer.pattern = {
      type: "style",
      style: patternStyle
    };
  }
  if (marker) {
    layer.marker = marker;
  }
  return {
    type: "line-3d",
    symbolLayers: [layer]
  } as any;
}

function buildLineSymbolForCurrentView(style: LineStyle) {
  return currentViewMode === "3d" ? buildLineSymbol3D(style) : buildLineSymbol(style);
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

function buildLineMarker3D(style: string, color: [number, number, number, number]) {
  if (!style.startsWith("arrow-")) return null;
  let placement: "begin" | "end" | "begin-end" = "end";
  if (style === "arrow-start") {
    placement = "begin";
  } else if (style === "arrow-both") {
    placement = "begin-end";
  }
  return {
    type: "style",
    style: "arrow",
    placement,
    color
  };
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

  activeTextLayerIndex = selectedLayerIndex;
  attachTextPanelTo(`style-settings-host-${selectedLayerIndex}`);
  syncTextPanelFromLayer(layerData);
  setTimeout(() => (getEl("text-content-input") as any)?.focus?.(), 0);
}

function updateTextCalloutControlVisibility(renderMode: string) {
  const calloutRow = document.getElementById("text-3d-callout-row") as HTMLElement | null;
  if (!calloutRow) return;
  calloutRow.style.display = renderMode === "scene-3d" ? "" : "none";
}

function syncTextPanelFromLayer(layerData: LayerData) {
  const contentInput = document.getElementById("text-content-input") as any;
  if (!contentInput) return;
  const sizeSlider = document.getElementById("text-size-slider") as any;
  const colorInput = document.getElementById("text-color-input") as HTMLInputElement | null;
  const renderModeSelect = document.getElementById("text-render-mode-select") as any;
  const fontSelect = document.getElementById("text-font-select") as any;
  const italicToggle = document.getElementById("text-italic-toggle") as any;
  const underlineToggle = document.getElementById("text-underline-toggle") as any;
  const calloutToggle = document.getElementById("text-3d-callout-toggle") as any;

  contentInput.value = layerData.textContent || "Text";
  if (sizeSlider) sizeSlider.value = layerData.textSize || 14;
  if (colorInput) colorInput.value = layerData.textColor || "#22323a";
  const renderMode = layerData.textRenderMode || "scene-3d";
  if (renderModeSelect) renderModeSelect.value = renderMode;
  if (fontSelect) fontSelect.value = layerData.textFontFamily || "sans-serif";
  if (italicToggle) italicToggle.checked = Boolean(layerData.textItalic);
  if (underlineToggle) underlineToggle.checked = Boolean(layerData.textUnderline);
  if (calloutToggle) calloutToggle.checked = Boolean(layerData.textCalloutLine);
  updateTextCalloutControlVisibility(renderMode);
}

function openAiModal() {
  setAiError(null);
  const modal = getEl("ai-ask-modal") as any;
  modal.open = true;
  const input = getEl("ai-prompt-input") as any;
  const lastPrompt = window.localStorage?.getItem(aiPromptStorageKey);
  if (lastPrompt) {
    input.value = lastPrompt;
  }
  const modelNote = document.getElementById("ai-model-note");
  if (modelNote) {
    const lastModel = window.localStorage?.getItem(aiModelStorageKey);
    const modelLabel = lastModel ? `Using ChatGPT Model ${lastModel}` : "Using ChatGPT Model (server configured)";
    modelNote.textContent = `${modelLabel} and will create a new project each time.`;
  }
  setTimeout(() => input?.focus?.(), 0);
}

function closeAiModal() {
  closeModal("ai-ask-modal");
}

function setAiError(message: string | null) {
  const errorEl = getEl("ai-error");
  if (!message) {
    errorEl.textContent = "";
    return;
  }
  errorEl.textContent = message;
}

function clearAiPrompt() {
  const promptInput = getEl("ai-prompt-input") as any;
  if (promptInput) {
    promptInput.value = "";
  }
  window.localStorage?.removeItem(aiPromptStorageKey);
  setAiError(null);
  promptInput?.focus?.();
}

function setAiLoading(loading: boolean) {
  const generateBtn = getEl("ai-generate-btn");
  const cancelBtn = getEl("ai-cancel-btn");
  const clearBtn = getEl("ai-clear-btn");
  const promptInput = getEl("ai-prompt-input");
  if (loading) {
    generateBtn.setAttribute("disabled", "");
    cancelBtn.setAttribute("disabled", "");
    clearBtn.setAttribute("disabled", "");
    promptInput.setAttribute("disabled", "");
    generateBtn.textContent = "Generating...";
  } else {
    generateBtn.removeAttribute("disabled");
    cancelBtn.removeAttribute("disabled");
    clearBtn.removeAttribute("disabled");
    promptInput.removeAttribute("disabled");
    generateBtn.textContent = "Generate";
  }
}

async function handleAiGenerate() {
  const promptInput = getEl("ai-prompt-input") as any;
  const prompt = String(promptInput?.value || "").trim();
  if (!prompt) {
    setAiError("Enter a description to continue.");
    return;
  }

  setAiError(null);
  setAiLoading(true);

  try {
    const base = (import.meta as any).env?.BASE_URL || "/";
    const endpoint = (import.meta as any).env?.DEV
      ? "http://localhost:8000/agent/anim.php"
      : `${base.replace(/\/?$/, "/")}anim.php`;
    const sharedToken = (import.meta as any).env?.VITE_PULSE_SHARED_SECRET;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sharedToken) {
      headers["X-Pulse-Token"] = String(sharedToken);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt })
    });
    const modelHeader = response.headers.get("X-OpenAI-Model");
    if (modelHeader) {
      window.localStorage?.setItem(aiModelStorageKey, modelHeader);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error || `Request failed (${response.status})`;
      setAiError(message);
      return;
    }
    await applyProjectSnapshot(data);
    window.localStorage?.setItem(aiPromptStorageKey, prompt);
    promptInput.value = "";
    closeAiModal();
  } catch (error) {
    setAiError("Request failed. Please try again.");
  } finally {
    setAiLoading(false);
  }
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
  const renderModeSelect = getEl("text-render-mode-select") as any;
  const renderModeRaw = String(renderModeSelect?.value || layerData.textRenderMode || "scene-3d");
  const renderMode = renderModeRaw === "flat" ? "flat" : "scene-3d";
  const fontSelect = getEl("text-font-select") as any;
  const fontFamily = String(fontSelect?.value || layerData.textFontFamily || "sans-serif");
  const italicToggle = getEl("text-italic-toggle") as any;
  const underlineToggle = getEl("text-underline-toggle") as any;
  const calloutToggle = getEl("text-3d-callout-toggle") as any;
  const isItalic = Boolean(italicToggle?.checked);
  const isUnderline = Boolean(underlineToggle?.checked);
  const hasCalloutLine = Boolean(calloutToggle?.checked);

  layerData.textContent = content;
  layerData.textSize = Number.isFinite(size) ? size : layerData.textSize;
  layerData.textColor = color;
  layerData.textRenderMode = renderMode;
  layerData.textFontFamily = fontFamily;
  layerData.textItalic = isItalic;
  layerData.textUnderline = isUnderline;
  layerData.textCalloutLine = hasCalloutLine;

  updateTextCalloutControlVisibility(renderMode);

  applyTextSymbols(layerData);

  scheduleProjectSave();

  if (shouldClose) {
    activeTextLayerIndex = null;
  }
}

function updateStylePanel() {
  if (selectedLayerIndex < 0) {
    attachStylePanelTo();
    attachTextPanelTo();
    return;
  }
  const layerData = graphicsLayers[selectedLayerIndex];
  if (isViewTrackLayer(layerData)) {
    attachStylePanelTo();
    attachTextPanelTo();
    return;
  }
  if (layerData.type === "text") {
    attachStylePanelTo();
    attachTextPanelTo(`style-settings-host-${selectedLayerIndex}`);
    syncTextPanelFromLayer(layerData);
    return;
  }
  attachTextPanelTo();
  attachStylePanelTo(`style-settings-host-${selectedLayerIndex}`);
  syncStylePanelFromLayer(layerData);
}

function updateAnimationOptions() {
  if (selectedLayerIndex < 0) {
    setAnimationPanelVisible(false);
    attachAnimationPanelTo();
    attachStylePanelTo();
    attachTextPanelTo();
    const cameraSettings = document.getElementById("camera-animation-settings");
    if (cameraSettings) {
      cameraSettings.style.display = "none";
    }
    return;
  }
  const layerData = graphicsLayers[selectedLayerIndex];
  setAnimationPanelVisible(true);
  attachAnimationPanelTo(`animation-settings-host-${selectedLayerIndex}`);
  const baseTypeSection = document.getElementById("animation-type-base-section");
  const webglSection = document.getElementById("webgl-animation-section");
  const featureSettings = document.getElementById("feature-animation-settings");
  const cameraSettings = document.getElementById("camera-animation-settings");

  if (isViewTrackLayer(layerData)) {
    attachStylePanelTo();
    attachTextPanelTo();
    if (baseTypeSection) {
      baseTypeSection.style.display = "none";
    }
    if (webglSection) {
      webglSection.style.display = "none";
    }
    if (featureSettings) {
      featureSettings.style.display = "none";
    }
    if (cameraSettings) {
      cameraSettings.style.display = "block";
    }
    syncCameraAnimationEasingControl(layerData);
    updateAnimationsList();
    return;
  }

  if (cameraSettings) {
    cameraSettings.style.display = "none";
  }
  if (baseTypeSection) {
    baseTypeSection.style.display = "block";
  }
  updateStylePanel();
  syncAnimationStartInput();

  const optionsContainer = document.getElementById("animation-type-options");
  const webglOptionsContainer = document.getElementById("animation-type-options-webgl");
  if (!optionsContainer || !webglOptionsContainer) return;
  optionsContainer.innerHTML = "";
  webglOptionsContainer.innerHTML = "";

  const types = animationTypes[layerData.type] || animationTypes.point;
  const baseTypes = types.filter((type) => !webglAnimationTypes.has(type.value));
  const webglTypes = types.filter((type) => webglAnimationTypes.has(type.value));

  const renderTypeOptions = (
    container: HTMLElement,
    list: ReadonlyArray<{ value: string; label: string }>
  ) => {
    list.forEach((type) => {
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
      container.appendChild(optionButton);
    });
  };

  renderTypeOptions(optionsContainer, baseTypes);
  renderTypeOptions(webglOptionsContainer, webglTypes);

  if (webglSection) {
    webglSection.style.display = webglTypes.length ? "block" : "none";
  }

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

  if (layerData.type === "feature" && featureSettings) {
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
  } else if (featureSettings) {
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

function attachStylePanelTo(hostId?: string) {
  const panel = document.getElementById("style-settings-panel");
  const stash = document.getElementById("style-settings-stash");
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

function attachTextPanelTo(hostId?: string) {
  const panel = document.getElementById("text-settings-panel");
  const stash = document.getElementById("text-settings-stash");
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

