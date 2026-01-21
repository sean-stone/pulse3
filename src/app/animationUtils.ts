import type { LayerAnimation, LayerData } from "../types";

const PLACEHOLDER_ANIMATION_TYPE = "__placeholder__";

export const createPlaceholderAnimation = (): LayerAnimation => ({
  type: PLACEHOLDER_ANIMATION_TYPE,
  duration: 0,
  start: 0
});

export const isPlaceholderAnimation = (anim: LayerAnimation) =>
  anim.type === PLACEHOLDER_ANIMATION_TYPE;

export const hasRealAnimations = (layerData: LayerData) =>
  layerData.animations.some((anim) => !isPlaceholderAnimation(anim));

export const hasPointKeyframes = (layerData: LayerData) => (layerData.pointKeyframes?.length ?? 0) > 0;
