/** The HUD's gold logic (GAME_DESIGN.md §3.16). */
import { describe, expect, it } from "vitest";
import {
  donationKeyOf,
  donationOptions,
  type DonationContext,
} from "../../src/client/app/economy.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { PlayerSnapshot } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

function player(id: number, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
    capacity: 100_000,
    growthPerTick: 0,
    gold: 50_000,
    goldPerTick: 20,
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
    neighbors: null,
    ...overrides,
  };
}

describe("donation options", () => {
  const ctx = (overrides: Partial<DonationContext> = {}): DonationContext => ({
    rules: DEFAULT_RULES,
    tick: 1_000,
    me: player(1, { neighbors: [0, 2] }),
    myDonations: new Map(),
    ...overrides,
  });

  it("send the chosen share of troops or gold", () => {
    const [troops, gold] = donationOptions(ctx(), player(2), 25);
    expect(troops).toEqual({ resource: "troops", amount: 2_500, secondsLeft: 0, blocked: null });
    expect(gold).toEqual({ resource: "gold", amount: 12_500, secondsLeft: 0, blocked: null });
  });

  it("show the cooldown, a full friend, and nothing to send", () => {
    const recent = new Map([[donationKeyOf(2, "gold"), 960]]);
    const [troops, gold] = donationOptions(
      ctx({ myDonations: recent, me: player(1, { homeTroops: 0, neighbors: [2] }) }),
      player(2),
      25,
    );
    expect(troops!.blocked).toBe("nothing");
    expect(gold).toMatchObject({ blocked: "cooldown", secondsLeft: 6 });
    const [toFull] = donationOptions(ctx(), player(2, { homeTroops: 100_000 }), 25);
    expect(toFull!.blocked).toBe("theyAreFull");
  });

  it("send troops only to a friend we border; gold anywhere (D-023)", () => {
    const [troops, gold] = donationOptions(
      ctx({ me: player(1, { neighbors: [0, 3] }) }),
      player(2),
      25,
    );
    expect(troops!.blocked).toBe("notBordering");
    expect(gold!.blocked).toBeNull();
  });

  it("send only the troops that fit under the friend's cap", () => {
    const [troops] = donationOptions(ctx(), player(2, { homeTroops: 99_000 }), 50);
    expect(troops!.amount).toBe(1_000);
  });
});

describe("gold toasts", () => {
  const names = (id: number) => `P${id}`;

  it("report gifts to and from the local player, and loot", () => {
    const toasts = toastsForEvents(
      [
        { type: "donated", from: 2, to: 1, resource: "troops", amount: 12_400 },
        { type: "donated", from: 1, to: 3, resource: "gold", amount: 5_000 },
        { type: "donated", from: 2, to: 3, resource: "gold", amount: 5_000 },
        { type: "eliminated", playerId: 4, by: 1, loot: 8_000 },
      ],
      1,
      names,
    );
    expect(toasts.map((t) => [t.text, t.tone])).toEqual([
      ["P2 sent you 12.4K troops", "success"],
      ["You sent P3 5K gold", "info"],
      ["You eliminated P4 and took 8K gold", "success"],
    ]);
  });
});
