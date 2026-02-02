export type LayerType = "point" | "polyline" | "polygon" | "text" | "feature";

export interface LayerAnimation {
  type: string;
  duration: number;
  start: number;
}

export interface PointKeyframe {
  time: number;
  x: number;
  y: number;
  spatialReference?: any;
}

export interface PointStyle {
  style: string;
  size: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  angle?: number;
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
  color?: string;
  animations: LayerAnimation[];
  pointKeyframes?: PointKeyframe[];
  textContent?: string;
  textSize?: number;
  textColor?: string;
  textFontFamily?: string;
  textItalic?: boolean;
  textUnderline?: boolean;
  pointStyle?: PointStyle;
  lineStyle?: LineStyle;
  polygonStyle?: PolygonStyle;
  featureLayerUrl?: string;
  featureFields?: Array<{ name: string; type: string }>;
  featureField?: string;
  featureFieldType?: string;
  featureFieldStats?: { min: number; max: number };
  featureVisualVariable?: "opacity" | "size" | "color";
  featureHideNulls?: boolean;
  featureLastValue?: number;
  featureKeepVisible?: boolean;
  layerBlendMode?: string;
  layerEffectSettings?: LayerEffectSettings;
  layerEffectsEnabled?: boolean;
}
