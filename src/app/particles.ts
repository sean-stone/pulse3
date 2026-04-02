import type { LayerData, LayerType, ParticlePreset, ParticleStyle, VolumeStyle } from "../types";

import { defaultParticleStyle } from "./constants";

const PARTICLE_PRESET_DEFAULTS: Record<ParticlePreset, Partial<ParticleStyle>> = {
  balanced: {},
  bonfire: {
    width: 260,
    depth: 260,
    height: 180,
    emitterRadius: 24,
    fireLifetime: 1.8,
    smokeLifetime: 8.8,
    fireSpeed: 52,
    smokeSpeed: 18,
    variation: 0.76,
    turbulence: 15,
    windX: 2.6,
    windY: 1.1,
    buoyancy: 30
  },
  "jet-flame": {
    width: 120,
    depth: 120,
    height: 240,
    emitterRadius: 9,
    fireLifetime: 1.05,
    smokeLifetime: 5.6,
    fireSpeed: 92,
    smokeSpeed: 24,
    variation: 0.38,
    turbulence: 9,
    windX: 4.4,
    windY: 0.5,
    buoyancy: 38
  },
  "heavy-smoke": {
    width: 320,
    depth: 320,
    height: 220,
    emitterRadius: 20,
    fireLifetime: 1.35,
    smokeLifetime: 11.2,
    fireSpeed: 42,
    smokeSpeed: 15,
    variation: 0.86,
    turbulence: 18,
    windX: 5.4,
    windY: 1.9,
    buoyancy: 21
  },
  "steam-vent": {
    width: 180,
    depth: 180,
    height: 160,
    emitterRadius: 15,
    fireLifetime: 0.4,
    smokeLifetime: 5.1,
    fireSpeed: 18,
    smokeSpeed: 31,
    variation: 0.36,
    turbulence: 10,
    windX: 2.2,
    windY: 0.4,
    buoyancy: 16
  },
  "dust-plume": {
    width: 300,
    depth: 300,
    height: 120,
    emitterRadius: 26,
    fireLifetime: 0.35,
    smokeLifetime: 6.6,
    fireSpeed: 11,
    smokeSpeed: 10,
    variation: 1.02,
    turbulence: 16,
    windX: 6.3,
    windY: 2.2,
    buoyancy: 7
  }
};

const normalizeParticlePreset = (value: unknown): ParticlePreset => {
  switch (value) {
    case "bonfire":
    case "jet-flame":
    case "heavy-smoke":
    case "steam-vent":
    case "dust-plume":
      return value;
    default:
      return "balanced";
  }
};

const mergeParticleStyle = (style?: Partial<ParticleStyle> | null): ParticleStyle => {
  const preset = normalizeParticlePreset(style?.preset);
  const presetDefaults = PARTICLE_PRESET_DEFAULTS[preset];
  return {
    ...defaultParticleStyle,
    ...presetDefaults,
    ...(style ?? {}),
    preset,
    emitterMode: "emitter"
  };
};

const isParticleLayerType = (type: LayerType | string | null | undefined): boolean => {
  return type === "particles" || type === "volume";
};

const isParticleLayer = (layerData: Pick<LayerData, "type"> | null | undefined): boolean => {
  return isParticleLayerType(layerData?.type);
};

const normalizeParticleLayerType = (type: LayerType | string | null | undefined): LayerType => {
  return type === "volume" ? "particles" : ((type ?? "point") as LayerType);
};

const getParticleStyle = (
  source:
    | {
        particleStyle?: ParticleStyle | null;
        volumeStyle?: VolumeStyle | null;
      }
    | null
    | undefined
) => {
  return mergeParticleStyle(source?.particleStyle ?? source?.volumeStyle ?? undefined);
};

const setParticleStyle = <
  T extends {
    particleStyle?: ParticleStyle;
    volumeStyle?: VolumeStyle;
  }
>(
  target: T,
  style?: Partial<ParticleStyle> | ParticleStyle | null
) => {
  const merged = mergeParticleStyle(style ?? undefined);
  target.particleStyle = merged;
  target.volumeStyle = merged;
  return merged;
};

const getParticlePresetDefaults = (preset: ParticlePreset) => {
  return mergeParticleStyle({ preset });
};

export {
  getParticlePresetDefaults,
  getParticleStyle,
  isParticleLayer,
  isParticleLayerType,
  normalizeParticleLayerType,
  normalizeParticlePreset,
  setParticleStyle
};
