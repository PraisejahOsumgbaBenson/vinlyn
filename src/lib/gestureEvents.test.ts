import { describe, expect, it } from "bun:test";
import { createGestureSelectGate } from "./gestureEvents";

describe("gesture select gate", () => {
  it("ignores the first value so enabling gestures does not select", () => {
    const gate = createGestureSelectGate();

    expect(gate.observe(undefined)).toBe(false);
    expect(gate.observe(0)).toBe(false);
    expect(gate.observe(0)).toBe(false);
  });

  it("opens only on a new pinch sequence", () => {
    const gate = createGestureSelectGate();

    expect(gate.observe(0)).toBe(false);
    expect(gate.observe(1)).toBe(true);
    expect(gate.observe(1)).toBe(false);
    expect(gate.observe(2)).toBe(true);
  });

  it("forgets the old sequence when gestures are turned off", () => {
    const gate = createGestureSelectGate();

    expect(gate.observe(3)).toBe(false);
    expect(gate.observe(undefined)).toBe(false);
    expect(gate.observe(3)).toBe(false);
    expect(gate.observe(4)).toBe(true);
  });
});
