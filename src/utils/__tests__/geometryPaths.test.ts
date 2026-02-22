import { describe, expect, test } from "vitest";

import { buildPartialPaths, distance, polylineLength } from "../geometryPaths";

describe("geometryPaths", () => {
  test("distance computes Euclidean length", () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
  });

  test("distance includes z when both coords contain z", () => {
    expect(distance([0, 0, 0], [0, 0, 10])).toBe(10);
  });

  test("polylineLength sums segments across paths", () => {
    const paths = [
      [
        [0, 0],
        [3, 4]
      ],
      [
        [3, 4],
        [6, 8]
      ]
    ];
    expect(polylineLength(paths)).toBe(10);
  });

  test("buildPartialPaths returns first point at 0 progress", () => {
    const paths = [[[0, 0], [10, 0]]];
    expect(buildPartialPaths(paths, 0, false)).toEqual([[[0, 0]]]);
  });

  test("buildPartialPaths returns full path at 1 progress", () => {
    const paths = [[[0, 0], [10, 0]]];
    expect(buildPartialPaths(paths, 1, false)).toEqual(paths);
  });

  test("buildPartialPaths interpolates mid progress", () => {
    const paths = [[[0, 0], [10, 0]]];
    expect(buildPartialPaths(paths, 0.5, false)).toEqual([[[0, 0], [5, 0]]]);
  });

  test("buildPartialPaths preserves z for first point at 0 progress", () => {
    const paths = [[[0, 0, 15], [10, 0, 25]]];
    expect(buildPartialPaths(paths, 0, false)).toEqual([[[0, 0, 15]]]);
  });

  test("buildPartialPaths interpolates z at mid progress", () => {
    const paths = [[[0, 0, 10], [10, 0, 30]]];
    expect(buildPartialPaths(paths, 0.5, false)).toEqual([[[0, 0, 10], [5, 0, 20]]]);
  });

  test("buildPartialPaths interpolates a vertical z-only segment", () => {
    const paths = [[[0, 0, 0], [0, 0, 10]]];
    expect(buildPartialPaths(paths, 0.5, false)).toEqual([[[0, 0, 0], [0, 0, 5]]]);
  });

  test("buildPartialPaths supports reverse traversal", () => {
    const paths = [
      [
        [0, 0],
        [10, 0],
        [20, 0]
      ]
    ];
    expect(buildPartialPaths(paths, 0.25, true)).toEqual([[[20, 0], [15, 0]]]);
  });
});
