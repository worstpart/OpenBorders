/** The diplomacy HUD's logic (GAME_DESIGN.md §3.14). */
import { describe, expect, it } from "vitest";
import {
  allianceStatus,
  diplomacyCards,
  formatCountdown,
  type DiplomacyContext,
} from "../../src/client/app/diplomacy.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { PlayerSnapshot } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

const D = DEFAULT_RULES.diplomacy;

function player(id: number): PlayerSnapshot {
  return {
    id,
    name: `P${id}`,
    kind: id === 1 ? "human" : "bot",
    alive: true,
    spawned: true,
    ready: true,
    tiles: 100,
    homeTroops: 10_000,
    fieldTroops: 0,
    capacity: 20_000,
    growthPerTick: 0,
    gold: 0,
    goldPerTick: 0,
    tradeGold: 0,
    capacityBonus: 0,
    growthBonus: 0,
    peakTiles: 100,
    tier: id === 1 ? null : "nation",
    personality: null,
    difficulty: null,
    eliminatedTick: -1,
    traitorUntilTick: -1,
    betrayals: 0,
    team: 0,
    neighbors: [2, 3],
  };
}

function context(overrides: Partial<DiplomacyContext> = {}): DiplomacyContext {
  const players = [player(1), player(2), player(3), player(4)];
  return {
    rules: DEFAULT_RULES,
    phase: "playing",
    tick: 1_000,
    me: players[0],
    players,
    alliances: [],
    requests: [],
    myRequests: new Map(),
    ...overrides,
  };
}

describe("alliance status", () => {
  it("offers a request to anyone alive but ourselves", () => {
    expect(allianceStatus(context(), 2).kind).toBe("canAsk");
    expect(allianceStatus(context(), 1).kind).toBe("none");
    expect(allianceStatus(context(), 0).kind).toBe("none");
    expect(allianceStatus(context({ phase: "spawn" }), 2).kind).toBe("none");
  });

  it("knows about requests both ways and the cooldown", () => {
    const requests = [
      { from: 2, to: 1, expiresTick: 1_150 },
      { from: 1, to: 3, expiresTick: 1_100 },
    ];
    expect(allianceStatus(context({ requests }), 2)).toEqual({
      kind: "theyAsked",
      secondsLeft: 15,
    });
    expect(allianceStatus(context({ requests }), 3)).toEqual({ kind: "sent", secondsLeft: 10 });
    const myRequests = new Map([[4, 1_000 - D.requestTicks]]);
    expect(allianceStatus(context({ myRequests }), 4)).toEqual({
      kind: "cooldown",
      secondsLeft: (D.requestCooldownTicks - D.requestTicks) / 10,
    });
  });

  it("shows time left and renewal state for allies", () => {
    const alliances = [{ a: 1, b: 2, expiresTick: 1_200, renewA: false, renewB: true }];
    expect(allianceStatus(context({ alliances }), 2)).toEqual({
      kind: "ally",
      secondsLeft: 20,
      renewable: true,
      renewedByMe: false,
      renewedByThem: true,
    });
  });
});

describe("diplomacy cards", () => {
  it("list requests to us first, then renewals soonest first", () => {
    const cards = diplomacyCards(
      context({
        requests: [
          { from: 3, to: 1, expiresTick: 1_100 },
          { from: 1, to: 4, expiresTick: 1_100 },
        ],
        alliances: [
          { a: 1, b: 2, expiresTick: 1_250, renewA: true, renewB: false },
          { a: 1, b: 4, expiresTick: 1_100, renewA: false, renewB: false },
          { a: 2, b: 3, expiresTick: 1_010, renewA: false, renewB: false },
          { a: 1, b: 3, expiresTick: 9_000, renewA: false, renewB: false },
        ],
      }),
    );
    expect(cards.map((c) => (c.kind === "request" ? `req ${c.from}` : `renew ${c.ally}`))).toEqual([
      "req 3",
      "renew 4",
      "renew 2",
    ]);
    expect(cards[2]).toMatchObject({ waiting: true });
  });

  it("formats countdowns rounding up", () => {
    expect(formatCountdown(191.2)).toBe("3:12");
    expect(formatCountdown(0.4)).toBe("0:01");
  });
});

describe("alliance toasts", () => {
  const name = (id: number) => `P${id}`;

  it("tell us about our own alliances", () => {
    const toasts = toastsForEvents(
      [
        { type: "allianceFormed", a: 1, b: 2 },
        { type: "allianceRequestEnded", from: 1, to: 3, reason: "declined" },
        { type: "allianceEnded", a: 1, b: 4, reason: "expired" },
        { type: "allianceFormed", a: 2, b: 3 },
      ],
      1,
      name,
    );
    expect(toasts.map((t) => t.text)).toEqual([
      "You are now allied with P2",
      "P3 declined your alliance",
      "Your alliance with P4 has ended",
    ]);
  });

  it("make betrayals loud", () => {
    const toasts = toastsForEvents(
      [
        { type: "allianceBroken", breaker: 2, victim: 1 },
        { type: "allianceBroken", breaker: 1, victim: 3 },
        { type: "allianceBroken", breaker: 3, victim: 4 },
      ],
      1,
      name,
      () => false, // every betrayal is news, even far away in a big lobby
    );
    expect(toasts.map((t) => t.tone)).toEqual(["danger", "danger", "info"]);
    expect(toasts[0]!.text).toContain("P2 betrayed you!");
    expect(toasts[2]!.text).toBe("P3 betrayed P4");
  });
});
