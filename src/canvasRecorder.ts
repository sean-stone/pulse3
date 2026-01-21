// Note: this is a canvas recorder, but ensure you let the users know that there is still
// licensing/terms linked to the map. Attribution to Esri is required as well as the data.

let recording = false;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let downloadUrl: string | null = null;
let downloadBlob: Blob | null = null;
const DEFAULT_EXPORT_NAME = "pulse-recording";

function setExportError(message: string | null) {
  const errorEl = document.getElementById("export-error");
  if (!errorEl) return;
  if (!message) {
    errorEl.textContent = "";
    errorEl.classList.remove("show");
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function updateUI(startDisabled: boolean, stopDisabled: boolean, showDownload = false) {
  const exportButton = document.getElementById("export-btn") as HTMLButtonElement | null;
  const copyCard = document.getElementById("copy-card");

  if (exportButton) exportButton.disabled = startDisabled;
  if (copyCard) copyCard.style.display = showDownload ? "block" : "none";
}

function handleRecordingStop(format: string, extension: "mp4" | "webm") {
  const attributionSource = document.querySelector(".esri-attribution__sources") as HTMLElement | null;
  const blob = new Blob(recordedChunks, { type: format });
  const url = URL.createObjectURL(blob);
  downloadUrl = url;
  downloadBlob = blob;

  const quoteText = document.getElementById("quote-text");
  if (quoteText) {
    const sources = attributionSource ? attributionSource.innerText : "";
    quoteText.textContent =
      `Attribution required when sharing exports: ${sources} ` +
      "Powered by Esri, made with Pulse seanst.one/demos/pulse3";
  }

  updateUI(false, true, true);
  setExportError(null);
  const downloadButton = document.getElementById("download-btn") as any;
  if (downloadButton && downloadButton.setAttribute) {
    downloadButton.setAttribute("data-extension", extension);
  }
  const copyCard = document.getElementById("copy-card");
  if (copyCard?.scrollIntoView) {
    copyCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function getExportFileName(extension: "mp4" | "webm") {
  const safeName = DEFAULT_EXPORT_NAME.replace(/[\\/:*?"<>|]/g, "-");
  const lower = safeName.toLowerCase();
  if (lower.endsWith(`.${extension}`)) {
    return safeName;
  }
  return `${safeName}.${extension}`;
}

async function trySaveWithPicker(fileName: string, extension: "mp4" | "webm") {
  const picker = (window as any).showSaveFilePicker;
  if (!downloadBlob || typeof picker !== "function") return false;
  const accepts =
    extension === "mp4"
      ? { "video/mp4": [".mp4"] }
      : { "video/webm": [".webm"] };
  try {
    const handle = await picker({
      suggestedName: fileName,
      types: [{ description: "Video", accept: accepts }]
    });
    const writable = await handle.createWritable();
    await writable.write(downloadBlob);
    await writable.close();
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      return true;
    }
    console.warn("Unable to use save picker, falling back to download.", error);
    return false;
  }
}

function bindDownload() {
  const downloadButton = document.getElementById("download-btn");
  const downloadLink = document.getElementById("download-link") as HTMLAnchorElement | null;
  if (!downloadButton || !downloadLink) return;

  downloadButton.addEventListener("click", async () => {
    if (!downloadUrl) return;
    const extension = downloadButton.getAttribute("data-extension") || "webm";
    const fileName = getExportFileName(extension as "mp4" | "webm");
    const handled = await trySaveWithPicker(fileName, extension as "mp4" | "webm");
    if (handled) return;
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    downloadLink.click();
  });
}

function getRecorderOptions(format: "mp4" | "webm") {
  if (format === "mp4") {
    return {
      mimeType: 'video/mp4; codecs="avc1.424028, mp4a.40.2"',
      videoBitsPerSecond: 15000000
    };
  }
  return {
    mimeType: "video/webm; codecs=vp9",
    videoBitsPerSecond: 8000000
  };
}

function getSupportedRecorderOptions(preferred: "mp4" | "webm") {
  const candidates =
    preferred === "mp4"
      ? [
          { format: "mp4" as const, options: getRecorderOptions("mp4") },
          { format: "webm" as const, options: getRecorderOptions("webm") },
          { format: "webm" as const, options: { mimeType: "video/webm; codecs=vp8", videoBitsPerSecond: 6000000 } }
        ]
      : [
          { format: "webm" as const, options: getRecorderOptions("webm") },
          { format: "webm" as const, options: { mimeType: "video/webm; codecs=vp8", videoBitsPerSecond: 6000000 } },
          { format: "mp4" as const, options: getRecorderOptions("mp4") }
        ];

  if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
    for (const candidate of candidates) {
      if (!candidate.options.mimeType || MediaRecorder.isTypeSupported(candidate.options.mimeType)) {
        return candidate;
      }
    }
    return null;
  }

  return candidates[0];
}

export function startRecording(canvas: HTMLCanvasElement, format: "mp4" | "webm") {
  if (recording) return false;
  recording = true;
  recordedChunks = [];
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  downloadBlob = null;
  setExportError(null);

  updateUI(true, false);
  bindDownload();

  const stream = canvas.captureStream(30);
  const supported = getSupportedRecorderOptions(format);
  if (!supported) {
    recording = false;
    updateUI(false, true);
    setExportError("Export isn't available in this browser. Try Chrome or Edge.");
    return false;
  }

  const options = supported.options;
  const resolvedFormat: "mp4" | "webm" = supported.format;

  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (error) {
    recording = false;
    updateUI(false, true);
    console.warn("Unable to start recording.", error);
    setExportError("Export isn't available in this browser. Try Chrome or Edge.");
    return false;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => handleRecordingStop(options.mimeType ?? resolvedFormat, resolvedFormat);

  mediaRecorder.start();
  return true;
}

export function stopRecording() {
  if (!recording) return;
  recording = false;
  updateUI(false, true);
  if (mediaRecorder) {
    mediaRecorder.stop();
  }
}
