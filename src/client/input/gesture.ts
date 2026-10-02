/**
 * Tells clicks from drags (GAME_DESIGN.md §4.1): a press that moves more than
 * DRAG_THRESHOLD_PX before release is a pan and never triggers an action.
 * Pure logic, so it can be unit-tested without a browser.
 */

export const DRAG_THRESHOLD_PX = 4;

export type GestureEvent =
  | { type: "pan"; dx: number; dy: number }
  | { type: "click"; x: number; y: number; button: number }
  | { type: "none" };

export class ClickDragTracker {
  private pressed = false;
  private dragging = false;
  private button = 0;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;

  get isDragging(): boolean {
    return this.dragging;
  }

  get isPressed(): boolean {
    return this.pressed;
  }

  down(x: number, y: number, button: number): void {
    this.pressed = true;
    this.dragging = false;
    this.button = button;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
  }

  move(x: number, y: number): GestureEvent {
    if (!this.pressed) return { type: "none" };
    if (!this.dragging) {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (dx * dx + dy * dy <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return { type: "none" };
      this.dragging = true;
    }
    const event: GestureEvent = { type: "pan", dx: x - this.lastX, dy: y - this.lastY };
    this.lastX = x;
    this.lastY = y;
    return event;
  }

  up(x: number, y: number): GestureEvent {
    if (!this.pressed) return { type: "none" };
    const wasDragging = this.dragging;
    this.pressed = false;
    this.dragging = false;
    return wasDragging ? { type: "none" } : { type: "click", x, y, button: this.button };
  }

  cancel(): void {
    this.pressed = false;
    this.dragging = false;
  }
}
