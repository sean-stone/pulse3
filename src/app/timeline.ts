
import type Point from "@arcgis/core/geometry/Point";

import { clipColors } from "../animationTypes";
import type { LayerAnimation, LayerData, PointKeyframe, PointKeyframeEasing } from "../types";

import { isPlaceholderAnimation } from "./animationUtils";
import { TIMELINE_SNAP_INCREMENT, TIMELINE_SNAP_PX } from "./constants";

export type TimelineState = {
  timelineZoom: number;
  timelineZoomAuto: boolean;
  timelineDurationOverride: number | null;
  selectedTimelineClip: HTMLElement | null;
  selectedTimelineAnimation: { layerIdx: number; animIdx: number } | null;
  selectedTimelineKeyframe: { layerIdx: number; keyframeIdx: number } | null;
  isScrubbingTimeline: boolean;
  timelinePanelWidth: number;
  timelinePanelResizeState: { startX: number; startWidth: number } | null;
  isSyncingTimelineScroll: boolean;
  timelineSnapEnabled: boolean;
  timelineGridVisible: boolean;
  dragState: {
    type: "move" | "resize-left" | "resize-right";
    layerIdx: number;
    animIdx: number;
    startX: number;
    originalStart: number;
    originalDuration: number;
    clipLeft: number;
    clipWidth: number;
  } | null;
  keyframeDragState: {
    layerIdx: number;
    keyframe: PointKeyframe;
    startX: number;
    originalTime: number;
    marker: HTMLElement;
  } | null;
};

export type TimelineConfig = {
  getEl: (id: string) => HTMLElement;
  getGraphicsLayers: () => LayerData[];
  getSelectedLayerIndex: () => number;
  isPlaying?: () => boolean;
  getCurrentTime: () => number;
  setCurrentTime: (value: number) => void;
  updatePlayhead: () => void;
  syncAnimationStartInput: () => void;
  applyAnimationsAtTime: (time: number) => void;
  resetAnimationGeometryCaches: () => void;
  updatePrimaryActionsState: () => void;
  updateLayersList: () => void;
  updateAnimationOptions: () => void;
  updateExportWarning: () => void;
  selectLayer: (layerIdx: number, shouldFocus?: boolean) => void;
  moveLayer: (layerIdx: number, direction: -1 | 1) => void;
  removeLayer: (layerIdx: number, options?: { confirmHostId?: string }) => void;
  duplicateLayer: (layerIdx: number) => Promise<void>;
  zoomToLayer: (layerData: LayerData) => void;
  scheduleProjectSave: () => void;
  sanitizePlainText: (value: string, fallback: string) => string;
  setCalciteValue: (element: HTMLElement, value: string) => void;
  upsertPointKeyframe: (layerData: LayerData, geometry: Point, time: number) => void;
  upsertLayerKeyframeAtCurrentTime?: (layerData: LayerData) => void;
  hasPointKeyframes: (layerData: LayerData) => boolean;
  removeAnimationAt: (layerIdx: number, animIdx: number) => void;
  removePointKeyframeAt?: (layerIdx: number, keyframeIdx: number) => void;
  restartPlaybackFromStart?: () => void;
};

export const createTimelineController = (state: TimelineState, config: TimelineConfig) => {
  const applyTimelinePanelWidth = () => {
    const panel = document.getElementById("timeline-layers-panel");
    if (!panel) return;
    panel.style.width = `${state.timelinePanelWidth}px`;
    panel.style.flexBasis = `${state.timelinePanelWidth}px`;
  };

  const getBaseTimelineDuration = () => {
    let maxEndTime = 0;
    config.getGraphicsLayers().forEach((layerData) => {
      layerData.animations.forEach((anim) => {
        if (isPlaceholderAnimation(anim)) {
          return;
        }
        const endTime = anim.start + anim.duration;
        if (endTime > maxEndTime) maxEndTime = endTime;
      });
      if (layerData.type === "point" && layerData.pointKeyframes?.length) {
        const lastKeyframe = layerData.pointKeyframes[layerData.pointKeyframes.length - 1];
        if (lastKeyframe.time > maxEndTime) {
          maxEndTime = lastKeyframe.time;
        }
      }
    });
    return maxEndTime;
  };

  const getMinTimelineDuration = () => Math.max(getBaseTimelineDuration(), 0.1);

  const getDefaultTimelineDuration = () => Math.max(5, getMinTimelineDuration());

  const getTimelineDuration = () => {
    const minDuration = getMinTimelineDuration();
    if (state.timelineDurationOverride && state.timelineDurationOverride >= minDuration) {
      return state.timelineDurationOverride;
    }
    return getDefaultTimelineDuration();
  };

  const snapTimeToGrid = (value: number) => {
    if (!state.timelineSnapEnabled) return value;
    return Math.round(value / TIMELINE_SNAP_INCREMENT) * TIMELINE_SNAP_INCREMENT;
  };

  const snapTimeToGridCeil = (value: number) => {
    if (!state.timelineSnapEnabled) return value;
    return Math.ceil(value / TIMELINE_SNAP_INCREMENT) * TIMELINE_SNAP_INCREMENT;
  };

  const getSnapThresholdSeconds = () => TIMELINE_SNAP_PX / state.timelineZoom;

  const getLayerSnapPoints = (layerIdx: number, excludeAnimIdx?: number) => {
    const layerData = config.getGraphicsLayers()[layerIdx];
    if (!layerData) return [];
    const points: number[] = [];
    layerData.animations.forEach((anim, idx) => {
      if (isPlaceholderAnimation(anim)) return;
      if (excludeAnimIdx !== undefined && excludeAnimIdx === idx) return;
      points.push(anim.start, anim.start + anim.duration);
    });
    return points;
  };

  const getNeighborClips = (layerData: LayerData, animIdx: number) => {
    const anims = layerData.animations
      .map((anim, idx) => ({ anim, idx }))
      .filter(({ anim }) => !isPlaceholderAnimation(anim))
      .sort((a, b) => a.anim.start - b.anim.start);
    const current = anims.findIndex((entry) => entry.idx === animIdx);
    if (current === -1) {
      return { prev: null as LayerAnimation | null, next: null as LayerAnimation | null };
    }
    return {
      prev: current > 0 ? anims[current - 1].anim : null,
      next: current < anims.length - 1 ? anims[current + 1].anim : null
    };
  };

  const getOtherAnimations = (layerData: LayerData, animIdx: number) =>
    layerData.animations
      .map((anim, idx) => ({ anim, idx }))
      .filter(({ anim, idx }) => !isPlaceholderAnimation(anim) && idx !== animIdx)
      .map(({ anim }) => anim)
      .sort((a, b) => a.start - b.start);

  const shouldBumpAtStart = (layerData: LayerData, animIdx: number) => {
    const others = getOtherAnimations(layerData, animIdx);
    if (others.length === 0) return false;
    return others[0].start <= TIMELINE_SNAP_INCREMENT;
  };

  const insertAtStartAndShift = (layerData: LayerData, animIdx: number) => {
    const anim = layerData.animations[animIdx];
    anim.start = 0;
    let cursor = snapTimeToGridCeil(anim.duration);
    const others = getOtherAnimations(layerData, animIdx);
    for (const other of others) {
      if (other.start < cursor) {
        other.start = cursor;
      }
      cursor = snapTimeToGridCeil(other.start + other.duration);
    }
  };

  const getNeighborBounds = (layerData: LayerData, animIdx: number) => {
    const { prev, next } = getNeighborClips(layerData, animIdx);
    return {
      prevEnd: prev ? prev.start + prev.duration : 0,
      nextStart: next ? next.start : Number.POSITIVE_INFINITY
    };
  };

  const clampNonOverlappingStart = (layerData: LayerData, animIdx: number, start: number, duration: number) => {
    const { prevEnd, nextStart } = getNeighborBounds(layerData, animIdx);
    const minStart = prevEnd;
    const maxStart = Number.isFinite(nextStart) ? Math.max(minStart, nextStart - duration) : Number.POSITIVE_INFINITY;
    return Math.max(minStart, Math.min(start, maxStart));
  };

  const clampNonOverlappingEnd = (layerData: LayerData, animIdx: number, end: number, startTime: number) => {
    const { prevEnd, nextStart } = getNeighborBounds(layerData, animIdx);
    const minEnd = Math.max(startTime + 0.1, prevEnd);
    const maxEnd = Number.isFinite(nextStart) ? Math.max(minEnd, nextStart) : Number.POSITIVE_INFINITY;
    return Math.max(minEnd, Math.min(end, maxEnd));
  };

  const reflowTimelineOrder = (layerData: LayerData, movedAnimIdx: number, snappedStart: number) => {
    const movedAnim = layerData.animations[movedAnimIdx];
    if (!movedAnim || isPlaceholderAnimation(movedAnim)) return;

    movedAnim.start = Math.max(0, snappedStart);
    const ordered = layerData.animations
      .map((anim, idx) => ({ anim, idx }))
      .filter(({ anim }) => !isPlaceholderAnimation(anim))
      .sort((a, b) => a.anim.start - b.anim.start || a.idx - b.idx);

    let cursor = 0;
    ordered.forEach(({ anim }) => {
      const nextStart = Math.max(anim.start, cursor);
      anim.start = snapTimeToGrid(nextStart);
      cursor = anim.start + anim.duration;
    });
  };

  const getNextNonOverlappingStart = (
    layerData: LayerData,
    desiredStart: number,
    duration: number,
    excludeAnimIdx?: number
  ) => {
    const animations = layerData.animations
      .map((anim, idx) => ({ anim, idx }))
      .filter(({ anim, idx }) => !isPlaceholderAnimation(anim) && idx !== excludeAnimIdx)
      .sort((a, b) => a.anim.start - b.anim.start);
    let nextStart = desiredStart;
    let moved = true;
    let safety = 0;

    while (moved && safety < 100) {
      moved = false;
      safety += 1;
      for (const { anim } of animations) {
        const animStart = anim.start;
        const animEnd = anim.start + anim.duration;
        if (nextStart < animEnd && nextStart + duration > animStart) {
          nextStart = animEnd;
          moved = true;
        }
      }
    }

    return nextStart;
  };

  const snapMoveStart = (layerIdx: number, animIdx: number, proposedStart: number, duration: number) => {
    if (!state.timelineSnapEnabled) return Math.max(0, proposedStart);
    const threshold = getSnapThresholdSeconds();
    const points = getLayerSnapPoints(layerIdx, animIdx);
    let bestStart = snapTimeToGrid(proposedStart);
    let bestDelta = Number.POSITIVE_INFINITY;
    const proposedEnd = proposedStart + duration;

    points.forEach((point) => {
      const deltaStart = Math.abs(proposedStart - point);
      if (deltaStart <= threshold && deltaStart < bestDelta) {
        bestDelta = deltaStart;
        bestStart = point;
      }
      const deltaEnd = Math.abs(proposedEnd - point);
      if (deltaEnd <= threshold && deltaEnd < bestDelta) {
        bestDelta = deltaEnd;
        bestStart = point - duration;
      }
    });

    return Math.max(0, bestStart);
  };

  const snapResizeStart = (layerIdx: number, animIdx: number, proposedStart: number, endTime: number) => {
    if (!state.timelineSnapEnabled) return Math.min(proposedStart, endTime - 0.1);
    const threshold = getSnapThresholdSeconds();
    const points = getLayerSnapPoints(layerIdx, animIdx);
    let bestStart = snapTimeToGrid(proposedStart);
    let bestDelta = Number.POSITIVE_INFINITY;

    points.forEach((point) => {
      const delta = Math.abs(proposedStart - point);
      if (delta <= threshold && delta < bestDelta) {
        bestDelta = delta;
        bestStart = point;
      }
    });

    return Math.min(bestStart, endTime - 0.1);
  };

  const snapResizeEnd = (layerIdx: number, animIdx: number, proposedEnd: number, startTime: number) => {
    if (!state.timelineSnapEnabled) return Math.max(proposedEnd, startTime + 0.1);
    const threshold = getSnapThresholdSeconds();
    const points = getLayerSnapPoints(layerIdx, animIdx);
    let bestEnd = snapTimeToGrid(proposedEnd);
    let bestDelta = Number.POSITIVE_INFINITY;

    points.forEach((point) => {
      const delta = Math.abs(proposedEnd - point);
      if (delta <= threshold && delta < bestDelta) {
        bestDelta = delta;
        bestEnd = point;
      }
    });

    return Math.max(bestEnd, startTime + 0.1);
  };
  const applyTimelineGridState = () => {
    const tracks = document.getElementById("timeline-tracks");
    if (tracks) {
      const gridStep = Math.max(16, state.timelineZoom * 0.5);
      tracks.classList.toggle("show-grid", state.timelineGridVisible);
      tracks.style.setProperty("--timeline-grid-step", `${gridStep}px`);
    }
    const gridButton = document.getElementById("timeline-grid-toggle");
    if (gridButton) {
      gridButton.setAttribute("data-active", String(state.timelineGridVisible));
      gridButton.setAttribute("aria-pressed", String(state.timelineGridVisible));
    }
  };

  const applyTimelineSnapState = () => {
    const snapButton = document.getElementById("timeline-snap-toggle");
    if (snapButton) {
      snapButton.setAttribute("data-active", String(state.timelineSnapEnabled));
      snapButton.setAttribute("aria-pressed", String(state.timelineSnapEnabled));
    }
  };

  const getSelectedTimelineKeyframeFrame = () => {
    if (!state.selectedTimelineKeyframe) return null;
    const { layerIdx, keyframeIdx } = state.selectedTimelineKeyframe;
    const layerData = config.getGraphicsLayers()[layerIdx];
    const frame = layerData?.pointKeyframes?.[keyframeIdx];
    if (!layerData || !frame) return null;
    return { layerData, frame };
  };

  const updateKeyframeEasingControl = () => {
    const wrap = document.getElementById("timeline-keyframe-easing-wrap");
    const select = document.getElementById("timeline-keyframe-easing") as any;
    if (!wrap || !select) return;
    const selected = getSelectedTimelineKeyframeFrame();
    const isViewTrackKeyframe = Boolean(selected?.layerData?.isViewTrack);
    if (!selected || !isViewTrackKeyframe) {
      wrap.setAttribute("hidden", "");
      select.setAttribute("disabled", "true");
      return;
    }
    wrap.removeAttribute("hidden");
    select.removeAttribute("disabled");
    const easing = (() => {
      const value = selected.frame.easing;
      if (value === "ease-in") return "ease-in";
      if (value === "ease-out") return "ease-out";
      if (value === "ease-in-out") return "ease-in-out";
      return "linear";
    })();
    if (String(select.value || "") !== easing) {
      config.setCalciteValue(select as HTMLElement, easing);
    }
  };

  const clearSelectedTimelineAnimation = () => {
    if (state.selectedTimelineClip) {
      state.selectedTimelineClip.classList.remove("selected");
    }
    state.selectedTimelineAnimation = null;
    state.selectedTimelineClip = null;
    state.selectedTimelineKeyframe = null;
    const deleteButton = document.getElementById("timeline-delete-clip-btn");
    if (deleteButton) {
      deleteButton.setAttribute("disabled", "true");
      deleteButton.classList.remove("show");
    }
    const duplicateButton = document.getElementById("timeline-duplicate-btn");
    if (duplicateButton) {
      duplicateButton.setAttribute("disabled", "true");
    }
    updateKeyframeEasingControl();
  };

  const setSelectedTimelineAnimation = (layerIdx: number, animIdx: number, clip?: HTMLElement) => {
    if (state.selectedTimelineClip && state.selectedTimelineClip !== clip) {
      state.selectedTimelineClip.classList.remove("selected");
    }
    state.selectedTimelineAnimation = { layerIdx, animIdx };
    state.selectedTimelineKeyframe = null;
    if (clip) {
      clip.classList.add("selected");
      state.selectedTimelineClip = clip;
    }
    const deleteButton = document.getElementById("timeline-delete-clip-btn");
    if (deleteButton) {
      deleteButton.removeAttribute("disabled");
      deleteButton.classList.add("show");
    }
    const duplicateButton = document.getElementById("timeline-duplicate-btn");
    if (duplicateButton) {
      duplicateButton.removeAttribute("disabled");
    }
    updateKeyframeEasingControl();
  };

  const removeSelectedTimelineAnimation = () => {
    if (state.selectedTimelineKeyframe) {
      const { layerIdx, keyframeIdx } = state.selectedTimelineKeyframe;
      config.removePointKeyframeAt?.(layerIdx, keyframeIdx);
      clearSelectedTimelineAnimation();
      return;
    }
    if (!state.selectedTimelineAnimation) return;
    const { layerIdx, animIdx } = state.selectedTimelineAnimation;
    config.removeAnimationAt(layerIdx, animIdx);
    clearSelectedTimelineAnimation();
  };

  const updateTimeline = () => {
    const layersPanel = config.getEl("timeline-layers-panel");
    const tracksContainer = config.getEl("timeline-tracks-container");
    const tracksArea = config.getEl("timeline-tracks-area");
    const ruler = config.getEl("timeline-ruler");
    const emptyMsg = config.getEl("timeline-empty");
    const durationInput = config.getEl("timeline-duration") as any;
    config.updatePrimaryActionsState();
    applyTimelinePanelWidth();

    const minDuration = getMinTimelineDuration();
    const maxEndTime = getTimelineDuration();

    durationInput.min = minDuration.toFixed(1);
    config.setCalciteValue(durationInput as HTMLElement, maxEndTime.toFixed(1));

    if (state.timelineZoomAuto) {
      const containerWidth = tracksContainer.clientWidth;
      if (containerWidth > 0) {
        state.timelineZoom = Math.min(200, Math.max(20, containerWidth / maxEndTime));
      }
    }
    applyTimelineGridState();
    applyTimelineSnapState();
    const totalWidth = maxEndTime * state.timelineZoom;
    const zoomLabel = document.getElementById("timeline-zoom-label");
    if (zoomLabel) {
      const zoomPercent = Math.round((state.timelineZoom / 50) * 100);
      zoomLabel.textContent = `${zoomPercent}%`;
    }

    const animatedLayers = config
      .getGraphicsLayers()
      .filter((layer) => layer.animations.length > 0 || config.hasPointKeyframes(layer));
    const orderedLayers = [...animatedLayers].reverse();
    let selectionVisible = false;

    if (animatedLayers.length === 0) {
      emptyMsg.style.display = "block";
      layersPanel.innerHTML = "";
      tracksArea.innerHTML = "";
      ruler.innerHTML = "";
      clearSelectedTimelineAnimation();
      config.updateExportWarning();
      return;
    }

    emptyMsg.style.display = "none";

    ruler.innerHTML = "";
    ruler.style.width = `${totalWidth}px`;
    for (let t = 0; t <= maxEndTime; t += 0.5) {
      const tick = document.createElement("div");
      tick.className = "ruler-tick";
      tick.style.left = `${t * state.timelineZoom}px`;
      if (t % 1 === 0) {
        tick.textContent = `${t}s`;
      }
      ruler.appendChild(tick);
    }

    layersPanel.innerHTML = "";
    const lockedBottomIndex = config.getGraphicsLayers().findIndex((layer) => layer.isViewTrack);
    orderedLayers.forEach((layerData) => {
      const layerIndex = config.getGraphicsLayers().indexOf(layerData);
      const isLockedLayer = Boolean(layerData.isViewTrack);
      const label = document.createElement("div");
      label.className = "timeline-layer-label";
      label.dataset.layerIdx = String(layerIndex);
      if (layerIndex === config.getSelectedLayerIndex()) {
        label.classList.add("selected");
      }

      const reorder = document.createElement("div");
      reorder.className = "timeline-layer-reorder";

      const moveUpButton = document.createElement("calcite-button");
      moveUpButton.className = "timeline-move-layer-btn timeline-move-layer-up";
      moveUpButton.setAttribute("appearance", "transparent");
      moveUpButton.setAttribute("scale", "s");
      moveUpButton.setAttribute("icon-start", "chevron-up");
      moveUpButton.title = "Move layer up";
      moveUpButton.setAttribute("aria-label", "Move layer up");
      if (isLockedLayer || layerIndex >= config.getGraphicsLayers().length - 1) {
        moveUpButton.setAttribute("disabled", "true");
      }
      moveUpButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isLockedLayer && layerIndex < config.getGraphicsLayers().length - 1) {
          config.moveLayer(layerIndex, 1);
        }
      });
      reorder.appendChild(moveUpButton);

      const moveDownButton = document.createElement("calcite-button");
      moveDownButton.className = "timeline-move-layer-btn timeline-move-layer-down";
      moveDownButton.setAttribute("appearance", "transparent");
      moveDownButton.setAttribute("scale", "s");
      moveDownButton.setAttribute("icon-start", "chevron-down");
      moveDownButton.title = "Move layer down";
      moveDownButton.setAttribute("aria-label", "Move layer down");
      const minMovableIndex = lockedBottomIndex >= 0 ? lockedBottomIndex + 1 : 0;
      if (isLockedLayer || layerIndex <= minMovableIndex) {
        moveDownButton.setAttribute("disabled", "true");
      }
      moveDownButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isLockedLayer && layerIndex > minMovableIndex) {
          config.moveLayer(layerIndex, -1);
        }
      });
      reorder.appendChild(moveDownButton);

      const name = document.createElement("span");
      name.className = "timeline-layer-name";
      name.textContent = layerData.name;
      label.appendChild(reorder);

      const startRename = () => {
        const input = document.createElement("calcite-input") as any;
        input.value = layerData.name;
        input.setAttribute("scale", "s");
        input.className = "timeline-layer-input";
        const finish = (commit: boolean) => {
          if (commit) {
            const next = config.sanitizePlainText(input.value, layerData.name);
            layerData.name = next;
          }
          config.updateLayersList();
          updateTimeline();
          config.updateAnimationOptions();
          config.scheduleProjectSave();
        };
        input.addEventListener("keydown", (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === "Enter") {
            finish(true);
          } else if (keyEvent.key === "Escape") {
            finish(false);
          }
        });
        input.addEventListener("blur", () => finish(true));
        label.replaceChild(input, name);
        if (typeof input.setFocus === "function") {
          input.setFocus();
        } else {
          input.focus();
        }
        if (typeof input.select === "function") {
          input.select();
        }
      };

      name.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        if (isLockedLayer) return;
        startRename();
      });
      label.appendChild(name);

      const actions = document.createElement("div");
      actions.className = "timeline-layer-actions";

      const renameButton = document.createElement("calcite-button");
      renameButton.className = "timeline-rename-btn";
      renameButton.setAttribute("appearance", "transparent");
      renameButton.setAttribute("scale", "s");
      renameButton.setAttribute("icon-start", "pencil");
      renameButton.title = "Rename layer";
      renameButton.setAttribute("aria-label", "Rename layer");
      renameButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isLockedLayer) return;
        startRename();
      });
      if (isLockedLayer) {
        renameButton.setAttribute("disabled", "true");
      }
      actions.appendChild(renameButton);

      const duplicateLayerButton = document.createElement("calcite-button");
      duplicateLayerButton.className = "timeline-duplicate-layer-btn";
      duplicateLayerButton.setAttribute("appearance", "transparent");
      duplicateLayerButton.setAttribute("scale", "s");
      duplicateLayerButton.setAttribute("icon-start", "copy");
      duplicateLayerButton.title = "Duplicate layer";
      duplicateLayerButton.setAttribute("aria-label", "Duplicate layer");
      duplicateLayerButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isLockedLayer && layerIndex >= 0) {
          void config.duplicateLayer(layerIndex);
        }
      });
      if (isLockedLayer) {
        duplicateLayerButton.setAttribute("disabled", "true");
      }
      actions.appendChild(duplicateLayerButton);

      const deleteButton = document.createElement("calcite-button");
      deleteButton.className = "timeline-delete-btn";
      deleteButton.setAttribute("appearance", "transparent");
      deleteButton.setAttribute("scale", "s");
      deleteButton.setAttribute("icon-start", "trash");
      deleteButton.title = "Delete layer";
      deleteButton.setAttribute("aria-label", "Delete layer");
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isLockedLayer && layerIndex >= 0) {
          config.removeLayer(layerIndex, { confirmHostId: "timeline-container" });
        }
      });
      if (isLockedLayer) {
        deleteButton.setAttribute("disabled", "true");
      }
      actions.appendChild(deleteButton);

      const zoomButton = document.createElement("calcite-button");
      zoomButton.className = "timeline-zoom-btn";
      zoomButton.setAttribute("appearance", "transparent");
      zoomButton.setAttribute("scale", "s");
      zoomButton.setAttribute("icon-start", "search");
      zoomButton.title = "Zoom to layer";
      zoomButton.setAttribute("aria-label", "Zoom to layer");
      zoomButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isLockedLayer) return;
        config.zoomToLayer(layerData);
      });
      if (isLockedLayer) {
        zoomButton.setAttribute("disabled", "true");
      }
      actions.appendChild(zoomButton);

      if (layerData.type === "point") {
        const keyframeButton = document.createElement("calcite-button");
        keyframeButton.className = "timeline-keyframe-btn";
        keyframeButton.setAttribute("appearance", "transparent");
        keyframeButton.setAttribute("scale", "s");
        keyframeButton.setAttribute("icon-start", "plus");
        keyframeButton.setAttribute("title", "Add keyframe");
        keyframeButton.setAttribute("aria-label", "Add keyframe");
        keyframeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          if (config.upsertLayerKeyframeAtCurrentTime) {
            config.upsertLayerKeyframeAtCurrentTime(layerData);
            updateTimeline();
            config.applyAnimationsAtTime(config.getCurrentTime());
            return;
          }
          const graphic = (layerData.layer.graphics as any).getItemAt?.(0) ?? layerData.layer.graphics?.items?.[0];
          if (graphic?.geometry?.type === "point") {
            config.upsertPointKeyframe(layerData, graphic.geometry as Point, config.getCurrentTime());
            updateTimeline();
            config.applyAnimationsAtTime(config.getCurrentTime());
          }
        });
        actions.appendChild(keyframeButton);
      } else {
        const keyframePlaceholder = document.createElement("span");
        keyframePlaceholder.className = "timeline-keyframe-placeholder";
        keyframePlaceholder.setAttribute("aria-hidden", "true");
        actions.appendChild(keyframePlaceholder);
      }

      label.appendChild(actions);

      label.addEventListener("click", () => config.selectLayer(layerIndex));
      layersPanel.appendChild(label);
    });

    tracksArea.innerHTML = "";
    tracksArea.style.width = `${totalWidth}px`;

    orderedLayers.forEach((layerData, layerIdx) => {
      const track = document.createElement("div");
      track.className = "timeline-track";
      track.dataset.layerIdx = String(config.getGraphicsLayers().indexOf(layerData));

      layerData.animations.forEach((anim, animIdx) => {
        if (isPlaceholderAnimation(anim)) {
          return;
        }
        const clip = document.createElement("div");
        clip.className = `timeline-clip ${clipColors[layerIdx % clipColors.length]}`;
        clip.style.left = `${anim.start * state.timelineZoom}px`;
        clip.style.width = `${anim.duration * state.timelineZoom}px`;
        clip.textContent = anim.type;
        clip.dataset.layerIdx = String(config.getGraphicsLayers().indexOf(layerData));
        clip.dataset.animIdx = String(animIdx);
        if (
          state.selectedTimelineAnimation &&
          state.selectedTimelineAnimation.layerIdx === Number(clip.dataset.layerIdx) &&
          state.selectedTimelineAnimation.animIdx === animIdx
        ) {
          clip.classList.add("selected");
          state.selectedTimelineClip = clip;
          selectionVisible = true;
        }

        const leftHandle = document.createElement("div");
        leftHandle.className = "clip-handle clip-handle-left";
        leftHandle.dataset.handle = "left";

        const rightHandle = document.createElement("div");
        rightHandle.className = "clip-handle clip-handle-right";
        rightHandle.dataset.handle = "right";

        clip.appendChild(leftHandle);
        clip.appendChild(rightHandle);

        track.appendChild(clip);
      });

      if (layerData.type === "point" && layerData.pointKeyframes?.length) {
        layerData.pointKeyframes.forEach((frame, frameIdx) => {
          const marker = document.createElement("div");
          marker.className = "timeline-keyframe";
          marker.style.left = `${frame.time * state.timelineZoom}px`;
          marker.dataset.layerIdx = String(config.getGraphicsLayers().indexOf(layerData));
          marker.dataset.keyframeIdx = String(frameIdx);
          if (
            state.selectedTimelineKeyframe &&
            state.selectedTimelineKeyframe.layerIdx === Number(marker.dataset.layerIdx) &&
            state.selectedTimelineKeyframe.keyframeIdx === frameIdx
          ) {
            marker.classList.add("selected");
            selectionVisible = true;
          }
          track.appendChild(marker);
        });
      }

      tracksArea.appendChild(track);
    });

    if (selectionVisible || state.selectedTimelineKeyframe) {
      const deleteButton = document.getElementById("timeline-delete-clip-btn");
      if (deleteButton) {
        deleteButton.removeAttribute("disabled");
        deleteButton.classList.add("show");
      }
    } else {
      clearSelectedTimelineAnimation();
    }
    updateKeyframeEasingControl();
    config.updateExportWarning();
  };
  const initTimelineScrollSync = () => {
    const layersPanel = document.getElementById("timeline-layers-panel");
    const tracksContainer = document.getElementById("timeline-tracks-container");
    if (!layersPanel || !tracksContainer) return;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (state.isSyncingTimelineScroll) return;
      state.isSyncingTimelineScroll = true;
      target.scrollTop = source.scrollTop;
      requestAnimationFrame(() => {
        state.isSyncingTimelineScroll = false;
      });
    };

    layersPanel.addEventListener("scroll", () => syncScroll(layersPanel, tracksContainer), { passive: true });
    tracksContainer.addEventListener("scroll", () => syncScroll(tracksContainer, layersPanel), { passive: true });
  };

  const handleTimelineDurationChange = () => {
    const input = config.getEl("timeline-duration") as any;
    const raw = Number(input.value);
    const minDuration = getMinTimelineDuration();
    const next = Number.isFinite(raw) ? Math.max(raw, minDuration) : minDuration;
    state.timelineDurationOverride = next;
    config.setCalciteValue(input as HTMLElement, next.toFixed(1));
    updateTimeline();
    if (config.isPlaying?.() && config.restartPlaybackFromStart) {
      config.restartPlaybackFromStart();
    }
    config.scheduleProjectSave();
  };

  const handleTimelineDurationAutoFit = () => {
    state.timelineDurationOverride = getMinTimelineDuration();
    updateTimeline();
    if (config.isPlaying?.() && config.restartPlaybackFromStart) {
      config.restartPlaybackFromStart();
    }
    config.scheduleProjectSave();
  };

  const toggleTimelineSnap = () => {
    state.timelineSnapEnabled = !state.timelineSnapEnabled;
    applyTimelineSnapState();
  };

  const toggleTimelineGrid = () => {
    state.timelineGridVisible = !state.timelineGridVisible;
    applyTimelineGridState();
  };

  const duplicateSelectedTimelineAnimation = () => {
    if (!state.selectedTimelineAnimation) return;
    const { layerIdx, animIdx } = state.selectedTimelineAnimation;
    const layerData = config.getGraphicsLayers()[layerIdx];
    if (!layerData) return;
    const source = layerData.animations[animIdx];
    if (!source || isPlaceholderAnimation(source)) return;
    const clone = { ...source };
    clone.start = getNextNonOverlappingStart(layerData, source.start + source.duration, source.duration, animIdx);
    layerData.animations.push(clone);
    state.selectedTimelineAnimation = { layerIdx, animIdx: layerData.animations.length - 1 };
    updateTimeline();
    config.scheduleProjectSave();
  };

  const setSelectedTimelineKeyframeEasing = (easing: PointKeyframeEasing) => {
    const selected = getSelectedTimelineKeyframeFrame();
    if (!selected || !selected.layerData.isViewTrack) return;
    selected.frame.easing = easing;
    updateKeyframeEasingControl();
    config.applyAnimationsAtTime(config.getCurrentTime());
    config.scheduleProjectSave();
  };

  const handleTimelineKeyframeEasingChange = (event: Event) => {
    const value = String((event.target as any)?.value || "linear");
    const easing: PointKeyframeEasing =
      value === "ease-in"
        ? "ease-in"
        : value === "ease-out"
          ? "ease-out"
          : value === "ease-in-out"
            ? "ease-in-out"
            : "linear";
    setSelectedTimelineKeyframeEasing(easing);
  };

  const initTimelineResizer = () => {
    const resizer = document.getElementById("timeline-resizer");
    const timeline = document.getElementById("timeline-container");
    const mainArea = document.getElementById("main-area");
    if (!resizer || !timeline || !mainArea) return;

    let startY = 0;
    let startHeight = 0;
    let isDragging = false;
    const minHeight = 140;
    const minMapHeight = 160;

    const getMaxHeight = () => Math.max(minHeight, mainArea.clientHeight - minMapHeight);

    const onMove = (event: MouseEvent) => {
      if (!isDragging) return;
      const delta = event.clientY - startY;
      const nextHeight = Math.min(getMaxHeight(), Math.max(minHeight, startHeight - delta));
      timeline.style.height = `${nextHeight}px`;
      timeline.style.flexBasis = `${nextHeight}px`;
    };

    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.classList.remove("timeline-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stopDrag);
    };

    resizer.addEventListener("mousedown", (event) => {
      event.preventDefault();
      isDragging = true;
      startY = event.clientY;
      startHeight = timeline.getBoundingClientRect().height;
      document.body.classList.add("timeline-resizing");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", stopDrag);
    });
  };

  const startTimelinePanelResize = (event: MouseEvent) => {
    const panel = document.getElementById("timeline-layers-panel");
    const timeline = document.getElementById("timeline-container");
    if (!panel || !timeline) return;
    event.preventDefault();
    event.stopPropagation();
    state.timelinePanelResizeState = {
      startX: event.clientX,
      startWidth: panel.getBoundingClientRect().width
    };
    document.body.classList.add("timeline-panel-resizing");
    document.addEventListener("mousemove", handleTimelinePanelResize);
    document.addEventListener("mouseup", stopTimelinePanelResize);
    event.preventDefault();
  };

  const handleTimelinePanelResize = (event: MouseEvent) => {
    if (!state.timelinePanelResizeState) return;
    const timeline = document.getElementById("timeline-container");
    if (!timeline) return;
    const maxWidth = Math.max(180, timeline.getBoundingClientRect().width - 240);
    const nextWidth = state.timelinePanelResizeState.startWidth + (event.clientX - state.timelinePanelResizeState.startX);
    state.timelinePanelWidth = Math.max(140, Math.min(nextWidth, maxWidth));
    applyTimelinePanelWidth();
  };

  const stopTimelinePanelResize = () => {
    state.timelinePanelResizeState = null;
    document.body.classList.remove("timeline-panel-resizing");
    document.removeEventListener("mousemove", handleTimelinePanelResize);
    document.removeEventListener("mouseup", stopTimelinePanelResize);
  };

  const scrollTimelineToLayer = (layerIdx: number) => {
    const layersPanel = document.getElementById("timeline-layers-panel");
    const tracksContainer = document.getElementById("timeline-tracks-container");
    if (!layersPanel || !tracksContainer) return;

    const label = layersPanel.querySelector(
      `.timeline-layer-label[data-layer-idx="${layerIdx}"]`
    ) as HTMLElement | null;
    const track = tracksContainer.querySelector(
      `.timeline-track[data-layer-idx="${layerIdx}"]`
    ) as HTMLElement | null;

    const centerScroll = (container: HTMLElement, target: HTMLElement | null) => {
      if (!target) return;
      const offset = target.offsetTop - (container.clientHeight - target.offsetHeight) / 2;
      container.scrollTop = Math.max(0, offset);
    };

    centerScroll(layersPanel, label);
    centerScroll(tracksContainer, track);
  };

  const handleTimelineMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const clip = target?.closest(".timeline-clip") as HTMLElement | null;
    const handle = target?.closest(".clip-handle") as HTMLElement | null;
    const keyframe = target?.closest(".timeline-keyframe") as HTMLElement | null;

    if (keyframe) {
      clearSelectedTimelineAnimation();
      const layerIdx = Number(keyframe.dataset.layerIdx);
      const keyframeIdx = Number(keyframe.dataset.keyframeIdx);
      const frame = config.getGraphicsLayers()[layerIdx]?.pointKeyframes?.[keyframeIdx];

      if (frame) {
        state.selectedTimelineKeyframe = { layerIdx, keyframeIdx };
        keyframe.classList.add("selected");
        const deleteButton = document.getElementById("timeline-delete-clip-btn");
        if (deleteButton) {
          deleteButton.removeAttribute("disabled");
          deleteButton.classList.add("show");
        }
        state.keyframeDragState = {
          layerIdx,
          keyframe: frame,
          startX: event.clientX,
          originalTime: frame.time,
          marker: keyframe
        };
        updateKeyframeEasingControl();
        keyframe.classList.add("dragging");
        document.addEventListener("mousemove", handleKeyframeMouseMove);
        document.addEventListener("mouseup", handleKeyframeMouseUp);
        event.preventDefault();
        return;
      }
    }

    if (clip) {
      const layerIdx = Number(clip.dataset.layerIdx);
      const animIdx = Number(clip.dataset.animIdx);
      const anim = config.getGraphicsLayers()[layerIdx].animations[animIdx];

      config.selectLayer(layerIdx, false);
      state.dragState = {
        type: handle ? (handle.dataset.handle === "left" ? "resize-left" : "resize-right") : "move",
        layerIdx,
        animIdx,
        startX: event.clientX,
        originalStart: anim.start,
        originalDuration: anim.duration,
        clipLeft: parseFloat(clip.style.left),
        clipWidth: parseFloat(clip.style.width)
      };

      setSelectedTimelineAnimation(layerIdx, animIdx, clip);

      document.addEventListener("mousemove", handleTimelineMouseMove);
      document.addEventListener("mouseup", handleTimelineMouseUp);

      event.preventDefault();
    } else {
      clearSelectedTimelineAnimation();
      state.isScrubbingTimeline = true;
      updateTimelineScrub(event);
      document.addEventListener("mousemove", handleTimelineScrubMove);
      document.addEventListener("mouseup", handleTimelineScrubUp);
      event.preventDefault();
    }
  };

  const handleTimelineMouseMove = (event: MouseEvent) => {
    if (!state.dragState) return;

    const deltaX = event.clientX - state.dragState.startX;
    const deltaTime = deltaX / state.timelineZoom;
    const layerData = config.getGraphicsLayers()[state.dragState.layerIdx];
    const anim = layerData.animations[state.dragState.animIdx];

    if (state.dragState.type === "move") {
      const proposedStart = Math.max(0, state.dragState.originalStart + deltaTime);
      const snappedStart = snapMoveStart(state.dragState.layerIdx, state.dragState.animIdx, proposedStart, anim.duration);
      const direction = Math.sign(deltaTime);
      if (direction < 0 && snappedStart <= 0 && shouldBumpAtStart(layerData, state.dragState.animIdx)) {
        insertAtStartAndShift(layerData, state.dragState.animIdx);
      } else {
        reflowTimelineOrder(layerData, state.dragState.animIdx, snappedStart);
      }
    } else if (state.dragState.type === "resize-left") {
      const endTime = state.dragState.originalStart + state.dragState.originalDuration;
      const proposedStart = Math.max(0, state.dragState.originalStart + deltaTime);
      const snappedStart = snapResizeStart(state.dragState.layerIdx, state.dragState.animIdx, proposedStart, endTime);
      const clampedStart = clampNonOverlappingStart(
        layerData,
        state.dragState.animIdx,
        Math.max(0, snappedStart),
        endTime - snappedStart
      );
      anim.start = clampedStart;
      anim.duration = Math.max(0.1, endTime - anim.start);
    } else if (state.dragState.type === "resize-right") {
      const proposedEnd = state.dragState.originalStart + Math.max(0.1, state.dragState.originalDuration + deltaTime);
      const snappedEnd = snapResizeEnd(
        state.dragState.layerIdx,
        state.dragState.animIdx,
        proposedEnd,
        state.dragState.originalStart
      );
      const clampedEnd = clampNonOverlappingEnd(
        layerData,
        state.dragState.animIdx,
        snappedEnd,
        state.dragState.originalStart
      );
      anim.duration = Math.max(0.1, clampedEnd - state.dragState.originalStart);
    }

    updateTimeline();
    if (
      anim.type === "draw" ||
      anim.type === "drawReverse" ||
      anim.type === "fill" ||
      anim.type === "neonTrail"
    ) {
      config.resetAnimationGeometryCaches();
    }
    config.applyAnimationsAtTime(config.getCurrentTime());
  };
  const handleTimelineMouseUp = () => {
    state.dragState = null;
    document.removeEventListener("mousemove", handleTimelineMouseMove);
    document.removeEventListener("mouseup", handleTimelineMouseUp);
    config.scheduleProjectSave();
  };

  const handleKeyframeMouseMove = (event: MouseEvent) => {
    if (!state.keyframeDragState) return;

    const deltaX = event.clientX - state.keyframeDragState.startX;
    const deltaTime = deltaX / state.timelineZoom;
    const maxTime = getTimelineDuration();
    const rawTime = Math.max(0, Math.min(maxTime, state.keyframeDragState.originalTime + deltaTime));
    const nextTime = Math.max(0, Math.min(maxTime, snapTimeToGrid(rawTime)));

    state.keyframeDragState.keyframe.time = nextTime;
    const layerData = config.getGraphicsLayers()[state.keyframeDragState.layerIdx];
    layerData.pointKeyframes?.sort((a, b) => a.time - b.time);
    const nextIndex = layerData.pointKeyframes?.indexOf(state.keyframeDragState.keyframe) ?? -1;
    if (nextIndex >= 0) {
      state.selectedTimelineKeyframe = {
        layerIdx: state.keyframeDragState.layerIdx,
        keyframeIdx: nextIndex
      };
      state.keyframeDragState.marker.dataset.keyframeIdx = String(nextIndex);
    }
    state.keyframeDragState.marker.style.left = `${nextTime * state.timelineZoom}px`;
    updateKeyframeEasingControl();
    config.applyAnimationsAtTime(config.getCurrentTime());
  };

  const handleKeyframeMouseUp = () => {
    if (state.keyframeDragState?.marker) {
      state.keyframeDragState.marker.classList.remove("dragging");
    }
    state.keyframeDragState = null;
    document.removeEventListener("mousemove", handleKeyframeMouseMove);
    document.removeEventListener("mouseup", handleKeyframeMouseUp);
    updateTimeline();
    config.scheduleProjectSave();
  };

  const updateTimelineScrub = (event: MouseEvent) => {
    const tracksContainer = config.getEl("timeline-tracks-container");
    const rect = tracksContainer.getBoundingClientRect();
    const x = event.clientX - rect.left + tracksContainer.scrollLeft;
    const time = x / state.timelineZoom;
    config.setCurrentTime(Math.max(0, Math.min(time, getTimelineDuration())));
    config.updatePlayhead();
    config.syncAnimationStartInput();
    config.applyAnimationsAtTime(config.getCurrentTime());
  };

  const handleTimelineScrubMove = (event: MouseEvent) => {
    if (!state.isScrubbingTimeline) return;
    updateTimelineScrub(event);
  };

  const handleTimelineScrubUp = () => {
    state.isScrubbingTimeline = false;
    document.removeEventListener("mousemove", handleTimelineScrubMove);
    document.removeEventListener("mouseup", handleTimelineScrubUp);
  };

  const zoomInTimeline = () => {
    state.timelineZoomAuto = false;
    state.timelineZoom = Math.min(200, state.timelineZoom + 20);
    updateTimeline();
  };

  const zoomOutTimeline = () => {
    state.timelineZoomAuto = false;
    state.timelineZoom = Math.max(20, state.timelineZoom - 20);
    updateTimeline();
  };

  const setTimelineDurationOverride = (value: number | null) => {
    state.timelineDurationOverride = value;
  };

  const getTimelineDurationOverride = () => state.timelineDurationOverride;

  const getTimelineZoom = () => state.timelineZoom;

  const isScrubbingTimeline = () => state.isScrubbingTimeline;

  return {
    applyTimelinePanelWidth,
    clearSelectedTimelineAnimation,
    duplicateSelectedTimelineAnimation,
    getDefaultTimelineDuration,
    getMinTimelineDuration,
    getTimelineDuration,
    getTimelineDurationOverride,
    getTimelineZoom,
    getNextNonOverlappingStart,
    handleTimelineDurationAutoFit,
    handleTimelineDurationChange,
    handleTimelineKeyframeEasingChange,
    handleTimelineMouseDown,
    handleTimelineScrubMove,
    handleTimelineScrubUp,
    initTimelineResizer,
    initTimelineScrollSync,
    isScrubbingTimeline,
    removeSelectedTimelineAnimation,
    scrollTimelineToLayer,
    setSelectedTimelineAnimation,
    setTimelineDurationOverride,
    snapTimeToGridCeil,
    startTimelinePanelResize,
    toggleTimelineGrid,
    toggleTimelineSnap,
    updateTimeline,
    zoomInTimeline,
    zoomOutTimeline
  };
};
