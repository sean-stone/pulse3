export type LayerType = "point" | "polyline" | "polygon" | "text" | "feature" | "volume";
export type PointKeyframeEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type TextRenderMode = "flat" | "scene-3d" | "mesh-3d";

export interface LayerAnimation {
  type: string;
  duration: number;
  start: number;
  pathLayerId?: string;
  orientToPath?: boolean;
  reverse?: boolean;
  smoothFollow?: boolean;
}

export interface PointKeyframe {
  time: number;
  x: number;
  y: number;
  z?: number;
  heading?: number;
  tilt?: number;
  roll?: number;
  fov?: number;
  rotation?: number;
  scale?: number;
  easing?: PointKeyframeEasing;
  spatialReference?: any;
}

export interface PointStyle {
  style: string;
  size: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  angle?: number;
  heading?: number;
  tilt?: number;
  roll?: number;
  xoffset?: number;
  yoffset?: number;
}

export interface LineStyle {
  style: string;
  width: number;
  color: string;
}

export interface PolygonStyle {
  style: string;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  outlineStyle?: string;
  extrudeHeight?: number;
}

export interface VolumeStyle {
  width: number;
  depth: number;
  height: number;
  floorOffset: number;
  opacity: number;
  slices: number;
  color: string;
  edgeColor: string;
  emitterMode?: "box" | "emitter";
  emitterRadius?: number;
  fireLifetime?: number;
  smokeLifetime?: number;
  fireSpeed?: number;
  smokeSpeed?: number;
  variation?: number;
  turbulence?: number;
  windX?: number;
  windY?: number;
  buoyancy?: number;
}

export interface LayerEffectSettings {
  brightness: number;
  contrast: number;
  grayscale: number;
  hueRotate: number;
  invert: number;
  opacity: number;
  saturate: number;
  sepia: number;
  blur: number;
  dropShadowOffsetX: number;
  dropShadowOffsetY: number;
  dropShadowBlur: number;
  dropShadowColor: string;
}

export interface LayerData {
  layer: any;
  name: string;
  type: LayerType;
  isViewTrack?: boolean;
  color?: string;
  animations: LayerAnimation[];
  pointKeyframes?: PointKeyframe[];
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
  pointStyle?: PointStyle;
  pointFollowTerrain3D?: boolean;
  lineStyle?: LineStyle;
  lineFollowTerrain3D?: boolean;
  polygonStyle?: PolygonStyle;
  polygonZOffset?: number;
  volumeStyle?: VolumeStyle;
  featureLayerUrl?: string;
  featureFields?: Array<{ name: string; type: string }>;
  featureField?: string;
  featureFieldType?: string;
  featureFieldStats?: { min: number; max: number };
  featureVisualVariable?: "opacity" | "size" | "color";
  featureHideNulls?: boolean;
  featureLastValue?: number;
  featureKeepVisible?: boolean;
  customAttribution?: string;
  layerBlendMode?: string;
  layerEffectSettings?: LayerEffectSettings;
  layerEffectsEnabled?: boolean;
}
