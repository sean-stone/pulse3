import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import type Graphic from "@arcgis/core/Graphic";

import type { LayerData, LayerType } from "../types";


type ImportConfig = {
  getView: () => any;
  createGraphicForType: (type: LayerType, geometry: any, attributes?: Record<string, any>) => Graphic;
  createImportedLayer: (type: LayerType, name: string, graphics: Graphic[]) => LayerData | null;
  zoomToLayers: (layers: LayerData[]) => void;
};

const importGeoJson = (config: ImportConfig, fileName: string, content: string) => {
  const view = config.getView();
  if (!view) return;
  let data: any;
  try {
    data = JSON.parse(content);
  } catch (error) {
    alert("Unable to read GeoJSON.");
    return;
  }

  const graphicsByType: Record<LayerType, Graphic[]> = {
    point: [],
    polyline: [],
    polygon: [],
    text: [],
    feature: []
  };

  const pushGeometry = (geometry: any, properties?: Record<string, any>) => {
    if (!geometry) return;
    const type = geometry.type;
    const coords = geometry.coordinates;
    const spatialReference = { wkid: 4326 };
    const addGraphic = (layerType: LayerType, geom: any) => {
      const graphic = config.createGraphicForType(layerType, geom, properties);
      graphicsByType[layerType].push(graphic);
    };

    if (type === "Point") {
      addGraphic("point", new Point({ x: coords[0], y: coords[1], spatialReference }));
    } else if (type === "MultiPoint") {
      coords.forEach((point: number[]) => {
        addGraphic("point", new Point({ x: point[0], y: point[1], spatialReference }));
      });
    } else if (type === "LineString") {
      addGraphic("polyline", new Polyline({ paths: [coords], spatialReference }));
    } else if (type === "MultiLineString") {
      coords.forEach((path: number[][]) => {
        addGraphic("polyline", new Polyline({ paths: [path], spatialReference }));
      });
    } else if (type === "Polygon") {
      addGraphic("polygon", new Polygon({ rings: coords, spatialReference }));
    } else if (type === "MultiPolygon") {
      coords.forEach((rings: number[][][]) => {
        addGraphic("polygon", new Polygon({ rings, spatialReference }));
      });
    }
  };

  if (data.type === "FeatureCollection") {
    data.features?.forEach((feature: any) => {
      pushGeometry(feature.geometry, feature.properties);
    });
  } else if (data.type === "Feature") {
    pushGeometry(data.geometry, data.properties);
  } else {
    pushGeometry(data);
  }

  const createdLayers: LayerData[] = [];
  const baseName = fileName.replace(/\.[^/.]+$/, "");
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

  if (
    graphicsByType.point.length === 0 &&
    graphicsByType.polyline.length === 0 &&
    graphicsByType.polygon.length === 0
  ) {
    alert("No supported geometry found in this GeoJSON.");
    return;
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

export type { ImportConfig };
export { importCsv, importGeoJson };
