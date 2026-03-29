import { describe, expect, test, vi } from "vitest";

import type { LayerData } from "../../types";
import { applyAnimationsAtTime } from "../animationPlayback";

const createPlaybackConfig = (layerData: LayerData, view: any = { type: "3d" }) => ({
  getView: () => view,
  getGraphicsLayers: () => [layerData],
  defaultPointStyle: { size: 12 } as any,
  hasPointKeyframes: () => false,
  getPointKeyframeAtTime: () => null,
  applyFeatureLayerAnimation: () => undefined,
  isPlaying: () => true,
  isScrubbingTimeline: () => false
});

describe("animation playback text opacity", () => {
  test("fades flat text in 3D by updating symbol color alpha directly", () => {
    const view = {
      type: "3d",
      requestRender: () => undefined
    };
    const requestRenderSpy = vi.spyOn(view, "requestRender");
    const graphic = {
      symbol: {
        type: "text",
        text: "Text",
        color: [34, 35, 58, 1],
        font: {
          size: 14,
          family: "sans-serif"
        }
      }
    };
    const layerData: LayerData = {
      name: "Text 1",
      type: "text",
      layer: {
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [graphic]
      },
      animations: [
        {
          type: "fadeIn",
          start: 0,
          duration: 1
        } as any
      ],
      pointKeyframes: [],
      textContent: "Flat text",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, view), 0.5);

    expect(layerData.layer.opacity).toBe(1);
    expect(graphic.symbol.text).toBe("Flat text");
    expect(graphic.symbol.color[3]).toBeCloseTo(0.5, 5);
    expect(requestRenderSpy).toHaveBeenCalled();
  });

  test("fades scene text in 3D by updating symbol layer and callout alpha directly", () => {
    const view = {
      type: "3d",
      requestRender: () => undefined
    };
    const requestRenderSpy = vi.spyOn(view, "requestRender");
    const graphic = {
      symbol: {
        type: "point-3d",
        symbolLayers: [
          {
            type: "text",
            text: "Text",
            size: 14,
            material: {
              color: [34, 35, 58, 1]
            },
            halo: {
              color: [255, 255, 255, 0.9],
              size: 1
            },
            font: {
              family: "sans-serif",
              style: "normal"
            }
          }
        ],
        callout: {
          color: [34, 35, 58, 0.9],
          border: {
            color: [255, 255, 255, 0.9]
          }
        }
      }
    };
    const layerData: LayerData = {
      name: "Text 2",
      type: "text",
      layer: {
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [graphic]
      },
      animations: [
        {
          type: "fadeIn",
          start: 0,
          duration: 1
        } as any
      ],
      pointKeyframes: [],
      textContent: "Scene text",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "scene-3d",
      textCalloutLine: true
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, view), 0.25);

    expect(layerData.layer.opacity).toBe(1);
    expect(graphic.symbol.symbolLayers[0].text).toBe("Scene text");
    expect(graphic.symbol.symbolLayers[0].material.color[3]).toBeCloseTo(0.25, 5);
    expect(graphic.symbol.symbolLayers[0].halo.color[3]).toBeCloseTo(0.225, 5);
    expect(graphic.symbol.callout.color[3]).toBeCloseTo(0.225, 5);
    expect(graphic.symbol.callout.border.color[3]).toBeCloseTo(0.225, 5);
    expect(requestRenderSpy).toHaveBeenCalled();
  });
});
