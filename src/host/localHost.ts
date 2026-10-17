/**
 * LocalHost: single-player host. Runs the simulation on the main thread and acts as the
 * turn scheduler a server will be in Phase 3: commands are collected, stamped with the
 * local player's id, and delivered as the next turn every tick (100 ms).
 */
import type { Command, StampedCommand, Turn } from "../sim/commands.ts";
import { buildFrame, type TickFrame } from "../sim/frame.ts";
import { runTick } from "../sim/tick.ts";
import { createWorld, type GameSetup, type PlayerId, type World } from "../sim/world.ts";
import type { FrameListener, InitialState, SimHost } from "./host.ts";

/** If the tab was in the background, don't fast-forward more than this many ticks at once. */
const MAX_CATCH_UP_TICKS = 5;

export interface LocalHostOptions {
  localPlayerId: PlayerId;
  /**
   * "realtime" (default) runs ticks on a timer; "manual" only advances on step() — used by
   * tests and the headless runner.
   */
  clock?: "realtime" | "manual";
}

export class LocalHost implements SimHost {
  private world: World | null = null;
  private readonly listeners = new Set<FrameListener>();
  private pending: StampedCommand[] = [];
  private readonly localPlayerId: PlayerId;
  private readonly clock: "realtime" | "manual";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;
  private speed = 1;
  private isPaused = false;
  private lastFrameAt = 0;

  constructor(options: LocalHostOptions) {
    this.localPlayerId = options.localPlayerId;
    this.clock = options.clock ?? "realtime";
  }

  get tickMs(): number {
    return (this.world?.rules.tickMs ?? 100) / this.speed;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get lastFrameTime(): number {
    return this.lastFrameAt;
  }

  async start(setup: GameSetup): Promise<InitialState> {
    if (this.world) throw new Error("LocalHost.start() called twice");
    const world = createWorld(setup);
    this.world = world;
    this.lastFrameAt = performance.now();
    if (this.clock === "realtime") this.schedule(performance.now() + this.tickMs);
    return {
      map: world.map,
      owner: world.owner.slice(),
      frame: buildFrame(world),
      localPlayerId: this.localPlayerId,
    };
  }

  /**
   * Development checks only (the debug hook): a command as if another player sent it,
   * e.g. a bot asking the local player for an alliance. Solo games only.
   */
  sendAs(playerId: PlayerId, command: Command): void {
    this.pending.push({ playerId, command });
  }

  send(command: Command): void {
    this.pending.push({ playerId: this.localPlayerId, command });
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause(): void {
    this.isPaused = true;
    this.cancelTimer();
  }

  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    if (this.clock === "realtime" && this.world) this.schedule(performance.now() + this.tickMs);
  }

  setSpeed(multiplier: number): void {
    if (!(multiplier > 0)) throw new RangeError(`Invalid speed ${multiplier}`);
    this.speed = multiplier;
  }

  /** Runs `ticks` ticks immediately (manual clock, tests). Returns the last frame. */
  step(ticks = 1): TickFrame {
    let frame: TickFrame | null = null;
    for (let k = 0; k < ticks; k++) frame = this.runOneTick();
    if (!frame) throw new Error("step() needs at least one tick");
    return frame;
  }

  /**
   * Runs one turn decided elsewhere (online games, D-006: the server's turns) — manual clock
   * only. Commands sent through send() are not added; the server already stamped and ordered
   * everyone's commands into `turn`.
   */
  applyTurn(turn: Turn): TickFrame {
    const world = this.world;
    if (!world) throw new Error("LocalHost is not running");
    if (this.clock !== "manual") throw new Error("applyTurn() needs the manual clock");
    const startedAt = performance.now();
    const frame = runTick(world, turn);
    const tickMs = performance.now() - startedAt;
    this.lastFrameAt = performance.now();
    for (const listener of this.listeners) listener(frame, { tickMs });
    return frame;
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
    this.world = null;
  }

  private runOneTick(): TickFrame {
    const world = this.world;
    if (!world) throw new Error("LocalHost is not running");
    const commands = this.pending;
    this.pending = [];
    const startedAt = performance.now();
    const frame = runTick(world, { tick: world.tick + 1, commands });
    const tickMs = performance.now() - startedAt;
    this.lastFrameAt = performance.now();
    for (const listener of this.listeners) listener(frame, { tickMs });
    return frame;
  }

  private schedule(at: number): void {
    this.nextTickAt = at;
    this.timer = setTimeout(() => this.pump(), Math.max(0, at - performance.now()));
  }

  private pump(): void {
    this.timer = null;
    if (this.isPaused || !this.world) return;
    const now = performance.now();
    let ran = 0;
    while (now >= this.nextTickAt && ran < MAX_CATCH_UP_TICKS) {
      this.runOneTick();
      if (!this.world) return; // a listener disposed the host
      this.nextTickAt += this.tickMs;
      ran++;
    }
    // Far behind (background tab): resynchronize instead of fast-forwarding.
    if (now - this.nextTickAt > this.tickMs * MAX_CATCH_UP_TICKS)
      this.nextTickAt = now + this.tickMs;
    this.schedule(this.nextTickAt);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
