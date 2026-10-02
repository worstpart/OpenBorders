/**
 * Turns raw mouse and keyboard events into semantic actions (GAME_DESIGN.md §4.1).
 * Knows nothing about rules or rendering; the session decides what an action means.
 */
import { ClickDragTracker } from "./gesture.ts";

export interface ScreenPoint {
  x: number;
  y: number;
}

export type KeyAction =
  | "centerOnMe"
  | "confirm"
  | "togglePerf"
  | "escape"
  | "preset1"
  | "preset2"
  | "preset3"
  | "preset4"
  | "preset5"
  | "percentDown"
  | "percentUp"
  /** Ally with the player under the cursor (request, or accept theirs). */
  | "ally"
  /** Yes / no to the top diplomacy card. */
  | "diplomacyYes"
  | "diplomacyNo"
  /** Turn gold into troops (GAME_DESIGN.md §3.16). */
  | "mobilize"
  /** Open the build menu at the cursor (GAME_DESIGN.md §3.17). */
  | "build";

export interface ControlHandlers {
  primaryClick(at: ScreenPoint): void;
  /** Right click (without dragging): the context menu. */
  secondaryClick(at: ScreenPoint): void;
  pan(dx: number, dy: number): void;
  zoom(factor: number, anchor: ScreenPoint): void;
  hover(at: ScreenPoint | null): void;
  key(action: KeyAction): void;
  /** Shift + wheel: change the attack percentage by this many steps (+ = more). */
  adjustPercent(steps: number): void;
  /**
   * True while a menu has the keyboard: only Escape reaches the game, so Tab, Enter and
   * Space work on the menu's buttons and the map stays still.
   */
  menuOpen(): boolean;
}

const KEY_ACTIONS: Record<string, KeyAction> = {
  Space: "centerOnMe",
  Enter: "confirm",
  NumpadEnter: "confirm",
  F3: "togglePerf",
  Backquote: "togglePerf",
  Escape: "escape",
  Digit1: "preset1",
  Digit2: "preset2",
  Digit3: "preset3",
  Digit4: "preset4",
  Digit5: "preset5",
  Numpad1: "preset1",
  Numpad2: "preset2",
  Numpad3: "preset3",
  Numpad4: "preset4",
  Numpad5: "preset5",
  KeyQ: "percentDown",
  KeyE: "percentUp",
  KeyK: "ally",
  KeyY: "diplomacyYes",
  KeyN: "diplomacyNo",
  KeyM: "mobilize",
  KeyB: "build",
};

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [1, 0],
  ArrowLeft: [1, 0],
  KeyD: [-1, 0],
  ArrowRight: [-1, 0],
};

/** Keyboard pan speed in CSS pixels per second. */
const KEY_PAN_SPEED = 900;
/** Wheel zoom sensitivity: factor = exp(-deltaY · this). */
const WHEEL_ZOOM_RATE = 0.0016;

export class Controls {
  private readonly target: HTMLElement;
  private readonly handlers: ControlHandlers;
  private readonly gesture = new ClickDragTracker();
  private readonly heldPanKeys = new Set<string>();
  private readonly abort = new AbortController();

  constructor(target: HTMLElement, handlers: ControlHandlers) {
    this.target = target;
    this.handlers = handlers;
    const options = { signal: this.abort.signal };
    target.addEventListener("pointerdown", (e) => this.onPointerDown(e), options);
    target.addEventListener("pointermove", (e) => this.onPointerMove(e), options);
    target.addEventListener("pointerup", (e) => this.onPointerUp(e), options);
    target.addEventListener("pointercancel", () => this.gesture.cancel(), options);
    target.addEventListener("pointerleave", () => this.handlers.hover(null), options);
    target.addEventListener("wheel", (e) => this.onWheel(e), { ...options, passive: false });
    target.addEventListener("contextmenu", (e) => e.preventDefault(), options);
    window.addEventListener("keydown", (e) => this.onKeyDown(e), options);
    window.addEventListener("keyup", (e) => this.heldPanKeys.delete(e.code), options);
    window.addEventListener("blur", () => this.heldPanKeys.clear(), options);
  }

  /** Applies held-key panning; call once per animation frame. */
  update(dtSeconds: number): void {
    if (this.heldPanKeys.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const code of this.heldPanKeys) {
      const [x, y] = PAN_KEYS[code]!;
      dx += x;
      dy += y;
    }
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const step = (KEY_PAN_SPEED * dtSeconds) / length;
    this.handlers.pan(dx * step, dy * step);
  }

  dispose(): void {
    this.abort.abort();
  }

  private point(e: MouseEvent): ScreenPoint {
    const rect = this.target.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.point(e);
    this.gesture.down(p.x, p.y, e.button);
    this.target.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.point(e);
    const event = this.gesture.move(p.x, p.y);
    if (event.type === "pan") this.handlers.pan(event.dx, event.dy);
    this.handlers.hover(this.gesture.isDragging ? null : p);
  }

  private onPointerUp(e: PointerEvent): void {
    const p = this.point(e);
    if (this.target.hasPointerCapture(e.pointerId)) this.target.releasePointerCapture(e.pointerId);
    const event = this.gesture.up(p.x, p.y);
    if (event.type !== "click") return;
    if (event.button === 0) this.handlers.primaryClick(p);
    else if (event.button === 2) this.handlers.secondaryClick(p);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    if (e.shiftKey) {
      // Some browsers report Shift+wheel as horizontal scrolling.
      const delta = pixels !== 0 ? pixels : e.deltaX;
      if (delta !== 0) this.handlers.adjustPercent(delta < 0 ? 1 : -1);
      return;
    }
    this.handlers.zoom(Math.exp(-pixels * WHEEL_ZOOM_RATE), this.point(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Typing in a form field (later: settings, names) must not move the map.
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      return;
    if (this.handlers.menuOpen()) {
      this.heldPanKeys.clear();
      if (e.code === "Escape" && !e.repeat) {
        e.preventDefault();
        this.handlers.key("escape");
      }
      return;
    }
    if (e.code in PAN_KEYS) {
      this.heldPanKeys.add(e.code);
      e.preventDefault();
      return;
    }
    const action = KEY_ACTIONS[e.code];
    if (action && !e.repeat) {
      // Space/Enter would also "click" a focused button; the game handles them instead.
      e.preventDefault();
      this.handlers.key(action);
    }
  }
}
