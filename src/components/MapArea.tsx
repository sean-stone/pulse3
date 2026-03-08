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
            id="scene-camera-studio-expand"
            slot="top-left"
            expand-icon="camera"
            expand-tooltip="3D Camera Studio"
            collapse-tooltip="Hide 3D Camera Studio"
          >
            <div id="scene-camera-studio-panel" className="scene-camera-studio-panel">
              <div className="scene-camera-studio-heading">3D Camera Studio</div>
              <calcite-label className="scene-camera-studio-control">
                Camera field of view
                <calcite-slider
                  id="scene-camera-fov"
                  min="20"
                  max="120"
                  step="1"
                  value="55"
                  min-label="20deg"
                  max-label="120deg"
                ></calcite-slider>
                <span id="scene-camera-fov-value" className="scene-camera-studio-readout">
                  55deg
                </span>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                WebScene quality
                <calcite-select id="scene-quality-profile" value="high">
                  <calcite-option value="low">Low</calcite-option>
                  <calcite-option value="medium">Medium</calcite-option>
                  <calcite-option value="high">High</calcite-option>
                </calcite-select>
              </calcite-label>
              <calcite-label className="scene-camera-studio-toggle">
                Glow
                <calcite-switch id="scene-glow-enabled" scale="s" checked></calcite-switch>
              </calcite-label>
              <calcite-label className="scene-camera-studio-toggle">
                Cinematic FX
                <calcite-switch id="scene-camera-fx-enabled" scale="s"></calcite-switch>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                Noise
                <calcite-slider
                  id="scene-camera-fx-noise"
                  min="0"
                  max="100"
                  step="1"
                  value="42"
                  min-label="0%"
                  max-label="100%"
                ></calcite-slider>
                <span id="scene-camera-fx-noise-value" className="scene-camera-studio-readout">
                  42%
                </span>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                Scanlines
                <calcite-slider
                  id="scene-camera-fx-scanline"
                  min="0"
                  max="100"
                  step="1"
                  value="38"
                  min-label="0%"
                  max-label="100%"
                ></calcite-slider>
                <span id="scene-camera-fx-scanline-value" className="scene-camera-studio-readout">
                  38%
                </span>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                Vignette
                <calcite-slider
                  id="scene-camera-fx-vignette"
                  min="0"
                  max="100"
                  step="1"
                  value="44"
                  min-label="0%"
                  max-label="100%"
                ></calcite-slider>
                <span id="scene-camera-fx-vignette-value" className="scene-camera-studio-readout">
                  44%
                </span>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                Jitter
                <calcite-slider
                  id="scene-camera-fx-jitter"
                  min="0"
                  max="12"
                  step="0.1"
                  value="2.5"
                  min-label="0px"
                  max-label="12px"
                ></calcite-slider>
                <span id="scene-camera-fx-jitter-value" className="scene-camera-studio-readout">
                  2.5 px
                </span>
              </calcite-label>
              <calcite-label className="scene-camera-studio-control">
                Chromatic shift
                <calcite-slider
                  id="scene-camera-fx-chromatic"
                  min="0"
                  max="12"
                  step="0.1"
                  value="2.2"
                  min-label="0px"
                  max-label="12px"
                ></calcite-slider>
                <span id="scene-camera-fx-chromatic-value" className="scene-camera-studio-readout">
                  2.2 px
                </span>
              </calcite-label>
            </div>
          </arcgis-expand>
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
          </arcgis-expand>
        </arcgis-scene>
      </div>
    </div>
  );
}

export default MapArea;
