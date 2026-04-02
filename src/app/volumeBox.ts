import Mesh from "@arcgis/core/geometry/Mesh";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import type { LayerData, VolumeStyle } from "../types";
import { destroyVolumePlume, syncVolumePlume } from "./volumePlume";

type Rgba = [number, number, number, number];
type VolumeEffectKind = "smoke" | "fire";
type VolumeTextureKind = "smoke" | "fire-slice" | "fire-plume" | "fire-core";
type VolumeAnimationState = {
  effect: VolumeEffectKind;
  progress: number;
  time: number;
};
type PlaneTextureOptions = {
  textureKind?: VolumeTextureKind;
  rotation?: number;
  scale?: [number, number];
  offset?: [number, number];
  emissiveStrength?: number;
  planeSides?: number;
  radialVariance?: number;
};

const volumeTextureCache = new Map<VolumeTextureKind, HTMLCanvasElement | null>();

const isSceneView3D = (view: any) => String(view?.type || "") === "3d";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFinite = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

const withAlpha = (color: Rgba, alpha: number): Rgba => [
  color[0],
  color[1],
  color[2],
  clamp(alpha, 0, 1)
];

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
  gradient.addColorStop(0.5, `rgba(255,255,255,${clamp(alpha * 0.5, 0, 1)})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
  context.restore();
};

const buildVolumeTexture = (kind: VolumeTextureKind) => {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = volumeTextureCache.get(kind);
  if (existing !== undefined) {
    return existing;
  }

  const canvas = document.createElement("canvas");
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    volumeTextureCache.set(kind, null);
    return null;
  }

  context.clearRect(0, 0, size, size);
  context.globalCompositeOperation = "lighter";

  if (kind === "smoke") {
    for (let index = 0; index < 18; index += 1) {
      const x = size * (0.24 + seededUnit(index * 1.87 + 1) * 0.52);
      const y = size * (0.2 + seededUnit(index * 2.41 + 2) * 0.56);
      const radius = size * (0.11 + seededUnit(index * 3.17 + 3) * 0.14);
      drawSoftBlob(
        context,
        x,
        y,
        radius,
        0.28 + seededUnit(index * 4.13 + 4) * 0.34,
        0.72 + seededUnit(index * 5.11 + 5) * 0.82,
        0.72 + seededUnit(index * 6.07 + 6) * 0.92
      );
    }
    context.globalCompositeOperation = "destination-in";
    drawSoftBlob(context, size * 0.5, size * 0.52, size * 0.48, 1, 1.06, 1.08);
  } else if (kind === "fire-slice") {
    for (let index = 0; index < 9; index += 1) {
      const t = index / 8;
      drawSoftBlob(
        context,
        size * (0.5 + (seededUnit(index * 2.03 + 9) * 2 - 1) * 0.08),
        size * (0.78 - t * 0.46),
        size * (0.19 - t * 0.055),
        0.32 + (1 - t) * 0.4,
        1.08 + (1 - t) * 0.26,
        0.84 + (1 - t) * 0.22
      );
    }
    context.globalCompositeOperation = "destination-in";
    drawSoftBlob(context, size * 0.5, size * 0.56, size * 0.4, 1, 0.96, 1.24);
  } else if (kind === "fire-plume") {
    for (let index = 0; index < 10; index += 1) {
      const t = index / 9;
      drawSoftBlob(
        context,
        size * (0.5 + Math.sin(index * 1.1) * 0.03),
        size * (0.86 - t * 0.68),
        size * (0.16 - t * 0.055),
        0.34 + (1 - t) * 0.42,
        0.7 + (1 - t) * 0.2,
        1.2 + (1 - t) * 0.7
      );
    }
    context.globalCompositeOperation = "destination-in";
    drawSoftBlob(context, size * 0.5, size * 0.5, size * 0.34, 1, 0.9, 1.5);
  } else {
    for (let index = 0; index < 7; index += 1) {
      const t = index / 6;
      drawSoftBlob(
        context,
        size * 0.5,
        size * (0.82 - t * 0.54),
        size * (0.11 - t * 0.024),
        0.44 + (1 - t) * 0.4,
        0.54 + (1 - t) * 0.08,
        1.18 + (1 - t) * 0.44
      );
    }
    context.globalCompositeOperation = "destination-in";
    drawSoftBlob(context, size * 0.5, size * 0.54, size * 0.24, 1, 0.68, 1.36);
  }

  volumeTextureCache.set(kind, canvas);
  return canvas;
};

const getAnimationActivity = (progress: number, min: number) =>
  clamp(min + (1 - min) * Math.sin(Math.PI * clamp(progress, 0, 1)), min, 1);

const readVolumeStyle = (layerData: LayerData): VolumeStyle => {
  const style = layerData.volumeStyle;
  return {
    width: clamp(toFinite(style?.width, 220), 10, 100000),
    depth: clamp(toFinite(style?.depth, 220), 10, 100000),
    height: clamp(toFinite(style?.height, 140), 10, 100000),
    floorOffset: clamp(toFinite(style?.floorOffset, 8), -10000, 100000),
    opacity: clamp(toFinite(style?.opacity, 0.32), 0.05, 0.95),
    slices: Math.round(clamp(toFinite(style?.slices, 22), 4, 64)),
    color: String(style?.color || "#c9dcff"),
    edgeColor: String(style?.edgeColor || "#f4fbff")
  };
};

const readVolumeAnimationState = (layerData: LayerData): VolumeAnimationState | null => {
  const state = (layerData as any).__volumeAnimationState as Partial<VolumeAnimationState> | undefined;
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

const syncOverlayLayerState = (overlayLayer: GraphicsLayer, layerData: LayerData) => {
  const overlayAny = overlayLayer as any;
  const sourceLayer: any = layerData.layer;
  const animationState = readVolumeAnimationState(layerData);
  overlayLayer.visible = sourceLayer.visible !== false;
  overlayLayer.opacity = sourceLayer.opacity ?? 1;
  overlayAny.blendMode = animationState?.effect === "fire" ? "screen" : "normal";
  overlayAny.effect = "";
  overlayAny.elevationInfo = { mode: "relative-to-ground", offset: 0 };
};

const getOrCreateVolumeOverlayLayer = (layerData: LayerData, view: any) => {
  const existing = (layerData as any).__volumeLayer as GraphicsLayer | undefined;
  if (existing) return existing;
  const layer = new GraphicsLayer({
    listMode: "hide",
    opacity: 1
  });
  (layer as any).__pulseVolumeLayerData = layerData;
  view?.map?.add(layer);
  (layerData as any).__volumeLayer = layer;
  return layer;
};

const destroyVolumeMeshOverlay = (layerData: LayerData, view?: any) => {
  const overlay = (layerData as any).__volumeLayer as GraphicsLayer | undefined;
  if (!overlay) return;
  overlay.removeAll();
  view?.map?.remove?.(overlay);
  delete (layerData as any).__volumeLayer;
};

const buildMeshGeometry = (point: any, positions: number[], faces: number[], uv?: number[]) => {
  const vertexAttributes: Record<string, Float64Array | Float32Array> = {
    position: new Float64Array(positions)
  };
  if (uv?.length) {
    vertexAttributes.uv = new Float32Array(uv);
  }
  return new Mesh({
    spatialReference: point?.spatialReference,
    vertexAttributes,
    components: [
      {
        faces: new Uint32Array(faces)
      }
    ],
    vertexSpace: {
      type: "local",
      origin: [Number(point?.x || 0), Number(point?.y || 0), 0]
    }
  });
};

const buildBoxGeometry = (point: any, width: number, depth: number, z0: number, z1: number) => {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return buildMeshGeometry(
    point,
    [
      -halfWidth, -halfDepth, z0,
      halfWidth, -halfDepth, z0,
      halfWidth, halfDepth, z0,
      -halfWidth, halfDepth, z0,
      -halfWidth, -halfDepth, z1,
      halfWidth, -halfDepth, z1,
      halfWidth, halfDepth, z1,
      -halfWidth, halfDepth, z1
    ],
    [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0
    ]
  );
};

const buildHorizontalPlaneGeometry = (
  point: any,
  width: number,
  depth: number,
  z: number,
  offsetX: number,
  offsetY: number,
  options: PlaneTextureOptions = {}
) => {
  const sides = Math.max(8, Math.round(options.planeSides ?? 20));
  const radialVariance = clamp(options.radialVariance ?? 0.18, 0, 0.4);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const seed =
    width * 0.013 +
    depth * 0.009 +
    z * 0.07 +
    offsetX * 0.005 +
    offsetY * 0.006;
  const rotation = seededUnit(seed) * Math.PI * 2;
  const positions = [offsetX, offsetY, z];
  const uv = [0.5, 0.5];
  const faces: number[] = [];

  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index / sides) * Math.PI * 2;
    const radialScale = 1 - radialVariance * 0.5 + seededUnit(seed + index * 1.71) * radialVariance;
    positions.push(
      offsetX + Math.cos(angle) * halfWidth * radialScale,
      offsetY + Math.sin(angle) * halfDepth * radialScale,
      z
    );
    uv.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
  }

  for (let index = 1; index <= sides; index += 1) {
    const nextIndex = index === sides ? 1 : index + 1;
    faces.push(0, index, nextIndex);
  }

  return buildMeshGeometry(point, positions, faces, uv);
};

const buildVerticalPlaneGeometry = (
  point: any,
  width: number,
  height: number,
  z0: number,
  axis: "x" | "y"
) => {
  const halfWidth = width / 2;
  const z1 = z0 + height;
  const positions =
    axis === "x"
      ? [
          0, -halfWidth, z0,
          0, halfWidth, z0,
          0, halfWidth, z1,
          0, -halfWidth, z1
        ]
      : [
          -halfWidth, 0, z0,
          halfWidth, 0, z0,
          halfWidth, 0, z1,
          -halfWidth, 0, z1
        ];
  return buildMeshGeometry(
    point,
    positions,
    [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0],
    [0, 0, 1, 0, 1, 1, 0, 1]
  );
};

const buildRotatedVerticalPlaneGeometry = (
  point: any,
  width: number,
  height: number,
  z0: number,
  angleDegrees: number,
  offsetX = 0,
  offsetY = 0
) => {
  const halfWidth = width / 2;
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(radians) * halfWidth;
  const dy = Math.sin(radians) * halfWidth;
  const z1 = z0 + height;
  return buildMeshGeometry(
    point,
    [
      offsetX - dx, offsetY - dy, z0,
      offsetX + dx, offsetY + dy, z0,
      offsetX + dx, offsetY + dy, z1,
      offsetX - dx, offsetY - dy, z1
    ],
    [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0],
    [0, 0, 1, 0, 1, 1, 0, 1]
  );
};

const buildPlaneSymbolFromColor = (rgba: Rgba, textureOptions: PlaneTextureOptions = {}) => {
  const texture = textureOptions.textureKind ? buildVolumeTexture(textureOptions.textureKind) : null;
  const material: any = {
    color: withAlpha(rgba, rgba[3]),
    doubleSided: true
  };
  if (texture) {
    material.colorTexture = texture;
    material.colorMixMode = "tint";
    material.alphaCutoff = 0.01;
    if (
      textureOptions.rotation !== undefined ||
      textureOptions.scale !== undefined ||
      textureOptions.offset !== undefined
    ) {
      material.colorTextureTransform = {
        rotation: textureOptions.rotation ?? 0,
        scale: textureOptions.scale ?? [1, 1],
        offset: textureOptions.offset ?? [0, 0]
      };
    }
  }
  if (Number(textureOptions.emissiveStrength) > 0) {
    material.emissive = {
      source: "color",
      strength: Number(textureOptions.emissiveStrength)
    };
  }
  return {
    type: "mesh-3d",
    symbolLayers: [
      {
        type: "fill",
        material
      }
    ]
  } as any;
};

const buildShellSymbolFromColors = (fill: Rgba, edge: Rgba) =>
  ({
    type: "mesh-3d",
    symbolLayers: [
      {
        type: "fill",
        material: {
          color: withAlpha(fill, fill[3])
        },
        edges: {
          type: "solid",
          color: withAlpha(edge, edge[3])
        }
      }
    ]
  }) as any;

const seededUnit = (seed: number) => {
  const x = Math.sin(seed) * 43758.5453123;
  return x - Math.floor(x);
};

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

const pushHorizontalPlaneGraphic = (
  graphics: Graphic[],
  point: any,
  width: number,
  depth: number,
  z: number,
  offsetX: number,
  offsetY: number,
  color: Rgba,
  textureOptions?: PlaneTextureOptions
) => {
  graphics.push(
    new Graphic({
      geometry: buildHorizontalPlaneGeometry(point, width, depth, z, offsetX, offsetY, textureOptions),
      symbol: buildPlaneSymbolFromColor(color, textureOptions)
    })
  );
};

const pushVerticalPlaneGraphic = (
  graphics: Graphic[],
  point: any,
  width: number,
  height: number,
  z0: number,
  angleDegrees: number,
  color: Rgba,
  offsetX = 0,
  offsetY = 0,
  textureOptions?: PlaneTextureOptions
) => {
  graphics.push(
    new Graphic({
      geometry: buildRotatedVerticalPlaneGeometry(
        point,
        width,
        height,
        z0,
        angleDegrees,
        offsetX,
        offsetY
      ),
      symbol: buildPlaneSymbolFromColor(color, textureOptions)
    })
  );
};

const buildFogVolumeGraphics = (point: any, style: VolumeStyle, seed: number) => {
  const graphics: Graphic[] = [];
  const z0 = style.floorOffset;
  const z1 = style.floorOffset + style.height;
  const fill = parseColorToRgba(style.color, [201, 220, 255, 1]);
  const edge = parseColorToRgba(style.edgeColor, [244, 251, 255, 1]);
  const sliceCount = Math.round(clamp(style.slices * 1.6, 10, 64));

  graphics.push(
    new Graphic({
      geometry: buildBoxGeometry(point, style.width, style.depth, z0, z1),
      symbol: buildShellSymbolFromColors(
        withAlpha(fill, clamp(style.opacity * 0.16, 0.02, 0.24)),
        withAlpha(edge, clamp(0.2 + style.opacity * 0.7, 0.24, 0.9))
      )
    })
  );

  for (let index = 0; index < sliceCount; index += 1) {
    const t = sliceCount <= 1 ? 0.5 : index / (sliceCount - 1);
    const bell = Math.sin(Math.PI * clamp(t, 0.02, 0.98));
    const jitterX = seededUnit(seed + index * 1.71) * 2 - 1;
    const jitterY = seededUnit(seed + index * 2.39) * 2 - 1;
    const insetX = style.width * (0.08 + seededUnit(seed + index * 3.17) * 0.14);
    const insetY = style.depth * (0.08 + seededUnit(seed + index * 4.91) * 0.14);
    const sliceWidth = Math.max(style.width * 0.46, style.width - insetX * 2);
    const sliceDepth = Math.max(style.depth * 0.46, style.depth - insetY * 2);
    const offsetX = jitterX * style.width * 0.045;
    const offsetY = jitterY * style.depth * 0.045;
    const z = z0 + t * style.height;
    const alpha = clamp(style.opacity * (0.08 + bell * 0.13), 0.01, 0.95);
    pushHorizontalPlaneGraphic(
      graphics,
      point,
      sliceWidth,
      sliceDepth,
      z,
      offsetX,
      offsetY,
      withAlpha(fill, alpha),
      {
        textureKind: "smoke",
        rotation: seededUnit(seed + index * 8.13) * 180
      }
    );
  }

  [0, 45, 90, 135].forEach((angle, index) => {
    const span = (index % 2 === 0 ? style.width : Math.max(style.width, style.depth)) * 0.9;
    pushVerticalPlaneGraphic(
      graphics,
      point,
      span,
      style.height,
      z0,
      angle,
      withAlpha(fill, clamp(style.opacity * 0.055, 0.02, 0.22)),
      0,
      0,
      {
        textureKind: "smoke",
        rotation: angle
      }
    );
  });

  return graphics;
};

const buildSmokeVolumeGraphics = (
  point: any,
  style: VolumeStyle,
  seed: number,
  animationState: VolumeAnimationState
) => {
  const graphics: Graphic[] = [];
  const z0 = style.floorOffset;
  const height = style.height;
  const activity = getAnimationActivity(animationState.progress, 0.48);
  const time = animationState.time;
  const smokeDark: Rgba = [72, 78, 88, 1];
  const smokeMid: Rgba = [124, 132, 143, 1];
  const smokeLight = mixRgba(
    [208, 214, 221, 1],
    parseColorToRgba(style.edgeColor, [244, 251, 255, 1]),
    0.16
  );

  graphics.push(
    new Graphic({
      geometry: buildBoxGeometry(point, style.width, style.depth, z0, z0 + height),
      symbol: buildShellSymbolFromColors(
        withAlpha(mixRgba(smokeDark, smokeMid, 0.35), clamp(style.opacity * 0.055 * activity, 0.015, 0.12)),
        withAlpha(smokeLight, clamp((0.06 + style.opacity * 0.12) * activity, 0.04, 0.18))
      )
    })
  );

  const sliceCount = Math.round(clamp(style.slices * 2.1 + 10, 18, 72));
  for (let index = 0; index < sliceCount; index += 1) {
    const t = sliceCount <= 1 ? 0.5 : index / (sliceCount - 1);
    const bell = Math.sin(Math.PI * clamp(t, 0.02, 0.98));
    const phase =
      time * 0.58 +
      index * 0.37 +
      seededUnit(seed + index * 1.17) * Math.PI * 2;
    const plumeWidth = clamp(0.38 + t * 0.56 + bell * 0.12, 0.32, 1.08);
    const plumeDepth = clamp(0.36 + t * 0.52 + bell * 0.1, 0.3, 1.04);
    const sliceWidth = clamp(
      style.width * (plumeWidth + Math.sin(phase * 0.88) * 0.04 * activity),
      style.width * 0.26,
      style.width * 1.08
    );
    const sliceDepth = clamp(
      style.depth * (plumeDepth + Math.cos(phase * 0.94) * 0.04 * activity),
      style.depth * 0.26,
      style.depth * 1.08
    );
    const offsetX = Math.sin(phase) * style.width * (0.01 + t * 0.055) * activity;
    const offsetY = Math.cos(phase * 1.06) * style.depth * (0.01 + t * 0.05) * activity;
    const z = clamp(z0 + t * height + Math.sin(phase * 0.72) * height * 0.02, z0, z0 + height);
    const fill = mixRgba(smokeDark, smokeLight, clamp(0.22 + bell * 0.58 + t * 0.08, 0, 1));
    const alpha = clamp(style.opacity * (0.028 + bell * 0.11) * activity, 0.012, 0.18);
    pushHorizontalPlaneGraphic(
      graphics,
      point,
      sliceWidth,
      sliceDepth,
      z,
      offsetX,
      offsetY,
      withAlpha(fill, alpha),
      {
        textureKind: "smoke",
        rotation: seededUnit(seed + index * 7.31) * 180
      }
    );
  }

  [
    { angle: 0, width: Math.max(style.width, style.depth) * 0.9, alpha: 0.065, tint: 0.32 },
    { angle: 45, width: Math.max(style.width, style.depth) * 0.96, alpha: 0.055, tint: 0.48 },
    { angle: 90, width: Math.max(style.width, style.depth) * 0.88, alpha: 0.06, tint: 0.22 },
    { angle: 135, width: Math.max(style.width, style.depth) * 0.94, alpha: 0.05, tint: 0.58 }
  ].forEach((plane, index) => {
    pushVerticalPlaneGraphic(
      graphics,
      point,
      plane.width,
      height * (0.9 + (index % 2 === 0 ? 0.06 : 0)),
      z0,
      plane.angle,
      withAlpha(
        mixRgba(smokeMid, smokeLight, plane.tint),
        clamp(style.opacity * plane.alpha * activity, 0.02, 0.12)
      ),
      Math.sin(time * 0.42 + index) * style.width * 0.018 * activity,
      Math.cos(time * 0.38 + index * 1.7) * style.depth * 0.015 * activity,
      {
        textureKind: "smoke",
        rotation: plane.angle
      }
    );
  });

  for (let index = 0; index < 6; index += 1) {
    const t = index / 5;
    const phase = time * 0.44 + index * 0.83 + seededUnit(seed + 200 + index) * Math.PI * 2;
    const fill = mixRgba(smokeMid, smokeLight, 0.42 + t * 0.34);
    pushHorizontalPlaneGraphic(
      graphics,
      point,
      style.width * (0.28 + t * 0.22),
      style.depth * (0.24 + t * 0.2),
      z0 + height * (0.66 + t * 0.24),
      Math.sin(phase) * style.width * 0.028 * activity,
      Math.cos(phase * 0.92) * style.depth * 0.024 * activity,
      withAlpha(fill, clamp(style.opacity * (0.03 - t * 0.003) * activity, 0.01, 0.04)),
      {
        textureKind: "smoke",
        rotation: seededUnit(seed + 300 + index) * 180
      }
    );
  }

  return graphics;
};

const buildFireVolumeGraphics = (
  point: any,
  style: VolumeStyle,
  seed: number,
  animationState: VolumeAnimationState
) => {
  const graphics: Graphic[] = [];
  const z0 = style.floorOffset;
  const activity = getAnimationActivity(animationState.progress, 0.34);
  const time = animationState.time;
  const flarePulse = 0.5 + 0.5 * Math.sin(time * 8.4 + seed * 0.0013);
  const flameHeight = clamp(
    style.height * (0.56 + flarePulse * 0.28) * (0.82 + activity * 0.28),
    style.height * 0.42,
    style.height * 0.94
  );
  const warmCore: Rgba = [255, 245, 214, 1];
  const gold: Rgba = [255, 208, 116, 1];
  const orange: Rgba = [255, 126, 52, 1];
  const ember: Rgba = [220, 62, 24, 1];
  const soot: Rgba = [112, 54, 38, 1];
  const footprintWidth = clamp(Math.min(style.width * 0.22, 44), 8, style.width * 0.28);
  const footprintDepth = clamp(Math.min(style.depth * 0.18, 34), 6, style.depth * 0.24);
  const crownWidth = footprintWidth * (1.08 + flarePulse * 0.08);
  const crownDepth = footprintDepth * (1.08 + flarePulse * 0.06);

  pushHorizontalPlaneGraphic(
    graphics,
    point,
    footprintWidth * 0.92,
    footprintDepth * 0.88,
    z0 + flameHeight * 0.035,
    0,
    0,
    withAlpha([255, 214, 148, 1], clamp((0.18 + flarePulse * 0.08) * activity, 0.08, 0.24)),
    {
      textureKind: "fire-slice",
      emissiveStrength: 1.2,
      planeSides: 28,
      radialVariance: 0.08
    }
  );

  const sliceCount = Math.round(clamp(style.slices * 1.15 + 8, 16, 40));
  for (let index = 0; index < sliceCount; index += 1) {
    const t = sliceCount <= 1 ? 0.5 : index / (sliceCount - 1);
    const verticalT = Math.pow(t, 0.82);
    const remaining = 1 - verticalT;
    const phase =
      time * 7.4 +
      index * 0.58 +
      seededUnit(seed + index * 0.79) * Math.PI * 2;
    const flicker = 0.82 + 0.18 * Math.sin(phase * 1.7);
    const widthScale = 0.26 + Math.pow(remaining, 0.7) * 0.74;
    const depthScale = 0.22 + Math.pow(remaining, 0.74) * 0.68;
    const sliceWidth = clamp(
      crownWidth * widthScale * flicker,
      footprintWidth * 0.18,
      crownWidth
    );
    const sliceDepth = clamp(
      crownDepth * depthScale * flicker,
      footprintDepth * 0.18,
      crownDepth
    );
    const offsetX = Math.sin(phase) * footprintWidth * (0.06 + remaining * 0.22) * activity;
    const offsetY = Math.cos(phase * 0.93) * footprintDepth * (0.05 + remaining * 0.18) * activity;
    const z = z0 + verticalT * flameHeight;
    let fill = mixRgba(warmCore, gold, clamp(verticalT * 1.35, 0, 1));
    fill = mixRgba(fill, orange, clamp(Math.pow(verticalT, 0.72), 0, 1));
    fill = mixRgba(fill, ember, clamp(Math.pow(verticalT, 1.65), 0, 1));
    if (verticalT > 0.82) {
      fill = mixRgba(fill, soot, ((verticalT - 0.82) / 0.18) * 0.45);
    }
    const alpha = clamp(
      style.opacity * (0.065 + remaining * 0.32) * (0.9 + flarePulse * 0.25) * activity,
      0.025,
      0.34
    );
    pushHorizontalPlaneGraphic(
      graphics,
      point,
      sliceWidth,
      sliceDepth,
      z,
      offsetX,
      offsetY,
      withAlpha(fill, alpha),
      {
        textureKind: "fire-slice",
        rotation: seededUnit(seed + index * 5.27) * 180,
        emissiveStrength: 0.68 + (1 - verticalT) * 0.9,
        planeSides: 28,
        radialVariance: 0.07
      }
    );
  }

  const coreHeight = flameHeight * 0.78;
  [
    { angle: 0, width: crownWidth * 0.74, color: gold, alpha: 0.15, height: coreHeight },
    { angle: 24, width: crownWidth * 0.88, color: warmCore, alpha: 0.14, height: coreHeight * 0.96 },
    { angle: 52, width: crownWidth * 0.82, color: gold, alpha: 0.13, height: coreHeight * 0.92 },
    { angle: 90, width: crownWidth * 0.68, color: warmCore, alpha: 0.13, height: coreHeight * 0.88 },
    { angle: 124, width: crownWidth * 0.96, color: orange, alpha: 0.1, height: flameHeight * 0.84 },
    { angle: 152, width: crownWidth * 0.8, color: gold, alpha: 0.11, height: flameHeight * 0.8 }
  ].forEach((plane, index) => {
    pushVerticalPlaneGraphic(
      graphics,
      point,
      plane.width,
      plane.height,
      z0,
      plane.angle,
      withAlpha(
        plane.color,
        clamp((plane.alpha + flarePulse * 0.05) * activity, 0.05, 0.22)
      ),
      Math.sin(time * 0.9 + index * 0.6) * footprintWidth * 0.1 * activity,
      Math.cos(time * 0.76 + index * 0.8) * footprintDepth * 0.08 * activity,
      {
        textureKind: index < 4 ? "fire-core" : "fire-plume",
        rotation: plane.angle,
        emissiveStrength: index < 4 ? 1.4 : 0.9
      }
    );
  });

  pushHorizontalPlaneGraphic(
    graphics,
    point,
    footprintWidth * 0.56,
    footprintDepth * 0.46,
    z0 + flameHeight * 0.08,
    0,
    0,
    withAlpha(warmCore, clamp((0.34 + flarePulse * 0.14) * activity, 0.16, 0.44)),
    {
      textureKind: "fire-slice",
      emissiveStrength: 1.6,
      planeSides: 30,
      radialVariance: 0.05
    }
  );

  const smokeTailHeight = Math.max(style.height - flameHeight, style.height * 0.18);
  for (let index = 0; index < 6; index += 1) {
    const t = index / 5;
    const z = z0 + flameHeight + t * smokeTailHeight * 0.85;
    const sizeScale = 0.56 + t * 0.42;
    const fill = mixRgba(soot, [172, 146, 128, 1], 0.32 + t * 0.26);
    pushHorizontalPlaneGraphic(
      graphics,
      point,
      footprintWidth * sizeScale,
      footprintDepth * sizeScale * 1.02,
      z,
      Math.sin(time * 0.9 + index * 0.7) * footprintWidth * 0.16 * activity,
      Math.cos(time * 0.86 + index * 1.4) * footprintDepth * 0.12 * activity,
      withAlpha(fill, clamp(style.opacity * (0.045 - t * 0.004) * activity, 0.012, 0.06)),
      {
        textureKind: "smoke",
        rotation: seededUnit(seed + 500 + index) * 180,
        planeSides: 24,
        radialVariance: 0.1
      }
    );
  }

  return graphics;
};

const buildVolumeGraphics = (layerData: LayerData, anchorGraphic: any) => {
  const point = anchorGraphic?.geometry;
  if (!point || point.type !== "point") return [] as Graphic[];
  if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return [] as Graphic[];
  }

  const style = readVolumeStyle(layerData);
  const seed = getAnchorSeed(anchorGraphic);
  const animationState = readVolumeAnimationState(layerData);
  const graphics =
    animationState?.effect === "smoke"
      ? buildSmokeVolumeGraphics(point, style, seed, animationState)
      : animationState?.effect === "fire"
        ? buildFireVolumeGraphics(point, style, seed, animationState)
        : buildFogVolumeGraphics(point, style, seed);

  graphics.forEach((graphic) => {
    (graphic as any).__pulseVolumeAnchorGraphic = anchorGraphic;
    (graphic as any).__pulseVolumeLayerData = layerData;
  });
  return graphics;
};

export const destroyVolumeBoxOverlay = (layerData: LayerData, view?: any) => {
  destroyVolumePlume(layerData, view);
  destroyVolumeMeshOverlay(layerData, view);
};

export const resolveVolumeBoxHitGraphic = (graphic: any) => {
  const overlayGraphic = graphic as Graphic | undefined;
  const overlayLayer = overlayGraphic?.layer as any;
  const layerData = (overlayGraphic as any)?.__pulseVolumeLayerData ?? overlayLayer?.__pulseVolumeLayerData;
  const anchorGraphic = (overlayGraphic as any)?.__pulseVolumeAnchorGraphic;
  if (!layerData || !anchorGraphic) {
    return null;
  }
  return {
    layerData: layerData as LayerData,
    graphic: anchorGraphic
  };
};

export const syncVolumeBoxOverlay = (layerData: LayerData, view: any) => {
  if (!view || layerData.type !== "volume" || !isSceneView3D(view)) {
    destroyVolumeBoxOverlay(layerData, view);
    return;
  }

  if (syncVolumePlume(layerData, view)) {
    destroyVolumeMeshOverlay(layerData, view);
    return;
  }
  destroyVolumeMeshOverlay(layerData, view);
};
