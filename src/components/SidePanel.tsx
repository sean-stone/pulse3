import Modals from "./Modals";

function SidePanel() {
  return (
    <div id="side-panel" data-testid="side-panel">
      <Modals />
      <div id="panel-anchor"></div>

      <div id="primary-controls">
        <div className="panel-header" id="panel-header">
          <div className="panel-title">Pulse 3</div>
        </div>

        <div className="primary-action-bar">
          <div className="create-layer-buttons" id="create-layer-buttons">
            <calcite-button
              id="add-point-btn"
              data-testid="add-point-btn"
              icon-start="pin"
              scale="s"
              appearance="outline"
              className="layer-icon-btn"
              title="Add point"
              aria-label="Add point"
            >
              Point
            </calcite-button>
            <calcite-button
              id="add-line-btn"
              icon-start="line"
              scale="s"
              appearance="outline"
              className="layer-icon-btn"
              title="Add line"
              aria-label="Add line"
            >
              Line
            </calcite-button>
            <calcite-button
              id="add-polygon-btn"
              icon-start="polygon"
              scale="s"
              appearance="outline"
              className="layer-icon-btn"
              title="Add polygon"
              aria-label="Add polygon"
            >
              Polygon
            </calcite-button>
            <calcite-button
              id="add-text-btn"
              icon-start="text-large"
              scale="s"
              appearance="outline"
              className="layer-icon-btn"
              title="Add text"
              aria-label="Add text"
            >
              Text
            </calcite-button>
          </div>
        </div>
      </div>

      <div className="panel-section" data-testid="layers-accordion-item">
        <div id="draw-instructions" data-testid="draw-instructions">
          <p>Click on the map to draw. Double-click to finish.</p>
        </div>

        <button id="import-toggle-btn" className="link-button" type="button" aria-expanded="false">
          Show more
        </button>

        <div id="layer-import-advanced" className="import-advanced">
          <div className="import-layer-buttons">
            <calcite-button
              id="import-geojson-btn"
              icon-start="file-text"
              scale="s"
              appearance="outline"
              width="full"
            >
              GeoJSON
            </calcite-button>
            <calcite-button
              id="import-csv-btn"
              icon-start="table"
              scale="s"
              appearance="outline"
              width="full"
            >
              CSV
            </calcite-button>
          </div>

          <calcite-label style={{ marginTop: 12 }}>
            FeatureLayer URL
            <calcite-input
              id="feature-layer-url"
              placeholder="https://.../FeatureServer/0"
              scale="s"
            ></calcite-input>
          </calcite-label>
          <calcite-button
            id="add-feature-layer-btn"
            icon-start="plus"
            scale="s"
            appearance="outline"
            width="full"
            style={{ marginTop: 8 }}
          >
            Add FeatureLayer
          </calcite-button>
          <div id="feature-layer-error" className="form-error" role="status" aria-live="polite"></div>
        </div>

        <input id="import-file-input" type="file" style={{ display: "none" }} />
        <div id="layers-accordion" data-testid="layers-accordion"></div>

        <div id="animation-settings-stash" style={{ display: "none" }}>
          <div id="animation-settings-panel" className="animation-settings-panel">
            <calcite-label className="animation-type-row">
              Animation Type
              <div className="animation-type-inline">
                <div id="animation-type-options" className="animation-type-options"></div>
              </div>
            </calcite-label>

            <div id="feature-animation-settings" style={{ display: "none" }}>
              <calcite-label style={{ marginTop: 12 }}>
                Field to animate
                <calcite-select id="feature-field-select" scale="m"></calcite-select>
              </calcite-label>
              <calcite-label style={{ marginTop: 12 }}>
                Visual variable
                <calcite-select id="feature-visual-select" scale="m">
                  <calcite-option value="opacity">Opacity</calcite-option>
                  <calcite-option value="size">Size</calcite-option>
                  <calcite-option value="color">Color</calcite-option>
                </calcite-select>
              </calcite-label>
              <calcite-label style={{ marginTop: 12 }}>
                Hide null values
                <calcite-switch id="feature-hide-nulls"></calcite-switch>
              </calcite-label>
              <calcite-label style={{ marginTop: 12 }}>
                Fade out at end
                <calcite-switch id="feature-fade-out" checked></calcite-switch>
              </calcite-label>
              <calcite-button
                id="feature-style-btn"
                width="full"
                appearance="outline"
                icon-start="paint-bucket"
                style={{ marginTop: 12 }}
              >
                Feature Style
              </calcite-button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-section" id="basemap-section">
        <div className="panel-section-title">Basemap</div>
        <calcite-label>
          <calcite-select id="basemap-select" scale="m">
            <calcite-option value="gray-vector">Gray</calcite-option>
            <calcite-option value="streets-vector">Streets</calcite-option>
            <calcite-option value="topo-vector">Topographic</calcite-option>
            <calcite-option value="satellite">Satellite</calcite-option>
            <calcite-option value="dark-gray-vector">Dark Gray</calcite-option>
            <calcite-option value="osm">OpenStreetMap</calcite-option>
            <calcite-option value="none">None</calcite-option>
          </calcite-select>
        </calcite-label>
      </div>

      <div className="panel-section" id="layout-section">
        <div className="panel-section-title">Layout</div>
        <calcite-tabs bordered id="layout-tabs" layout="inline" position="top" scale="m">
          <calcite-tab-nav slot="title-group" role="tablist" bordered layout="inline">
            <calcite-tab-title selected data-layout="default">
              Default
            </calcite-tab-title>
            <calcite-tab-title data-layout="mobile">Mobile</calcite-tab-title>
            <calcite-tab-title data-layout="tablet">Tablet</calcite-tab-title>
            <calcite-tab-title data-layout="custom">Custom</calcite-tab-title>
          </calcite-tab-nav>
          <calcite-tab selected>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
              Default layout (full screen)
            </p>
          </calcite-tab>
          <calcite-tab>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
              Mobile: 9:16
            </p>
          </calcite-tab>
          <calcite-tab>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
              Tablet: 3:4
            </p>
          </calcite-tab>
          <calcite-tab>
            <calcite-label>
              Aspect Width
              <calcite-input-number
                id="custom-width"
                value="9"
                min="1"
                max="100"
                step="1"
                scale="s"
              ></calcite-input-number>
            </calcite-label>
            <calcite-label style={{ marginTop: 8 }}>
              Aspect Height
              <calcite-input-number
                id="custom-height"
                value="16"
                min="1"
                max="100"
                step="1"
                scale="s"
              ></calcite-input-number>
            </calcite-label>
          </calcite-tab>
        </calcite-tabs>
      </div>

      <div id="export-section">
        <calcite-button id="export-btn" icon-start="download" scale="m" width="full">
          Export as .mp4
        </calcite-button>
        <div id="export-error" className="export-error" role="status" aria-live="polite"></div>
        <div id="export-warning" className="export-warning" role="status" aria-live="polite"></div>
        <div className="export-note">
          Best in Chrome or Edge. Long exports can be slow or large.
        </div>
        <div className="export-terms">
          You are responsible for complying with Esri and data source terms when sharing exports.
        </div>
        <calcite-tooltip id="export-tooltip" reference-element="export-btn" placement="top">
          Add at least one animation to enable export.
        </calcite-tooltip>
        <div id="copy-card" style={{ display: "none", marginTop: 12 }}>
          <div id="quote-text" style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 8 }}>
            Attribution required when sharing exports:
          </div>
          <calcite-button id="download-btn" icon-start="download" scale="m" width="full">
            Download
          </calcite-button>
          <a id="download-link" style={{ display: "none" }}></a>
        </div>
      </div>
      <div className="export-lock-overlay" aria-hidden="true">
        <div className="export-lock-card">
          <svg
            className="export-lock-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7z" />
          </svg>
          <div className="export-lock-title">Exporting...</div>
          <div className="export-lock-subtitle">Side panel locked while rendering.</div>
        </div>
      </div>
    </div>
  );
}

export default SidePanel;
