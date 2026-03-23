import type {
  LayerAnimation,
  LayerEffectSettings,
  LayerType,
  LineStyle,
  PointKeyframe,
  PointStyle,
  PolygonStyle,
  TextRenderMode
} from "../types";

export const TIMELINE_SNAP_INCREMENT = 0.1;
export const TIMELINE_SNAP_PX = 8;
export const HISTORY_LIMIT = 10;
export const EXPORT_WARNING_DURATION = 60;
export const EXPORT_WARNING_ANIMATIONS = 80;

export const DEFAULT_PIN_SIZE = 20;
export const DEFAULT_CIRCLE_SIZE = 5;
export const DEFAULT_PIN_Y_OFFSET = 10;
export const DEFAULT_PIN_Y_OFFSET_RATIO = DEFAULT_PIN_Y_OFFSET / DEFAULT_PIN_SIZE;

export const defaultPointStyle: PointStyle = {
  style: "map-pin",
  size: DEFAULT_PIN_SIZE,
  color: "#0a4c66",
  outlineColor: "#ffffff",
  outlineWidth: 2,
  angle: 0,
  heading: 0,
  tilt: 0,
  roll: 0,
  xoffset: 0,
  yoffset: DEFAULT_PIN_Y_OFFSET
};

export const defaultLineStyle: LineStyle = {
  style: "arrow-end",
  width: 3,
  color: "#0a4c66"
};

export const defaultPolygonStyle: PolygonStyle = {
  style: "solid",
  color: "#7ac7b0",
  outlineColor: "#0a4c66",
  outlineWidth: 2,
  outlineStyle: "solid",
  extrudeHeight: 0
};
export const DEFAULT_TEXT_MESH_DEPTH_PERCENT = 22;

export const PROJECT_STORAGE_KEY_LOCAL = "pulse.project.local";
export const PROJECT_STORAGE_KEY_SESSION = "pulse.project.session";
export const PROJECT_STORAGE_KEY_RECENTS = "pulse.project.recents";
export const PROJECT_STORAGE_KEY_NAME = "pulse.project.name";
export const STORAGE_CONSENT_KEY = "pulse.storage.consent";
export const PROJECT_VERSION = 1;
export const APP_VERSION = "3.13.0";
export const ENABLE_PROJECT_STORAGE = true;

export const allowedBasemaps = new Set([
  "gray-vector",
  "streets-vector",
  "streets-navigation-vector",
  "streets-night-vector",
  "streets-relief-vector",
  "topo-vector",
  "topo-3d",
  "navigation-3d",
  "navigation-dark-3d",
  "osm-3d",
  "gray-3d",
  "dark-gray-3d",
  "streets-3d",
  "streets-dark-3d",
  "satellite",
  "hybrid",
  "terrain",
  "oceans",
  "dark-gray-vector",
  "osm",
  "none"
]);

export type ProjectLayerSnapshot = {
  id: string;
  name: string;
  type: LayerType;
  animations: LayerAnimation[];
  pointKeyframes?: PointKeyframe[];
  pointStyle?: PointStyle;
  pointFollowTerrain3D?: boolean;
  lineStyle?: LineStyle;
  lineFollowTerrain3D?: boolean;
  polygonStyle?: PolygonStyle;
  polygonZOffset?: number;
  textContent?: string;
  textSize?: number;
  textColor?: string;
  textFontFamily?: string;
  textItalic?: boolean;
  textUnderline?: boolean;
  textRenderMode?: TextRenderMode;
  textCalloutLine?: boolean;
  textDepth?: number;
  textFixedToWorld?: boolean;
  textWorldHeight?: number;
  textWorldRotation?: number;
  featureLayerUrl?: string;
  featureFields?: Array<{ name: string; type: string }>;
  featureField?: string;
  featureFieldType?: string;
  featureFieldStats?: { min: number; max: number };
  featureVisualVariable?: "opacity" | "size" | "color";
  featureHideNulls?: boolean;
  featureKeepVisible?: boolean;
  customAttribution?: string;
  layerBlendMode?: string;
  layerEffectSettings?: LayerEffectSettings;
  layerEffectsEnabled?: boolean;
};

export type ProjectSnapshot = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: any;
    properties: Record<string, any>;
  }>;
  properties: {
    _pulse: {
      version: number;
      savedAt: string;
      projectName?: string;
      spatialReference?: { wkid?: number };
      app: {
        mode?: "2d" | "3d";
        layout: "default" | "mobile" | "tablet" | "custom";
        customWidth: number | null;
        customHeight: number | null;
        isRotated: boolean;
        basemap: string;
        basemapVisible: boolean;
        basemapLabelsVisible?: boolean;
        google3DTilesEnabled?: boolean;
        viewTrackKeyframes?: Array<{
          time: number;
          x: number;
          y: number;
          z?: number;
          heading?: number;
          tilt?: number;
          fov?: number;
          rotation?: number;
          scale?: number;
          easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
          spatialReference?: { wkid?: number; latestWkid?: number };
        }>;
        backgroundColor?: string;
        backgroundTransparent?: boolean;
        camera?: {
          position: {
            x: number;
            y: number;
            z: number;
            spatialReference?: { wkid?: number; latestWkid?: number };
          };
          heading: number;
          tilt: number;
        };
        scene?: {
          cameraStudio?: {
            fov?: number;
            qualityProfile?: "low" | "medium" | "high";
            atmosphereQuality?: "low" | "high";
            glowEnabled?: boolean;
            glowIntensity?: number;
            cinematicFxEnabled?: boolean;
            exposure?: number;
            contrast?: number;
            saturation?: number;
            letterbox?: number;
            noiseLevel?: number;
            scanlineLevel?: number;
            vignetteLevel?: number;
            jitter?: number;
            chromaticAberration?: number;
          };
          lighting?: {
            type?: "sun" | "virtual";
            date?: string;
            displayUTCOffset?: number;
            directShadowsEnabled?: boolean;
            glowIntensity?: number;
          };
        };
        extent?: { xmin: number; ymin: number; xmax: number; ymax: number; wkid?: number };
      };
      timeline: {
        durationOverride: number | null;
      };
      layers: ProjectLayerSnapshot[];
    };
  };
};

export type RecentProject = {
  id: string;
  name: string;
  savedAt: string;
  snapshot: ProjectSnapshot;
};

export const sanitizePlainText = (value: string, fallback: string) => {
  const cleaned = String(value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  return cleaned || fallback;
};

export const getAutoPinYOffset = (size: number) => {
  const next = size * DEFAULT_PIN_Y_OFFSET_RATIO;
  return Number(next.toFixed(2));
};

export const normalizeBasemap = (value: string) => {
  return allowedBasemaps.has(value) ? value : "gray-vector";
};
