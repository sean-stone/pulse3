import Modals from "./Modals";

type SidePanelProps = {
  themeMode: "light" | "dark";
};

function SidePanel({ themeMode }: SidePanelProps) {
  const whereButtonStyle =
    themeMode === "dark"
      ? ({
          "--calcite-button-text-color": "#ffffff",
          "--calcite-button-icon-color": "#ffffff",
        } as React.CSSProperties)
      : ({
          "--calcite-button-text-color": "#0a4c66",
          "--calcite-button-icon-color": "#0a4c66",
        } as React.CSSProperties);

  return (
    <div id="side-panel" data-testid="side-panel">
      <Modals />
      <div id="style-modal-anchor"></div>
      <div id="panel-anchor"></div>

      <div id="primary-controls">
      </div>

      <div className="panel-section" data-testid="onboarding-steps">
        <calcite-stepper layout="vertical" icon>
          <calcite-stepper-item
            id="onboarding-step-draw"
            icon
            heading="Get Started"
            selected
          >
            <p className="stepper-info">
              Welcome to Pulse! To get started, draw onto the map the features you want to animate.
            </p>
            <div className="stepper-action-row">
              <calcite-button
                id="onboarding-where-btn"
                scale="s"
                appearance="outline"
                style={whereButtonStyle}
              >
                Where?
              </calcite-button>
            </div>
          </calcite-stepper-item>
          <calcite-stepper-item
            id="onboarding-step-style"
            icon
            heading="Animations and Styles"
          >
            <calcite-accordion id="layers-accordion" data-testid="layers-accordion" selection-mode="single"></calcite-accordion>

            <div id="animation-settings-stash" style={{ display: "none" }}>
              <div id="animation-settings-panel" className="animation-settings-panel">
                <div id="animation-type-base-section" className="animation-type-row">
                  <div className="animation-type-inline">
                    <div id="animation-type-options" className="animation-type-options"></div>
                  </div>
                </div>
                <div id="webgl-animation-section" className="animation-type-row animation-type-webgl-section">
                  <div className="animation-type-header">
                    <span>WebGL animations</span>
                    <calcite-chip className="animation-beta-chip" scale="s" appearance="outline">
                      BETA
                    </calcite-chip>
                  </div>
                  <div className="animation-type-inline">
                    <div
                      id="animation-type-options-webgl"
                      className="animation-type-options"
                    ></div>
                  </div>
                </div>

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

                <div id="camera-animation-settings" style={{ display: "none" }}>
                  <calcite-label style={{ marginTop: 12 }}>
                    Camera blend mode
                    <calcite-select id="camera-keyframe-easing" scale="m">
                      <calcite-option value="linear">Linear</calcite-option>
                      <calcite-option value="ease-in">Ease In</calcite-option>
                      <calcite-option value="ease-out">Ease Out</calcite-option>
                      <calcite-option value="ease-in-out">Ease In/Out</calcite-option>
                    </calcite-select>
                  </calcite-label>
                  <div id="camera-layer-studio-settings" className="camera-layer-studio-settings">
                    <calcite-label className="scene-camera-studio-control">
                      Camera field of view
                      <calcite-slider
                        id="camera-layer-scene-camera-fov"
                        min="20"
                        max="120"
                        step="1"
                        value="55"
                        min-label="20deg"
                        max-label="120deg"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fov-value" className="scene-camera-studio-readout">
                        55deg
                      </span>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      WebScene quality
                      <calcite-select id="camera-layer-scene-quality-profile" value="high">
                        <calcite-option value="low">Low</calcite-option>
                        <calcite-option value="medium">Medium</calcite-option>
                        <calcite-option value="high">High</calcite-option>
                      </calcite-select>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Atmosphere quality
                      <calcite-select id="camera-layer-scene-atmosphere-quality" value="high">
                        <calcite-option value="low">Low</calcite-option>
                        <calcite-option value="high">High</calcite-option>
                      </calcite-select>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-toggle">
                      Glow
                      <calcite-switch id="camera-layer-scene-glow-enabled" scale="s" checked></calcite-switch>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-toggle">
                      Cinematic FX
                      <calcite-switch id="camera-layer-scene-camera-fx-enabled" scale="s"></calcite-switch>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Noise
                      <calcite-slider
                        id="camera-layer-scene-camera-fx-noise"
                        min="0"
                        max="100"
                        step="1"
                        value="42"
                        min-label="0%"
                        max-label="100%"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fx-noise-value" className="scene-camera-studio-readout">
                        42%
                      </span>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Scanlines
                      <calcite-slider
                        id="camera-layer-scene-camera-fx-scanline"
                        min="0"
                        max="100"
                        step="1"
                        value="38"
                        min-label="0%"
                        max-label="100%"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fx-scanline-value" className="scene-camera-studio-readout">
                        38%
                      </span>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Vignette
                      <calcite-slider
                        id="camera-layer-scene-camera-fx-vignette"
                        min="0"
                        max="100"
                        step="1"
                        value="44"
                        min-label="0%"
                        max-label="100%"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fx-vignette-value" className="scene-camera-studio-readout">
                        44%
                      </span>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Jitter
                      <calcite-slider
                        id="camera-layer-scene-camera-fx-jitter"
                        min="0"
                        max="12"
                        step="0.1"
                        value="2.5"
                        min-label="0px"
                        max-label="12px"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fx-jitter-value" className="scene-camera-studio-readout">
                        2.5 px
                      </span>
                    </calcite-label>
                    <calcite-label className="scene-camera-studio-control">
                      Chromatic shift
                      <calcite-slider
                        id="camera-layer-scene-camera-fx-chromatic"
                        min="0"
                        max="12"
                        step="0.1"
                        value="2.2"
                        min-label="0px"
                        max-label="12px"
                      ></calcite-slider>
                      <span id="camera-layer-scene-camera-fx-chromatic-value" className="scene-camera-studio-readout">
                        2.2 px
                      </span>
                    </calcite-label>
                  </div>
                </div>
              </div>
            </div>
          </calcite-stepper-item>
          <calcite-stepper-item
            id="onboarding-step-export"
            icon
            heading="Export Video"
          >
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
          <calcite-button
            id="export-action-btn"
            icon-start="download"
            scale="m"
            width="full"
            style={{
              "--calcite-button-text-color": themeMode === "dark" ? "#ffffff" : undefined,
              "--calcite-button-icon-color": themeMode === "dark" ? "#ffffff" : undefined,
            }}
          >
            Export
          </calcite-button>
            </div>
          </calcite-stepper-item>
        </calcite-stepper>
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
