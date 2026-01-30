import Modals from "./Modals";

function SidePanel() {
  return (
    <div id="side-panel" data-testid="side-panel">
      <Modals />
      <div id="panel-anchor"></div>

      <div id="primary-controls">
      </div>

      <div className="panel-section" data-testid="layers-accordion-item">
        <div id="draw-instructions" data-testid="draw-instructions">
          <p>Click on the map to draw. Double-click to finish.</p>
        </div>

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

      <div id="export-section">
        <calcite-label className="export-format-label">
          Export format
          <calcite-select id="export-format-select" scale="m">
            <calcite-option value="gif" selected>
              GIF (animated image)
            </calcite-option>
            <calcite-option value="webm">WebM (high quality)</calcite-option>
            <calcite-option value="png">PNG sequence (zip)</calcite-option>
            <calcite-option value="mp4">MP4 (ffmpeg.wasm)</calcite-option>
          </calcite-select>
        </calcite-label>
        <calcite-label className="gif-fps-label">
          Export FPS
          <calcite-input-number
            id="gif-fps-input"
            scale="s"
            min="1"
            max="60"
            step="1"
            value="30"
          ></calcite-input-number>
        </calcite-label>
        <calcite-label className="export-quality-label">
          Export quality
          <calcite-slider
            id="export-quality-slider"
            min="1"
            max="4"
            step="1"
            value="3"
            snap
            ticks
            label-handles
          ></calcite-slider>
          <div className="export-quality-scale">
            <span>Lowest</span>
            <span>Moderate</span>
            <span>High</span>
            <span>Best</span>
          </div>
        </calcite-label>
        <calcite-label className="export-resolution-label">
          Export resolution
          <calcite-select id="export-resolution-select" scale="m">
            <calcite-option value="default" selected>
              Default (current map resolution)
            </calcite-option>
            <calcite-option value="instagram">Instagram (1080 x 1080)</calcite-option>
            <calcite-option value="720p">720p (1280 x 720)</calcite-option>
            <calcite-option value="1080p">1080p (1920 x 1080)</calcite-option>
            <calcite-option value="4k">4K (3840 x 2160)</calcite-option>
            <calcite-option value="custom">Custom...</calcite-option>
          </calcite-select>
        </calcite-label>
        <div id="export-resolution-custom" className="export-resolution-custom">
          <div className="export-resolution-inputs">
            <calcite-label>
              Width (px)
              <calcite-input-number
                id="export-resolution-width"
                scale="s"
                min="1"
                max="8000"
                step="1"
                value="1000"
              ></calcite-input-number>
            </calcite-label>
            <calcite-label>
              Height (px)
              <calcite-input-number
                id="export-resolution-height"
                scale="s"
                min="1"
                max="8000"
                step="1"
                value="1000"
              ></calcite-input-number>
            </calcite-label>
          </div>
          <div className="export-resolution-note">
            Custom resolution overrides the current aspect ratio (examples: 1080 x 1080, 1920 x 1080).
          </div>
        </div>
        <calcite-button id="export-action-btn" icon-start="download" scale="m" width="full">
          Export
        </calcite-button>
        <div className="export-note">
          Best in Chrome or Edge. Long exports can be slow or large.
        </div>
        <div className="export-terms">
          You are responsible for complying with Esri and data source terms when sharing exports.
        </div>
        <div id="quote-text" style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 12 }}>
          Attribution required when sharing exports:
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
