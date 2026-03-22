import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createBootController } from "../bootstrap";

type HostListenerMap = Record<string, Array<(event: Event) => void>>;

const createHost = (view?: unknown) => {
  const listeners: HostListenerMap = {};
  const host = {
    view,
    addEventListener: (name: string, listener: (event: Event) => void) => {
      if (!listeners[name]) {
        listeners[name] = [];
      }
      listeners[name].push(listener);
    }
  };
  return { host: host as unknown as HTMLElement & { view?: unknown }, listeners };
};

describe("bootstrap controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("boots once and activates ready map view in 2d mode", () => {
    const map = createHost({ kind: "map" });
    const scene = createHost({ kind: "scene" });
    const onViewReady = vi.fn();
    const onSceneViewDetected = vi.fn();
    const onBootReady = vi.fn();
    const onHostsResolved = vi.fn();
    const onBootFailure = vi.fn();

    const controller = createBootController({
      resolveHosts: () => ({ mapHost: map.host as any, sceneHost: scene.host as any }),
      getCurrentViewMode: () => "2d",
      onHostsResolved,
      onBootReady,
      onViewReady,
      onSceneViewDetected,
      onBootFailure
    });

    controller.boot();
    controller.boot();

    expect(onBootReady).toHaveBeenCalledTimes(1);
    expect(onHostsResolved).toHaveBeenCalledTimes(1);
    expect(onViewReady).toHaveBeenCalledWith({ kind: "map" }, "2d");
    expect(onSceneViewDetected).toHaveBeenCalledWith({ kind: "scene" });
    expect(onBootFailure).not.toHaveBeenCalled();
    expect(Array.isArray(map.listeners.arcgisViewReadyChange)).toBe(true);
    expect(Array.isArray(scene.listeners.arcgisViewReadyChange)).toBe(true);
  });

  test("fails with bounded retries when map host never appears", () => {
    const onBootFailure = vi.fn();
    const controller = createBootController({
      resolveHosts: () => ({ mapHost: null, sceneHost: null }),
      getCurrentViewMode: () => "2d",
      onHostsResolved: vi.fn(),
      onBootReady: vi.fn(),
      onViewReady: vi.fn(),
      onSceneViewDetected: vi.fn(),
      onBootFailure,
      maxRetries: 1,
      retryDelayMs: 10
    });

    controller.boot();
    vi.advanceTimersByTime(20);

    expect(onBootFailure).toHaveBeenCalledTimes(1);
  });
});
