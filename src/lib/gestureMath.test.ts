import { describe, expect, it } from "bun:test";
import { createGestureTracker, stepGesture, type GestureSample } from "./gestureMath";

function sample(indexY: number, pinchDistance = 0.2, span = 0.25): GestureSample {
  return { indexY, pinchDistance, span };
}

describe("gesture signal smoothing", () => {
  it("ignores tiny hand jitter", () => {
    let tracker = createGestureTracker();
    tracker = stepGesture(tracker, sample(0.5), 0).tracker;

    const result = stepGesture(tracker, sample(0.502), 16);

    expect(result.deltaPx).toBe(0);
  });

  it("smooths and clamps a large movement", () => {
    let tracker = createGestureTracker();
    tracker = stepGesture(tracker, sample(0.5), 0).tracker;

    const result = stepGesture(tracker, sample(0.9), 16);

    expect(result.deltaPx).toBeGreaterThan(0);
    expect(result.deltaPx).toBeLessThanOrEqual(28);
  });

  it("uses hand-relative pinch with release hysteresis", () => {
    let tracker = createGestureTracker();
    tracker = stepGesture(tracker, sample(0.5), 0).tracker;

    const down = stepGesture(tracker, sample(0.5, 0.08), 100);
    expect(down.select).toBe(true);

    const held = stepGesture(down.tracker, sample(0.5, 0.1), 600);
    expect(held.select).toBe(false);
    expect(held.tracker.pinchDown).toBe(true);

    const released = stepGesture(held.tracker, sample(0.5, 0.2), 650);
    expect(released.tracker.pinchDown).toBe(false);
  });

  it("does not select when the first tracked hand is already pinched", () => {
    const tracker = createGestureTracker();

    const result = stepGesture(tracker, sample(0.5, 0.05), 0);

    expect(result.select).toBe(false);
    expect(result.tracker.pinchArmed).toBe(false);
    expect(result.tracker.pinchDown).toBe(true);
  });

  it("selects after an open hand arms the pinch", () => {
    let tracker = createGestureTracker();
    tracker = stepGesture(tracker, sample(0.5, 0.2), 0).tracker;
    expect(tracker.pinchArmed).toBe(true);

    const result = stepGesture(tracker, sample(0.5, 0.05), 600);

    expect(result.select).toBe(true);
  });

  it("resets tracking when the hand disappears", () => {
    let tracker = createGestureTracker();
    tracker = stepGesture(tracker, sample(0.5), 0).tracker;

    const result = stepGesture(tracker, null, 100);

    expect(result.tracker.smoothedY).toBeNull();
    expect(result.tracker.pinchDown).toBe(false);
    expect(result.tracker.pinchArmed).toBe(false);
    expect(result.deltaPx).toBe(0);
  });
});
