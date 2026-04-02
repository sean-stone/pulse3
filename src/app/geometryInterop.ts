import Multipoint from "@arcgis/core/geometry/Multipoint";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

import type { LayerData } from "../types";

import type { ViewMode } from "./bootstrap";

type SpatialReferenceLike = {
  isWebMercator?: boolean;
  isGeographic?: boolean;
  wkid?: number;
};

type ArcgisGeometryLike = {
  type?: string;
  x?: number;
  y?: number;
  points?: unknown[];
  paths?: unknown[];
  rings?: unknown[];
  isMultipart?: boolean;
  spatialReference?: SpatialReferenceLike;
};

type GeoJsonGeometryLike = {
  type?: string;
  coordinates?: unknown;
};

const arcgisGeometryToGeoJSON = (geometry: unknown) => {
  if (!geometry || typeof geometry !== "object") return null;
  let sourceGeometry = geometry as ArcgisGeometryLike;
  if (sourceGeometry.spatialReference?.isWebMercator) {
    sourceGeometry = webMercatorUtils.webMercatorToGeographic(sourceGeometry as any) as ArcgisGeometryLike;
  }
  if (sourceGeometry.type === "point") {
    const z = Number((sourceGeometry as any).z);
    return {
      type: "Point",
      coordinates: Number.isFinite(z) ? [sourceGeometry.x, sourceGeometry.y, z] : [sourceGeometry.x, sourceGeometry.y]
    };
  }
  if (sourceGeometry.type === "multipoint") {
    return { type: "MultiPoint", coordinates: sourceGeometry.points ?? [] };
  }
  if (sourceGeometry.type === "polyline") {
    const paths = Array.isArray(sourceGeometry.paths) ? sourceGeometry.paths : [];
    if (paths.length === 1) {
      return { type: "LineString", coordinates: paths[0] };
    }
    return { type: "MultiLineString", coordinates: paths };
  }
  if (sourceGeometry.type === "polygon") {
    const rings = Array.isArray(sourceGeometry.rings) ? sourceGeometry.rings : [];
    if (sourceGeometry.isMultipart && rings.length > 1) {
      return { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
    }
    return { type: "Polygon", coordinates: rings };
  }
  return null;
};

const toGeographicGeometry = (geometry: unknown) => {
  if (!geometry || typeof geometry !== "object") return geometry;
  const spatialRef = (geometry as ArcgisGeometryLike).spatialReference;
  if (spatialRef?.isGeographic || spatialRef?.wkid === 4326) {
    return geometry;
  }
  if (spatialRef?.isWebMercator) {
    return webMercatorUtils.webMercatorToGeographic(geometry as any) ?? geometry;
  }
  return geometry;
};

const toViewGeometry = (geometry: unknown, viewSpatialReference: SpatialReferenceLike | null | undefined) => {
  if (!geometry || !viewSpatialReference || typeof geometry !== "object") return geometry;
  const spatialRef = (geometry as ArcgisGeometryLike).spatialReference;
  if (!spatialRef) return geometry;

  if (viewSpatialReference.isWebMercator && (spatialRef.isGeographic || spatialRef.wkid === 4326)) {
    return webMercatorUtils.geographicToWebMercator(geometry as any) ?? geometry;
  }
  if ((viewSpatialReference.isGeographic || viewSpatialReference.wkid === 4326) && spatialRef.isWebMercator) {
    return webMercatorUtils.webMercatorToGeographic(geometry as any) ?? geometry;
  }
  return geometry;
};

const ensurePolylineGeometryHasZ = (geometry: unknown) => {
  if (!geometry || typeof geometry !== "object") return geometry;
  const geometryLike = geometry as ArcgisGeometryLike;
  if (geometryLike.type !== "polyline") return geometry;
  const rawPaths = Array.isArray(geometryLike.paths) ? geometryLike.paths : [];
  const paths = rawPaths.map((path) => {
    if (!Array.isArray(path)) return path;
    return path.map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return coord;
      const x = Number(coord[0]);
      const y = Number(coord[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return coord;
      const z = Number(coord[2]);
      return [x, y, Number.isFinite(z) ? z : 0];
    });
  });
  return new Polyline({
    paths: paths as any,
    spatialReference: geometryLike.spatialReference,
    hasZ: true
  });
};

const prepareLayerGeometryForSketch = (
  layerData: LayerData,
  options: {
    currentViewMode: ViewMode;
    viewSpatialReference: SpatialReferenceLike | null | undefined;
  }
) => {
  layerData.layer.graphics.forEach((graphic: { geometry?: unknown }) => {
    if (!graphic?.geometry) return;
    let prepared = toViewGeometry(graphic.geometry, options.viewSpatialReference);
    if (options.currentViewMode === "3d" && layerData.type === "polyline") {
      prepared = ensurePolylineGeometryHasZ(prepared);
    }
    if (prepared) {
      graphic.geometry = prepared;
    }
  });
};

const geoJSONToArcGISGeometry = (geometry: unknown, spatialReference: unknown) => {
  if (!geometry || typeof geometry !== "object") return null;
  const geo = geometry as GeoJsonGeometryLike;
  if (geo.type === "Point") {
    const coordinates = Array.isArray(geo.coordinates) ? geo.coordinates : [];
    const [x, y, z] = coordinates;
    return new Point({
      x,
      y,
      z: Number.isFinite(Number(z)) ? Number(z) : undefined,
      spatialReference: spatialReference as any
    });
  }
  if (geo.type === "MultiPoint") {
    return new Multipoint({
      points: (Array.isArray(geo.coordinates) ? geo.coordinates : []) as any,
      spatialReference: spatialReference as any
    });
  }
  if (geo.type === "LineString") {
    return new Polyline({
      paths: [Array.isArray(geo.coordinates) ? geo.coordinates : []] as any,
      spatialReference: spatialReference as any
    });
  }
  if (geo.type === "MultiLineString") {
    return new Polyline({
      paths: (Array.isArray(geo.coordinates) ? geo.coordinates : []) as any,
      spatialReference: spatialReference as any
    });
  }
  if (geo.type === "Polygon") {
    return new Polygon({
      rings: (Array.isArray(geo.coordinates) ? geo.coordinates : []) as any,
      spatialReference: spatialReference as any
    });
  }
  if (geo.type === "MultiPolygon") {
    const rings = (Array.isArray(geo.coordinates) ? geo.coordinates : []).flat();
    return new Polygon({
      rings: rings as any,
      spatialReference: spatialReference as any
    });
  }
  return null;
};

export {
  arcgisGeometryToGeoJSON,
  ensurePolylineGeometryHasZ,
  geoJSONToArcGISGeometry,
  prepareLayerGeometryForSketch,
  toGeographicGeometry,
  toViewGeometry
};
