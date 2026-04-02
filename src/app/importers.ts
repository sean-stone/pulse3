import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import type Graphic from "@arcgis/core/Graphic";

import type { LayerData, LayerType } from "../types";

type GeoJsonImportMode = "combined" | "split";
type GeoJsonImportChoiceRequest = {
  fileName: string;
  supportedFeatureCount: number;
  typeCounts: Partial<Record<LayerType, number>>;
};
type GeoJsonFeatureImport = {
  type: LayerType;
  graphics: Graphic[];
};

type ImportConfig = {
  getView: () => any;
  createGraphicForType: (type: LayerType, geometry: any, attributes?: Record<string, any>) => Graphic;
  createImportedLayer: (type: LayerType, name: string, graphics: Graphic[]) => LayerData | null;
  zoomToLayers: (layers: LayerData[]) => void;
  applyProjectSnapshot?: (snapshot: unknown) => void | Promise<void>;
  setProjectError?: (message: string | null) => void;
  chooseGeoJsonImportMode?: (
    request: GeoJsonImportChoiceRequest
  ) => GeoJsonImportMode | null | Promise<GeoJsonImportMode | null>;
};

const importGeoJson = async (config: ImportConfig, fileName: string, content: string) => {
  const view = config.getView();
  if (!view) return;
  let data: any;
  try {
    data = JSON.parse(content);
  } catch (error) {
    alert("Unable to read GeoJSON.");
    return;
  }

  const isPulseProject =
    data?.type === "FeatureCollection" &&
    typeof data?.properties?._pulse === "object" &&
    Array.isArray(data?.properties?._pulse?.layers);
  if (isPulseProject && config.applyProjectSnapshot) {
    try {
      await Promise.resolve(config.applyProjectSnapshot(data));
    } catch (error) {
      config.setProjectError?.("Unable to import project file.");
      alert("Unable to import project file.");
    }
    return;
  }

  const isLikelyWebMercator = (coords: number[]) => {
    const [x, y] = coords;
    return Math.abs(x) > 180 || Math.abs(y) > 90;
  };

  const normalizeGeometry = (geometry: any, spatialReference: any) => {
    if (!geometry) return geometry;
    if (geometry.spatialReference?.isWebMercator) {
      return webMercatorUtils.webMercatorToGeographic(geometry);
    }
    if (spatialReference?.isWebMercator) {
      return webMercatorUtils.webMercatorToGeographic(geometry);
    }
    return geometry;
  };

  const createFeatureImport = (geometry: any, properties?: Record<string, any>): GeoJsonFeatureImport | null => {
    if (!geometry) return null;
    const type = geometry.type;
    const coords = geometry.coordinates;
    const graphics: Graphic[] = [];
    const attributes =
      properties && typeof properties === "object" && !Array.isArray(properties)
        ? properties
        : undefined;
    const addGraphic = (layerType: LayerType, geom: any) => {
      const graphic = config.createGraphicForType(layerType, geom, attributes);
      graphics.push(graphic);
    };
    let layerType: LayerType | null = null;

    const addPoint = (point: number[]) => {
      if (!Array.isArray(point) || point.length < 2) return;
      const sr = isLikelyWebMercator(point) ? { wkid: 3857 } : { wkid: 4326 };
      let geom = new Point({ x: point[0], y: point[1], spatialReference: sr });
      geom = normalizeGeometry(geom, sr);
      addGraphic("point", geom);
    };

    const addLine = (path: number[][]) => {
      if (!Array.isArray(path) || path.length === 0) return;
      const first = path?.[0] ?? [0, 0];
      const sr = isLikelyWebMercator(first) ? { wkid: 3857 } : { wkid: 4326 };
      let geom = new Polyline({ paths: [path], spatialReference: sr });
      geom = normalizeGeometry(geom, sr);
      addGraphic("polyline", geom);
    };

    const addPolygon = (rings: number[][][]) => {
      if (!Array.isArray(rings) || rings.length === 0) return;
      const first = rings?.[0]?.[0] ?? [0, 0];
      const sr = isLikelyWebMercator(first) ? { wkid: 3857 } : { wkid: 4326 };
      let geom = new Polygon({ rings, spatialReference: sr });
      geom = normalizeGeometry(geom, sr);
      addGraphic("polygon", geom);
    };

    if (type === "Point") {
      layerType = "point";
      addPoint(coords);
    } else if (type === "MultiPoint" && Array.isArray(coords)) {
      layerType = "point";
      coords.forEach((point: number[]) => {
        addPoint(point);
      });
    } else if (type === "LineString") {
      layerType = "polyline";
      addLine(coords);
    } else if (type === "MultiLineString" && Array.isArray(coords)) {
      layerType = "polyline";
      coords.forEach((path: number[][]) => {
        addLine(path);
      });
    } else if (type === "Polygon") {
      layerType = "polygon";
      addPolygon(coords);
    } else if (type === "MultiPolygon" && Array.isArray(coords)) {
      layerType = "polygon";
      coords.forEach((rings: number[][][]) => {
        addPolygon(rings);
      });
    }

    if (!layerType || graphics.length === 0) {
      return null;
    }

    return {
      type: layerType,
      graphics
    };
  };

  const featureImports: GeoJsonFeatureImport[] = [];
  const pushFeatureImport = (geometry: any, properties?: Record<string, any>) => {
    const featureImport = createFeatureImport(geometry, properties);
    if (featureImport) {
      featureImports.push(featureImport);
    }
  };

  if (data.type === "FeatureCollection") {
    if (Array.isArray(data.features)) {
      data.features.forEach((feature: any) => {
        pushFeatureImport(feature?.geometry, feature?.properties);
      });
    }
  } else if (data.type === "Feature") {
    pushFeatureImport(data.geometry, data.properties);
  } else {
    pushFeatureImport(data);
  }

  if (featureImports.length === 0) {
    alert("No supported geometry found in this GeoJSON.");
    return;
  }

  const createdLayers: LayerData[] = [];
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  let importMode: GeoJsonImportMode = "combined";
  if (data.type === "FeatureCollection" && featureImports.length > 1 && config.chooseGeoJsonImportMode) {
    const typeCounts = featureImports.reduce<Partial<Record<LayerType, number>>>((counts, featureImport) => {
      counts[featureImport.type] = (counts[featureImport.type] ?? 0) + 1;
      return counts;
    }, {});
    const choice = await Promise.resolve(
      config.chooseGeoJsonImportMode({
        fileName,
        supportedFeatureCount: featureImports.length,
        typeCounts
      })
    );
    if (!choice) {
      return;
    }
    importMode = choice;
  }

  if (importMode === "split") {
    const featureTypeCounts: Partial<Record<LayerType, number>> = {};
    featureImports.forEach((featureImport) => {
      featureTypeCounts[featureImport.type] = (featureTypeCounts[featureImport.type] ?? 0) + 1;
      const ordinal = featureTypeCounts[featureImport.type];
      const layerName =
        featureImport.type === "point"
          ? `${baseName} Point ${ordinal}`
          : featureImport.type === "polyline"
            ? `${baseName} Line ${ordinal}`
            : featureImport.type === "polygon"
              ? `${baseName} Polygon ${ordinal}`
              : `${baseName} ${featureImport.type} ${ordinal}`;
      const layerData = config.createImportedLayer(featureImport.type, layerName, featureImport.graphics);
      if (layerData) {
        createdLayers.push(layerData);
      }
    });
  } else {
    const graphicsByType: Record<LayerType, Graphic[]> = {
      point: [],
      polyline: [],
      polygon: [],
      text: [],
      feature: [],
      volume: []
    };
    featureImports.forEach((featureImport) => {
      graphicsByType[featureImport.type].push(...featureImport.graphics);
    });

    if (graphicsByType.point.length) {
      const layerData = config.createImportedLayer("point", `${baseName} Points`, graphicsByType.point);
      if (layerData) createdLayers.push(layerData);
    }
    if (graphicsByType.polyline.length) {
      const layerData = config.createImportedLayer("polyline", `${baseName} Lines`, graphicsByType.polyline);
      if (layerData) createdLayers.push(layerData);
    }
    if (graphicsByType.polygon.length) {
      const layerData = config.createImportedLayer("polygon", `${baseName} Polygons`, graphicsByType.polygon);
      if (layerData) createdLayers.push(layerData);
    }
  }
  config.zoomToLayers(createdLayers);
};

const findFirstIndex = (values: string[], keys: string[]) => {
  return values.findIndex((value) => keys.includes(value));
};

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
};

const parseCsv = (content: string) => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map(parseCsvLine);
};

const importCsv = (config: ImportConfig, fileName: string, content: string) => {
  const view = config.getView();
  if (!view) return;
  const rows = parseCsv(content);
  if (rows.length < 2) {
    alert("CSV needs a header row and at least one data row.");
    return;
  }

  const header = rows[0].map((value) => value.trim());
  const lower = header.map((value) => value.trim().toLowerCase());
  const latIndex = findFirstIndex(lower, ["lat", "latitude", "y"]);
  const lonIndex = findFirstIndex(lower, ["lon", "lng", "long", "longitude", "x"]);
  if (latIndex === -1 || lonIndex === -1) {
    alert("CSV must include latitude/longitude or x/y columns.");
    return;
  }

  const graphics: Graphic[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const lat = Number(row[latIndex]);
    const lon = Number(row[lonIndex]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const attributes: Record<string, any> = {};
    header.forEach((key, index) => {
      attributes[key] = row[index];
    });

    const looksLikeLatLon = Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const spatialReference = looksLikeLatLon ? { wkid: 4326 } : view.spatialReference;
    const point = new Point({ x: lon, y: lat, spatialReference });
    graphics.push(config.createGraphicForType("point", point, attributes));
  }

  if (!graphics.length) {
    alert("No valid point rows found in the CSV.");
    return;
  }

  const baseName = fileName.replace(/\.[^/.]+$/, "");
  config.createImportedLayer("point", `${baseName} Points`, graphics);
};

export type { GeoJsonImportChoiceRequest, GeoJsonImportMode, ImportConfig };
export { importCsv, importGeoJson };
