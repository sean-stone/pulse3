import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";

import type { LayerAnimation, LayerData, PointKeyframe, PointStyle } from "../types";
import { buildPartialPaths } from "../utils/geometryPaths";

type AnimationPlaybackConfig = {
  getGraphicsLayers: () => LayerData[];
  defaultPointStyle: PointStyle;
  hasPointKeyframes: (layerData: LayerData) => boolean;
  getPointKeyframeAtTime: (layerData: LayerData, time: number) => PointKeyframe | null;
  applyFeatureLayerAnimation: (layerData: LayerData, time: number) => void;
  isPlaying: () => boolean;
  isScrubbingTimeline: () => boolean;
};

const updatePolylineDraw = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  maxDrawEnd: number,
  isPlaying: boolean,
  isScrubbingTimeline: boolean
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic.geometry || graphic.geometry.type !== "polyline") return;

    if (!graphic.__originalGeometry) {
      graphic.__originalGeometry = graphic.geometry.clone();
    }

    const original = graphic.__originalGeometry as Polyline;
    if (!isPlaying && !isScrubbingTimeline) {
      graphic.geometry = original.clone();
      return;
    }
    const densified = graphic.__densifiedGeometry ?? densifyPolyline(original);
    graphic.__densifiedGeometry = densified;

    if (activeAnim) {
      const progress = Math.min(1, Math.max(0, (time - activeAnim.start) / activeAnim.duration));
      const reverse = activeAnim.type === "drawReverse";
      graphic.geometry = buildPartialPolyline(densified, progress, reverse);
      return;
    }

    if (time > maxDrawEnd) {
      graphic.geometry = original.clone();
    } else if (time < maxDrawEnd) {
      graphic.geometry = buildPartialPolyline(densified, 0, false);
    }
  });
};

const updatePolygonFill = (
  layerData: LayerData,
  activeAnim: LayerAnimation | null,
  time: number,
  maxFillEnd: number
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic.geometry || graphic.geometry.type !== "polygon") return;

    if (!graphic.__originalGeometry) {
      graphic.__originalGeometry = graphic.geometry.clone();
    }

    const original = graphic.__originalGeometry as Polygon;

    if (activeAnim) {
      const progress = Math.min(1, Math.max(0, (time - activeAnim.start) / activeAnim.duration));
      if (!graphic.__fillMaxInset) {
        graphic.__fillMaxInset = estimateFillInset(original);
      }
      const inset = graphic.__fillMaxInset * (1 - progress);
      if (inset <= 0) {
        graphic.geometry = original.clone();
        return;
      }
      const buffered = geometryEngine.buffer(original, -inset) as Polygon | null;
      if (buffered && buffered.rings?.length) {
        graphic.geometry = buffered;
        return;
      }
      graphic.geometry = progress >= 0.98 ? original.clone() : buildEmptyPolygon(original);
      return;
    }

    if (time > maxFillEnd) {
      graphic.geometry = original.clone();
    } else if (time < maxFillEnd) {
      graphic.geometry = buildEmptyPolygon(original);
    }
  });
};

const estimateFillInset = (geometry: Polygon) => {
  const extent = geometry.extent;
  if (!extent) {
    return 0;
  }
  const width = extent.width ?? extent.xmax - extent.xmin;
  const height = extent.height ?? extent.ymax - extent.ymin;
  const minDim = Math.min(width, height);
  if (!Number.isFinite(minDim) || minDim <= 0) {
    return 0;
  }
  return minDim * 0.5;
};

const buildEmptyPolygon = (geometry: Polygon) => {
  return new Polygon({
    spatialReference: geometry.spatialReference,
    rings: []
  });
};

const densifyPolyline = (polyline: Polyline) => {
  const isGeographic = Boolean((polyline.spatialReference as any)?.isGeographic);
  const totalLength = isGeographic
    ? geometryEngine.geodesicLength(polyline) || 0
    : geometryEngine.planarLength(polyline) || 0;
  if (totalLength <= 0) {
    return polyline.clone();
  }
  const maxSegmentLength = Math.max(totalLength / 400, totalLength / 2000, 0.00001);
  const densified = (isGeographic
    ? geometryEngine.geodesicDensify(polyline, maxSegmentLength)
    : geometryEngine.densify(polyline, maxSegmentLength)) as Polyline;
  if (!densified?.paths?.length) {
    return polyline.clone();
  }
  return densified;
};

const buildPartialPolyline = (polyline: Polyline, progress: number, reverse: boolean) => {
  const resultPaths = buildPartialPaths(polyline.paths, progress, reverse);
  return new Polyline({
    spatialReference: polyline.spatialReference,
    paths: resultPaths
  });
};

const applyAnimationsAtTime = (config: AnimationPlaybackConfig, time: number) => {
  const isPlaying = config.isPlaying();
  const isScrubbingTimeline = config.isScrubbingTimeline();
  config.getGraphicsLayers().forEach((layerData) => {
    if (layerData.type === "feature") {
      config.applyFeatureLayerAnimation(layerData, time);
      return;
    }
    if (!layerData.animations?.length && !config.hasPointKeyframes(layerData)) {
      return;
    }
    let layerVisible = false;
    let opacity = 1;
    let scale = 1;
    let activeDrawAnimation: LayerAnimation | null = null;
    let hasDrawAnimation = false;
    let maxDrawEnd = 0;
    let minDrawStart = Number.POSITIVE_INFINITY;
    let activeFillAnimation: LayerAnimation | null = null;
    let hasFillAnimation = false;
    let maxFillEnd = 0;
    let minFillStart = Number.POSITIVE_INFINITY;
    let activeSpinProgress: number | null = null;
    let activeTypewriter: { anim: LayerAnimation; progress: number } | null = null;
    let maxTypewriterEnd = 0;
    let minTypewriterStart = Number.POSITIVE_INFINITY;
    let hasTypewriterAnimation = false;
    let hasActiveAnimation = false;
    let latestEndedAnimation: LayerAnimation | null = null;
    let latestEndedAnimationEnd = Number.NEGATIVE_INFINITY;

    layerData.animations.forEach((anim: LayerAnimation) => {
      if (anim.type === "__placeholder__") {
        return;
      }
      const animEnd = anim.start + anim.duration;
      if (anim.type === "draw" || anim.type === "drawReverse") {
        hasDrawAnimation = true;
        maxDrawEnd = Math.max(maxDrawEnd, animEnd);
        minDrawStart = Math.min(minDrawStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          activeDrawAnimation = anim;
        }
      }
      if (anim.type === "fill") {
        hasFillAnimation = true;
        maxFillEnd = Math.max(maxFillEnd, animEnd);
        minFillStart = Math.min(minFillStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          activeFillAnimation = anim;
        }
      }
      if (anim.type === "typewriter") {
        hasTypewriterAnimation = true;
        maxTypewriterEnd = Math.max(maxTypewriterEnd, animEnd);
        minTypewriterStart = Math.min(minTypewriterStart, anim.start);
        if (time >= anim.start && time <= animEnd) {
          const progress = (time - anim.start) / anim.duration;
          activeTypewriter = { anim, progress };
        }
      }

      if (time >= anim.start && time <= animEnd) {
        hasActiveAnimation = true;
        layerVisible = true;
        const progress = (time - anim.start) / anim.duration;

        switch (anim.type) {
          case "fadeIn":
            opacity = progress;
            break;
          case "fadeOut":
            opacity = 1 - progress;
            break;
          case "pulse":
            opacity = 0.5 + 0.5 * Math.sin(progress * Math.PI * 4);
            scale = 0.9 + 0.15 * Math.sin(progress * Math.PI * 4);
            break;
          case "grow":
            scale = 0.5 + progress * 0.5;
            break;
          case "bounce":
            scale = 1 + Math.sin(progress * Math.PI * 2) * 0.3;
            break;
          case "spin":
            activeSpinProgress = progress;
            break;
          case "draw":
          case "drawReverse":
            opacity = 1;
            break;
          case "fill":
            opacity = 1;
            break;
          default:
            opacity = 1;
        }
      }

      if (animEnd <= time && animEnd > latestEndedAnimationEnd) {
        latestEndedAnimation = anim;
        latestEndedAnimationEnd = animEnd;
      }
    });

    if (layerData.animations.length > 0) {
      if (config.hasPointKeyframes(layerData) && !layerData.animations.some((anim) => anim.type !== "__placeholder__")) {
        const firstKeyframeTime = layerData.pointKeyframes?.[0]?.time ?? 0;
        layerVisible = time >= firstKeyframeTime;
      }
      if (hasDrawAnimation && time < minDrawStart && (isPlaying || isScrubbingTimeline)) {
        layerVisible = false;
      }
      if (hasFillAnimation && time < minFillStart && (isPlaying || isScrubbingTimeline)) {
        layerVisible = false;
      }
      if (!hasActiveAnimation && latestEndedAnimation) {
        switch ((latestEndedAnimation as LayerAnimation).type) {
          case "fadeOut":
            opacity = 0;
            layerVisible = false;
            break;
          default:
            opacity = 1;
            layerVisible = true;
            break;
        }
      }
      layerData.layer.opacity = layerVisible ? opacity : 0;
    }

    if (hasDrawAnimation) {
      updatePolylineDraw(layerData, activeDrawAnimation, time, maxDrawEnd, isPlaying, isScrubbingTimeline);
    }
    if (hasFillAnimation) {
      updatePolygonFill(layerData, activeFillAnimation, time, maxFillEnd);
    }
    if (config.hasPointKeyframes(layerData)) {
      applyPointKeyframes(layerData, time, config.getPointKeyframeAtTime);
    }
    if (layerData.type === "point") {
      const baseSize = layerData.pointStyle?.size ?? config.defaultPointStyle.size;
      const baseAngle = layerData.pointStyle?.angle ?? 0;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "simple-marker") return;
        const symbol = graphic.symbol.clone();
        symbol.size = baseSize * scale;
        symbol.angle = activeSpinProgress !== null ? baseAngle + activeSpinProgress * 360 : baseAngle;
        graphic.symbol = symbol;
      });
    }
    if (layerData.type === "text") {
      const baseText = layerData.textContent || "Text";
      const baseSize = layerData.textSize ?? 14;
      layerData.layer.graphics.forEach((graphic: any) => {
        if (!graphic?.symbol || graphic.symbol.type !== "text") return;
        const symbol = graphic.symbol.clone();
        symbol.font = symbol.font || { size: baseSize, family: "sans-serif" };
        symbol.font.size = baseSize * scale;
        if (hasTypewriterAnimation) {
          if (activeTypewriter) {
            const length = Math.max(0, Math.floor(baseText.length * activeTypewriter.progress));
            symbol.text = baseText.slice(0, length);
          } else if (time < minTypewriterStart) {
            symbol.text = "";
          } else if (time > maxTypewriterEnd) {
            symbol.text = baseText;
          }
        }
        graphic.symbol = symbol;
      });
    }
  });
};

const applyPointKeyframes = (
  layerData: LayerData,
  time: number,
  getPointKeyframeAtTime: (layerData: LayerData, time: number) => PointKeyframe | null
) => {
  layerData.layer.graphics.forEach((graphic: any) => {
    if (!graphic?.geometry) return;
    const frame = getPointKeyframeAtTime(layerData, time);
    if (!frame) return;
    graphic.geometry = new Point({
      x: frame.x,
      y: frame.y,
      spatialReference: frame.spatialReference
    });
  });
};

export { applyAnimationsAtTime };
