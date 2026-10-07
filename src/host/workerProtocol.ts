/**
 * Messages between WorkerHost (main thread) and the simulation worker (ARCHITECTURE.md
 * §5.6, milestone 2.8). Frames cross as structured clones, slimmed down: a boat's or trade
 * ship's route (which never changes) is sent once, with the first frame that has the ship,
 * and walls only when they changed. WorkerHost puts them back, so listeners see ordinary
 * TickFrames.
 */
import type { Command } from "../sim/commands.ts";
import type { BoatSnapshot, TickFrame, TradeShipSnapshot, WallSnapshot } from "../sim/frame.ts";
import type { GameRules } from "../sim/rules.ts";
import type { PlayerId, PlayerSetup } from "../sim/world.ts";

export type WireBoat = Omit<BoatSnapshot, "route"> & { readonly route: Int32Array | null };
export type WireTradeShip = Omit<TradeShipSnapshot, "route"> & {
  readonly route: Int32Array | null;
};

/** A TickFrame on the wire: routes already sent are null; walls null when unchanged. */
export type WireFrame = Omit<TickFrame, "boats" | "tradeShips" | "walls"> & {
  readonly boats: readonly WireBoat[];
  readonly tradeShips: readonly WireTradeShip[];
  readonly walls: readonly WallSnapshot[] | null;
};

export type ToWorker =
  | {
      readonly type: "start";
      readonly seed: number;
      readonly players: readonly PlayerSetup[];
      readonly rules?: GameRules;
      readonly localPlayerId: PlayerId;
      readonly width: number;
      readonly height: number;
      readonly terrain: Uint8Array;
      readonly relief: Uint8Array;
    }
  /** A command from the local player (`playerId` null) or, in dev checks, another player. */
  | { readonly type: "send"; readonly playerId: PlayerId | null; readonly command: Command }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "speed"; readonly multiplier: number };

export type FromWorker =
  | { readonly type: "started"; readonly owner: Uint16Array; readonly frame: WireFrame }
  | { readonly type: "frame"; readonly frame: WireFrame; readonly tickMs: number }
  | { readonly type: "error"; readonly message: string };

/** The worker's side: strips what the main thread already has from each frame. */
export class FrameSlimmer {
  private boats = new Set<number>();
  private trade = new Set<number>();
  private walls: readonly WallSnapshot[] | null = null;

  /** The frame for the wire, and the buffers that can move instead of being copied. */
  slim(frame: TickFrame): { wire: WireFrame; transfer: ArrayBuffer[] } {
    const boats = frame.boats.map((b) => (this.boats.has(b.id) ? { ...b, route: null } : b));
    this.boats = new Set(frame.boats.map((b) => b.id));
    const tradeShips = frame.tradeShips.map((s) =>
      this.trade.has(s.id) ? { ...s, route: null } : s,
    );
    this.trade = new Set(frame.tradeShips.map((s) => s.id));
    const walls = frame.walls === this.walls ? null : frame.walls;
    this.walls = frame.walls;
    // Made fresh for every frame (never shared with later frames), so they can move.
    const transfer = [
      frame.changedTiles.buffer,
      frame.changedOwners.buffer,
      frame.fortTiles.buffer,
      frame.fortLevels.buffer,
    ] as ArrayBuffer[];
    return { wire: { ...frame, boats, tradeShips, walls }, transfer };
  }
}

/**
 * The main thread's side: puts routes and walls back, and reuses the snapshot of a ship
 * that didn't change (as frames from a LocalHost would).
 */
export class FrameRestorer {
  private boats = new Map<number, BoatSnapshot>();
  private tradeShips = new Map<number, TradeShipSnapshot>();
  private walls: readonly WallSnapshot[] = [];

  restore(wire: WireFrame): TickFrame {
    const boats = new Map<number, BoatSnapshot>();
    for (const b of wire.boats) {
      const known = this.boats.get(b.id);
      const same = known && known.recallTick === b.recallTick && known.arriveTick === b.arriveTick;
      const route = b.route ?? known?.route;
      if (!route) throw new Error(`boat ${b.id} arrived without its route`);
      boats.set(b.id, same ? known : { ...b, route });
    }
    this.boats = boats;
    const ships = new Map<number, TradeShipSnapshot>();
    for (const s of wire.tradeShips) {
      const known = this.tradeShips.get(s.id);
      const same = known && known.owner === s.owner && known.toPort === s.toPort;
      const route = s.route ?? known?.route;
      if (!route) throw new Error(`trade ship ${s.id} arrived without its route`);
      ships.set(s.id, same ? known : { ...s, route });
    }
    this.tradeShips = ships;
    if (wire.walls) this.walls = wire.walls;
    return {
      ...wire,
      boats: [...boats.values()],
      tradeShips: [...ships.values()],
      walls: this.walls,
    };
  }
}
