import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import * as webgl from "@arcgis/core/views/3d/webgl";
import type ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import {
  AdditiveBlending,
  type Blending,
  BufferGeometry,
  Camera,
  CanvasTexture,
  Float32BufferAttribute,
  LinearFilter,
  NoToneMapping,
  NormalBlending,
  Points,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer
} from "three";

import type { LayerData, VolumeStyle } from "../types";
import { getParticleStyle, isParticleLayer } from "./particles";

type VolumeEffectKind = "smoke" | "fire";
type ParticleSpriteKind = VolumeEffectKind | "ember";
type Rgba = [number, number, number, number];
type VolumeEmitterMode = "box" | "emitter";
type VolumePlumeAnimationState = {
  effect: VolumeEffectKind;
  progress: number;
  time: number;
};
type ResolvedVolumePlumeStyle = VolumeStyle & {
  emitterMode: VolumeEmitterMode;
  emitterRadius: number;
  fireLifetime: number;
  smokeLifetime: number;
  fireSpeed: number;
  smokeSpeed: number;
  variation: number;
  turbulence: number;
  windX: number;
  windY: number;
  buoyancy: number;
};
type VolumePlumeAnchor = {
  originRender: [number, number, number];
  transform: Float64Array;
  seed: number;
};
type VolumePlumeEntry = {
  layerData: LayerData;
  style: ResolvedVolumePlumeStyle;
  effect: VolumeEffectKind;
  progress: number;
  time: number;
  opacity: number;
  anchors: VolumePlumeAnchor[];
};
type VolumePlumeManager = {
  view: any;
  node: VolumePlumeRenderNode;
  entries: Map<LayerData, VolumePlumeEntry>;
};
type VolumePlumeObjectSet = {
  fireGeometry: BufferGeometry;
  firePoints: Points;
  emberGeometry: BufferGeometry;
  emberPoints: Points;
  smokeGeometry: BufferGeometry;
  smokePoints: Points;
};

const VIEW_MANAGER_KEY = "__pulseVolumePlumeManager";
const LAYER_MANAGER_KEY = "__pulseVolumePlumeManager";
const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toFinite = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const fract = (value: number) => value - Math.floor(value);
const signedUnit = (seed: number) => seededUnit(seed) * 2 - 1;
const seededUnit = (seed: number) => {
  const x = Math.sin(seed) * 43758.5453123;
  return x - Math.floor(x);
};

const PARTICLE_VERTEX_SHADER = `
  precision highp float;

  uniform float uPointScale;

  attribute float aSize;
  attribute vec4 aColor;
  attribute float aSoftness;

  varying vec4 vColor;
  varying float vSoftness;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float depth = max(1.0, -viewPosition.z);
    gl_PointSize = clamp(aSize * uPointScale / depth, 1.5, 220.0);
    vColor = aColor;
    vSoftness = aSoftness;
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D uSpriteTexture;
  uniform float uAlphaBoost;
  uniform float uColorBoost;
  uniform float uHasTexture;

  varying vec4 vColor;
  varying float vSoftness;

  void main() {
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    float radial = clamp(1.0 - dot(centered, centered), 0.0, 1.0);
    float analyticAlpha = pow(radial, mix(2.8, 0.8, clamp(vSoftness, 0.0, 1.0)));

    vec4 spriteSample = vec4(1.0);
    if (uHasTexture > 0.5) {
      spriteSample = texture2D(uSpriteTexture, gl_PointCoord);
    }

    float spriteAlpha = uHasTexture > 0.5 ? spriteSample.a : 1.0;
    float alpha = analyticAlpha * spriteAlpha * vColor.a * uAlphaBoost;
    if (alpha < 0.01) {
      discard;
    }

    float lightMix = uHasTexture > 0.5 ? spriteSample.r : radial;
    vec3 color = vColor.rgb * mix(0.92, 1.0 + uColorBoost, clamp(lightMix, 0.0, 1.0));

    gl_FragColor = vec4(color, alpha);
  }
`;

const readVolumeStyle = (layerData: LayerData): ResolvedVolumePlumeStyle => {
  const style = getParticleStyle(layerData);
  const width = clamp(toFinite(style?.width, 220), 10, 100000);
  const depth = clamp(toFinite(style?.depth, 220), 10, 100000);
  const height = clamp(toFinite(style?.height, 140), 10, 100000);
  const emitterSpan = Math.max(6, Math.min(width, depth));
  return {
    width,
    depth,
    height,
    floorOffset: 0,
    opacity: clamp(toFinite(style?.opacity, 0.32), 0.05, 0.95),
    slices: Math.round(clamp(toFinite(style?.slices, 22), 4, 64)),
    color: String(style?.color || "#c9dcff"),
    edgeColor: String(style?.edgeColor || "#f4fbff"),
    emitterMode: "emitter",
    emitterRadius: clamp(toFinite(style?.emitterRadius, emitterSpan * 0.085), 2, Math.max(emitterSpan * 0.45, 4)),
    fireLifetime: clamp(toFinite(style?.fireLifetime, 0.9 + height / 240), 0.25, 6),
    smokeLifetime: clamp(toFinite(style?.smokeLifetime, 3.8 + height / 36), 0.8, 24),
    fireSpeed: clamp(toFinite(style?.fireSpeed, height * 0.42), 1, 100000),
    smokeSpeed: clamp(toFinite(style?.smokeSpeed, height * 0.14), 0.5, 100000),
    variation: clamp(toFinite(style?.variation, 0.65), 0, 1.5),
    turbulence: clamp(toFinite(style?.turbulence, emitterSpan * 0.055), 0, 100000),
    windX: toFinite(style?.windX, emitterSpan * 0.015),
    windY: toFinite(style?.windY, emitterSpan * 0.005),
    buoyancy: clamp(toFinite(style?.buoyancy, height * 0.2), 0, 100000)
  };
};

const parseColorToRgba = (color: string, fallback: Rgba): Rgba => {
  const trimmed = String(color || "").trim();
  if (!trimmed) return fallback;
  const rgbaMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(",").map((part) => Number(part.trim()));
    if (parts.length >= 3) {
      return [
        clamp(Number(parts[0]) || 0, 0, 255),
        clamp(Number(parts[1]) || 0, 0, 255),
        clamp(Number(parts[2]) || 0, 0, 255),
        parts.length >= 4 ? clamp(Number(parts[3]) || 0, 0, 1) : 1
      ];
    }
  }
  const hex = trimmed.replace("#", "");
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, clamp(a, 0, 1)];
  }
  return fallback;
};

const mixRgba = (from: Rgba, to: Rgba, t: number): Rgba => {
  const weight = clamp(t, 0, 1);
  return [
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
    from[3] + (to[3] - from[3]) * weight
  ];
};

const normalizeRgba = (color: Rgba, alphaScale = 1): Rgba => [
  color[0] / 255,
  color[1] / 255,
  color[2] / 255,
  clamp(color[3] * alphaScale, 0, 1)
];

const getVolumeAnimationState = (layerData: LayerData): VolumePlumeAnimationState | null => {
  const state = (layerData as any).__volumeAnimationState as Partial<VolumePlumeAnimationState> | undefined;
  const effect = state?.effect;
  if (effect !== "smoke" && effect !== "fire") {
    return null;
  }
  return {
    effect,
    progress: clamp(toFinite(state?.progress, 0.5), 0, 1),
    time: toFinite(state?.time, 0)
  };
};

const getAnimationActivity = (progress: number, min: number) =>
  clamp(min + (1 - min) * Math.sin(Math.PI * clamp(progress, 0, 1)), min, 1);

const getAnchorSeed = (anchorGraphic: any) => {
  const existing = Number(anchorGraphic?.attributes?.__pulseVolumeSeed);
  if (Number.isFinite(existing) && existing !== 0) return existing;
  const geometry = anchorGraphic?.geometry;
  const x = Number(geometry?.x || 0);
  const y = Number(geometry?.y || 0);
  const nextSeed = Math.round((x * 73856093 + y * 19349663) % 2147483647) || 1;
  anchorGraphic.attributes = {
    ...(anchorGraphic.attributes ?? {}),
    __pulseVolumeSeed: nextSeed
  };
  return nextSeed;
};

const transformLocalOffset = (transform: ArrayLike<number>, x: number, y: number, z: number) => [
  Number(transform[0]) * x + Number(transform[4]) * y + Number(transform[8]) * z,
  Number(transform[1]) * x + Number(transform[5]) * y + Number(transform[9]) * z,
  Number(transform[2]) * x + Number(transform[6]) * y + Number(transform[10]) * z
] as [number, number, number];

const pushParticle = (
  target: number[],
  position: [number, number, number],
  size: number,
  color: Rgba,
  softness: number
) => {
  target.push(
    position[0],
    position[1],
    position[2],
    size,
    color[0],
    color[1],
    color[2],
    color[3],
    softness
  );
};

const appendSmokeParticles = (
  target: number[],
  entry: VolumePlumeEntry,
  anchor: VolumePlumeAnchor,
  count: number,
  opacityScale: number,
  heightOffset: number,
  heightScale: number
) => {
  const { style, progress, time, opacity } = entry;
  const isFireSmoke = entry.effect === "fire";
  const activity = getAnimationActivity(progress, isFireSmoke ? 0.42 : 0.34);
  const span = Math.max(style.width, style.depth);
  const emitterRadius = style.emitterRadius * (isFireSmoke ? 0.9 : 1.05);
  const smokeLifetime = style.smokeLifetime * (isFireSmoke ? 0.82 : 1);
  const baseDark = isFireSmoke
    ? parseColorToRgba("#25272c", [37, 39, 44, 1])
    : parseColorToRgba("#4c535b", [76, 83, 91, 1]);
  const baseMid = isFireSmoke
    ? ([74, 74, 78, 1] as Rgba)
    : mixRgba(parseColorToRgba(style.color, [201, 220, 255, 1]), [132, 140, 150, 1], 0.68);
  const baseLight = isFireSmoke
    ? ([118, 112, 104, 1] as Rgba)
    : mixRgba(parseColorToRgba(style.edgeColor, [244, 251, 255, 1]), [192, 198, 205, 1], 0.36);

  for (let index = 0; index < count; index += 1) {
    const seed = anchor.seed + index * 11.17;
    const particleLifetime = smokeLifetime * (0.74 + seededUnit(seed + 2.31) * 0.68);
    const age = fract(seededUnit(seed + 1.17) + time / Math.max(particleLifetime, 0.01));
    const lifeSeconds = age * particleLifetime;
    const plumeAge = Math.pow(age, isFireSmoke ? 0.74 : 0.88);
    const swirl =
      seededUnit(seed + 5.91) * TAU +
      lifeSeconds * (0.52 + seededUnit(seed + 4.27) * 0.28) +
      plumeAge * (isFireSmoke ? 6.8 : 5.4);
    const expansion =
      emitterRadius * (0.45 + seededUnit(seed + 6.73) * 0.55) +
      span * (isFireSmoke ? 0.018 + plumeAge * 0.08 : 0.05 + plumeAge * 0.17);
    const curlAmplitude =
      style.turbulence *
      (0.22 + plumeAge * (isFireSmoke ? 0.72 : 1.08)) *
      (0.38 + seededUnit(seed + 7.77) * 0.58);
    const plumeRise =
      heightScale *
      (style.smokeSpeed * lifeSeconds + style.buoyancy * lifeSeconds * lifeSeconds * (isFireSmoke ? 0.42 : 0.32));
    const heightProgress = clamp(plumeRise / Math.max(style.height * (isFireSmoke ? 1.35 : 1.8), 1), 0, 1);
    const windShear = Math.pow(heightProgress, isFireSmoke ? 1.35 : 1.7);
    const windGust = 0.88 + 0.16 * Math.sin(seed + time * 0.41 + heightProgress * 6.2);
    const windDrift =
      lifeSeconds * (isFireSmoke ? 0.68 : 0.52) +
      plumeRise * (isFireSmoke ? 0.006 : 0.012);
    const windOffsetX = style.windX * windDrift * (0.18 + windShear * (isFireSmoke ? 1.35 : 2.1)) * windGust;
    const windOffsetY = style.windY * windDrift * (0.18 + windShear * (isFireSmoke ? 1.35 : 2.1)) * windGust;
    const x =
      Math.cos(swirl) * expansion * (0.14 + seededUnit(seed + 8.91) * 0.22) +
      Math.sin(swirl * 0.47 + time * 0.74 + seed) * curlAmplitude * 0.16 +
      windOffsetX;
    const y =
      Math.sin(swirl * 0.91) * expansion * (0.12 + seededUnit(seed + 9.13) * 0.2) +
      Math.cos(swirl * 0.31 + time * 0.58 + seed) * curlAmplitude * 0.13 +
      windOffsetY;
    const z = style.floorOffset + heightOffset + plumeRise;
    const position = transformLocalOffset(anchor.transform, x, y, z);
    const fade = Math.sin(Math.PI * clamp(age, 0.03, 0.97));
    const alpha = isFireSmoke
      ? clamp(opacity * opacityScale * activity * (0.03 + fade * 0.12), 0.008, 0.12)
      : clamp(opacity * opacityScale * activity * (0.08 + fade * 0.2), 0.012, 0.2);
    const color = normalizeRgba(
      mixRgba(
        baseDark,
        mixRgba(baseMid, baseLight, isFireSmoke ? Math.pow(age, 0.78) : age),
        isFireSmoke ? 0.08 + age * 0.38 : 0.18 + age * 0.54
      ),
      alpha
    );
    const size =
      emitterRadius * (isFireSmoke ? 1.35 : 1.7) +
      expansion * (isFireSmoke ? 0.34 : 0.5) +
      style.turbulence * 0.18 * seededUnit(seed + 9.41);
    pushParticle(target, position, size, color, isFireSmoke ? 0.84 : 0.92);
  }
};

const appendFireParticles = (target: number[], entry: VolumePlumeEntry, anchor: VolumePlumeAnchor, count: number) => {
  const { style, progress, time, opacity } = entry;
  const activity = getAnimationActivity(progress, 0.55);
  const flameHeight = style.height * (0.62 + 0.2 * activity);
  const warmCore = normalizeRgba([255, 236, 182, 1]);
  const yellow = normalizeRgba([255, 192, 86, 1]);
  const orange = normalizeRgba([255, 114, 40, 1]);
  const ember = normalizeRgba([160, 40, 14, 1]);

  for (let index = 0; index < count; index += 1) {
    const seed = anchor.seed + index * 7.19;
    const particleLifetime = style.fireLifetime * (0.72 + seededUnit(seed + 2.73) * 0.7);
    const age = Math.pow(fract(seededUnit(seed + 0.91) + time / Math.max(particleLifetime, 0.01)), 1.08);
    const lifeSeconds = age * particleLifetime;
    const remaining = 1 - age;
    const ignition = clamp(age / 0.12, 0, 1);
    const angle = seededUnit(seed + 4.67) * TAU + lifeSeconds * (4.8 + seededUnit(seed + 3.17) * 3.6);
    const baseRadius = style.emitterRadius * (0.08 + seededUnit(seed + 5.21) * 0.72);
    const columnRadius = baseRadius * (0.14 + remaining * (0.68 + style.variation * 0.16));
    const curlAmplitude =
      style.turbulence * 0.24 * (0.18 + remaining * 0.68) * (0.45 + seededUnit(seed + 6.33) * 0.55);
    const windOffsetX = style.windX * lifeSeconds * lifeSeconds * 0.05 + style.windX * lifeSeconds * 0.03;
    const windOffsetY = style.windY * lifeSeconds * lifeSeconds * 0.05 + style.windY * lifeSeconds * 0.03;
    const x =
      Math.cos(angle) * columnRadius +
      Math.sin(angle * 0.43 + lifeSeconds * 4.2 + seed) * curlAmplitude * 0.16 +
      windOffsetX;
    const y =
      Math.sin(angle * 0.87) * columnRadius * 0.66 +
      Math.cos(angle * 0.29 + lifeSeconds * 3.4 + seed) * curlAmplitude * 0.12 +
      windOffsetY;
    const riseSpeed = style.fireSpeed * (0.78 + seededUnit(seed + 7.93) * 0.44);
    const z = style.floorOffset + Math.min(flameHeight, riseSpeed * lifeSeconds + style.buoyancy * lifeSeconds * lifeSeconds * 0.1);
    const position = transformLocalOffset(anchor.transform, x, y, z);
    const alpha = clamp(opacity * activity * ignition * (0.04 + remaining * 0.16), 0.01, 0.18);
    let color = yellow;
    if (age < 0.16) {
      color = [warmCore[0], warmCore[1], warmCore[2], alpha];
    } else if (age < 0.52) {
      const t = (age - 0.16) / 0.36;
      color = [
        yellow[0] + (orange[0] - yellow[0]) * t,
        yellow[1] + (orange[1] - yellow[1]) * t,
        yellow[2] + (orange[2] - yellow[2]) * t,
        alpha
      ];
    } else {
      const t = (age - 0.52) / 0.48;
      color = [
        orange[0] + (ember[0] - orange[0]) * t,
        orange[1] + (ember[1] - orange[1]) * t,
        orange[2] + (ember[2] - orange[2]) * t,
        alpha * (1 - t * 0.34)
      ];
    }
    const size = style.emitterRadius * (0.44 + remaining * 1.22 + seededUnit(seed + 8.11) * 0.18);
    pushParticle(target, position, size, color as Rgba, 0.24);
  }
};

const appendEmberParticles = (target: number[], entry: VolumePlumeEntry, anchor: VolumePlumeAnchor, count: number) => {
  const { style, progress, time, opacity } = entry;
  const activity = getAnimationActivity(progress, 0.46);
  const hot = normalizeRgba([255, 204, 102, 1]);
  const ember = normalizeRgba([255, 128, 44, 1]);
  const ash = normalizeRgba([112, 40, 18, 1]);

  for (let index = 0; index < count; index += 1) {
    const seed = anchor.seed + index * 13.71;
    const particleLifetime = Math.max(0.24, style.fireLifetime * (0.48 + seededUnit(seed + 2.7) * 0.42));
    const age = fract(seededUnit(seed + 0.7) + time / particleLifetime);
    const remaining = 1 - age;
    const lifeSeconds = age * particleLifetime;
    const launchAngle = seededUnit(seed + 4.9) * TAU;
    const launchRadius = style.emitterRadius * (0.08 + seededUnit(seed + 3.3) * 0.32);
    const baseX = Math.cos(launchAngle) * launchRadius;
    const baseY = Math.sin(launchAngle) * launchRadius * 0.75;
    const driftX = style.windX * lifeSeconds * 0.12 + Math.sin(seed + time * 1.8) * style.turbulence * 0.04;
    const driftY = style.windY * lifeSeconds * 0.12 + Math.cos(seed + time * 1.6) * style.turbulence * 0.04;
    const rise =
      style.floorOffset +
      style.fireSpeed * lifeSeconds * (0.82 + seededUnit(seed + 7.1) * 0.5) +
      style.buoyancy * lifeSeconds * lifeSeconds * 0.16;
    const position = transformLocalOffset(anchor.transform, baseX + driftX, baseY + driftY, rise);
    const alpha = clamp(opacity * activity * (0.06 + remaining * 0.24), 0.015, 0.28);
    const tint =
      age < 0.2
        ? hot
        : age < 0.56
          ? [
              hot[0] + (ember[0] - hot[0]) * ((age - 0.2) / 0.36),
              hot[1] + (ember[1] - hot[1]) * ((age - 0.2) / 0.36),
              hot[2] + (ember[2] - hot[2]) * ((age - 0.2) / 0.36),
              alpha
            ]
          : [
              ember[0] + (ash[0] - ember[0]) * ((age - 0.56) / 0.44),
              ember[1] + (ash[1] - ember[1]) * ((age - 0.56) / 0.44),
              ember[2] + (ash[2] - ember[2]) * ((age - 0.56) / 0.44),
              alpha * (1 - (age - 0.56) / 0.44 * 0.5)
            ];
    const size = Math.max(1.6, style.emitterRadius * (0.06 + remaining * 0.18));
    pushParticle(target, position, size, tint as Rgba, 0.12);
  }
};

const drawSoftBlob = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  stretchX = 1,
  stretchY = 1
) => {
  context.save();
  context.translate(x, y);
  context.scale(stretchX, stretchY);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, `rgba(255,255,255,${clamp(alpha, 0, 1)})`);
  gradient.addColorStop(0.45, `rgba(255,255,255,${clamp(alpha * 0.64, 0, 1)})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
  context.restore();
};

const buildSpriteCanvas = (kind: ParticleSpriteKind) => {
  if (typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, size, size);
  context.globalCompositeOperation = "lighter";

  if (kind === "smoke") {
    for (let index = 0; index < 14; index += 1) {
      drawSoftBlob(
        context,
        size * (0.28 + seededUnit(index * 2.11 + 1) * 0.44),
        size * (0.3 + seededUnit(index * 3.07 + 2) * 0.42),
        size * (0.15 + seededUnit(index * 4.03 + 3) * 0.12),
        0.18 + seededUnit(index * 5.01 + 4) * 0.18,
        0.76 + seededUnit(index * 6.21 + 5) * 0.48,
        0.8 + seededUnit(index * 7.39 + 6) * 0.56
      );
    }
    context.globalCompositeOperation = "destination-out";
    for (let index = 0; index < 6; index += 1) {
      drawSoftBlob(
        context,
        size * (0.34 + seededUnit(index * 1.91 + 7) * 0.32),
        size * (0.34 + seededUnit(index * 2.71 + 8) * 0.32),
        size * (0.08 + seededUnit(index * 3.17 + 9) * 0.08),
        0.2 + seededUnit(index * 4.01 + 10) * 0.12,
        0.9,
        0.9
      );
    }
    context.globalCompositeOperation = "lighter";
  } else if (kind === "fire") {
    for (let index = 0; index < 7; index += 1) {
      const t = index / 6;
      drawSoftBlob(
        context,
        size * (0.5 + Math.sin(index * 1.24) * 0.02),
        size * (0.8 - t * 0.48),
        size * (0.14 - t * 0.05),
        0.18 + (1 - t) * 0.16,
        0.5 + (1 - t) * 0.12,
        1.02 + (1 - t) * 0.56
      );
    }

    drawSoftBlob(context, size * 0.43, size * 0.8, size * 0.09, 0.2, 0.62, 1.12);
    drawSoftBlob(context, size * 0.57, size * 0.78, size * 0.085, 0.18, 0.6, 1.06);

    const outerGlow = context.createRadialGradient(size * 0.5, size * 0.6, 0, size * 0.5, size * 0.6, size * 0.24);
    outerGlow.addColorStop(0, "rgba(255,224,164,0.52)");
    outerGlow.addColorStop(0.4, "rgba(255,152,62,0.28)");
    outerGlow.addColorStop(0.78, "rgba(138,26,10,0.08)");
    outerGlow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = outerGlow;
    context.fillRect(0, 0, size, size);
  } else {
    const streak = context.createLinearGradient(size * 0.2, size * 0.9, size * 0.8, size * 0.1);
    streak.addColorStop(0, "rgba(255,120,40,0)");
    streak.addColorStop(0.45, "rgba(255,174,72,0.88)");
    streak.addColorStop(1, "rgba(255,244,196,0)");
    context.fillStyle = streak;
    context.beginPath();
    context.ellipse(size * 0.5, size * 0.5, size * 0.14, size * 0.38, -0.32, 0, TAU);
    context.fill();

    drawSoftBlob(context, size * 0.48, size * 0.55, size * 0.11, 0.9, 0.4, 1.8);
    drawSoftBlob(context, size * 0.56, size * 0.43, size * 0.08, 0.72, 0.32, 1.22);
  }

  context.globalCompositeOperation = "destination-in";
  drawSoftBlob(
    context,
    size * 0.5,
    size * (kind === "fire" ? 0.56 : kind === "ember" ? 0.5 : 0.5),
    size * (kind === "fire" ? 0.34 : kind === "ember" ? 0.22 : 0.44),
    1,
    kind === "fire" ? 0.62 : kind === "ember" ? 0.36 : 1,
    kind === "fire" ? 1.54 : kind === "ember" ? 1.9 : 1.04
  );

  return canvas;
};

const createSpriteTexture = (kind: ParticleSpriteKind) => {
  const canvas = buildSpriteCanvas(kind);
  if (!canvas) {
    return null;
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

class VolumePlumeRenderNode extends RenderNode {
  private manager: VolumePlumeManager;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private threeCamera: Camera | null = null;
  private outputTarget: WebGLRenderTarget | null = null;
  private smokeMaterial: ShaderMaterial | null = null;
  private fireMaterial: ShaderMaterial | null = null;
  private emberMaterial: ShaderMaterial | null = null;
  private smokeTexture: CanvasTexture | null = null;
  private fireTexture: CanvasTexture | null = null;
  private emberTexture: CanvasTexture | null = null;
  private objectSets: VolumePlumeObjectSet[] = [];
  private smokeData: number[] = [];
  private fireData: number[] = [];
  private renderViewport = new Vector4();
  public hasRenderedFrame = false;
  private didLogRenderSuccess = false;
  private didLogRenderFailure = false;
  private isAttached = false;

  constructor(props: { view: any; manager: VolumePlumeManager }) {
    super();
    (this as any).view = props.view;
    (this as any).consumes = { required: ["composite-color"] };
    (this as any).produces = "composite-color";
    this.manager = props.manager;
  }

  override destroy(): void {
    this.objectSets.forEach((objectSet) => {
      objectSet.fireGeometry.dispose();
      objectSet.emberGeometry.dispose();
      objectSet.smokeGeometry.dispose();
    });
    this.objectSets.length = 0;

    this.smokeMaterial?.dispose();
    this.fireMaterial?.dispose();
    this.emberMaterial?.dispose();
    this.outputTarget?.dispose();
    this.smokeTexture?.dispose();
    this.fireTexture?.dispose();
    this.emberTexture?.dispose();
    this.renderer?.dispose();

    this.smokeMaterial = null;
    this.fireMaterial = null;
    this.emberMaterial = null;
    this.outputTarget = null;
    this.renderer = null;
    this.scene = null;
    this.threeCamera = null;
    this.smokeTexture = null;
    this.fireTexture = null;
    this.emberTexture = null;
    this.hasRenderedFrame = false;

    this.detachFromRenderer();
  }

  public attachToRenderer() {
    if (this.isAttached) {
      return true;
    }

    const view = (this.view ?? this.manager.view) as any;
    const renderer = view?.stage?.renderer as { addRenderNode?: (node: VolumePlumeRenderNode) => void } | undefined;
    if (!renderer?.addRenderNode) {
      return false;
    }

    renderer.addRenderNode(this);
    this.isAttached = true;
    return true;
  }

  public detachFromRenderer() {
    if (!this.isAttached) {
      return;
    }

    const view = (this.view ?? this.manager.view) as any;
    view?.stage?.renderer?.removeRenderNode?.(this);
    this.isAttached = false;
  }

  private createMaterial(
    texture: CanvasTexture | null,
    options: { blending: Blending; alphaBoost: number; colorBoost: number }
  ) {
    return new ShaderMaterial({
      uniforms: {
        uPointScale: { value: 1 },
        uSpriteTexture: { value: texture },
        uHasTexture: { value: texture ? 1 : 0 },
        uAlphaBoost: { value: options.alphaBoost },
        uColorBoost: { value: options.colorBoost }
      },
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: options.blending,
      toneMapped: false
    });
  }

  private ensureRenderer() {
    if (
      this.renderer &&
      this.scene &&
      this.threeCamera &&
      this.outputTarget &&
      this.smokeMaterial &&
      this.fireMaterial &&
      this.emberMaterial
    ) {
      return;
    }

    const gl = this.gl;
    this.renderer = new WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      alpha: true,
      antialias: false,
      depth: true,
      stencil: true,
      premultipliedAlpha: false
    });
    this.renderer.autoClear = false;
    this.renderer.autoClearColor = false;
    this.renderer.autoClearDepth = false;
    this.renderer.autoClearStencil = false;
    this.renderer.sortObjects = false;
    this.renderer.toneMapping = NoToneMapping;

    this.scene = new Scene();
    (this.scene as any).autoUpdate = false;

    this.threeCamera = new Camera();
    this.threeCamera.matrixAutoUpdate = false;
    this.threeCamera.matrixWorldAutoUpdate = false;
    this.threeCamera.matrixWorld.identity();
    this.threeCamera.matrixWorldInverse.identity();
    this.threeCamera.updateMatrixWorld(true);

    this.outputTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: true
    });

    this.smokeTexture = createSpriteTexture("smoke");
    this.fireTexture = createSpriteTexture("fire");
    this.emberTexture = createSpriteTexture("ember");
    this.smokeMaterial = this.createMaterial(this.smokeTexture, {
      blending: NormalBlending,
      alphaBoost: 0.88,
      colorBoost: 0.04
    });
    this.fireMaterial = this.createMaterial(this.fireTexture, {
      blending: NormalBlending,
      alphaBoost: 0.8,
      colorBoost: 0.18
    });
    this.emberMaterial = this.createMaterial(this.emberTexture, {
      blending: AdditiveBlending,
      alphaBoost: 1.1,
      colorBoost: 0.62
    });
  }

  private createObjectSet(): VolumePlumeObjectSet {
    if (!this.scene || !this.smokeMaterial || !this.fireMaterial || !this.emberMaterial) {
      throw new Error("Volume plume Three.js scene is not initialized.");
    }

    const fireGeometry = new BufferGeometry();
    const emberGeometry = new BufferGeometry();
    const smokeGeometry = new BufferGeometry();
    const firePoints = new Points(fireGeometry, this.fireMaterial);
    const emberPoints = new Points(emberGeometry, this.emberMaterial);
    const smokePoints = new Points(smokeGeometry, this.smokeMaterial);

    [firePoints, emberPoints, smokePoints].forEach((points) => {
      points.matrixAutoUpdate = false;
      points.matrixWorldAutoUpdate = false;
      points.matrix.identity();
      points.matrixWorld.identity();
      points.frustumCulled = false;
      points.visible = false;
    });

    this.scene.add(firePoints);
    this.scene.add(emberPoints);
    this.scene.add(smokePoints);

    return {
      fireGeometry,
      firePoints,
      emberGeometry,
      emberPoints,
      smokeGeometry,
      smokePoints
    };
  }

  private ensureObjectCount(count: number) {
    while (this.objectSets.length < count) {
      this.objectSets.push(this.createObjectSet());
    }
  }

  private ensureGeometryCapacity(geometry: BufferGeometry, count: number) {
    const currentCapacity = Number(geometry.userData.capacity) || 0;
    if (currentCapacity >= count) {
      return;
    }

    const nextCapacity = Math.max(16, count, Math.ceil(currentCapacity * 1.5));
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(nextCapacity * 3), 3));
    geometry.setAttribute("aSize", new Float32BufferAttribute(new Float32Array(nextCapacity), 1));
    geometry.setAttribute("aColor", new Float32BufferAttribute(new Float32Array(nextCapacity * 4), 4));
    geometry.setAttribute("aSoftness", new Float32BufferAttribute(new Float32Array(nextCapacity), 1));
    geometry.userData.capacity = nextCapacity;
  }

  private updateGeometry(geometry: BufferGeometry, data: number[]) {
    const count = Math.floor(data.length / 9);
    if (!count) {
      geometry.setDrawRange(0, 0);
      return false;
    }

    this.ensureGeometryCapacity(geometry, count);
    const position = geometry.getAttribute("position") as Float32BufferAttribute;
    const size = geometry.getAttribute("aSize") as Float32BufferAttribute;
    const color = geometry.getAttribute("aColor") as Float32BufferAttribute;
    const softness = geometry.getAttribute("aSoftness") as Float32BufferAttribute;

    const positionArray = position.array as Float32Array;
    const sizeArray = size.array as Float32Array;
    const colorArray = color.array as Float32Array;
    const softnessArray = softness.array as Float32Array;

    let src = 0;
    for (let index = 0; index < count; index += 1, src += 9) {
      const positionOffset = index * 3;
      const colorOffset = index * 4;
      positionArray[positionOffset] = data[src];
      positionArray[positionOffset + 1] = data[src + 1];
      positionArray[positionOffset + 2] = data[src + 2];
      sizeArray[index] = data[src + 3];
      colorArray[colorOffset] = data[src + 4];
      colorArray[colorOffset + 1] = data[src + 5];
      colorArray[colorOffset + 2] = data[src + 6];
      colorArray[colorOffset + 3] = data[src + 7];
      softnessArray[index] = data[src + 8];
    }

    position.needsUpdate = true;
    size.needsUpdate = true;
    color.needsUpdate = true;
    softness.needsUpdate = true;
    geometry.setDrawRange(0, count);
    return true;
  }

  private hideUnusedObjects(startIndex: number) {
    for (let index = startIndex; index < this.objectSets.length; index += 1) {
      const objectSet = this.objectSets[index];
      objectSet.firePoints.visible = false;
      objectSet.fireGeometry.setDrawRange(0, 0);
      objectSet.emberPoints.visible = false;
      objectSet.emberGeometry.setDrawRange(0, 0);
      objectSet.smokePoints.visible = false;
      objectSet.smokeGeometry.setDrawRange(0, 0);
    }
  }

  protected override render(_inputs: ManagedFBO[]): ManagedFBO | null | undefined {
    const output = this.bindRenderTarget();
    if (!this.manager.entries.size) {
      this.hideUnusedObjects(0);
      return output;
    }

    this.ensureRenderer();
    if (
      !this.renderer ||
      !this.scene ||
      !this.threeCamera ||
      !this.outputTarget ||
      !this.smokeMaterial ||
      !this.fireMaterial ||
      !this.emberMaterial
    ) {
      return output;
    }

    const viewport = this.camera.viewport;
    const viewportX = Number(viewport[0]) || 0;
    const viewportY = Number(viewport[1]) || 0;
    const viewportWidth = Math.max(Number(viewport[2]) || 1, 1);
    const viewportHeight = Math.max(Number(viewport[3]) || 1, 1);
    const framebufferWidth = Math.max(Number((output as any)?.fbo?.width) || viewportWidth, viewportWidth);
    const framebufferHeight = Math.max(Number((output as any)?.fbo?.height) || viewportHeight, viewportHeight);
    const pointScale = viewportHeight / Math.max(2 * Math.tan(this.camera.fovY * 0.5), 1e-4);

    this.outputTarget.setSize(framebufferWidth, framebufferHeight);
    this.renderViewport.set(viewportX, viewportY, viewportWidth, viewportHeight);
    this.outputTarget.viewport.copy(this.renderViewport);
    this.outputTarget.scissor.copy(this.renderViewport);
    this.outputTarget.scissorTest = false;

    this.threeCamera.projectionMatrix.fromArray(this.camera.projectionMatrix as ArrayLike<number>);
    this.threeCamera.projectionMatrixInverse.copy(this.threeCamera.projectionMatrix).invert();
    this.threeCamera.matrixWorldInverse.fromArray(this.camera.viewMatrix as ArrayLike<number>);
    this.threeCamera.matrixWorld.copy(this.threeCamera.matrixWorldInverse).invert();
    this.threeCamera.matrixWorldNeedsUpdate = false;

    this.smokeMaterial.uniforms.uPointScale.value = pointScale;
    this.fireMaterial.uniforms.uPointScale.value = pointScale;
    this.emberMaterial.uniforms.uPointScale.value = pointScale;

    let objectIndex = 0;
    for (const entry of this.manager.entries.values()) {
      if (!entry.anchors.length || entry.opacity <= 0.001) {
        continue;
      }

      const smokeCount =
        entry.effect === "smoke"
          ? Math.round(clamp(entry.style.slices * 6.8, 88, 360))
          : Math.round(clamp(entry.style.slices * 4.4, 52, 220));
      const fireCount =
        entry.effect === "fire"
          ? Math.round(clamp(entry.style.slices * 4.8, 84, 280))
          : 0;
      const emberCount =
        entry.effect === "fire"
          ? Math.round(clamp(entry.style.slices * 1.9, 18, 86))
          : 0;

      this.ensureObjectCount(objectIndex + entry.anchors.length);

      for (const anchor of entry.anchors) {
        const objectSet = this.objectSets[objectIndex];
        objectSet.firePoints.renderOrder = objectIndex * 2;
        objectSet.emberPoints.renderOrder = objectIndex * 2 + 1;
        objectSet.smokePoints.renderOrder = objectIndex * 2 + 2;
        objectSet.firePoints.matrix.identity();
        objectSet.firePoints.matrix.setPosition(
          anchor.originRender[0],
          anchor.originRender[1],
          anchor.originRender[2]
        );
        objectSet.firePoints.matrixWorld.copy(objectSet.firePoints.matrix);
        objectSet.emberPoints.matrix.identity();
        objectSet.emberPoints.matrix.setPosition(
          anchor.originRender[0],
          anchor.originRender[1],
          anchor.originRender[2]
        );
        objectSet.emberPoints.matrixWorld.copy(objectSet.emberPoints.matrix);
        objectSet.smokePoints.matrix.identity();
        objectSet.smokePoints.matrix.setPosition(
          anchor.originRender[0],
          anchor.originRender[1],
          anchor.originRender[2]
        );
        objectSet.smokePoints.matrixWorld.copy(objectSet.smokePoints.matrix);

        this.fireData.length = 0;
        this.smokeData.length = 0;
        const emberData: number[] = [];

        if (entry.effect === "smoke") {
          appendSmokeParticles(this.smokeData, entry, anchor, smokeCount, 1, 0, 1);
        } else {
          appendFireParticles(this.fireData, entry, anchor, fireCount);
          appendEmberParticles(emberData, entry, anchor, emberCount);
          appendSmokeParticles(this.smokeData, entry, anchor, smokeCount, 0.78, entry.style.height * 0.14, 0.96);
        }

        objectSet.firePoints.visible = this.updateGeometry(objectSet.fireGeometry, this.fireData);
        objectSet.emberPoints.visible = this.updateGeometry(objectSet.emberGeometry, emberData);
        objectSet.smokePoints.visible = this.updateGeometry(objectSet.smokeGeometry, this.smokeData);
        objectIndex += 1;
      }
    }

    this.hideUnusedObjects(objectIndex);
    if (objectIndex === 0) {
      return output;
    }

    try {
      this.renderer.resetState();
      (this.renderer as any).setRenderTargetFramebuffer(this.outputTarget, (output as any)?.fbo?.glName ?? null);
      this.renderer.setRenderTarget(this.outputTarget);
      this.renderer.render(this.scene, this.threeCamera);
      this.hasRenderedFrame = true;
      if (!this.didLogRenderSuccess) {
        this.didLogRenderSuccess = true;
        console.info("Volume plume Three render succeeded", {
          drawCalls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          points: this.renderer.info.render.points,
          entries: this.manager.entries.size
        });
      }
      this.renderer.resetState();
    } catch (error) {
      if (!this.didLogRenderFailure) {
        this.didLogRenderFailure = true;
        console.error("Volume plume Three render failed", error);
      }
      this.renderer.resetState();
    }
    this.resetWebGLState();
    return output;
  }
}

const getManager = (view: any): VolumePlumeManager | null => {
  if (!view || String(view?.type || "") !== "3d") return null;
  const existing = (view as any)[VIEW_MANAGER_KEY] as VolumePlumeManager | undefined;
  if (existing) {
    existing.node.attachToRenderer();
    return existing;
  }
  const manager = {
    view,
    node: null as unknown as VolumePlumeRenderNode,
    entries: new Map<LayerData, VolumePlumeEntry>()
  };
  manager.node = new VolumePlumeRenderNode({ view, manager });
  manager.node.attachToRenderer();
  (view as any)[VIEW_MANAGER_KEY] = manager;
  return manager;
};

const getManagerView = (manager: VolumePlumeManager | null | undefined) =>
  (manager?.view ?? ((manager?.node as any)?.view ?? null)) as any;

const requestManagerRender = (manager: VolumePlumeManager | null | undefined) => {
  manager?.node?.attachToRenderer();
  const managerView = getManagerView(manager);
  const nodeView = ((manager?.node as any)?.view ?? null) as any;

  if (nodeView?.stage?.renderView) {
    (manager?.node as any)?.requestRender?.(1);
    nodeView.requestRender?.();
    return;
  }

  managerView?.requestRender?.();
};

const destroyManagerIfEmpty = (manager: VolumePlumeManager | null | undefined) => {
  if (!manager || manager.entries.size > 0) return;
  const view = getManagerView(manager);
  manager.node.destroy();
  if (view) {
    delete view[VIEW_MANAGER_KEY];
  }
};

const buildEntry = (layerData: LayerData, view: any): VolumePlumeEntry | null => {
  if (!isParticleLayer(layerData) || String(view?.type || "") !== "3d") return null;
  const animationState = getVolumeAnimationState(layerData);
  if (!animationState) return null;
  const style = readVolumeStyle(layerData);
  if (layerData.layer?.visible === false) return null;
  const opacity = clamp(toFinite(layerData.layer?.opacity, 1), 0, 1);
  if (opacity <= 0.001) return null;

  const anchors = (layerData.layer?.graphics?.toArray?.() ?? [])
    .map((graphic: any) => {
      const point = graphic?.geometry;
      if (!point || point.type !== "point") return null;
      if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
      const origin = [Number(point.x), Number(point.y), Number(point.z) || 0];
      const transform = webgl.renderCoordinateTransformAt(
        view,
        origin,
        point.spatialReference ?? view.spatialReference,
        new Float64Array(16)
      ) as Float64Array | null | undefined;
      if (!transform) return null;
      return {
        originRender: [Number(transform[12]), Number(transform[13]), Number(transform[14])] as [
          number,
          number,
          number
        ],
        transform,
        seed: getAnchorSeed(graphic)
      };
    })
    .filter(Boolean) as VolumePlumeAnchor[];

  if (!anchors.length) return null;

  return {
    layerData,
    style,
    effect: animationState.effect,
    progress: animationState.progress,
    time: animationState.time,
    opacity,
    anchors
  };
};

export const syncVolumePlume = (layerData: LayerData, view: any) => {
  const entry = buildEntry(layerData, view);
  const previousManager = (layerData as any)[LAYER_MANAGER_KEY] as VolumePlumeManager | undefined;
  const manager = entry
    ? getManager(view)
    : (previousManager ?? ((view as any)?.[VIEW_MANAGER_KEY] as VolumePlumeManager | undefined) ?? null);
  if (previousManager && previousManager !== manager) {
    previousManager.entries.delete(layerData);
    delete (layerData as any)[LAYER_MANAGER_KEY];
    requestManagerRender(previousManager);
    destroyManagerIfEmpty(previousManager);
  }
  if (!entry) {
    manager?.entries.delete(layerData);
    delete (layerData as any)[LAYER_MANAGER_KEY];
    requestManagerRender(manager);
    destroyManagerIfEmpty(manager);
    return false;
  }
  if (!manager) {
    delete (layerData as any)[LAYER_MANAGER_KEY];
    return false;
  }

  manager.entries.set(layerData, entry);
  (layerData as any)[LAYER_MANAGER_KEY] = manager;
  const shouldUsePlume = manager.node.hasRenderedFrame || manager.node.attachToRenderer();
  requestManagerRender(manager);
  return shouldUsePlume;
};

export const destroyVolumePlume = (layerData: LayerData, view?: any) => {
  const manager =
    ((layerData as any)[LAYER_MANAGER_KEY] as VolumePlumeManager | undefined) ??
    ((view as any)?.[VIEW_MANAGER_KEY] as VolumePlumeManager | undefined);
  if (!manager) return;
  manager.entries.delete(layerData);
  delete (layerData as any)[LAYER_MANAGER_KEY];
  requestManagerRender(manager);
  destroyManagerIfEmpty(manager);
};
