/**
 * NetworkHost (Phase 3, D-006): an online game. The simulation still runs here — in the
 * worker, like a solo game — but its clock is the server: it runs exactly the turns the
 * server sends, in order, and the local player's commands go to the server instead of
 * straight into the next tick.
 *
 * Repair (3.5): every turn carries the server's state hash. A tick whose hash differs, or a
 * turn that doesn't follow the last one, means this client is off; it asks for a snapshot
 * (onResync), drops the turns until it comes — they are all from before it — and replaces
 * its world with it (onRestored: the client redraws). A browser that joins mid-game (a
 * rejoin, a spectator) starts out waiting for its first snapshot the same way.
 *
 * Orders on their way (3.6): an order goes to the server and comes back in a turn some
 * 100–300 ms later. Until then it is pending — the client shows it at once (a ring where it
 * was aimed) — and the time it took is the delay players feel, shown in the HUD.
 *
 * The socket itself lives with the client (client/app/online.ts): this class only needs a
 * way to send a command and ask for a snapshot, and is handed the turns and snapshots.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import type { WorldSnapshot } from "../sim/snapshot.ts";
import type { GameSetup, PlayerId } from "../sim/world.ts";
import type { FrameListener, InitialState, RestoredState, SimHost } from "./host.ts";
import { LocalHost } from "./localHost.ts";
import { WorkerHost } from "./workerHost.ts";

export interface ServerTurn {
  readonly tick: number;
  readonly commands: readonly StampedCommand[];
  readonly hash: number;
}

/** While waiting for a snapshot, ask again this often (the server may have been busy). */
const RESYNC_RETRY_MS = 8_000;

/** An order not back in a turn after this long was lost or dropped: stop showing it. */
export const PENDING_ORDER_MS = 4_000;

/** Recent order delays kept for the HUD's figure (the median of these). */
const DELAY_SAMPLES = 9;

/** One of the local player's orders, sent but not yet back in a turn (3.6). */
export interface PendingOrder {
  readonly command: Command;
  /** `performance.now()` when it was sent. */
  readonly sentAt: number;
}

export interface NetworkHostOptions {
  readonly localPlayerId: PlayerId;
  /** Sends the local player's command to the server. */
  readonly sendCommand: (command: Command) => void;
  /** Joined mid-game (a rejoin or a spectator): wait for a snapshot before playing turns. */
  readonly awaitSnapshot?: boolean;
  /** This client needs a snapshot: it drifted (or missed a turn) at `tick`. */
  readonly onResync?: (tick: number) => void;
  /** A snapshot replaced the world after the game was running: redraw from `state`. */
  readonly onRestored?: (state: RestoredState) => void;
  readonly onError?: (message: string) => void;
  /** The clock for pending orders (ms); performance.now by default (tests pass their own). */
  readonly now?: () => number;
}

export class NetworkHost implements SimHost {
  private readonly inner: WorkerHost | LocalHost;
  private readonly options: NetworkHostOptions;
  private started = false;
  /** Turns to run once the world is ready, in order. */
  private waiting: ServerTurn[] = [];
  /** The server's hash for each tick sent to the simulation but not checked yet. */
  private readonly expected = new Map<number, number>();
  /** Waiting for a snapshot: turns are dropped meanwhile. */
  private syncing: boolean;
  /** The last turn's tick passed on (or the snapshot's). */
  private lastTick = 0;
  /** A snapshot that came before the world was built (a mid-game join). */
  private pendingSnapshot: WorldSnapshot | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private repairs = 0;
  private ruleTickMs = 100;
  /** Sent, not yet seen in a turn; `key` is the command's JSON (it comes back unchanged). */
  private pending: (PendingOrder & { readonly key: string })[] = [];
  private delays: number[] = [];
  private readonly now: () => number;

  constructor(options: NetworkHostOptions) {
    this.options = options;
    this.syncing = options.awaitSnapshot ?? false;
    this.now = options.now ?? (() => performance.now());
    this.inner =
      typeof Worker === "undefined"
        ? new LocalHost({ localPlayerId: options.localPlayerId, clock: "manual" })
        : new WorkerHost({
            localPlayerId: options.localPlayerId,
            turns: true,
            ...(options.onError ? { onError: options.onError } : {}),
          });
    this.inner.onFrame((frame) => {
      const hash = this.expected.get(frame.tick);
      if (hash === undefined) return;
      this.expected.delete(frame.tick);
      if (hash !== frame.hash) this.needSnapshot(frame.tick);
    });
  }

  get tickMs(): number {
    return this.ruleTickMs;
  }

  /** Online games can't be paused or sped up: the server keeps time for everyone. */
  get paused(): boolean {
    return false;
  }

  get lastFrameTime(): number {
    return this.inner.lastFrameTime;
  }

  /** Waiting for a snapshot (catching up after a drift, a rejoin or joining to watch). */
  get catchingUp(): boolean {
    return this.syncing || this.pendingSnapshot !== null;
  }

  /** Snapshots that repaired this game after it ran (for the console and tests). */
  get repairCount(): number {
    return this.repairs;
  }

  /**
   * Builds the world. A mid-game join resolves with the snapshot's state (once it came),
   * so the client never shows tick 0 of a game in progress.
   */
  async start(setup: GameSetup): Promise<InitialState> {
    this.ruleTickMs = setup.rules?.tickMs ?? 100;
    const initial = await this.inner.start(setup);
    let result = initial;
    // (A newer snapshot may come while the last one is restored: the newest wins.)
    for (let snapshot = this.pendingSnapshot; snapshot; snapshot = this.pendingSnapshot) {
      this.pendingSnapshot = null;
      const state = await new Promise<RestoredState>((resolve) =>
        this.inner.restore(snapshot!, resolve),
      );
      result = { ...initial, owner: state.owner, frame: state.frame, fort: state.fort };
    }
    this.started = true;
    // Turns that arrived meanwhile, in order (all after the snapshot, if there was one).
    const waiting = this.waiting;
    this.waiting = [];
    for (const turn of waiting) this.run(turn);
    return result;
  }

  /** The local player's orders still on their way, oldest first (3.6). */
  get pendingOrders(): readonly PendingOrder[] {
    const now = this.now();
    if (this.pending.length > 0 && now - this.pending[0]!.sentAt > PENDING_ORDER_MS) {
      this.pending = this.pending.filter((p) => now - p.sentAt <= PENDING_ORDER_MS);
    }
    return this.pending;
  }

  /** How long the local player's recent orders took to come back in a turn (ms), or null. */
  get orderDelayMs(): number | null {
    if (this.delays.length === 0) return null;
    const sorted = [...this.delays].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /** The next turn from the server. */
  receiveTurn(turn: ServerTurn): void {
    this.confirmOrders(turn);
    // Until the snapshot comes every turn is from before it.
    if (this.syncing) return;
    if (turn.tick !== this.lastTick + 1) {
      this.needSnapshot(turn.tick);
      return;
    }
    this.lastTick = turn.tick;
    if (this.started) this.run(turn);
    else this.waiting.push(turn);
  }

  /** The server's snapshot (3.5): the world becomes it; the next turn follows its tick. */
  receiveSnapshot(snapshot: WorldSnapshot): void {
    this.syncing = false;
    this.clearRetry();
    this.lastTick = snapshot.tick;
    this.waiting = [];
    this.expected.clear();
    // Orders sent before it are in it or lost; either way they aren't on their way any more.
    this.pending = [];
    if (!this.started) {
      this.pendingSnapshot = snapshot;
      return;
    }
    this.repairs++;
    this.inner.restore(snapshot, (state) => this.options.onRestored?.(state));
  }

  /**
   * The connection dropped and came back (3.5): this game continues from a snapshot the
   * server sends with the rejoin; until then turns are dropped.
   */
  awaitSnapshot(): void {
    this.syncing = true;
    this.waiting = [];
    this.clearRetry();
  }

  send(command: Command): void {
    // A spectator's orders are ignored by the server: nothing to wait for.
    if (this.options.localPlayerId > 0) {
      this.pending.push({ command, sentAt: this.now(), key: JSON.stringify(command) });
    }
    this.options.sendCommand(command);
  }

  onFrame(listener: FrameListener): () => void {
    return this.inner.onFrame(listener);
  }

  pause(): void {}

  resume(): void {}

  setSpeed(): void {}

  /** Development checks only: corrupts this browser's world so the repair can be watched. */
  debugCorrupt(): void {
    this.inner.debugCorrupt();
  }

  /** Development checks only: online, a command as another player would be cheating. */
  sendAs(): void {
    throw new Error("sendAs() isn't available in online games");
  }

  dispose(): void {
    this.clearRetry();
    this.inner.dispose();
    this.waiting = [];
    this.expected.clear();
    this.pending = [];
  }

  /** The local player's orders in `turn` are no longer on their way. */
  private confirmOrders(turn: ServerTurn): void {
    if (this.pending.length === 0) return;
    const me = this.options.localPlayerId;
    for (const stamped of turn.commands) {
      if (stamped.playerId !== me) continue;
      const key = JSON.stringify(stamped.command);
      const k = this.pending.findIndex((p) => p.key === key);
      if (k < 0) continue;
      this.delays.push(this.now() - this.pending[k]!.sentAt);
      if (this.delays.length > DELAY_SAMPLES) this.delays.shift();
      this.pending.splice(k, 1);
    }
  }

  private run(turn: ServerTurn): void {
    this.expected.set(turn.tick, turn.hash);
    this.inner.applyTurn({ tick: turn.tick, commands: turn.commands });
  }

  /** Drifted or missed a turn at `tick`: ask for a snapshot (again until one comes). */
  private needSnapshot(tick: number): void {
    if (this.syncing) return;
    this.syncing = true;
    this.waiting = [];
    this.expected.clear();
    const ask = () => {
      this.options.onResync?.(tick);
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.syncing) ask();
      }, RESYNC_RETRY_MS);
    };
    ask();
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }
}
