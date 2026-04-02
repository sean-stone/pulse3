import type {
  LayerAnimation,
  LayerData,
  LayerType,
  LayerEffectSettings,
  LineStyle,
  ParticleStyle,
  PointKeyframe,
  PointStyle,
  PolygonStyle,
  VolumeStyle
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
    particleStyle?: ParticleStyle;
    volumeStyle?: VolumeStyle;
    textContent?: string;
    textSize?: number;
    textColor?: string;
    textFontFamily?: string;
    textItalic?: boolean;
    textUnderline?: boolean;
    textRenderMode?: "flat" | "scene-3d" | "mesh-3d";
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
      particleStyle: layer.particleStyle ? { ...layer.particleStyle } : undefined,
      volumeStyle: layer.volumeStyle ? { ...layer.volumeStyle } : undefined,
      textContent: layer.textContent,
      textSize: layer.textSize,
      textColor: layer.textColor,
      textFontFamily: layer.textFontFamily,
      textItalic: layer.textItalic,
      textUnderline: layer.textUnderline,
      textRenderMode: layer.textRenderMode,
      textCalloutLine: layer.textCalloutLine,
      textDepth: layer.textDepth,
      textFixedToWorld: layer.textFixedToWorld,
      textWorldHeight: layer.textWorldHeight,
      textWorldRotation: layer.textWorldRotation,
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
