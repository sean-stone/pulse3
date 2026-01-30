type LayoutState = {
  responsiveMediaQuery: MediaQueryList | null;
  hasAppliedMobileDefaultLayout: boolean;
};

type LayoutConfig = {
  handleLayoutChange: (event: Event) => void;
  attachAnimationPanelTo: (hostId?: string) => void;
  getSelectedLayerIndex: () => number;
};

const applyResponsiveLayout = (state: LayoutState, config: LayoutConfig, isMobile: boolean) => {
  document.body.classList.toggle("is-mobile", isMobile);
  document.body.classList.toggle("is-portrait", window.matchMedia("(orientation: portrait)").matches);
  const orientationOverlay = document.getElementById("orientation-overlay");
  const shouldShowOrientation =
    isMobile && window.matchMedia("(orientation: portrait)").matches;
  if (orientationOverlay) {
    orientationOverlay.classList.toggle("show", shouldShowOrientation);
    orientationOverlay.setAttribute("aria-hidden", shouldShowOrientation ? "false" : "true");
  }

  const mobileHeader = document.getElementById("mobile-header");
  const primaryControls = document.getElementById("primary-controls");
  const panelAnchor = document.getElementById("panel-anchor");
  const sidePanel = document.getElementById("side-panel");
  const basemapWidget = document.getElementById("basemap-widget");
  const basemapSection = document.getElementById("basemap-section");
  const layoutSection = document.getElementById("layout-section");
  const exportSection = document.getElementById("export-section");
  const timeline = document.getElementById("timeline-container");
  const mainArea = document.getElementById("main-area");
  const timelineResizer = document.getElementById("timeline-resizer");

  if (isMobile) {
    if (mobileHeader && primaryControls && mobileHeader.firstElementChild !== primaryControls) {
      mobileHeader.appendChild(primaryControls);
    }
    if (basemapWidget && basemapSection && basemapWidget.firstElementChild !== basemapSection) {
      basemapWidget.appendChild(basemapSection);
    }
    if (timeline && exportSection && timeline.nextElementSibling !== exportSection) {
      timeline.insertAdjacentElement("afterend", exportSection);
    }
    if (!state.hasAppliedMobileDefaultLayout) {
      const defaultTab = document.querySelector(
        'calcite-tab-title[data-layout="default"]'
      ) as HTMLElement | null;
      if (defaultTab) {
        document.querySelectorAll("calcite-tab-title").forEach((tab) => {
          tab.toggleAttribute("selected", tab === defaultTab);
        });
        config.handleLayoutChange({ target: defaultTab } as unknown as Event);
      }
      state.hasAppliedMobileDefaultLayout = true;
    }
  } else {
    state.hasAppliedMobileDefaultLayout = false;
    if (panelAnchor && primaryControls && panelAnchor.nextElementSibling !== primaryControls) {
      panelAnchor.insertAdjacentElement("afterend", primaryControls);
    }
    if (sidePanel && basemapSection && !sidePanel.contains(basemapSection)) {
      if (layoutSection) {
        sidePanel.insertBefore(basemapSection, layoutSection);
      } else {
        sidePanel.appendChild(basemapSection);
      }
    }
    if (sidePanel && exportSection && !sidePanel.contains(exportSection)) {
      sidePanel.appendChild(exportSection);
    }
    if (mainArea && timeline && !mainArea.contains(timeline)) {
      if (timelineResizer && timelineResizer.nextElementSibling !== timeline) {
        timelineResizer.insertAdjacentElement("afterend", timeline);
      } else {
        mainArea.appendChild(timeline);
      }
    }
  }

  const selectedLayerIndex = config.getSelectedLayerIndex();
  config.attachAnimationPanelTo(
    selectedLayerIndex >= 0 ? `animation-settings-host-${selectedLayerIndex}` : undefined
  );
};

const setupResponsiveLayout = (state: LayoutState, config: LayoutConfig) => {
  if (state.responsiveMediaQuery) return;
  state.responsiveMediaQuery = window.matchMedia("(max-width: 900px)");
  const apply = () => applyResponsiveLayout(state, config, state.responsiveMediaQuery?.matches ?? false);
  apply();
  if ("addEventListener" in state.responsiveMediaQuery) {
    state.responsiveMediaQuery.addEventListener("change", apply);
  } else if (typeof (state.responsiveMediaQuery as any).addListener === "function") {
    (state.responsiveMediaQuery as any).addListener(apply);
  }
  const orientationQuery = window.matchMedia("(orientation: portrait)");
  if ("addEventListener" in orientationQuery) {
    orientationQuery.addEventListener("change", apply);
  } else if (typeof (orientationQuery as any).addListener === "function") {
    (orientationQuery as any).addListener(apply);
  }
};

export type { LayoutConfig, LayoutState };
export { applyResponsiveLayout, setupResponsiveLayout };
