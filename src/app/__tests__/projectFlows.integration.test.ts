import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ProjectSnapshot } from "../constants";
import { PROJECT_STORAGE_KEY_LOCAL } from "../constants";
import type { HistoryConfig, HistoryState } from "../history";
import { redoHistory } from "../history";
import type { ProjectIoConfig } from "../projectIo";
import { handleProjectFileChange } from "../projectIo";
import type { StorageConfig, StorageState } from "../storage";
import { loadProjectFromStorage } from "../storage";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

  readAsText(file: Blob) {
    void file.text().then((text) => {
      this.result = text;
      this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
    });
  }
}

const buildValidSnapshot = (): ProjectSnapshot =>
  ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: null,
        properties: { _pulse: { layerId: "layer-0" } }
      }
    ],
    properties: {
      _pulse: {
        version: 1,
        savedAt: "2026-03-20T00:00:00.000Z",
        projectName: "Test",
        app: {
          layout: "default",
          customWidth: null,
          customHeight: null,
          isRotated: false,
          basemap: "gray-vector",
          basemapVisible: true
        },
        timeline: { durationOverride: null },
        layers: [
          {
            id: "layer-0",
            name: "Layer 1",
            type: "point",
            animations: []
          }
        ]
      }
    }
  }) as ProjectSnapshot;

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("project flow integrations", () => {
  beforeEach(() => {
    (globalThis as any).window = {
      localStorage: new MemoryStorage(),
      sessionStorage: new MemoryStorage(),
      setTimeout,
      clearTimeout
    };
    (globalThis as any).FileReader = MockFileReader;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).FileReader;
    delete (globalThis as any).window;
  });

  test("project file import applies a valid snapshot", async () => {
    const applyProjectSnapshot = vi.fn().mockResolvedValue(undefined);
    const setProjectError = vi.fn();
    const config: ProjectIoConfig = {
      getEl: () => ({}) as HTMLElement,
      buildProjectSnapshot: () => null,
      getProjectFileName: () => "test.json",
      setProjectError,
      applyProjectSnapshot
    };
    const file = new Blob([JSON.stringify(buildValidSnapshot())], { type: "application/json" }) as File;
    const event = { target: { files: [file] } } as unknown as Event;

    handleProjectFileChange(config, event);
    await flushAsync();

    expect(applyProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(setProjectError).toHaveBeenCalledWith(null);
  });

  test("project file import rejects invalid snapshot metadata", async () => {
    const applyProjectSnapshot = vi.fn();
    const setProjectError = vi.fn();
    const config: ProjectIoConfig = {
      getEl: () => ({}) as HTMLElement,
      buildProjectSnapshot: () => null,
      getProjectFileName: () => "test.json",
      setProjectError,
      applyProjectSnapshot
    };
    const invalidSnapshot = {
      type: "FeatureCollection",
      features: [],
      properties: {}
    };
    const file = new Blob([JSON.stringify(invalidSnapshot)], { type: "application/json" }) as File;
    const event = { target: { files: [file] } } as unknown as Event;

    handleProjectFileChange(config, event);
    await flushAsync();

    expect(applyProjectSnapshot).not.toHaveBeenCalled();
    expect(setProjectError.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = setProjectError.mock.calls[setProjectError.mock.calls.length - 1];
    const lastError = String(lastCall?.[0] || "");
    expect(lastError).toContain("Unable to import project.");
  });

  test("storage restore applies a valid stored snapshot", async () => {
    const applyProjectSnapshot = vi.fn().mockResolvedValue(undefined);
    const setProjectError = vi.fn();
    const config: StorageConfig = {
      setProjectStatus: vi.fn(),
      setProjectError,
      updateRecentProjectsUI: vi.fn(),
      applyProjectSnapshot,
      buildProjectSnapshot: () => buildValidSnapshot()
    };
    const state: StorageState = {
      localStorageAllowed: true,
      hasCheckedStorageConsent: true
    };
    window.localStorage.setItem(PROJECT_STORAGE_KEY_LOCAL, JSON.stringify(buildValidSnapshot()));

    loadProjectFromStorage(state, config);
    await flushAsync();

    expect(applyProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(setProjectError).not.toHaveBeenCalled();
  });

  test("storage restore surfaces validation errors for malformed snapshots", async () => {
    const applyProjectSnapshot = vi.fn().mockResolvedValue(undefined);
    const setProjectError = vi.fn();
    const config: StorageConfig = {
      setProjectStatus: vi.fn(),
      setProjectError,
      updateRecentProjectsUI: vi.fn(),
      applyProjectSnapshot,
      buildProjectSnapshot: () => buildValidSnapshot()
    };
    const state: StorageState = {
      localStorageAllowed: true,
      hasCheckedStorageConsent: true
    };
    window.localStorage.setItem(
      PROJECT_STORAGE_KEY_LOCAL,
      JSON.stringify({ type: "FeatureCollection", features: [], properties: {} })
    );

    loadProjectFromStorage(state, config);
    await flushAsync();

    expect(applyProjectSnapshot).not.toHaveBeenCalled();
    expect(setProjectError).toHaveBeenCalledWith("Saved project could not be loaded.");
  });

  test("redo history handles malformed payloads without applying them", async () => {
    const applyProjectSnapshot = vi.fn().mockResolvedValue(undefined);
    const setProjectError = vi.fn();
    const updateHistoryControls = vi.fn();
    const config: HistoryConfig = {
      buildProjectSnapshot: () => buildValidSnapshot(),
      applyProjectSnapshot,
      updateHistoryControls,
      setProjectError,
      isRestoringProject: () => false
    };
    const state: HistoryState = {
      historyStack: [JSON.stringify(buildValidSnapshot())],
      redoStack: [JSON.stringify({ type: "FeatureCollection", features: [], properties: {} })],
      historyTimer: null,
      isApplyingHistory: false
    };

    await redoHistory(state, config);

    expect(applyProjectSnapshot).not.toHaveBeenCalled();
    expect(setProjectError).toHaveBeenCalledWith("Undo/redo failed to restore the project.");
    expect(updateHistoryControls).toHaveBeenCalled();
  });
});
