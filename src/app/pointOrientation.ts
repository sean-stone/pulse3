import type { PointKeyframe, PointStyle } from "../types";

type PointSymbolOrientationMode = "simple" | "icon-3d" | "object-3d" | "unknown";

type PointSymbolOrientation = {
  mode: PointSymbolOrientationMode;
  angle?: number;
  heading?: number;
  tilt?: number;
  roll?: number;
  has3DIconLayer?: boolean;
  has3DObjectLayer?: boolean;
};

const toFiniteNumber = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
};

const getSymbolLayers = (symbol: any): any[] => {
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
  try {
    return Array.from(symbolLayers as Iterable<any>);
  } catch {
    return [];
  }
};

const setSymbolLayers = (symbol: any, nextLayers: any[]) => {
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
};

const mergePointSymbolOrientations = (
  ...orientations: Array<Partial<PointSymbolOrientation> | null | undefined>
): PointSymbolOrientation => {
  const merged: PointSymbolOrientation = { mode: "unknown" };
  orientations.forEach((orientation) => {
    if (!orientation) return;
    if (orientation.mode && orientation.mode !== "unknown") {
      merged.mode = orientation.mode;
    }
    if (orientation.has3DIconLayer) {
      merged.has3DIconLayer = true;
    }
    if (orientation.has3DObjectLayer) {
      merged.has3DObjectLayer = true;
    }
    const angle = toFiniteNumber(orientation.angle);
    if (Number.isFinite(angle)) {
      merged.angle = angle;
    }
    const heading = toFiniteNumber(orientation.heading);
    if (Number.isFinite(heading)) {
      merged.heading = heading;
    }
    const tilt = toFiniteNumber(orientation.tilt);
    if (Number.isFinite(tilt)) {
      merged.tilt = tilt;
    }
    const roll = toFiniteNumber(orientation.roll);
    if (Number.isFinite(roll)) {
      merged.roll = roll;
    }
  });
  if (merged.mode === "unknown") {
    if (merged.has3DObjectLayer) {
      merged.mode = "object-3d";
    } else if (merged.has3DIconLayer) {
      merged.mode = "icon-3d";
    }
  }
  return merged;
};

const readPointStyleOrientation = (style?: PointStyle | null): PointSymbolOrientation => {
  const angle = toFiniteNumber(style?.angle);
  const heading = toFiniteNumber(style?.heading);
  return mergePointSymbolOrientations({
    mode: "unknown",
    angle,
    heading: heading ?? angle,
    tilt: toFiniteNumber(style?.tilt),
    roll: toFiniteNumber(style?.roll)
  });
};

const readPointKeyframeOrientation = (frame?: PointKeyframe | null): PointSymbolOrientation => {
  const rotation = toFiniteNumber(frame?.rotation);
  const heading = toFiniteNumber(frame?.heading);
  const roll = toFiniteNumber(frame?.roll);
  return mergePointSymbolOrientations({
    mode: "unknown",
    angle: rotation ?? heading,
    heading: heading ?? rotation,
    tilt: toFiniteNumber(frame?.tilt),
    roll
  });
};

const readPointSymbolOrientation = (symbol: any): PointSymbolOrientation => {
  if (!symbol) {
    return { mode: "unknown" };
  }
  if (symbol.type === "simple-marker") {
    const angle = toFiniteNumber(symbol.angle);
    return {
      mode: "simple",
      angle,
      heading: angle
    };
  }
  if (symbol.type === "point-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    let objectOrientation: PointSymbolOrientation | null = null;
    let iconOrientation: PointSymbolOrientation | null = null;
    symbolLayers.forEach((layer: any) => {
      if (!layer) return;
      if (layer.type === "object") {
        objectOrientation = mergePointSymbolOrientations(objectOrientation, {
          mode: "object-3d",
          has3DObjectLayer: true,
          heading: toFiniteNumber(layer.heading),
          tilt: toFiniteNumber(layer.tilt),
          roll: toFiniteNumber(layer.roll)
        });
        return;
      }
      if (layer.type === "icon") {
        const angle = toFiniteNumber(layer.angle);
        iconOrientation = mergePointSymbolOrientations(iconOrientation, {
          mode: "icon-3d",
          has3DIconLayer: true,
          angle,
          heading: angle
        });
      }
    });
    return mergePointSymbolOrientations(iconOrientation, objectOrientation);
  }
  const fallbackAngle = toFiniteNumber((symbol as any)?.angle);
  return {
    mode: "unknown",
    angle: fallbackAngle,
    heading: fallbackAngle
  };
};

const getPointOrientationAngle = (orientation?: Partial<PointSymbolOrientation> | null) =>
  orientation?.mode === "object-3d"
    ? toFiniteNumber(orientation?.heading) ?? toFiniteNumber(orientation?.angle)
    : toFiniteNumber(orientation?.angle) ?? toFiniteNumber(orientation?.heading);

const getPointOrientationHeading = (orientation?: Partial<PointSymbolOrientation> | null) =>
  toFiniteNumber(orientation?.heading) ?? toFiniteNumber(orientation?.angle);

const applyPointOrientationToSymbol = (
  symbol: any,
  orientation?: Partial<PointSymbolOrientation> | null
) => {
  if (!symbol || !orientation) return symbol;
  const angle = getPointOrientationAngle(orientation);
  const heading = getPointOrientationHeading(orientation);
  const tilt = toFiniteNumber(orientation.tilt);
  const roll = toFiniteNumber(orientation.roll);

  if (symbol.type === "simple-marker") {
    if (Number.isFinite(angle)) {
      symbol.angle = angle;
    }
    return symbol;
  }

  if (symbol.type === "point-3d") {
    const symbolLayers = getSymbolLayers(symbol);
    if (!symbolLayers.length) return symbol;
    const nextLayers = symbolLayers.map((layer: any) => {
      if (!layer) return layer;
      const nextLayer = typeof layer.clone === "function" ? layer.clone() : { ...layer };
      if (nextLayer.type === "icon") {
        if (Number.isFinite(angle)) {
          nextLayer.angle = angle;
        }
        return nextLayer;
      }
      if (nextLayer.type === "object") {
        if (Number.isFinite(heading)) {
          nextLayer.heading = heading;
        }
        if (Number.isFinite(tilt)) {
          nextLayer.tilt = tilt;
        }
        if (Number.isFinite(roll)) {
          nextLayer.roll = roll;
        }
      }
      return nextLayer;
    });
    setSymbolLayers(symbol, nextLayers);
    return symbol;
  }

  if (Number.isFinite(angle)) {
    (symbol as any).angle = angle;
  }
  return symbol;
};

export type { PointSymbolOrientation, PointSymbolOrientationMode };
export {
  applyPointOrientationToSymbol,
  getPointOrientationAngle,
  getPointOrientationHeading,
  getSymbolLayers,
  mergePointSymbolOrientations,
  readPointKeyframeOrientation,
  readPointStyleOrientation,
  readPointSymbolOrientation,
  setSymbolLayers,
  toFiniteNumber
};
