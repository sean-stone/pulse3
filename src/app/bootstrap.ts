type ViewMode = "2d" | "3d";

type ArcgisViewHostElement = HTMLElement & {
  view?: unknown;
  map?: unknown;
};

type HostRefs = {
  mapHost: ArcgisViewHostElement | null;
  sceneHost: ArcgisViewHostElement | null;
};

type BootControllerConfig = {
  retryDelayMs?: number;
  maxRetries?: number;
  resolveHosts: () => HostRefs;
  getCurrentViewMode: () => ViewMode;
  onHostsResolved: (hosts: HostRefs) => void;
  onBootReady: () => void;
  onViewReady: (nextView: unknown, mode: ViewMode) => void;
  onSceneViewDetected: (sceneView: unknown) => void;
  onBootFailure: (message: string) => void;
};

const getEventView = (event: Event): unknown => {
  const target = event.target as { view?: unknown } | null;
  return target?.view;
};

const createBootController = (config: BootControllerConfig) => {
  const retryDelayMs = config.retryDelayMs ?? 100;
  const maxRetries = config.maxRetries ?? 40;

  let hasBooted = false;
  let retryCount = 0;
  let retryTimer: number | null = null;

  const clearRetryTimer = () => {
    if (retryTimer) {
      globalThis.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const maybeActivateReadyView = (nextView: unknown, mode: ViewMode) => {
    if (!nextView) return;
    config.onViewReady(nextView, mode);
  };

  const scheduleRetry = () => {
    if (retryCount >= maxRetries) {
      retryCount = 0;
      clearRetryTimer();
      config.onBootFailure("Unable to boot app: #arcgisMap host element was not found.");
      return;
    }
    retryCount += 1;
    if (!retryTimer) {
      retryTimer = globalThis.setTimeout(() => {
        retryTimer = null;
        boot();
      }, retryDelayMs);
    }
  };

  const bindReadyListeners = (mapHost: ArcgisViewHostElement, sceneHost: ArcgisViewHostElement | null) => {
    mapHost.addEventListener("arcgisViewReadyChange", (event: Event) => {
      maybeActivateReadyView(getEventView(event), "2d");
    });
    sceneHost?.addEventListener("arcgisViewReadyChange", (event: Event) => {
      const sceneView = getEventView(event);
      maybeActivateReadyView(sceneView, "3d");
      config.onSceneViewDetected(sceneView);
    });
  };

  const boot = () => {
    if (hasBooted) return;

    const hosts = config.resolveHosts();
    const mapHost = hosts.mapHost;
    const sceneHost = hosts.sceneHost;
    if (!mapHost) {
      scheduleRetry();
      return;
    }

    clearRetryTimer();
    retryCount = 0;
    hasBooted = true;
    config.onHostsResolved({ mapHost, sceneHost });
    config.onBootReady();

    const currentViewMode = config.getCurrentViewMode();
    if (mapHost.view && currentViewMode === "2d") {
      maybeActivateReadyView(mapHost.view, "2d");
    }
    if (sceneHost?.view && currentViewMode === "3d") {
      maybeActivateReadyView(sceneHost.view, "3d");
    }
    if (sceneHost?.view) {
      config.onSceneViewDetected(sceneHost.view);
    }

    bindReadyListeners(mapHost, sceneHost);
  };

  return {
    boot
  };
};

export type { ArcgisViewHostElement, ViewMode };
export { createBootController };
