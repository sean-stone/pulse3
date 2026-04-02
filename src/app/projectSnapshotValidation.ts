import type { ProjectSnapshot } from "./constants";

type ProjectSnapshotValidationResult =
  | {
      ok: true;
      snapshot: ProjectSnapshot;
    }
  | {
      ok: false;
      error: string;
    };

const validLayerTypes = new Set(["point", "polyline", "polygon", "text", "feature", "particles", "volume"]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const validateProjectSnapshot = (input: unknown): ProjectSnapshotValidationResult => {
  if (!isRecord(input)) {
    return { ok: false, error: "Snapshot root must be an object." };
  }

  if (input.type !== "FeatureCollection") {
    return { ok: false, error: "Snapshot type must be FeatureCollection." };
  }

  if (!Array.isArray(input.features)) {
    return { ok: false, error: "Snapshot features must be an array." };
  }

  for (let index = 0; index < input.features.length; index += 1) {
    const feature = input.features[index];
    if (!isRecord(feature)) {
      return { ok: false, error: `Feature at index ${index} must be an object.` };
    }
    if (feature.type !== "Feature") {
      return { ok: false, error: `Feature at index ${index} must have type Feature.` };
    }
    if (!("geometry" in feature)) {
      return { ok: false, error: `Feature at index ${index} is missing geometry.` };
    }
    if (!isRecord(feature.properties)) {
      return { ok: false, error: `Feature at index ${index} must have object properties.` };
    }
  }

  if (!isRecord(input.properties)) {
    return { ok: false, error: "Snapshot properties must be an object." };
  }

  const pulse = input.properties._pulse;
  if (!isRecord(pulse)) {
    return { ok: false, error: "Snapshot is missing properties._pulse metadata." };
  }

  if (!isRecord(pulse.app)) {
    return { ok: false, error: "Snapshot is missing properties._pulse.app metadata." };
  }

  if (!isRecord(pulse.timeline)) {
    return { ok: false, error: "Snapshot is missing properties._pulse.timeline metadata." };
  }

  if (!Array.isArray(pulse.layers)) {
    return { ok: false, error: "Snapshot properties._pulse.layers must be an array." };
  }

  for (let index = 0; index < pulse.layers.length; index += 1) {
    const layer = pulse.layers[index];
    if (!isRecord(layer)) {
      return { ok: false, error: `Layer at index ${index} must be an object.` };
    }
    const layerType = layer.type;
    if (typeof layerType !== "string" || !validLayerTypes.has(layerType)) {
      return { ok: false, error: `Layer at index ${index} has an unsupported layer type.` };
    }
  }

  return { ok: true, snapshot: input as ProjectSnapshot };
};

export type { ProjectSnapshotValidationResult };
export { validateProjectSnapshot };
