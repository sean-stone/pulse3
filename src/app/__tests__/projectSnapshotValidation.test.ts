import { describe, expect, test } from "vitest";

import { validateProjectSnapshot } from "../projectSnapshotValidation";

const buildValidSnapshot = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: null,
      properties: {
        _pulse: {
          layerId: "layer-0"
        }
      }
    }
  ],
  properties: {
    _pulse: {
      version: 1,
      savedAt: "2026-03-20T00:00:00.000Z",
      app: {
        layout: "default"
      },
      timeline: {
        durationOverride: null
      },
      layers: [
        {
          id: "layer-0",
          name: "Layer 1",
          type: "point",
          animations: []
        }
      ]
    }
  }
});

describe("projectSnapshotValidation", () => {
  test("accepts a valid project snapshot", () => {
    const result = validateProjectSnapshot(buildValidSnapshot());
    expect(result.ok).toBe(true);
  });

  test("rejects invalid top-level type", () => {
    const snapshot = buildValidSnapshot();
    snapshot.type = "Collection";
    const result = validateProjectSnapshot(snapshot);
    expect(result.ok).toBe(false);
  });

  test("rejects snapshot without pulse metadata", () => {
    const snapshot = buildValidSnapshot();
    delete (snapshot.properties as Record<string, unknown>)._pulse;
    const result = validateProjectSnapshot(snapshot);
    expect(result.ok).toBe(false);
  });

  test("rejects unsupported layer types", () => {
    const snapshot = buildValidSnapshot();
    snapshot.properties._pulse.layers[0].type = "raster";
    const result = validateProjectSnapshot(snapshot);
    expect(result.ok).toBe(false);
  });

  test("rejects features with non-object properties", () => {
    const snapshot = buildValidSnapshot();
    (snapshot.features[0] as Record<string, unknown>).properties = "invalid";
    const result = validateProjectSnapshot(snapshot);
    expect(result.ok).toBe(false);
  });
});
