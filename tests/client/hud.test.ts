import { describe, expect, it } from "vitest";
import { nearestOwnedTile } from "../../src/client/app/focus.ts";
import { HintTracker, type HintId, type HintStore } from "../../src/client/app/hints.ts";
import { previewClick, type PreviewContext } from "../../src/client/app/preview.ts";
import { addToast, toastsForEvents, type Toast } from "../../src/client/app/toasts.ts";
import { growthState, troopBarModel } from "../../src/client/app/troopBar.ts";
import type { PlayerSnapshot } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

describe("troop bar", () => {
  it("marks the sweet spot: fastest growth around half capacity, none when full", () => {
    expect(growthState(0.1)).toBe("rebuilding");
    expect(growthState(0.5)).toBe("peak");
    expect(growthState(0.36)).toBe("peak");
    expect(growthState(0.8)).toBe("slowing");
    expect(growthState(0.97)).toBe("full");
  });

  it("shows the slice a click would send and where that leaves you", () => {
    const bar = troopBarModel(8_000, 1_000, 10_000, 25);
    expect(bar.home).toBeCloseTo(0.8);
    expect(bar.sendTroops).toBe(2_000);
    expect(bar.send).toBeCloseTo(0.2);
    expect(bar.after).toBeCloseTo(0.6);
    expect(bar.field).toBeCloseTo(0.1);
    expect(bar.state).toBe("slowing");
    expect(bar.afterState).toBe("peak");
  });

  it("never draws past the end of the bar", () => {
    const bar = troopBarModel(9_500, 2_000, 10_000, 10);
    expect(bar.home + bar.field).toBeLessThanOrEqual(1);
  });
});

function player(overrides: Partial<PlayerSnapshot>): PlayerSnapshot {
  return {
    id: 1,
    name: "P",
    kind: "bot",
    alive: true,
    spawned: true,
    ready: true,
    tiles: 100,
    homeTroops: 10_000,
    fieldTroops: 0,
    capacity: 20_000,
    growthPerTick: 0,
    peakTiles: 100,
    personality: null,
    eliminatedTick: -1,
    neighbors: null,
    ...overrides,
  };
}

describe("click preview", () => {
  const me = player({ id: 1, kind: "human", homeTroops: 12_000, neighbors: [0, 2] });
  const players = [me, player({ id: 2 }), player({ id: 3 })];
  const ctx = (overrides: Partial<PreviewContext> = {}): PreviewContext => ({
    rules: DEFAULT_RULES,
    phase: "playing",
    tick: 1_000,
    playStartTick: 0,
    me,
    players,
    ...overrides,
  });

  it("previews an expansion with the tiles it could reach", () => {
    expect(previewClick(ctx(), 0, 25)).toEqual({ kind: "expand", army: 3_000, tiles: 1_000 });
  });

  it("previews an attack on a neighbour with odds", () => {
    const preview = previewClick(ctx(), 2, 100);
    expect(preview.kind).toBe("attack");
    if (preview.kind === "attack") expect(preview.outlook.odds).toBe("advantage");
  });

  it("explains why a click would do nothing", () => {
    expect(previewClick(ctx(), 3, 25).kind).toBe("notReachable");
    expect(previewClick(ctx(), 1, 25).kind).toBe("own");
    expect(previewClick(ctx({ phase: "spawn" }), 2, 25).kind).toBe("inactive");
    expect(previewClick(ctx({ tick: 20 }), 2, 25)).toEqual({ kind: "protected", seconds: 3 });
    // Neutral land isn't protected.
    expect(previewClick(ctx({ tick: 20 }), 0, 25).kind).toBe("expand");
  });
});

describe("toasts", () => {
  const names = (id: number) => `P${id}`;

  it("reports what matters to the local player only", () => {
    const toasts = toastsForEvents(
      [
        { type: "attackStarted", attackId: 1, attacker: 2, target: 1 },
        { type: "attackStarted", attackId: 2, attacker: 3, target: 2 },
        { type: "eliminated", playerId: 4, by: 1 },
        { type: "eliminated", playerId: 5, by: 3 },
        { type: "eliminated", playerId: 1, by: 3 },
        { type: "encircled", playerId: 1, by: 2, tiles: 1200 },
        { type: "encircled", playerId: 3, by: 2, tiles: 50 },
        { type: "encircled", playerId: 3, by: 1, tiles: 2 },
      ],
      1,
      names,
    );
    expect(toasts.map((t) => [t.text, t.tone])).toEqual([
      ["P2 is attacking you", "danger"],
      ["You eliminated P4", "success"],
      ["P3 eliminated P5", "info"],
      ["P2 encircled 1,200 of your tiles", "danger"],
    ]);
  });

  it("in big lobbies, reports other eliminations only when they bordered us", () => {
    const events = [
      { type: "eliminated", playerId: 4, by: 3 },
      { type: "eliminated", playerId: 5, by: 3 },
      { type: "eliminated", playerId: 6, by: 1 },
    ] as const;
    const toasts = toastsForEvents(events, 1, names, (id) => id === 5);
    expect(toasts.map((t) => t.text)).toEqual(["P3 eliminated P5", "You eliminated P6"]);
  });

  it("keeps at most three, dropping the oldest", () => {
    let list: Toast[] = [];
    for (let id = 1; id <= 5; id++) list = addToast(list, { id, text: `${id}`, tone: "info" });
    expect(list.map((t) => t.id)).toEqual([3, 4, 5]);
  });
});

describe("hints", () => {
  function memoryStore(initial: HintId[] = []): HintStore & { saved: HintId[] } {
    const store = {
      saved: initial,
      load: () => store.saved,
      save: (done: readonly HintId[]) => (store.saved = [...done]),
    };
    return store;
  }
  const playing = { playing: true, canAttackPlayer: false };

  it("shows one hint at a time, each until it's done", () => {
    const hints = new HintTracker(memoryStore());
    expect(hints.update({ playing: false, canAttackPlayer: false }, 0)).toBeNull();
    expect(hints.update(playing, 0)).toBe("expand");
    hints.complete("expand");
    expect(hints.update(playing, 1)).toBe("sweetSpot");
    // Explanations disappear on their own after a while.
    expect(hints.update(playing, 16)).toBe("menus");
    expect(hints.update(playing, 31)).toBeNull();
  });

  it("brings up the attack hint as soon as it applies", () => {
    const hints = new HintTracker(memoryStore(["expand"]));
    expect(hints.update(playing, 0)).toBe("sweetSpot");
    expect(hints.update({ playing: true, canAttackPlayer: true }, 1)).toBe("attack");
  });

  it("remembers finished hints", () => {
    const store = memoryStore();
    new HintTracker(store).complete("expand");
    expect(store.saved).toEqual(["expand"]);
    expect(new HintTracker(store).update(playing, 0)).toBe("sweetSpot");
  });
});

describe("nearest owned tile (counter-attack aim)", () => {
  // 5×3 map: player 2 owns (4,0) and (0,2).
  const owner = new Uint16Array([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0]);

  it("finds the closest tile of that owner", () => {
    expect(nearestOwnedTile(owner, 5, 3, 3, 2)).toBe(4);
    expect(nearestOwnedTile(owner, 5, 3, 11, 2)).toBe(10);
  });

  it("falls back to a full scan beyond the search radius, and -1 when there is none", () => {
    expect(nearestOwnedTile(owner, 5, 3, 0, 2, 0)).toBe(4);
    expect(nearestOwnedTile(owner, 5, 3, 0, 7)).toBe(-1);
  });
});
