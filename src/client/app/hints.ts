/**
 * Contextual hints instead of a tutorial (GAME_DESIGN.md §5.4). One hint at a time, in
 * order; each disappears once the player has done it (or after a while for the ones
 * that only explain). Finished hints are remembered across games in this browser.
 */

export type HintId = "expand" | "sweetSpot" | "attack" | "menus" | "ally" | "gold" | "build";

export const HINT_TEXT: Record<HintId, string> = {
  expand: "Click neutral land next to your territory to expand into it.",
  sweetSpot:
    "Troops grow fastest at half capacity — that's the tick on your troop bar. Don't sit full: send troops, then let them regrow.",
  attack:
    "You border another player. Hover their land to see your odds, then click it to attack. Bigger armies win cheaper and faster.",
  menus: "Right-click land for more options. Esc pauses the game.",
  gold: "Your land earns gold. Mobilize (M) turns it into troops at once — best right after an attack, to get back to the sweet spot.",
  build:
    "You can afford a building: right-click your land (or press B) to build Housing (more troops) or a Factory (more gold). Click a building to upgrade it.",
  ally: "Alliances: right-click a player (or press K over their land) to propose one. Allies can't attack each other; breaking an alliance makes you a traitor for 30 s.",
};

/** Hints that only explain disappear after this long (seconds of real time). */
const READ_SECONDS = 14;

export interface HintContext {
  /** The local player is alive in a running match. */
  readonly playing: boolean;
  /** The local player borders another player and spawn protection is over. */
  readonly canAttackPlayer: boolean;
  /** The local player could mobilize right now (has gold and room under the cap). */
  readonly canMobilize?: boolean;
  /** The local player has the gold for their cheapest building (GAME_DESIGN.md §3.17). */
  readonly canBuild?: boolean;
}

export interface HintStore {
  load(): HintId[];
  save(done: readonly HintId[]): void;
}

export class HintTracker {
  private readonly done: Set<HintId>;
  private readonly store: HintStore | null;
  private current: HintId | null = null;
  private shownAt = 0;

  constructor(store: HintStore | null) {
    this.store = store;
    this.done = new Set(store?.load() ?? []);
  }

  /** The player did the thing a hint asks for (or closed it). */
  complete(id: HintId): void {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.store?.save([...this.done]);
  }

  /** The hint to show now (`nowSeconds`: any real-time clock). */
  update(ctx: HintContext, nowSeconds: number): HintId | null {
    if (this.current && !this.done.has(this.current) && this.isTimed(this.current)) {
      if (nowSeconds - this.shownAt >= READ_SECONDS) this.complete(this.current);
    }
    const next = ctx.playing ? this.pick(ctx) : null;
    if (next !== this.current) {
      this.current = next;
      this.shownAt = nowSeconds;
    }
    return next;
  }

  private pick(ctx: HintContext): HintId | null {
    if (!this.done.has("expand")) return "expand";
    // The attack hint jumps the queue: it matters the moment it applies.
    if (ctx.canAttackPlayer && !this.done.has("attack")) return "attack";
    if (!this.done.has("sweetSpot")) return "sweetSpot";
    if (!this.done.has("menus")) return "menus";
    if (ctx.canMobilize && !this.done.has("gold")) return "gold";
    if (ctx.canBuild && !this.done.has("build")) return "build";
    if (ctx.canAttackPlayer && !this.done.has("ally")) return "ally";
    return null;
  }

  private isTimed(id: HintId): boolean {
    return id === "sweetSpot" || id === "menus" || id === "ally";
  }
}

// Kept from the working title "Borderline" so finished hints stay finished after the rename.
const STORAGE_KEY = "borderline.hints.v1";

/** Remembers finished hints in localStorage; quietly does nothing where that's unavailable. */
export const localHintStore: HintStore = {
  load() {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is HintId => v in HINT_TEXT) : [];
    } catch {
      return [];
    }
  },
  save(done) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    } catch {
      // Private mode or storage disabled: hints simply come back next time.
    }
  },
};
