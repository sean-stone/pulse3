import type {
  LayerAnimation,
  LayerEffectSettings,
  LayerType,
  LineStyle,
  PointKeyframe,
  PointStyle,
  PolygonStyle
} from "../types";

export const TIMELINE_SNAP_INCREMENT = 0.1;
export const TIMELINE_SNAP_PX = 8;
export const HISTORY_LIMIT = 30;
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
  outlineStyle: "solid"
};

export const PROJECT_STORAGE_KEY_LOCAL = "pulse.project.local";
export const PROJECT_STORAGE_KEY_SESSION = "pulse.project.session";
export const PROJECT_STORAGE_KEY_RECENTS = "pulse.project.recents";
export const PROJECT_STORAGE_KEY_NAME = "pulse.project.name";
export const STORAGE_CONSENT_KEY = "pulse.storage.consent";
export const PROJECT_VERSION = 1;
export const ENABLE_PROJECT_STORAGE = true;

export const allowedBasemaps = new Set([
  "gray-vector",
  "streets-vector",
  "topo-vector",
  "satellite",
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
  lineStyle?: LineStyle;
  polygonStyle?: PolygonStyle;
  textContent?: string;
  textSize?: number;
  textColor?: string;
  featureLayerUrl?: string;
  featureFields?: Array<{ name: string; type: string }>;
  featureField?: string;
  featureFieldType?: string;
  featureFieldStats?: { min: number; max: number };
  featureVisualVariable?: "opacity" | "size" | "color";
  featureHideNulls?: boolean;
  featureKeepVisible?: boolean;
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
        layout: "default" | "mobile" | "tablet" | "custom";
        customWidth: number | null;
        customHeight: number | null;
        isRotated: boolean;
        basemap: string;
        basemapVisible: boolean;
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
