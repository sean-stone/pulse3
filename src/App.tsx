import { useEffect } from "react";

import { bootApp } from "./appController";
import { APP_VERSION } from "./app/constants";
import MapArea from "./components/MapArea";
import SidePanel from "./components/SidePanel";
import Timeline from "./components/Timeline";

export default function App() {
  useEffect(() => {
    bootApp();
  }, []);

  return (
    <>
      <div id="map-loading-overlay" aria-live="polite" aria-busy="true">
        <div className="map-loading-swarm" aria-hidden="true">
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
          <span className="map-loading-dot"></span>
        </div>
        <div className="map-loading-pin" role="img" aria-label="Loading">
          <span className="map-loading-pin-dot" aria-hidden="true"></span>
        </div>
      </div>
      <div
        id="orientation-overlay"
        className="orientation-overlay"
        role="dialog"
        aria-live="polite"
        aria-hidden="true"
      >
        <div className="orientation-card">
          <div className="orientation-icon" aria-hidden="true">
            <calcite-icon icon="rotate" scale="l"></calcite-icon>
          </div>
          <div className="orientation-title">Rotate your device</div>
          <div className="orientation-text">
            Pulse works best in landscape. Please rotate your phone or make the window wider.
          </div>
        </div>
      </div>
        <div id="app-container">
          <div id="app-topbars" aria-label="Application menus">
          <div id="menu-bar" role="menubar">
            <div className="menu-bar-left">
              <calcite-button
                id="menu-new-project-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="file"
              >
                New Project
              </calcite-button>
              <calcite-button
                id="menu-open-project-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="folder-open"
              >
                Open Project File
              </calcite-button>
              <calcite-button
                id="menu-save-as-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="export"
              >
                Export Project File
              </calcite-button>
              <calcite-button
                id="menu-auto-save-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="save"
              >
                Auto Save
              </calcite-button>
              <span
                id="project-status"
                className="project-status-badge menu-status-badge"
                role="status"
                aria-live="polite"
                aria-label="Saved"
                title="Saved"
              >
                <span className="project-status-icon" aria-hidden="true"></span>
                <span className="project-status-text" data-status-text>
                  Saved
                </span>
                <span
                  id="project-status-warning"
                  className="project-status-warning"
                  role="img"
                  aria-label="Storage full. Export to GeoJSON to save."
                  title="Storage full. Export to GeoJSON to save."
                  hidden
                >
                  <calcite-icon icon="exclamation-mark-triangle" scale="s"></calcite-icon>
                </span>
              </span>
              <span className="menu-divider" aria-hidden="true"></span>
              <calcite-button
                id="keyboard-shortcuts-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="keyboard"
              >
                Keyboard Shortcuts
              </calcite-button>
            </div>
            <div className="menu-bar-title">Pulse {APP_VERSION}</div>
            <div className="menu-bar-right">
              <calcite-button
                id="about-pulse-btn"
                className="menu-button"
                scale="s"
                appearance="transparent"
                icon-start="information"
              >
                About Pulse
              </calcite-button>
              <a
                className="panel-github-link topbar-github-link"
                href="https://github.com/sean-stone/pulse3"
                target="_blank"
                rel="noreferrer"
                aria-label={`Pulse ${APP_VERSION} on GitHub`}
                title="View on GitHub"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1.5c-5.8 0-10.5 4.7-10.5 10.5 0 4.6 3 8.5 7.1 9.9.5.1.7-.2.7-.5v-2.1c-2.9.6-3.5-1.2-3.5-1.2-.5-1.1-1.2-1.4-1.2-1.4-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 .1 1.6.7 1.9 1.2.1-.8.4-1.4.7-1.7-2.3-.2-4.6-1.1-4.6-5.1 0-1.1.4-2 1.1-2.8-.1-.2-.5-1.3.1-2.7 0 0 .9-.3 2.8 1.1.8-.2 1.7-.3 2.6-.3s1.8.1 2.6.3c1.9-1.4 2.8-1.1 2.8-1.1.6 1.4.2 2.5.1 2.7.7.7 1.1 1.7 1.1 2.8 0 4-2.3 4.9-4.6 5.1.4.3.8 1 .8 2v3c0 .3.2.6.7.5 4.2-1.4 7.1-5.3 7.1-9.9 0-5.8-4.7-10.5-10.5-10.5z" />
                </svg>
              </a>
            </div>
          </div>
          <div id="toolbar-bar" role="toolbar" aria-label="Quick tools">
            <div className="toolbar-left">
              <div className="toolbar-group" id="draw-toolbar-group">
                <span className="toolbar-label">Draw</span>
                <calcite-action-bar
                  layout="horizontal"
                  scale="s"
                  className="draw-action-bar"
                  expanded
                >
                  <calcite-action
                    id="add-point-btn"
                    data-testid="add-point-btn"
                    icon="pin"
                    text="Point"
                    scale="s"
                  ></calcite-action>
                  <calcite-action id="add-line-btn" icon="line" text="Line" scale="s"></calcite-action>
                  <calcite-action
                    id="add-polygon-btn"
                    icon="polygon"
                    text="Polygon"
                    scale="s"
                  ></calcite-action>
                  <calcite-action
                    id="add-text-btn"
                    icon="text-large"
                    text="Annotation"
                    scale="s"
                  ></calcite-action>
                  <calcite-action
                    id="import-toggle-btn"
                    icon="ellipsis"
                    text="More"
                    scale="s"
                  ></calcite-action>
                </calcite-action-bar>
                <calcite-popover reference-element="import-toggle-btn" placement="bottom-start" auto-close>
                  <div id="layer-import-advanced" className="import-advanced show">
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
                </calcite-popover>
                <input id="import-file-input" type="file" style={{ display: "none" }} />
              </div>
              <span className="toolbar-divider" aria-hidden="true"></span>
                <div className="toolbar-group">
                  <span className="toolbar-label">Basemap</span>
                  <calcite-select id="basemap-select" scale="s">
                  <calcite-option value="gray-vector">Gray</calcite-option>
                  <calcite-option value="streets-vector">Streets</calcite-option>
                  <calcite-option value="streets-navigation-vector">Streets Navigation</calcite-option>
                  <calcite-option value="streets-night-vector">Streets Night</calcite-option>
                  <calcite-option value="streets-relief-vector">Streets Relief</calcite-option>
                  <calcite-option value="topo-vector">Topographic</calcite-option>
                  <calcite-option value="satellite">Satellite</calcite-option>
                  <calcite-option value="hybrid">Hybrid</calcite-option>
                  <calcite-option value="terrain">Terrain</calcite-option>
                  <calcite-option value="oceans">Oceans</calcite-option>
                  <calcite-option value="dark-gray-vector">Dark Gray</calcite-option>
                  <calcite-option value="osm">OpenStreetMap</calcite-option>
                    <calcite-option value="none">None</calcite-option>
                  </calcite-select>
                </div>
                <div
                  id="basemap-bg-picker"
                  className="toolbar-group basemap-bg-picker"
                  hidden
                  aria-hidden="true"
                >
                  <span className="toolbar-label">Background</span>
                  <input
                    id="basemap-bg-color"
                    type="color"
                    defaultValue="#ffffff"
                    aria-label="Basemap background color"
                  />
                  <label className="basemap-bg-transparent">
                    <calcite-switch id="basemap-bg-transparent" scale="s"></calcite-switch>
                    <span>Transparent</span>
                  </label>
                </div>
              </div>
            <div className="toolbar-right">
              <calcite-button
                id="rotation-button"
                icon-start="rotate"
                scale="s"
                appearance="outline"
                aria-label="Rotate map"
                title="Rotate map"
              ></calcite-button>
              <calcite-button
                id="ai-ask-btn"
                scale="s"
                appearance="solid"
                className="panel-ai-btn"
                icon-start="automation"
              >
                AI Animation Agent
              </calcite-button>
            </div>
          </div>
        </div>
        <div id="mobile-header" aria-label="Mobile tools"></div>
        <input id="project-file-input" type="file" style={{ display: "none" }} />
        <div id="app-content">
          <div id="main-area">
            <div id="mobile-animation-suggestions" aria-live="polite"></div>
            <MapArea />
            <div id="timeline-resizer" data-testid="timeline-resizer"></div>
            <Timeline />
          </div>
          <SidePanel />
        </div>
      </div>
    </>
  );
}
