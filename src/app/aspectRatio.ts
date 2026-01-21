type AspectRatioState = {
  getCurrentAspectRatio: () => { width: number; height: number } | null;
  setCurrentAspectRatio: (value: { width: number; height: number } | null) => void;
  getIsRotated: () => boolean;
  setIsRotated: (value: boolean) => void;
};

type AspectRatioConfig = {
  getEl: (id: string) => HTMLElement;
  getView: () => any;
  scheduleProjectSave: () => void;
};

const scheduleAspectRatioUpdate = (state: AspectRatioState, config: AspectRatioConfig) => {
  requestAnimationFrame(() => {
    applyAspectRatio(state, config);
    const view = config.getView();
    if (view && typeof view.resize === "function") {
      view.resize();
    }
  });
};

const applyAspectRatio = (state: AspectRatioState, config: AspectRatioConfig) => {
  const currentAspectRatio = state.getCurrentAspectRatio();
  if (!currentAspectRatio) return;
  const mapContainer = config.getEl("map-container");
  const mapWrapper = config.getEl("map-wrapper");

  const containerWidth = mapContainer.clientWidth;
  const containerHeight = mapContainer.clientHeight;
  const ratioWidth = state.getIsRotated() ? currentAspectRatio.height : currentAspectRatio.width;
  const ratioHeight = state.getIsRotated() ? currentAspectRatio.width : currentAspectRatio.height;
  const targetRatio = ratioWidth / ratioHeight;

  const widthBasedHeight = containerWidth / targetRatio;
  let finalWidth = containerWidth;
  let finalHeight = widthBasedHeight;

  if (widthBasedHeight > containerHeight) {
    finalHeight = containerHeight;
    finalWidth = containerHeight * targetRatio;
  }

  mapWrapper.style.width = `${Math.floor(finalWidth)}px`;
  mapWrapper.style.height = `${Math.floor(finalHeight)}px`;
  mapWrapper.style.maxWidth = `${Math.floor(finalWidth)}px`;
  mapWrapper.style.maxHeight = `${Math.floor(finalHeight)}px`;
};

const rotateMap = (state: AspectRatioState, config: AspectRatioConfig) => {
  if (!state.getCurrentAspectRatio()) return;
  state.setIsRotated(!state.getIsRotated());
  scheduleAspectRatioUpdate(state, config);
  config.scheduleProjectSave();
};

const resetMapWrapperSize = (config: AspectRatioConfig) => {
  const mapWrapper = config.getEl("map-wrapper");
  mapWrapper.style.width = "";
  mapWrapper.style.height = "";
  mapWrapper.style.maxWidth = "";
  mapWrapper.style.maxHeight = "";
};

const handleCustomDimensions = (state: AspectRatioState, config: AspectRatioConfig) => {
  const widthValue = Number((config.getEl("custom-width") as any).value);
  const heightValue = Number((config.getEl("custom-height") as any).value);
  const width = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 9;
  const height = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 16;
  state.setCurrentAspectRatio({ width, height });
  scheduleAspectRatioUpdate(state, config);
  config.scheduleProjectSave();
};

export type { AspectRatioConfig, AspectRatioState };
export { applyAspectRatio, handleCustomDimensions, resetMapWrapperSize, rotateMap, scheduleAspectRatioUpdate };
