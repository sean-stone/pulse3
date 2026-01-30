function MapArea() {
  return (
    <div id="map-container" data-testid="map-container">
      <div id="map-action-buttons">
        <calcite-button
          id="new-project-map-btn"
          icon-start="file"
          scale="s"
          appearance="outline"
          kind="brand"
        >
          New project
        </calcite-button>
        <calcite-button
          id="delete-layer-btn"
          icon-start="trash"
          scale="s"
          appearance="solid"
          kind="danger"
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
      >
        Play from start
      </calcite-button>

      <div id="map-wrapper" className="no-shadow">
        <arcgis-map
          id="arcgisMap"
          basemap="gray-vector"
          center="-0.1276, 51.5074"
          zoom="11"
        ></arcgis-map>
      </div>
    </div>
  );
}

export default MapArea;
