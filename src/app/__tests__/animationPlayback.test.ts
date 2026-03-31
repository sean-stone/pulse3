import { describe, expect, test, vi } from "vitest";

import type { LayerData } from "../../types";
import { applyAnimationsAtTime } from "../animationPlayback";

const createPlaybackConfig = (layerData: LayerData | LayerData[], view: any = { type: "3d" }) => {
  const layers = Array.isArray(layerData) ? layerData : [layerData];
  return {
    getView: () => view,
    getGraphicsLayers: () => layers,
    defaultPointStyle: { size: 12 } as any,
    hasPointKeyframes: () => false,
    getPointKeyframeAtTime: () => null,
    applyFeatureLayerAnimation: () => undefined,
    isPlaying: () => true,
    isScrubbingTimeline: () => false
  };
};

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

  test("moves a point along a followed polyline and rotates it to the path direction", () => {
    const routeGeometry = {
      type: "polyline",
      spatialReference: { wkid: 3857 },
      paths: [[[0, 0], [10, 0], [10, 10]]],
      clone() {
        return {
          ...this,
          paths: this.paths.map((path: number[][]) => path.map((coord) => [...coord]))
        };
      }
    };
    const routeGraphic = {
      geometry: routeGeometry,
      __originalGeometry: routeGeometry,
      __densifiedGeometry: routeGeometry
    };
    const carGraphic = {
      geometry: { type: "point", x: 0, y: 0, spatialReference: { wkid: 3857 } },
      symbol: {
        type: "simple-marker",
        size: 12,
        angle: 0
      }
    };
    const routeLayer: LayerData = {
      name: "Route 1",
      type: "polyline",
      layer: {
        id: "route-layer",
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [routeGraphic]
      },
      animations: [
        {
          type: "draw",
          start: 0,
          duration: 10
        } as any
      ],
      lineStyle: {
        style: "solid",
        width: 2,
        color: "#0a4c66"
      }
    };
    const carLayer: LayerData = {
      name: "Car",
      type: "point",
      layer: {
        id: "car-layer",
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [carGraphic]
      },
      animations: [
        {
          type: "followPath",
          start: 0,
          duration: 10,
          pathLayerId: "route-layer",
          orientToPath: true,
          smoothFollow: false,
          reverse: false
        } as any
      ],
      pointKeyframes: [],
      pointStyle: {
        style: "circle",
        size: 12,
        color: "#0a4c66",
        outlineColor: "#ffffff",
        outlineWidth: 1,
        angle: 0,
        heading: 0,
        xoffset: 0,
        yoffset: 0
      }
    };

    applyAnimationsAtTime(createPlaybackConfig([routeLayer, carLayer], { type: "2d" }), 7.5);

    expect(Number(carGraphic.geometry.x)).toBeCloseTo(10, 5);
    expect(Number(carGraphic.geometry.y)).toBeCloseTo(5, 5);
    expect(Number(carGraphic.symbol.angle)).toBeCloseTo(0, 5);
  });

  test("smooths follow-path rotation across a corner when enabled", () => {
    const routeGeometry = {
      type: "polyline",
      spatialReference: { wkid: 3857 },
      paths: [[[0, 0], [10, 0], [10, 10]]],
      clone() {
        return {
          ...this,
          paths: this.paths.map((path: number[][]) => path.map((coord) => [...coord]))
        };
      }
    };
    const routeGraphic = {
      geometry: routeGeometry,
      __originalGeometry: routeGeometry,
      __densifiedGeometry: routeGeometry
    };
    const boatGraphic = {
      geometry: { type: "point", x: 0, y: 0, spatialReference: { wkid: 3857 } },
      symbol: {
        type: "simple-marker",
        size: 12,
        angle: 0
      }
    };
    const routeLayer: LayerData = {
      name: "Route 1",
      type: "polyline",
      layer: {
        id: "route-layer",
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [routeGraphic]
      },
      animations: [],
      lineStyle: {
        style: "solid",
        width: 2,
        color: "#0a4c66"
      }
    };
    const boatLayer: LayerData = {
      name: "Boat",
      type: "point",
      layer: {
        id: "boat-layer",
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [boatGraphic]
      },
      animations: [
        {
          type: "followPath",
          start: 0,
          duration: 10,
          pathLayerId: "route-layer",
          orientToPath: true,
          smoothFollow: true,
          reverse: false
        } as any
      ],
      pointKeyframes: [],
      pointStyle: {
        style: "circle",
        size: 12,
        color: "#0a4c66",
        outlineColor: "#ffffff",
        outlineWidth: 1,
        angle: 0,
        heading: 0,
        xoffset: 0,
        yoffset: 0
      }
    };

    applyAnimationsAtTime(createPlaybackConfig([routeLayer, boatLayer], { type: "2d" }), 5);

    expect(Number(boatGraphic.geometry.x)).toBeCloseTo(10, 5);
    expect(Number(boatGraphic.geometry.y)).toBeCloseTo(0, 5);
    expect(Number(boatGraphic.symbol.angle)).toBeCloseTo(45, 5);
  });
});
