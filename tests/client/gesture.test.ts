import { describe, expect, it } from "vitest";
import { ClickDragTracker, DRAG_THRESHOLD_PX } from "../../src/client/input/gesture.ts";

describe("click vs drag", () => {
  it("a press and release without moving is a click", () => {
    const tracker = new ClickDragTracker();
    tracker.down(10, 10, 0);
    expect(tracker.up(10, 10)).toEqual({ type: "click", x: 10, y: 10, button: 0 });
  });

  it("small jitter within the threshold is still a click", () => {
    const tracker = new ClickDragTracker();
    tracker.down(10, 10, 0);
    expect(tracker.move(12, 12).type).toBe("none");
    expect(tracker.up(12, 12).type).toBe("click");
  });

  it("moving past the threshold pans and never clicks", () => {
    const tracker = new ClickDragTracker();
    tracker.down(10, 10, 0);
    expect(tracker.move(10 + DRAG_THRESHOLD_PX + 1, 10)).toEqual({
      type: "pan",
      dx: DRAG_THRESHOLD_PX + 1,
      dy: 0,
    });
    expect(tracker.move(20, 13)).toEqual({
      type: "pan",
      dx: 20 - (10 + DRAG_THRESHOLD_PX + 1),
      dy: 3,
    });
    expect(tracker.up(20, 13).type).toBe("none");
  });

  it("ignores moves while no button is pressed", () => {
    const tracker = new ClickDragTracker();
    expect(tracker.move(100, 100).type).toBe("none");
    expect(tracker.up(100, 100).type).toBe("none");
  });

  it("remembers which button was pressed", () => {
    const tracker = new ClickDragTracker();
    tracker.down(0, 0, 2);
    expect(tracker.up(0, 0)).toEqual({ type: "click", x: 0, y: 0, button: 2 });
  });
});
