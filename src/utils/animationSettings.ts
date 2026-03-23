import type {
  LayerAnimation,
  LayerData,
  LayerType,
  LayerEffectSettings,
  LineStyle,
  PointKeyframe,
  PointStyle,
  PolygonStyle
} from "../types";

export interface AnimationSettingsSnapshot {
  timeline: {
    durationOverride: number | null;
  };
  layers: Array<{
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
  }>;
}

export function buildAnimationSettingsSnapshot(
  layers: LayerData[],
  timelineDurationOverride: number | null
): AnimationSettingsSnapshot {
  return {
    timeline: { durationOverride: timelineDurationOverride },
    layers: layers.map((layer) => ({
      name: layer.name,
      type: layer.type,
      animations: layer.animations.map((anim) => ({ ...anim })),
      pointKeyframes: layer.pointKeyframes?.map((frame) => ({ ...frame })),
      pointStyle: layer.pointStyle ? { ...layer.pointStyle } : undefined,
      pointFollowTerrain3D: layer.pointFollowTerrain3D,
      lineStyle: layer.lineStyle ? { ...layer.lineStyle } : undefined,
      lineFollowTerrain3D: layer.lineFollowTerrain3D,
      polygonStyle: layer.polygonStyle ? { ...layer.polygonStyle } : undefined,
      polygonZOffset: layer.polygonZOffset,
      textContent: layer.textContent,
      textSize: layer.textSize,
      textColor: layer.textColor,
      featureLayerUrl: layer.featureLayerUrl,
      featureFields: layer.featureFields?.map((field) => ({ ...field })),
      featureField: layer.featureField,
      featureFieldType: layer.featureFieldType,
      featureFieldStats: layer.featureFieldStats ? { ...layer.featureFieldStats } : undefined,
      featureVisualVariable: layer.featureVisualVariable,
      featureHideNulls: layer.featureHideNulls,
      featureKeepVisible: layer.featureKeepVisible,
      layerBlendMode: layer.layerBlendMode,
      layerEffectSettings: layer.layerEffectSettings
        ? { ...layer.layerEffectSettings }
        : undefined,
      layerEffectsEnabled: layer.layerEffectsEnabled
    }))
  };
}
