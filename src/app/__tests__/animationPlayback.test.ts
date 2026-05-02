import { describe, expect, test, vi } from "vitest";

import type { LayerData } from "../../types";
import { applyAnimationsAtTime } from "../animationPlayback";

const createPlaybackConfig = (
  layerData: LayerData | LayerData[],
  view: any = { type: "3d" },
  overrides: Partial<ReturnType<typeof createPlaybackConfigBase>> = {}
) => {
  const layers = Array.isArray(layerData) ? layerData : [layerData];
  return {
    ...createPlaybackConfigBase(),
    getView: () => view,
    getGraphicsLayers: () => layers,
    ...overrides
  };
};

const createPlaybackConfigBase = () => ({
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

  test("applies timing curve to follow-path progress", () => {
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
      symbol: { type: "simple-marker", size: 12, angle: 0 }
    };
    const routeLayer: LayerData = {
      name: "Route 2",
      type: "polyline",
      layer: { id: "route-2", opacity: 1, blendMode: "normal", effect: "", graphics: [routeGraphic] },
      animations: [],
      lineStyle: { style: "solid", width: 2, color: "#0a4c66" }
    };
    const carLayer: LayerData = {
      name: "Car 2",
      type: "point",
      layer: { id: "car-2", opacity: 1, blendMode: "normal", effect: "", graphics: [carGraphic] },
      animations: [
        {
          type: "followPath",
          start: 0,
          duration: 10,
          pathLayerId: "route-2",
          reverse: false,
          timingCurve: { x1: 0.95, y1: 0, x2: 1, y2: 0.05 }
        } as any
      ],
      pointKeyframes: [],
      pointStyle: { style: "circle", size: 12, color: "#0a4c66", outlineColor: "#ffffff", outlineWidth: 1 }
    };

    applyAnimationsAtTime(createPlaybackConfig([routeLayer, carLayer], { type: "2d" }), 5);

    expect(Number(carGraphic.geometry.x)).toBeLessThan(9);
    expect(Number(carGraphic.geometry.y)).toBeCloseTo(0, 5);
  });

  test("applies timing curve to polyline draw progress", () => {
    const baseGeometry = {
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
    const graphic = {
      geometry: baseGeometry,
      __originalGeometry: baseGeometry,
      __densifiedGeometry: baseGeometry
    };
    const layerData: LayerData = {
      name: "Line draw curve",
      type: "polyline",
      layer: { opacity: 1, blendMode: "normal", effect: "", graphics: [graphic] },
      animations: [
        {
          type: "draw",
          start: 0,
          duration: 10,
          timingCurve: { x1: 0.95, y1: 0, x2: 1, y2: 0.05 }
        } as any
      ],
      lineStyle: { style: "solid", width: 2, color: "#0a4c66" }
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }), 5);

    const drawPath = graphic.geometry.paths?.[0] ?? [];
    const drawPoint = drawPath[drawPath.length - 1];
    expect(Number(drawPoint?.[0] ?? 0)).toBeLessThan(9);
    expect(Number(drawPoint?.[1] ?? 0)).toBeCloseTo(0, 5);
  });

  test("stores smoke playback state for particle layers while the clip is active", () => {
    const layerData: LayerData = {
      name: "Smoke Box",
      type: "particles",
      layer: {
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: []
      },
      animations: [
        {
          type: "smoke",
          start: 0,
          duration: 2
        } as any
      ],
      particleStyle: {
        width: 220,
        depth: 220,
        height: 140,
        floorOffset: 8,
        opacity: 0.32,
        slices: 14,
        color: "#c9dcff",
        edgeColor: "#f4fbff",
        preset: "balanced"
      }
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }), 0.5);

    expect((layerData as any).__volumeAnimationState).toEqual({
      effect: "smoke",
      progress: 0.25,
      time: 0.5
    });
    expect(layerData.layer.opacity).toBe(1);
  });

  test("clears particle playback state when playback is not previewing", () => {
    const layerData: LayerData = {
      name: "Smoke Box",
      type: "particles",
      layer: {
        opacity: 0.4,
        blendMode: "normal",
        effect: "",
        graphics: []
      },
      animations: [
        {
          type: "smoke",
          start: 0,
          duration: 2
        } as any
      ],
      particleStyle: {
        width: 220,
        depth: 220,
        height: 140,
        floorOffset: 8,
        opacity: 0.32,
        slices: 14,
        color: "#c9dcff",
        edgeColor: "#f4fbff",
        preset: "balanced"
      }
    };
    (layerData as any).__volumeAnimationState = {
      effect: "smoke",
      progress: 0.5,
      time: 1
    };

    applyAnimationsAtTime(
      createPlaybackConfig(layerData, { type: "2d" }, { isPlaying: () => false }),
      1
    );

    expect((layerData as any).__volumeAnimationState).toBeUndefined();
    expect(layerData.layer.opacity).toBe(1);
  });
});

describe("animation playback text templates", () => {
  test("resolves timeline tokens from current playback time", () => {
    const graphic = {
      geometry: { type: "point", x: 0, y: 0, spatialReference: { wkid: 4326 } },
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
      name: "Timed text",
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
          duration: 10
        } as any
      ],
      pointKeyframes: [],
      textContent: "t={time_s:.1}s {time_mmss} {progress_pct:.0}%",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }), 3.4);

    expect(graphic.symbol.text).toBe("t=3.4s 00:03 34%");
  });

  test("resolves coordinate and elevation tokens from text geometry", () => {
    const graphic = {
      geometry: { type: "point", x: 2.3522, y: 48.8566, z: 35, spatialReference: { wkid: 4326 } },
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
      name: "Coordinate text",
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
      textContent: "Lat {lat:.2}, Lon {lon:.2}, Elev {elevation_m:.0} m",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }), 0.5);

    expect(graphic.symbol.text).toBe("Lat 48.86, Lon 2.35, Elev 35 m");
  });

  test("resolves elevation from terrain sampler when point z is missing", () => {
    const graphic = {
      geometry: { type: "point", x: -0.1278, y: 51.5074, spatialReference: { wkid: 4326 } },
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
      name: "Terrain text",
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
      textContent: "Elevation {elevation_m:.0} m",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };
    const view = {
      type: "3d",
      groundView: {
        elevationSampler: {
          queryElevation: () => ({ z: 86.2 })
        }
      }
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, view), 0.5);

    expect(graphic.symbol.text).toBe("Elevation 86 m");
  });

  test("resolves line length token from polyline geometry while paused", () => {
    const graphic = {
      geometry: {
        type: "polyline",
        spatialReference: { wkid: 3857 },
        paths: [
          [
            [0, 0],
            [3, 4]
          ]
        ]
      },
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
      name: "Length text",
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
          duration: 10
        } as any
      ],
      pointKeyframes: [],
      textContent: "Length {line_length:.1}",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }, { isPlaying: () => false }), 0);

    expect(graphic.symbol.text).toBe("Length 5.0");
  });

  test("resolves area and perimeter tokens from polygon geometry", () => {
    const graphic = {
      geometry: {
        type: "polygon",
        spatialReference: { wkid: 3857 },
        rings: [
          [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
            [0, 0]
          ]
        ]
      },
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
      name: "Area text",
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
          duration: 10
        } as any
      ],
      pointKeyframes: [],
      textContent: "Area {area:.1} Perim {perimeter:.1}",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig(layerData, { type: "2d" }), 0);

    expect(graphic.symbol.text).toBe("Area 12.0 Perim 14.0");
  });

  test("resolves geometry tokens from a linked measure source layer", () => {
    const sourceLineGraphic = {
      geometry: {
        type: "polyline",
        spatialReference: { wkid: 3857 },
        paths: [
          [
            [0, 0],
            [0, 6]
          ]
        ]
      }
    };
    const textGraphic = {
      geometry: { type: "point", x: 10, y: 10, spatialReference: { wkid: 4326 } },
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
    const sourceLayer: LayerData = {
      name: "Measure line",
      type: "polyline",
      layer: {
        id: "line-source-1",
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [sourceLineGraphic]
      },
      animations: [],
      pointKeyframes: []
    } as any;
    const textLayer: LayerData = {
      name: "Length text",
      type: "text",
      layer: {
        opacity: 1,
        blendMode: "normal",
        effect: "",
        graphics: [textGraphic]
      },
      animations: [
        {
          type: "fadeIn",
          start: 0,
          duration: 2
        } as any
      ],
      pointKeyframes: [],
      textContent: "Linked {line_length:.1}",
      textMeasureSourceLayerId: "line-source-1",
      textSize: 14,
      textColor: "#22323a",
      textRenderMode: "flat"
    };

    applyAnimationsAtTime(createPlaybackConfig([sourceLayer, textLayer], { type: "2d" }), 0);

    expect(textGraphic.symbol.text).toBe("Linked 6.0");
  });
});
