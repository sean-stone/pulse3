function Modals() {
  return (
    <>
      <calcite-dialog
        id="style-settings-modal"
        data-testid="style-settings-modal"
        heading="Style Settings"
        scale="s"
        overlay-positioning="absolute"
        placement="cover"
        embedded
      >
        <div>
          <div id="point-style-section">
            <calcite-label>
              Point Style
              <div id="point-style-options" className="style-option-grid" role="group" aria-label="Point style">
                <button type="button" className="style-option-btn" data-value="circle">
                  <span className="point-style-swatch point-style-swatch--circle"></span>
                  Circle
                </button>
                <button type="button" className="style-option-btn" data-value="square">
                  <span className="point-style-swatch point-style-swatch--square"></span>
                  Square
                </button>
                <button type="button" className="style-option-btn" data-value="diamond">
                  <span className="point-style-swatch point-style-swatch--diamond"></span>
                  Diamond
                </button>
                <button type="button" className="style-option-btn" data-value="triangle">
                  <span className="point-style-swatch point-style-swatch--triangle"></span>
                  Triangle
                </button>
                <button type="button" className="style-option-btn" data-value="cross">
                  <span className="point-style-swatch point-style-swatch--cross"></span>
                  Cross
                </button>
                <button type="button" className="style-option-btn" data-value="x">
                  <span className="point-style-swatch point-style-swatch--x"></span>
                  X
                </button>
                <button type="button" className="style-option-btn" data-value="home">
                  <span className="point-style-swatch point-style-swatch--home"></span>
                  Home
                </button>
                <button type="button" className="style-option-btn" data-value="map-pin">
                  <span className="point-style-swatch point-style-swatch--map-pin"></span>
                  Map pin
                </button>
                <button type="button" className="style-option-btn" data-value="star">
                  <span className="point-style-swatch point-style-swatch--star"></span>
                  Star
                </button>
                <button type="button" className="style-option-btn" data-value="flag">
                  <span className="point-style-swatch point-style-swatch--flag"></span>
                  Flag
                </button>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              Point Size
              <calcite-slider
                id="point-size-input"
                data-testid="point-size-input"
                min="1"
                max="64"
                step="1"
                value="20"
                label-handles="true"
                scale="m"
              ></calcite-slider>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              <div className="color-picker-row">
                <span className="color-picker-label">Inner Color:</span>
                <button
                  type="button"
                  id="point-fill-color"
                  className="color-swatch-button"
                  aria-label="Inner color"
                ></button>
                <calcite-popover reference-element="point-fill-color" placement="bottom-start" auto-close>
                  <calcite-color-picker
                    id="point-fill-color-picker"
                    value="#0a4c66"
                    scale="s"
                    alpha-channel
                    channels-disabled
                    saved-disabled
                  ></calcite-color-picker>
                </calcite-popover>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              <div className="color-picker-row">
                <span className="color-picker-label">Outer Color:</span>
                <button
                  type="button"
                  id="point-outline-color"
                  className="color-swatch-button"
                  aria-label="Outer color"
                ></button>
                <calcite-popover reference-element="point-outline-color" placement="bottom-start" auto-close>
                  <calcite-color-picker
                    id="point-outline-color-picker"
                    value="#ffffff"
                    scale="s"
                    alpha-channel
                    channels-disabled
                    saved-disabled
                  ></calcite-color-picker>
                </calcite-popover>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              Outer Stroke
              <calcite-slider
                id="point-outline-width"
                min="0"
                max="10"
                step="1"
                value="2"
                label-handles="true"
                scale="m"
              ></calcite-slider>
            </calcite-label>

            <div id="point-advanced-section">
              <calcite-label style={{ marginTop: 12 }}>
                Angle (degrees)
                <calcite-input-number
                  id="point-angle-input"
                  value="0"
                  min="-360"
                  max="360"
                  step="1"
                  scale="m"
                ></calcite-input-number>
              </calcite-label>

              <calcite-label style={{ marginTop: 12 }}>
                X Offset (px)
                <calcite-input-number
                  id="point-xoffset-input"
                  value="0"
                  min="-200"
                  max="200"
                  step="1"
                  scale="m"
                ></calcite-input-number>
              </calcite-label>

              <calcite-label style={{ marginTop: 12 }}>
                Y Offset (px)
                <calcite-input-number
                  id="point-yoffset-input"
                  value="0"
                  min="-200"
                  max="200"
                  step="1"
                  scale="m"
                ></calcite-input-number>
              </calcite-label>
            </div>
          </div>

          <div id="line-style-section">
            <calcite-label>
              Line Style
              <div id="line-style-options" className="style-option-grid" role="group" aria-label="Line style">
                <button type="button" className="style-option-btn" data-value="solid">
                  <span className="line-style-swatch line-style-swatch--solid"></span>
                  Solid
                </button>
                <button type="button" className="style-option-btn" data-value="arrow-start">
                  <span className="line-style-swatch line-style-swatch--arrow-start"></span>
                  Arrow Start
                </button>
                <button type="button" className="style-option-btn" data-value="arrow-end">
                  <span className="line-style-swatch line-style-swatch--arrow-end"></span>
                  Arrow End
                </button>
                <button type="button" className="style-option-btn" data-value="arrow-both">
                  <span className="line-style-swatch line-style-swatch--arrow-both"></span>
                  Arrow Both
                </button>
                <button type="button" className="style-option-btn" data-value="dash">
                  <span className="line-style-swatch line-style-swatch--dash"></span>
                  Dash
                </button>
                <button type="button" className="style-option-btn" data-value="dot">
                  <span className="line-style-swatch line-style-swatch--dot"></span>
                  Dot
                </button>
                <button type="button" className="style-option-btn" data-value="dash-dot">
                  <span className="line-style-swatch line-style-swatch--dash-dot"></span>
                  Dash Dot
                </button>
                <button type="button" className="style-option-btn" data-value="short-dash">
                  <span className="line-style-swatch line-style-swatch--short-dash"></span>
                  Short Dash
                </button>
                <button type="button" className="style-option-btn" data-value="short-dot">
                  <span className="line-style-swatch line-style-swatch--short-dot"></span>
                  Short Dot
                </button>
                <button type="button" className="style-option-btn" data-value="short-dash-dot">
                  <span className="line-style-swatch line-style-swatch--short-dash-dot"></span>
                  Short Dash Dot
                </button>
                <button type="button" className="style-option-btn" data-value="short-dash-dot-dot">
                  <span className="line-style-swatch line-style-swatch--short-dash-dot-dot"></span>
                  Short Dash Dot Dot
                </button>
                <button type="button" className="style-option-btn" data-value="long-dash">
                  <span className="line-style-swatch line-style-swatch--long-dash"></span>
                  Long Dash
                </button>
                <button type="button" className="style-option-btn" data-value="long-dash-dot">
                  <span className="line-style-swatch line-style-swatch--long-dash-dot"></span>
                  Long Dash Dot
                </button>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              Line Width
              <calcite-slider
                id="line-width-input"
                min="1"
                max="20"
                step="1"
                value="3"
                label-handles="true"
                scale="m"
              ></calcite-slider>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              <div className="color-picker-row">
                <span className="color-picker-label">Line Color:</span>
                <button
                  type="button"
                  id="line-color-input"
                  className="color-swatch-button"
                  aria-label="Line color"
                ></button>
                <calcite-popover reference-element="line-color-input" placement="bottom-start" auto-close>
                  <calcite-color-picker
                    id="line-color-input-picker"
                    value="#0a4c66"
                    scale="s"
                    alpha-channel
                    channels-disabled
                    saved-disabled
                  ></calcite-color-picker>
                </calcite-popover>
              </div>
            </calcite-label>
          </div>

          <div id="polygon-style-section">
            <calcite-label>
              Fill Style
              <div
                id="polygon-fill-style-options"
                className="style-option-grid"
                role="group"
                aria-label="Polygon fill style"
              >
                <button type="button" className="style-option-btn" data-value="solid">
                  <span className="polygon-style-swatch polygon-style-swatch--solid"></span>
                  Solid
                </button>
                <button type="button" className="style-option-btn" data-value="backward-diagonal">
                  <span className="polygon-style-swatch polygon-style-swatch--backward-diagonal"></span>
                  Backward Diagonal
                </button>
                <button type="button" className="style-option-btn" data-value="forward-diagonal">
                  <span className="polygon-style-swatch polygon-style-swatch--forward-diagonal"></span>
                  Forward Diagonal
                </button>
                <button type="button" className="style-option-btn" data-value="diagonal-cross">
                  <span className="polygon-style-swatch polygon-style-swatch--diagonal-cross"></span>
                  Diagonal Cross
                </button>
                <button type="button" className="style-option-btn" data-value="cross">
                  <span className="polygon-style-swatch polygon-style-swatch--cross"></span>
                  Cross
                </button>
                <button type="button" className="style-option-btn" data-value="horizontal">
                  <span className="polygon-style-swatch polygon-style-swatch--horizontal"></span>
                  Horizontal
                </button>
                <button type="button" className="style-option-btn" data-value="vertical">
                  <span className="polygon-style-swatch polygon-style-swatch--vertical"></span>
                  Vertical
                </button>
                <button type="button" className="style-option-btn" data-value="none">
                  <span className="polygon-style-swatch polygon-style-swatch--none"></span>
                  None
                </button>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              <div className="color-picker-row">
                <span className="color-picker-label">Fill Color:</span>
                <button
                  type="button"
                  id="polygon-fill-color"
                  className="color-swatch-button"
                  aria-label="Fill color"
                ></button>
                <calcite-popover reference-element="polygon-fill-color" placement="bottom-start" auto-close>
                  <calcite-color-picker
                    id="polygon-fill-color-picker"
                    value="#7ac7b04d"
                    scale="s"
                    alpha-channel
                    channels-disabled
                    saved-disabled
                  ></calcite-color-picker>
                </calcite-popover>
              </div>
            </calcite-label>

            <calcite-label style={{ marginTop: 12 }}>
              <div className="color-picker-row">
                <span className="color-picker-label">Outline Color:</span>
                <button
                  type="button"
                  id="polygon-outline-color"
                  className="color-swatch-button"
                  aria-label="Outline color"
                ></button>
                <calcite-popover reference-element="polygon-outline-color" placement="bottom-start" auto-close>
                  <calcite-color-picker
                    id="polygon-outline-color-picker"
                    value="#0a4c66"
                    scale="s"
                    alpha-channel
                    channels-disabled
                    saved-disabled
                  ></calcite-color-picker>
                </calcite-popover>
              </div>
            </calcite-label>

            <div id="polygon-outline-style-row">
              <calcite-label style={{ marginTop: 12 }}>
                Outline Style
                <calcite-select id="polygon-outline-style-select" scale="m">
                  <calcite-option value="solid">Solid</calcite-option>
                  <calcite-option value="dash">Dash</calcite-option>
                  <calcite-option value="dot">Dot</calcite-option>
                  <calcite-option value="dash-dot">Dash Dot</calcite-option>
                  <calcite-option value="short-dash">Short Dash</calcite-option>
                  <calcite-option value="short-dot">Short Dot</calcite-option>
                  <calcite-option value="short-dash-dot">Short Dash Dot</calcite-option>
                  <calcite-option value="short-dash-dot-dot">Short Dash Dot Dot</calcite-option>
                  <calcite-option value="long-dash">Long Dash</calcite-option>
                  <calcite-option value="long-dash-dot">Long Dash Dot</calcite-option>
                </calcite-select>
              </calcite-label>
            </div>

            <calcite-label style={{ marginTop: 12 }}>
              Outline Width
              <calcite-input-number
                id="polygon-outline-width"
                value="2"
                min="0"
                max="10"
                step="1"
                scale="m"
              ></calcite-input-number>
            </calcite-label>
          </div>

          <div id="layer-effects-section">
            <button
              id="style-effects-toggle"
              className="link-button"
              type="button"
              aria-expanded="false"
            >
              Show more
            </button>

            <div id="style-effects-advanced" className="style-effects-advanced">
              <calcite-label style={{ marginTop: 12 }}>
                Blend Mode
                <calcite-select id="layer-blend-mode-select" scale="m">
                  <calcite-option value="normal">Normal</calcite-option>
                  <calcite-option value="average">Average</calcite-option>
                  <calcite-option value="color-burn">Color Burn</calcite-option>
                  <calcite-option value="color-dodge">Color Dodge</calcite-option>
                  <calcite-option value="color">Color</calcite-option>
                  <calcite-option value="darken">Darken</calcite-option>
                  <calcite-option value="destination-atop">Destination Atop</calcite-option>
                  <calcite-option value="destination-in">Destination In</calcite-option>
                  <calcite-option value="destination-out">Destination Out</calcite-option>
                  <calcite-option value="destination-over">Destination Over</calcite-option>
                  <calcite-option value="difference">Difference</calcite-option>
                  <calcite-option value="exclusion">Exclusion</calcite-option>
                  <calcite-option value="hard-light">Hard Light</calcite-option>
                  <calcite-option value="hue">Hue</calcite-option>
                  <calcite-option value="invert">Invert</calcite-option>
                  <calcite-option value="lighten">Lighten</calcite-option>
                  <calcite-option value="lighter">Lighter</calcite-option>
                  <calcite-option value="luminosity">Luminosity</calcite-option>
                  <calcite-option value="multiply">Multiply</calcite-option>
                  <calcite-option value="overlay">Overlay</calcite-option>
                  <calcite-option value="saturation">Saturation</calcite-option>
                  <calcite-option value="screen">Screen</calcite-option>
                  <calcite-option value="soft-light">Soft Light</calcite-option>
                  <calcite-option value="source-atop">Source Atop</calcite-option>
                  <calcite-option value="source-in">Source In</calcite-option>
                  <calcite-option value="source-out">Source Out</calcite-option>
                  <calcite-option value="vivid-light">Vivid Light</calcite-option>
                  <calcite-option value="xor">Xor</calcite-option>
                </calcite-select>
              </calcite-label>

              <div className="effects-divider">CSS Effects</div>

              <calcite-label className="filter-control">
                Brightness
                <calcite-slider
                  id="effect-brightness"
                  min="0"
                  max="5"
                  step="0.1"
                  value="1"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Contrast
                <calcite-slider
                  id="effect-contrast"
                  min="0"
                  max="200"
                  step="1"
                  value="100"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Grayscale
                <calcite-slider
                  id="effect-grayscale"
                  min="0"
                  max="1"
                  step="0.1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Hue Rotate
                <calcite-slider
                  id="effect-hue-rotate"
                  min="0"
                  max="360"
                  step="1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Invert
                <calcite-slider
                  id="effect-invert"
                  min="0"
                  max="1"
                  step="0.1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Opacity
                <calcite-slider
                  id="effect-opacity"
                  min="0"
                  max="1"
                  step="0.1"
                  value="1"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Saturate
                <calcite-slider
                  id="effect-saturate"
                  min="0"
                  max="5"
                  step="0.1"
                  value="1"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Sepia
                <calcite-slider
                  id="effect-sepia"
                  min="0"
                  max="1"
                  step="0.1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Blur
                <calcite-slider
                  id="effect-blur"
                  min="0"
                  max="20"
                  step="1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Drop Shadow Offset X
                <calcite-slider
                  id="effect-drop-shadow-offset-x"
                  min="-50"
                  max="50"
                  step="1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Drop Shadow Offset Y
                <calcite-slider
                  id="effect-drop-shadow-offset-y"
                  min="-50"
                  max="50"
                  step="1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

              <calcite-label className="filter-control">
                Drop Shadow Blur
                <calcite-slider
                  id="effect-drop-shadow-blur"
                  min="0"
                  max="50"
                  step="1"
                  value="0"
                  label-handles="true"
                  scale="m"
                ></calcite-slider>
              </calcite-label>

            <calcite-label className="filter-control">
              Drop Shadow Color
              <button
                type="button"
                id="effect-drop-shadow-color"
                className="color-swatch-button"
                aria-label="Drop shadow color"
              ></button>
              <calcite-popover reference-element="effect-drop-shadow-color" placement="bottom-start" auto-close>
                <calcite-color-picker
                  id="effect-drop-shadow-color-picker"
                  value="#000000"
                  scale="s"
                  alpha-channel
                  channels-disabled
                  saved-disabled
                ></calcite-color-picker>
              </calcite-popover>
            </calcite-label>
            </div>
          </div>
        </div>
        <div slot="footer" className="dialog-footer">
          <calcite-button id="style-confirm">
            Ok
          </calcite-button>
        </div>
      </calcite-dialog>

      <calcite-dialog
        id="text-settings-modal"
        heading="Text Settings"
        scale="s"
        overlay-positioning="absolute"
        placement="cover"
        embedded
      >
        <div>
          <calcite-label>
            Text Content
            <calcite-input
              id="text-content-input"
              placeholder="Enter text"
              scale="m"
            ></calcite-input>
          </calcite-label>
          <calcite-label style={{ marginTop: 12 }}>
            Font Size
            <calcite-slider
              id="text-size-slider"
              min="8"
              max="48"
              value="14"
              step="1"
              label-handles="true"
              scale="m"
            ></calcite-slider>
          </calcite-label>
          <calcite-label style={{ marginTop: 12 }}>
            <div className="color-picker-row">
              <span className="color-picker-label">Text Color:</span>
              <input
                type="color"
                id="text-color-input"
                defaultValue="#22323a"
                className="color-picker-compact"
              />
            </div>
          </calcite-label>
        </div>
        <div slot="footer" className="dialog-footer">
          <calcite-button id="text-settings-cancel" appearance="outline">
            Cancel
          </calcite-button>
          <calcite-button id="text-settings-confirm">
            Apply
          </calcite-button>
        </div>
      </calcite-dialog>

      <calcite-dialog
        id="confirm-dialog"
        heading="Confirm"
        scale="s"
        overlay-positioning="absolute"
        placement="center"
        embedded
      >
        <div>
          <p id="confirm-message" style={{ margin: 0, fontSize: 14, color: "var(--color-text)" }}></p>
        </div>
        <div slot="footer" className="dialog-footer">
          <calcite-button id="confirm-cancel" appearance="outline">
            Cancel
          </calcite-button>
          <calcite-button id="confirm-accept">
            Confirm
          </calcite-button>
        </div>
      </calcite-dialog>
    </>
  );
}

export default Modals;
