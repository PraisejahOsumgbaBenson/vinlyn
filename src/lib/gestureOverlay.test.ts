import { describe, expect, it } from "bun:test";
import { gestureOverlayStatus } from "./gestureOverlay";
import type { GestureLandmark } from "./gestureMessages";
import type { GestureSample } from "./gestureMath";

const hand: GestureLandmark[] = Array.from({ length: 21 }, (_, index) => ({
  x: 0.2 + index * 0.02,
  y: 0.5,
  z: 0,
}));

const openSample: GestureSample = {
  indexY: 0.5,
  pinchDistance: 0.2,
  span: 0.25,
};

describe("gesture overlay status", () => {
  it("asks for a hand when no landmarks arrive", () => {
    expect(gestureOverlayStatus(null, null, 30)).toContain("HAND NOT FOUND");
  });

  it("shows the movement guide and frame rate when a hand is tracked", () => {
    const status = gestureOverlayStatus(openSample, hand, 30);

    expect(status).toContain("HAND FOUND");
    expect(status).toContain("MOVE FINGER UP OR DOWN");
    expect(status).toContain("30 FPS");
  });

  it("shows pinch state when thumb and finger are close", () => {
    const status = gestureOverlayStatus(
      { ...openSample, pinchDistance: 0.08 },
      hand,
      30,
    );

    expect(status).toContain("PINCHING");
  });
});
