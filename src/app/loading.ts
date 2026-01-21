type LoadingState = {
  loadingStartTime: number;
  loadingTimer: number | null;
};

const createLoadingOverlayController = () => {
  const state: LoadingState = {
    loadingStartTime: 0,
    loadingTimer: null
  };

  const showLoadingOverlay = () => {
    const overlay = document.getElementById("map-loading-overlay");
    if (!overlay) return;
    overlay.classList.remove("is-hidden");
    overlay.setAttribute("aria-busy", "true");
    state.loadingStartTime = performance.now();
  };

  const hideLoadingOverlay = () => {
    const overlay = document.getElementById("map-loading-overlay");
    if (!overlay) return;
    overlay.classList.add("is-hidden");
    overlay.setAttribute("aria-busy", "false");
  };

  const finishLoadingOverlay = () => {
    const elapsed = performance.now() - state.loadingStartTime;
    const remaining = Math.max(0, 2000 - elapsed);
    if (state.loadingTimer) {
      window.clearTimeout(state.loadingTimer);
    }
    state.loadingTimer = window.setTimeout(() => {
      hideLoadingOverlay();
    }, remaining);
  };

  return {
    showLoadingOverlay,
    hideLoadingOverlay,
    finishLoadingOverlay
  };
};

export { createLoadingOverlayController };
