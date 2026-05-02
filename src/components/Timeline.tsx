function Timeline() {
  return (
    <div id="timeline-container" data-testid="timeline-container">
      <div id="timeline-header">
        <div className="timeline-io-controls"></div>
        <h3>Animation Timeline</h3>
        <div id="timeline-controls">
          <calcite-button
            id="timeline-play-btn"
            data-testid="timeline-play-btn"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="play"
            title="Play"
            aria-label="Play"
          ></calcite-button>
          <calcite-button
            id="timeline-duplicate-btn"
            data-testid="timeline-duplicate-btn"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="copy"
            title="Duplicate selected animation"
            aria-label="Duplicate selected animation"
            disabled
          ></calcite-button>
          <calcite-button
            id="timeline-delete-clip-btn"
            data-testid="timeline-delete-clip-btn"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="trash"
            title="Delete selected animation"
            aria-label="Delete selected animation"
            disabled
          ></calcite-button>
          <calcite-button
            id="timeline-start-btn"
            data-testid="timeline-start-btn"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="chevron-left"
            title="Go to start"
            aria-label="Go to start"
          ></calcite-button>
          <calcite-button
            id="timeline-end-btn"
            data-testid="timeline-end-btn"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="chevron-right"
            title="Go to end"
            aria-label="Go to end"
          ></calcite-button>
          <calcite-button
            id="timeline-zoom-in"
            data-testid="timeline-zoom-in"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="plus"
            title="Zoom in"
            aria-label="Zoom in"
          ></calcite-button>
          <calcite-button
            id="timeline-zoom-out"
            data-testid="timeline-zoom-out"
            className="timeline-icon-only"
            appearance="transparent"
            scale="s"
            icon-start="minus"
            title="Zoom out"
            aria-label="Zoom out"
          ></calcite-button>
          <calcite-button
            id="timeline-snap-toggle"
            data-testid="timeline-snap-toggle"
            className="timeline-icon-only timeline-toggle"
            appearance="transparent"
            scale="s"
            icon-start="snap-to-grid"
            title="Toggle snapping"
            aria-label="Toggle snapping"
            aria-pressed="true"
            data-active="true"
          ></calcite-button>
          <calcite-button
            id="timeline-grid-toggle"
            data-testid="timeline-grid-toggle"
            className="timeline-icon-only timeline-toggle"
            appearance="transparent"
            scale="s"
            icon-start="grid"
            title="Toggle grid"
            aria-label="Toggle grid"
            aria-pressed="true"
            data-active="true"
          ></calcite-button>
          <span id="timeline-zoom-label" title="Timeline zoom">
            100%
          </span>
          <div id="timeline-keyframe-easing-wrap" className="timeline-keyframe-easing" hidden>
            <span className="timeline-keyframe-easing-label">Easing</span>
            <calcite-select
              id="timeline-keyframe-easing"
              data-testid="timeline-keyframe-easing"
              scale="s"
              aria-label="Selected keyframe easing"
              disabled
            >
              <calcite-option value="linear">Linear</calcite-option>
              <calcite-option value="ease-in">Ease In</calcite-option>
              <calcite-option value="ease-out">Ease Out</calcite-option>
              <calcite-option value="ease-in-out">Ease In/Out</calcite-option>
            </calcite-select>
          </div>
          <div id="timeline-clip-curve-wrap" className="timeline-clip-curve" hidden>
            <span className="timeline-keyframe-easing-label">Clip Curve</span>
            <calcite-select
              id="timeline-clip-curve-preset"
              scale="s"
              aria-label="Selected clip timing curve preset"
              disabled
            >
              <calcite-option value="linear">Linear</calcite-option>
              <calcite-option value="ease-in">Ease In</calcite-option>
              <calcite-option value="ease-out">Ease Out</calcite-option>
              <calcite-option value="ease-in-out">Ease In/Out</calcite-option>
              <calcite-option value="custom">Custom</calcite-option>
            </calcite-select>
            <calcite-input-number id="timeline-curve-x1" scale="s" step="0.01" min="0" max="1" value="0.00" disabled></calcite-input-number>
            <calcite-input-number id="timeline-curve-y1" scale="s" step="0.01" min="0" max="1" value="0.00" disabled></calcite-input-number>
            <calcite-input-number id="timeline-curve-x2" scale="s" step="0.01" min="0" max="1" value="1.00" disabled></calcite-input-number>
            <calcite-input-number id="timeline-curve-y2" scale="s" step="0.01" min="0" max="1" value="1.00" disabled></calcite-input-number>
          </div>
          <div className="timeline-duration">
            <calcite-button
              id="timeline-duration-autofit"
              className="timeline-duration-reset"
              appearance="transparent"
              scale="s"
              type="button"
              title="Auto-fit duration to animations"
            >
              Duration (s)
            </calcite-button>
            <calcite-input-number
              id="timeline-duration"
              data-testid="timeline-duration"
              step="0.1"
              min="0"
              value="5.0"
              scale="s"
              aria-label="Duration in seconds"
            ></calcite-input-number>
          </div>
        </div>
      </div>
      <div id="timeline-body">
        <div id="timeline-layers-panel"></div>
        <div id="timeline-panel-resizer" data-testid="timeline-panel-resizer"></div>
        <div id="timeline-tracks-container">
          <div id="timeline-tracks">
            <div id="timeline-ruler"></div>
            <div id="timeline-tracks-area"></div>
            <div id="timeline-playhead" data-testid="timeline-playhead" style={{ left: 0 }}></div>
            <div id="timeline-empty">
              No animation layers. Add animations to layers to see them here.
            </div>
          </div>
        </div>
      </div>
      <div className="export-lock-overlay" aria-hidden="true">
        <div className="export-lock-card">
          <svg
            className="export-lock-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7z" />
          </svg>
          <div className="export-lock-title">Exporting...</div>
          <div className="export-lock-subtitle">Timeline locked while rendering.</div>
        </div>
      </div>
    </div>
  );
}

export default Timeline;
