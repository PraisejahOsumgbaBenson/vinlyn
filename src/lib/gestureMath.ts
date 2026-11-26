export type GestureSample = {
  indexY: number;
  pinchDistance: number;
  span: number;
};

export type GestureTracker = {
  smoothedY: number | null;
  pinchDown: boolean;
  pinchArmed: boolean;
  lastSelectAt: number;
};

export type GestureStep = {
  tracker: GestureTracker;
  deltaPx: number;
  select: boolean;
};

const SCROLL_GAIN = 1400;
const SMOOTHING_FACTOR = 0.35;
const SCROLL_DEADBAND_PX = 3;
const MAX_SCROLL_STEP_PX = 28;
export const PINCH_ON_RATIO = 0.35;
export const PINCH_OFF_RATIO = 0.45;
const SELECT_DEBOUNCE_MS = 500;

export function createGestureTracker(): GestureTracker {
  return {
    smoothedY: null,
    pinchDown: false,
    pinchArmed: false,
    lastSelectAt: Number.NEGATIVE_INFINITY,
  };
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function stepGesture(
  tracker: GestureTracker,
  sample: GestureSample | null,
  now: number,
): GestureStep {
  if (
    !sample ||
    !Number.isFinite(sample.indexY) ||
    !Number.isFinite(sample.pinchDistance) ||
    !Number.isFinite(sample.span) ||
    sample.span <= 0.001
  ) {
    return {
      tracker: {
        ...tracker,
        smoothedY: null,
        pinchDown: false,
        pinchArmed: false,
      },
      deltaPx: 0,
      select: false,
    };
  }

  const smoothedY =
    tracker.smoothedY === null
      ? sample.indexY
      : tracker.smoothedY +
        (sample.indexY - tracker.smoothedY) * SMOOTHING_FACTOR;

  const rawDelta =
    tracker.smoothedY === null ? 0 : (smoothedY - tracker.smoothedY) * SCROLL_GAIN;
  const limitedDelta = clamp(rawDelta, MAX_SCROLL_STEP_PX);
  const deltaPx = Math.abs(limitedDelta) < SCROLL_DEADBAND_PX ? 0 : limitedDelta;

  const pinchRatio = sample.pinchDistance / sample.span;
  const pinchThreshold = tracker.pinchDown ? PINCH_OFF_RATIO : PINCH_ON_RATIO;
  const pinching = pinchRatio < pinchThreshold;
  const pinchArmed =
    !pinching && pinchRatio >= PINCH_OFF_RATIO ? true : tracker.pinchArmed;
  const select =
    pinching &&
    !tracker.pinchDown &&
    tracker.pinchArmed &&
    now - tracker.lastSelectAt >= SELECT_DEBOUNCE_MS;

  return {
    tracker: {
      smoothedY,
      pinchDown: pinching,
      pinchArmed,
      lastSelectAt: select ? now : tracker.lastSelectAt,
    },
    deltaPx,
    select,
  };
}
