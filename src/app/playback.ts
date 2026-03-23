import Point from "@arcgis/core/geometry/Point";

import type { LayerData, PointKeyframe, PointStyle } from "../types";
import { applyPointSymbolScaleOrientation } from "./animationPlaybackHelpers";
import {
  mergePointSymbolOrientations,
  readPointKeyframeOrientation,
  readPointStyleOrientation
} from "./pointOrientation";

type PlaybackAccessors = {
  getIsPlaying: () => boolean;
  setIsPlaying: (value: boolean) => void;
  getCurrentTime: () => number;
  setCurrentTime: (value: number) => void;
  getAnimationFrameId: () => number | null;
  setAnimationFrameId: (value: number | null) => void;
};

type PlaybackConfig = {
  getTimelineDuration: () => number;
  getTimelineZoom: () => number;
  getSketch: () => { cancel: () => void } | null;
  setSketchUpdateOnGraphicClick: (value: boolean) => void;
  getEl: (id: string) => HTMLElement;
  applyAnimationsAtTime: (time: number) => void;
  resetAnimationGeometryCaches: () => void;
  getGraphicsLayers: () => LayerData[];
  hasPointKeyframes: (layerData: LayerData) => boolean;
  getPointKeyframeAtTime: (layerData: LayerData, time: number) => PointKeyframe | null;
  defaultPointStyle: PointStyle;
  isExporting: () => boolean;
  stopExportRecording: () => void;
};

const createPlaybackController = (accessors: PlaybackAccessors, config: PlaybackConfig) => {
  const updatePlayhead = () => {
    const playhead = config.getEl("timeline-playhead");
    playhead.style.left = `${accessors.getCurrentTime() * config.getTimelineZoom()}px`;
  };

  const syncAnimationStartInput = () => {
    const input = document.getElementById("animation-start-input") as any;
    if (!input) return;
    input.value = accessors.getCurrentTime().toFixed(1);
  };

  const goToStart = () => {
    accessors.setCurrentTime(0);
    updatePlayhead();
    syncAnimationStartInput();
    config.applyAnimationsAtTime(accessors.getCurrentTime());
  };

  const goToEnd = () => {
    accessors.setCurrentTime(config.getTimelineDuration());
    updatePlayhead();
    syncAnimationStartInput();
    config.applyAnimationsAtTime(accessors.getCurrentTime());
  };

  const handlePlayFromStart = () => {
    if (accessors.getIsPlaying()) {
      stopAnimation();
      return;
    }
    goToStart();
    startAnimation();
  };

  const togglePlayAnimation = () => {
    if (accessors.getIsPlaying()) {
      stopAnimation();
    } else {
      startAnimation();
    }
  };

  const startAnimation = () => {
    const sketch = config.getSketch();
    if (sketch) {
      sketch.cancel();
      config.setSketchUpdateOnGraphicClick(false);
    }
    accessors.setIsPlaying(true);
    config.getEl("play-button").setAttribute("icon-start", "pause");
    config.getEl("play-button").textContent = "Pause";
    const timelinePlayBtn = config.getEl("timeline-play-btn");
    timelinePlayBtn.setAttribute("icon-start", "pause");
    timelinePlayBtn.setAttribute("title", "Pause");
    timelinePlayBtn.setAttribute("aria-label", "Pause");

    const startTime = performance.now();
    const maxEndTime = config.getTimelineDuration();

    const clampedTime = Math.max(0, Math.min(accessors.getCurrentTime(), maxEndTime));
    accessors.setCurrentTime(clampedTime >= maxEndTime ? 0 : clampedTime);
    config.resetAnimationGeometryCaches();
    updatePlayhead();
    config.applyAnimationsAtTime(accessors.getCurrentTime());

    const initialTime = accessors.getCurrentTime();
    let lastLoop = 0;

    const animate = (timestamp: number) => {
      if (!accessors.getIsPlaying()) return;

      const elapsed = (timestamp - startTime) / 1000;
      const rawTime = initialTime + elapsed;
      if (config.isExporting() && rawTime >= maxEndTime) {
        accessors.setCurrentTime(maxEndTime);
        updatePlayhead();
        config.applyAnimationsAtTime(accessors.getCurrentTime());
        stopAnimation();
        return;
      }
      const loops = Math.floor(rawTime / maxEndTime);
      if (loops !== lastLoop) {
        lastLoop = loops;
        config.resetAnimationGeometryCaches();
      }
      accessors.setCurrentTime(rawTime % maxEndTime);

      updatePlayhead();
      config.applyAnimationsAtTime(accessors.getCurrentTime());

      accessors.setAnimationFrameId(requestAnimationFrame(animate));
    };

    accessors.setAnimationFrameId(requestAnimationFrame(animate));
  };

  const stopAnimation = () => {
    accessors.setIsPlaying(false);
    const frameId = accessors.getAnimationFrameId();
    if (frameId) {
      cancelAnimationFrame(frameId);
      accessors.setAnimationFrameId(null);
    }
    if (config.getSketch()) {
      config.setSketchUpdateOnGraphicClick(true);
    }
    config.getEl("play-button").setAttribute("icon-start", "play");
    config.getEl("play-button").textContent = "Play from start";
    const timelinePlayBtn = config.getEl("timeline-play-btn");
    timelinePlayBtn.setAttribute("icon-start", "play");
    timelinePlayBtn.setAttribute("title", "Play");
    timelinePlayBtn.setAttribute("aria-label", "Play");

    config.getGraphicsLayers().forEach((layerData) => {
      if (layerData.type === "feature") {
        layerData.layer.opacity = 1;
        return;
      }
      const hideBasePointForFireworks =
        layerData.type === "point" &&
        layerData.animations.some((animation) =>
          animation.type === "fireworks" ||
          animation.type === "crossetteShell" ||
          animation.type === "mineShellCombo"
        );
      const pointStyle = layerData.type === "point" ? layerData.pointStyle ?? config.defaultPointStyle : null;
      const pointFrame =
        layerData.type === "point" && config.hasPointKeyframes(layerData)
          ? config.getPointKeyframeAtTime(layerData, accessors.getCurrentTime())
          : null;
      const pointOrientation =
        layerData.type === "point"
          ? mergePointSymbolOrientations(
              readPointStyleOrientation(pointStyle ?? config.defaultPointStyle),
              readPointKeyframeOrientation(pointFrame)
            )
          : null;
      layerData.layer.opacity = 1;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (layerData.type === "point" && pointStyle) {
          applyPointSymbolScaleOrientation(
            graphic,
            hideBasePointForFireworks ? 0 : pointStyle.size,
            pointOrientation ?? {}
          );
        } else if (graphic.symbol) {
          const symbol = graphic.symbol.clone();
          if (symbol.size !== undefined) {
            symbol.size = hideBasePointForFireworks ? 0 : pointStyle?.size ?? config.defaultPointStyle.size;
          }
          graphic.symbol = symbol;
        }
        if (graphic.__originalGeometry) {
          if (layerData.type === "point" && pointFrame) {
            const frameZ = Number(pointFrame.z);
            graphic.geometry = new Point({
              x: pointFrame.x,
              y: pointFrame.y,
              spatialReference: pointFrame.spatialReference,
              ...(Number.isFinite(frameZ) ? { z: frameZ } : {})
            });
            return;
          }
          graphic.geometry = graphic.__originalGeometry.clone();
        }
      });
    });

    if (config.isExporting()) {
      config.stopExportRecording();
    }
  };

  return {
    updatePlayhead,
    syncAnimationStartInput,
    goToStart,
    goToEnd,
    handlePlayFromStart,
    togglePlayAnimation,
    startAnimation,
    stopAnimation
  };
};

export type { PlaybackAccessors, PlaybackConfig };
export { createPlaybackController };
