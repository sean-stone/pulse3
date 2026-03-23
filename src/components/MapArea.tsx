function MapArea() {
  return (
    <div id="map-container" data-testid="map-container">
      <div id="draw-info-box" className="draw-info-box map-draw-info" role="note">
        Click on the map to draw. Double-click to finish.
      </div>
      <div id="map-action-buttons">
        <calcite-button
          id="delete-layer-btn"
          icon-start="trash"
          scale="s"
          appearance="solid"
          kind="danger"
          style={{
            "--calcite-button-text-color": "#ffffff",
            "--calcite-button-icon-color": "#ffffff",
          }}
        >
          Delete
        </calcite-button>
      </div>
      <div id="basemap-widget" aria-label="Basemap widget"></div>
      <calcite-button
        id="play-button"
        icon-start="play"
        scale="l"
        appearance="solid"
        kind="brand"
        style={{
          "--calcite-button-text-color": "#ffffff",
          "--calcite-button-icon-color": "#ffffff",
        }}
      >
        Play from start
      </calcite-button>

      <div id="map-context-menu" className="map-context-menu" role="menu" aria-hidden="true">
        <div id="map-context-menu-title" className="map-context-menu__header">
          Map
        </div>
        <div id="map-context-menu-items" className="map-context-menu__items"></div>
      </div>

      <div id="map-wrapper" className="no-shadow">
        <arcgis-map
          id="arcgisMap"
          className="map-view-host"
          basemap="gray-vector"
          center="-0.1276, 51.5074"
          zoom="11"
        >
          <arcgis-compass id="map-compass" slot="top-left"></arcgis-compass>
        </arcgis-map>
        <arcgis-scene
          id="arcgisScene"
          className="map-view-host"
          basemap="gray-vector"
          center="-0.1276, 51.5074"
          zoom="11"
          quality-profile="high"
          hidden
          aria-hidden="true"
        >
          <arcgis-compass id="scene-compass" slot="top-left"></arcgis-compass>
          <arcgis-expand
            id="scene-daylight-expand"
            slot="top-left"
            expand-icon="brightness"
            expand-tooltip="Daylight"
            collapse-tooltip="Hide daylight"
          >
            <arcgis-daylight
              id="scene-daylight"
              date-or-season="date"
              hide-timezone
              play-speed-multiplier="2"
              time-slider-position="600"
            ></arcgis-daylight>
            <arcgis-weather id="scene-weather"></arcgis-weather>
          </arcgis-expand>
        </arcgis-scene>
      </div>
    </div>
  );
}

export default MapArea;
