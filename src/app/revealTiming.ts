export type RevealGeometryMode = "empty" | "full";

const isFiniteNumber = (value: number) => Number.isFinite(value);

const isLeadingRevealAnimation = (firstRevealStart: number, firstAnimationStart: number) =>
  isFiniteNumber(firstRevealStart) &&
  isFiniteNumber(firstAnimationStart) &&
  firstRevealStart <= firstAnimationStart;

const getInactiveRevealGeometryMode = (
  time: number,
  firstRevealStart: number,
  firstAnimationStart: number
): RevealGeometryMode =>
  isLeadingRevealAnimation(firstRevealStart, firstAnimationStart) && time < firstRevealStart ? "empty" : "full";

export { getInactiveRevealGeometryMode, isLeadingRevealAnimation };
