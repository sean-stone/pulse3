import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@arcgis/core/geometry/Point", () => ({
  default: class MockPoint {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
}));
vi.mock("@arcgis/core/geometry/Polyline", () => ({
  default: class MockPolyline {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
}));
vi.mock("@arcgis/core/geometry/Polygon", () => ({
  default: class MockPolygon {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  }
}));
vi.mock("@arcgis/core/geometry/support/webMercatorUtils", () => ({
  webMercatorToGeographic: (geometry: unknown) => geometry
}));

import type { ImportConfig } from "../importers";
import { importGeoJson } from "../importers";

type CreatedLayer = {
  type: string;
  name: string;
  graphics: unknown[];
};

const buildConfig = (overrides: Partial<ImportConfig> = {}) => {
  const createdLayers: CreatedLayer[] = [];
  const createGraphicForType = vi.fn((type: string, geometry: unknown, attributes?: Record<string, unknown>) => ({
    type,
    geometry,
    attributes
  }));
  const createImportedLayer = vi.fn((type: string, name: string, graphics: unknown[]) => {
    const layer = { type, name, graphics };
    createdLayers.push(layer);
    return layer as any;
  });
  const zoomToLayers = vi.fn();
  const config: ImportConfig = {
    getView: () => ({}),
    createGraphicForType: createGraphicForType as any,
    createImportedLayer: createImportedLayer as any,
    zoomToLayers,
    ...overrides
  };

  return {
    config,
    createdLayers,
    createImportedLayer,
    zoomToLayers
  };
};

describe("GeoJSON import", () => {
  beforeEach(() => {
    (globalThis as any).alert = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).alert;
  });

  test("prompts and keeps multi-feature GeoJSON combined when combined is selected", async () => {
    const chooseGeoJsonImportMode = vi.fn().mockResolvedValue("combined");
    const { config, createdLayers, createImportedLayer, zoomToLayers } = buildConfig({
      chooseGeoJsonImportMode
    });

    const payload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-1, 51] },
          properties: { name: "A" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-2, 52] },
          properties: { name: "B" }
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-3, 50], [-2, 50], [-2, 51], [-3, 50]]]
          },
          properties: { name: "Zone" }
        }
      ]
    };

    await importGeoJson(config, "places.geojson", JSON.stringify(payload));

    expect(chooseGeoJsonImportMode).toHaveBeenCalledWith({
      fileName: "places.geojson",
      supportedFeatureCount: 3,
      typeCounts: { point: 2, polygon: 1 }
    });
    expect(createImportedLayer).toHaveBeenCalledTimes(2);
    expect(createdLayers).toEqual([
      expect.objectContaining({ type: "point", name: "places Points", graphics: expect.any(Array) }),
      expect.objectContaining({ type: "polygon", name: "places Polygons", graphics: expect.any(Array) })
    ]);
    expect(createdLayers[0]?.graphics).toHaveLength(2);
    expect(createdLayers[1]?.graphics).toHaveLength(1);
    expect(zoomToLayers).toHaveBeenCalledWith(createdLayers);
  });

  test("can split multi-feature GeoJSON into separate layers per feature", async () => {
    const chooseGeoJsonImportMode = vi.fn().mockResolvedValue("split");
    const { config, createdLayers, createImportedLayer, zoomToLayers } = buildConfig({
      chooseGeoJsonImportMode
    });

    const payload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-1, 51] },
          properties: { id: "a" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-2, 52] },
          properties: { id: "b" }
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[-3, 50], [-2, 51]] },
          properties: { id: "c" }
        }
      ]
    };

    await importGeoJson(config, "transport.geojson", JSON.stringify(payload));

    expect(createImportedLayer).toHaveBeenCalledTimes(3);
    expect(createdLayers.map((layer) => layer.name)).toEqual([
      "transport Point 1",
      "transport Point 2",
      "transport Line 1"
    ]);
    expect(createdLayers.map((layer) => layer.type)).toEqual(["point", "point", "polyline"]);
    expect(createdLayers.every((layer) => layer.graphics.length === 1)).toBe(true);
    expect(zoomToLayers).toHaveBeenCalledWith(createdLayers);
  });

  test("does not prompt when only one supported feature is present", async () => {
    const chooseGeoJsonImportMode = vi.fn();
    const { config, createImportedLayer } = buildConfig({
      chooseGeoJsonImportMode
    });

    const payload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-1, 51] },
          properties: { name: "Only one" }
        }
      ]
    };

    await importGeoJson(config, "single.geojson", JSON.stringify(payload));

    expect(chooseGeoJsonImportMode).not.toHaveBeenCalled();
    expect(createImportedLayer).toHaveBeenCalledTimes(1);
  });
});
