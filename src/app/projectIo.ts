import { validateProjectSnapshot } from "./projectSnapshotValidation";

type ProjectIoConfig = {
  getEl: (id: string) => HTMLElement;
  buildProjectSnapshot: () => unknown | null;
  getProjectFileName: () => string;
  setProjectError: (message: string | null) => void;
  applyProjectSnapshot: (snapshot: unknown) => void | Promise<void>;
};

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
  config.setProjectError(null);
  input.accept = ".json,.geojson,application/geo+json,application/json";
  input.value = "";
  input.click();
};

const handleProjectFileChange = (config: ProjectIoConfig, event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  config.setProjectError(null);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      const validation = validateProjectSnapshot(parsed);
      if (!validation.ok) {
        config.setProjectError(`Unable to import project. ${validation.error}`);
        return;
      }
      void Promise.resolve(config.applyProjectSnapshot(validation.snapshot)).catch(() => {
        config.setProjectError("Unable to import project. The snapshot could not be applied.");
      });
    } catch (error) {
      config.setProjectError("Unable to import project. The file is not valid GeoJSON.");
    }
  };
  reader.readAsText(file);
};

export type { ProjectIoConfig };
export { handleExportProject, handleImportProjectClick, handleProjectFileChange };
