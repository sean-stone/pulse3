# Agent Instructions

- Do not scan or index `node_modules/`.
- Do not scan or index `dist/`.
- Do not scan or index `assets/esri/`.
- Do not scan or index `public/assets/esri/`.
- Do not scan or index `public/assets/**/calcite*`.
- Do not scan or index `test-results/`.
- Do not scan or index `*.tsbuildinfo`.

## Local storage JSON schema (Project Snapshot)

Pulse stores project data as JSON strings in local/session storage. The payloads below must remain backward compatible.

### Storage keys
- `pulse.project.local` (localStorage): `ProjectSnapshot` JSON string.
- `pulse.project.session` (sessionStorage): `ProjectSnapshot` JSON string.
- `pulse.project.recents` (localStorage): JSON array of `RecentProject`.
- `pulse.project.name` (localStorage): string.
- `pulse.storage.consent` (localStorage): `"granted"` or `"denied"`.

### ProjectSnapshot (GeoJSON FeatureCollection)
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "...", "coordinates": "..." },
      "properties": {
        "_pulse": { "layerId": "layer-0" },
        "...": "feature attributes copied from ArcGIS graphics"
      }
    }
  ],
  "properties": {
    "_pulse": {
      "version": 1,
      "savedAt": "2026-01-26T11:00:00.000Z",
      "projectName": "My Project",
      "spatialReference": { "wkid": 102100 },
      "app": {
        "layout": "default",
        "customWidth": 1920,
        "customHeight": 1080,
        "isRotated": false,
        "basemap": "gray-vector",
        "basemapVisible": true,
        "extent": { "xmin": 0, "ymin": 0, "xmax": 1, "ymax": 1, "wkid": 102100 }
      },
      "timeline": {
        "durationOverride": 12.5
      },
      "layers": [
        {
          "id": "layer-0",
          "name": "Layer",
          "type": "point",
          "animations": [{ "type": "fade", "duration": 2, "start": 0 }],
          "pointKeyframes": [{ "time": 0, "x": 0, "y": 0, "spatialReference": {} }],
          "pointStyle": {
            "style": "map-pin",
            "size": 20,
            "color": "#0a4c66",
            "outlineColor": "#ffffff",
            "outlineWidth": 2,
            "angle": 0,
            "xoffset": 0,
            "yoffset": 10
          },
          "lineStyle": { "style": "arrow-end", "width": 3, "color": "#0a4c66" },
          "polygonStyle": {
            "style": "solid",
            "color": "#7ac7b0",
            "outlineColor": "#0a4c66",
            "outlineWidth": 2,
            "outlineStyle": "solid"
          },
          "textContent": "Label",
          "textSize": 14,
          "textColor": "#22323a",
          "featureLayerUrl": "https://.../FeatureServer/0",
          "featureFields": [{ "name": "FIELD", "type": "string" }],
          "featureField": "FIELD",
          "featureFieldType": "string",
          "featureFieldStats": { "min": 0, "max": 100 },
          "featureVisualVariable": "size",
          "featureHideNulls": false,
          "featureKeepVisible": true,
          "layerBlendMode": "normal",
          "layerEffectSettings": {
            "brightness": 100,
            "contrast": 100,
            "grayscale": 0,
            "hueRotate": 0,
            "invert": 0,
            "opacity": 1,
            "saturate": 1,
            "sepia": 0,
            "blur": 0,
            "dropShadowOffsetX": 0,
            "dropShadowOffsetY": 0,
            "dropShadowBlur": 0,
            "dropShadowColor": "#000000"
          },
          "layerEffectsEnabled": true
        }
      ]
    }
  }
}
```

### Field notes (non-exhaustive)
- `features[].geometry` is GeoJSON; types vary by layer (point/polyline/polygon/text). Text layers use point geometry for placement and render text via `textContent/textStyle`.
- `features[].properties._pulse.layerId` must match a `layers[].id` entry.
- `properties._pulse.spatialReference.wkid` may be omitted; when omitted, the current view spatial reference is assumed.
- `properties._pulse.app.extent` is optional; when absent, no view extent is restored.
- `properties._pulse.layers[].featureLayerUrl` and related `feature*` fields are only present for `type: "feature"` layers.
- Style fields (`pointStyle`, `lineStyle`, `polygonStyle`) may be omitted and will fall back to defaults on load.

### RecentProject
```json
{
  "id": "2026-01-26T11:00:00.000Z-My Project",
  "name": "My Project",
  "savedAt": "2026-01-26T11:00:00.000Z",
  "snapshot": { "type": "FeatureCollection", "features": [], "properties": { "_pulse": {} } }
}
```

### Backward compatibility rules
- Do not remove or rename existing fields.
- Add new fields as optional and provide safe defaults when missing.
- Only increment `_pulse.version` when a migration is required; loaders must accept older versions.
- Preserve `features[].properties._pulse.layerId` and `layers[].id` mapping semantics.
- Ignore unknown fields to allow forward compatibility.
