import type { ProjectSnapshot, RecentProject } from "./constants";
import {
  ENABLE_PROJECT_STORAGE,
  PROJECT_STORAGE_KEY_LOCAL,
  PROJECT_STORAGE_KEY_NAME,
  PROJECT_STORAGE_KEY_RECENTS,
  PROJECT_STORAGE_KEY_SESSION,
  STORAGE_CONSENT_KEY,
  sanitizePlainText
} from "./constants";

type StorageConfig = {
  setProjectStatus: (state: "saved" | "dirty") => void;
  setProjectError: (message: string | null) => void;
  setProjectStorageWarning?: (visible: boolean) => void;
  updateRecentProjectsUI: () => void;
  applyProjectSnapshot: (snapshot: ProjectSnapshot) => Promise<void> | void;
  buildProjectSnapshot: () => ProjectSnapshot | null;
};

type StorageState = {
  localStorageAllowed: boolean;
  hasCheckedStorageConsent: boolean;
};

const canUseLocalStorage = (state: StorageState) => {
  return ENABLE_PROJECT_STORAGE && state.localStorageAllowed;
};

const getStoredLocalStorageConsent = () => {
  try {
    const stored = window.localStorage.getItem(STORAGE_CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch (error) {
    console.warn("Unable to read storage consent.", error);
  }
  return null;
};

const clearLocalProjectStorage = () => {
  try {
    window.localStorage.removeItem(PROJECT_STORAGE_KEY_LOCAL);
    window.localStorage.removeItem(PROJECT_STORAGE_KEY_NAME);
    window.localStorage.removeItem(PROJECT_STORAGE_KEY_RECENTS);
  } catch (error) {
    console.warn("Unable to clear local storage data.", error);
  }
};

const clearSessionProjectStorage = () => {
  try {
    window.sessionStorage.removeItem(PROJECT_STORAGE_KEY_SESSION);
  } catch (error) {
    console.warn("Unable to clear session storage data.", error);
  }
};

const initializeStorageConsentState = (state: StorageState) => {
  if (!ENABLE_PROJECT_STORAGE) return;
  const storedConsent = getStoredLocalStorageConsent();
  if (storedConsent === "granted") {
    state.localStorageAllowed = true;
    state.hasCheckedStorageConsent = true;
    return;
  }
  if (storedConsent === "denied") {
    state.localStorageAllowed = false;
    state.hasCheckedStorageConsent = true;
    clearLocalProjectStorage();
    clearSessionProjectStorage();
  }
};

const ensureStorageConsent = async (
  state: StorageState,
  openConfirmDialog: (options: {
    message: string;
    heading?: string;
    confirmText?: string;
    cancelText?: string;
    confirmKind?: string;
    hostId?: string;
  }) => Promise<boolean>
) => {
  if (!ENABLE_PROJECT_STORAGE) return;
  if (state.hasCheckedStorageConsent && state.localStorageAllowed) return;
  state.hasCheckedStorageConsent = true;
  const storedConsent = getStoredLocalStorageConsent();
  if (storedConsent === "granted") {
    state.localStorageAllowed = true;
    return;
  }
  if (storedConsent === "denied") {
    state.localStorageAllowed = false;
    clearLocalProjectStorage();
    clearSessionProjectStorage();
    return;
  }
  const allowed = await openConfirmDialog({
    heading: "Local storage",
    message: "Allow Pulse to use storage on this device to remember your project during and after this session?",
    confirmText: "Allow",
    cancelText: "Decline",
    confirmKind: "brand"
  });
  state.localStorageAllowed = allowed;
  if (allowed) {
    try {
      window.localStorage.setItem(STORAGE_CONSENT_KEY, "granted");
    } catch (error) {
      console.warn("Unable to save storage consent.", error);
    }
  } else {
    clearLocalProjectStorage();
    clearSessionProjectStorage();
  }
};

const loadProjectFromStorage = (state: StorageState, config: StorageConfig) => {
  if (!ENABLE_PROJECT_STORAGE) return;
  if (!state.localStorageAllowed) return;
  const raw =
    window.sessionStorage.getItem(PROJECT_STORAGE_KEY_SESSION) ||
    window.localStorage.getItem(PROJECT_STORAGE_KEY_LOCAL);
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw);
    void config.applyProjectSnapshot(snapshot);
  } catch (error) {
    console.warn("Unable to parse stored project.", error);
    config.setProjectError("Saved project could not be loaded.");
  }
};

const loadRecentProjectsFromStorage = (state: StorageState): RecentProject[] => {
  if (!canUseLocalStorage(state)) return [];
  const raw = window.localStorage.getItem(PROJECT_STORAGE_KEY_RECENTS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as RecentProject[];
  } catch (error) {
    console.warn("Unable to parse recent projects.", error);
  }
  return [];
};

function isQuotaExceeded(error: unknown) {
  const err = error as { name?: string; code?: number } | null;
  return (
    err?.name === "QuotaExceededError" ||
    err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err?.code === 22 ||
    err?.code === 1014
  );
}

const setStorageWarning = (config: StorageConfig, visible: boolean) => {
  if (config.setProjectStorageWarning) {
    config.setProjectStorageWarning(visible);
  }
};

const saveRecentProjectsToStorage = (state: StorageState, config: StorageConfig, recents: RecentProject[]) => {
  if (!canUseLocalStorage(state)) return;
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY_RECENTS, JSON.stringify(recents));
    setStorageWarning(config, false);
  } catch (error) {
    console.warn("Unable to save recent projects.", error);
    if (isQuotaExceeded(error)) {
      setStorageWarning(config, true);
    }
  }
};

const rememberRecentProject = (
  state: StorageState,
  config: StorageConfig,
  snapshot: ProjectSnapshot,
  projectName: string
) => {
  if (!canUseLocalStorage(state)) return;
  const name = sanitizePlainText(snapshot?.properties?._pulse?.projectName || projectName, "Untitled");
  const savedAt = snapshot?.properties?._pulse?.savedAt || new Date().toISOString();
  const id = `${savedAt}-${name}`.replace(/[^\x20-\x7E]/g, "");
  const existing = loadRecentProjectsFromStorage(state).filter((entry) => entry.id !== id);
  const next: RecentProject[] = [{ id, name, savedAt, snapshot }, ...existing].slice(0, 8);
  saveRecentProjectsToStorage(state, config, next);
  config.updateRecentProjectsUI();
};

const saveProjectToStorage = (
  state: StorageState,
  config: StorageConfig,
  projectName: string,
  hasView: boolean
) => {
  if (!ENABLE_PROJECT_STORAGE) return;
  if (!state.localStorageAllowed) return;
  if (!hasView) return;
  const snapshot = config.buildProjectSnapshot();
  if (!snapshot) return;
  const payload = JSON.stringify(snapshot);
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY_LOCAL, payload);
  } catch (error) {
    console.warn("Unable to save project to localStorage.", error);
  }
  try {
    window.sessionStorage.setItem(PROJECT_STORAGE_KEY_SESSION, payload);
  } catch (error) {
    console.warn("Unable to save project to sessionStorage.", error);
  }
  rememberRecentProject(state, config, snapshot, projectName);
  config.setProjectStatus("saved");
};

const clearRecentProjects = (state: StorageState, config: StorageConfig) => {
  if (!canUseLocalStorage(state)) {
    config.updateRecentProjectsUI();
    return;
  }
  saveRecentProjectsToStorage(state, config, []);
  try {
    window.localStorage.removeItem(PROJECT_STORAGE_KEY_RECENTS);
  } catch (error) {
    console.warn("Unable to clear recent projects.", error);
  }
  config.updateRecentProjectsUI();
};

const clearProjectStorage = (state: StorageState) => {
  if (!ENABLE_PROJECT_STORAGE) return;
  try {
    window.sessionStorage.removeItem(PROJECT_STORAGE_KEY_SESSION);
    if (state.localStorageAllowed) {
      window.localStorage.removeItem(PROJECT_STORAGE_KEY_LOCAL);
      window.localStorage.removeItem(PROJECT_STORAGE_KEY_NAME);
    }
  } catch (error) {
    console.warn("Unable to clear saved project.", error);
  }
};

const setProjectNameStorage = (state: StorageState, value: string) => {
  if (!canUseLocalStorage(state)) return;
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY_NAME, value);
  } catch (error) {
    console.warn("Unable to save project name.", error);
  }
};

const loadStoredProjectName = (state: StorageState) => {
  if (!canUseLocalStorage(state)) return null;
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY_NAME);
  } catch (error) {
    console.warn("Unable to read project name.", error);
  }
  return null;
};

export type { StorageConfig, StorageState };
export {
  canUseLocalStorage,
  clearProjectStorage,
  clearRecentProjects,
  clearSessionProjectStorage,
  ensureStorageConsent,
  initializeStorageConsentState,
  loadProjectFromStorage,
  loadRecentProjectsFromStorage,
  loadStoredProjectName,
  rememberRecentProject,
  saveProjectToStorage,
  saveRecentProjectsToStorage,
  setProjectNameStorage
};
