import { HISTORY_LIMIT } from "./constants";
import { validateProjectSnapshot } from "./projectSnapshotValidation";

type HistoryState = {
  historyStack: string[];
  redoStack: string[];
  historyTimer: number | null;
  isApplyingHistory: boolean;
};

type HistoryConfig = {
  buildProjectSnapshot: () => unknown | null;
  applyProjectSnapshot: (snapshot: unknown) => Promise<void> | void;
  updateHistoryControls: () => void;
  setProjectError: (message: string | null) => void;
  isRestoringProject: () => boolean;
  getHistoryLimit?: () => number;
};

const captureHistorySnapshot = (config: HistoryConfig) => {
  const snapshot = config.buildProjectSnapshot();
  if (!snapshot) return null;
  return JSON.stringify(snapshot);
};

const pushHistorySnapshot = (state: HistoryState, config: HistoryConfig) => {
  if (config.isRestoringProject() || state.isApplyingHistory) return;
  const payload = captureHistorySnapshot(config);
  if (!payload) return;
  if (state.historyStack[state.historyStack.length - 1] === payload) return;
  state.historyStack.push(payload);
  const historyLimit = config.getHistoryLimit ? config.getHistoryLimit() : HISTORY_LIMIT;
  if (state.historyStack.length > historyLimit) {
    state.historyStack.shift();
  }
  state.redoStack = [];
  config.updateHistoryControls();
};

const queueHistorySnapshot = (state: HistoryState, config: HistoryConfig) => {
  if (config.isRestoringProject() || state.isApplyingHistory) return;
  if (state.historyTimer) {
    window.clearTimeout(state.historyTimer);
  }
  state.historyTimer = window.setTimeout(() => {
    state.historyTimer = null;
    pushHistorySnapshot(state, config);
  }, 300);
};

const applyHistorySnapshot = async (
  state: HistoryState,
  config: HistoryConfig,
  payload: string
) => {
  try {
    const parsed = JSON.parse(payload);
    const validation = validateProjectSnapshot(parsed);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    state.isApplyingHistory = true;
    await config.applyProjectSnapshot(validation.snapshot);
  } catch (error) {
    console.warn("Unable to restore history snapshot.", error);
    config.setProjectError("Undo/redo failed to restore the project.");
  } finally {
    state.isApplyingHistory = false;
    config.updateHistoryControls();
  }
};

const undoHistory = async (state: HistoryState, config: HistoryConfig) => {
  if (state.historyStack.length <= 1) return;
  const current = state.historyStack.pop();
  if (current) state.redoStack.push(current);
  const previous = state.historyStack[state.historyStack.length - 1];
  if (!previous) return;
  await applyHistorySnapshot(state, config, previous);
};

const redoHistory = async (state: HistoryState, config: HistoryConfig) => {
  if (!state.redoStack.length) return;
  const next = state.redoStack.pop();
  if (!next) return;
  state.historyStack.push(next);
  await applyHistorySnapshot(state, config, next);
};

const resetHistory = (state: HistoryState, config: HistoryConfig) => {
  state.historyStack = [];
  state.redoStack = [];
  pushHistorySnapshot(state, config);
  config.updateHistoryControls();
};

export type { HistoryConfig, HistoryState };
export {
  pushHistorySnapshot,
  queueHistorySnapshot,
  redoHistory,
  resetHistory,
  undoHistory
};
