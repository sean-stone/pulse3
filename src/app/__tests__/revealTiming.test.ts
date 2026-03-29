import { describe, expect, test } from "vitest";

import { getInactiveRevealGeometryMode, isLeadingRevealAnimation } from "../revealTiming";

describe("reveal timing", () => {
  test("treats the first reveal as the pre-roll gate when it starts the layer timeline", () => {
    expect(isLeadingRevealAnimation(4, 4)).toBe(true);
    expect(getInactiveRevealGeometryMode(1, 4, 4)).toBe("empty");
  });

  test("keeps full geometry available before a later reveal when another animation starts earlier", () => {
    expect(isLeadingRevealAnimation(4, 1)).toBe(false);
    expect(getInactiveRevealGeometryMode(1, 4, 1)).toBe("full");
    expect(getInactiveRevealGeometryMode(3, 1, 1)).toBe("full");
  });
});
