type ExportState = {
  isExporting: boolean;
};

type ExportConfig = {
  getView: () => any;
  isPlaying: () => boolean;
  stopAnimation: () => void;
  startAnimation: () => void;
  goToStart: () => void;
  setExportUiError: (message: string | null) => void;
  startCanvasRecording: (canvas: HTMLCanvasElement, format: "mp4" | "webm") => boolean;
  stopCanvasRecording: () => void;
};

const isFirefox = () => {
  return /firefox/i.test(navigator.userAgent);
};

const getPreferredExportFormat = (): "mp4" | "webm" => {
  return isFirefox() ? "webm" : "mp4";
};

const updateExportButtonLabel = () => {
  const exportButton = document.getElementById("export-btn");
  if (!exportButton) return;
  const format = getPreferredExportFormat();
  exportButton.textContent = `Export as .${format}`;
};

const startExportRecording = (state: ExportState, config: ExportConfig) => {
  const view = config.getView();
  if (!view || state.isExporting) return;
  config.setExportUiError(null);
  const format = getPreferredExportFormat();

  const canvas = view.container?.querySelector("canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    config.setExportUiError("Unable to find a canvas to record.");
    return;
  }

  if (config.isPlaying()) {
    config.stopAnimation();
  }

  const resolvedFormat = format === "mp4" ? "mp4" : "webm";
  state.isExporting = true;
  document.body.classList.add("is-exporting");
  config.goToStart();
  setTimeout(() => {
    const started = config.startCanvasRecording(canvas, resolvedFormat);
    if (!started) {
      stopExportRecording(state, config);
      return;
    }
    config.startAnimation();
  }, 1000);
};

const stopExportRecording = (state: ExportState, config: ExportConfig) => {
  if (!state.isExporting) return;
  state.isExporting = false;
  document.body.classList.remove("is-exporting");
  config.stopCanvasRecording();
};

const handleExport = () => {
  alert(
    "Export as MP4 is not yet implemented. This would capture the animation and export it as MP4."
  );
};

export type { ExportConfig, ExportState };
export { handleExport, startExportRecording, stopExportRecording, updateExportButtonLabel };
