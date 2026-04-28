import { validateProjectSnapshot } from "./projectSnapshotValidation";

type ProjectIoConfig = {
  getEl: (id: string) => HTMLElement;
  buildProjectSnapshot: () => unknown | null;
  getProjectFileName: () => string;
  setProjectError: (message: string | null) => void;
  applyProjectSnapshot: (snapshot: unknown) => void | Promise<void>;
  setProjectImportStatus?: (message: string | null, kind?: "error" | "info" | "success") => void;
  onProjectImported?: () => void;
};

const setImportError = (config: ProjectIoConfig, message: string) => {
  config.setProjectError(message);
  config.setProjectImportStatus?.(message, "error");
};

const clearImportError = (config: ProjectIoConfig) => {
  config.setProjectError(null);
  config.setProjectImportStatus?.(null);
};

const readProjectFileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const handleExportProject = (config: ProjectIoConfig) => {
  const snapshot = config.buildProjectSnapshot();
  if (!snapshot) return;
  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = config.getProjectFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const handleImportProjectClick = (config: ProjectIoConfig) => {
  const input = config.getEl("project-file-input") as HTMLInputElement;
  clearImportError(config);
  input.accept = ".json,.geojson,application/geo+json,application/json";
  input.value = "";
  input.click();
};

const importProjectSnapshot = async (config: ProjectIoConfig, snapshot: unknown) => {
  clearImportError(config);
  const validation = validateProjectSnapshot(snapshot);
  if (!validation.ok) {
    setImportError(config, `Unable to import project. ${validation.error}`);
    return false;
  }
  try {
    await Promise.resolve(config.applyProjectSnapshot(validation.snapshot));
    config.setProjectImportStatus?.("Project loaded.", "success");
    config.onProjectImported?.();
    return true;
  } catch (error) {
    setImportError(config, "Unable to import project. The snapshot could not be applied.");
    return false;
  }
};

const importProjectFile = async (config: ProjectIoConfig, file: File) => {
  clearImportError(config);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readProjectFileText(file));
  } catch (error) {
    setImportError(config, "Unable to import project. The file is not valid GeoJSON.");
    return false;
  }
  return importProjectSnapshot(config, parsed);
};

const handleProjectFileChange = (config: ProjectIoConfig, event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return Promise.resolve(false);
  return importProjectFile(config, file);
};

export type { ProjectIoConfig };
export { handleExportProject, handleImportProjectClick, handleProjectFileChange, importProjectFile, importProjectSnapshot };
