/** Milestone 3.6: orders on their way, as the map and HUD show them; the connection banner. */
import { describe, expect, it } from "vitest";
import {
  latencyTone,
  orderTile,
  pendingRings,
  SENDING_HINT_MS,
  slowOrder,
} from "../../src/client/app/pendingOrders.ts";
import { onlineBanner } from "../../src/client/app/online.ts";
import type { OnlineState } from "../../src/client/app/uiState.svelte.ts";

describe("pending orders (3.6)", () => {
  it("knows where an order is aimed, if anywhere", () => {
    expect(orderTile({ type: "attack", target: 3, focusTile: 77, percentBp: 5000 })).toBe(77);
    expect(orderTile({ type: "attack", target: 3, focusTile: -1, percentBp: 5000 })).toBeNull();
    expect(orderTile({ type: "spawn", tile: 12 })).toBe(12);
    expect(orderTile({ type: "build", buildingType: "port", tile: 40 })).toBe(40);
    expect(orderTile({ type: "buildWall", points: [1, 2, 9] })).toBe(9);
    expect(orderTile({ type: "moveWarship", warshipId: 1, tile: -1 })).toBeNull();
    expect(orderTile({ type: "allianceRequest", target: 2 })).toBeNull();
    expect(orderTile({ type: "confirmSpawn" })).toBeNull();
  });

  it("rings for aimed orders; the HUD says 'sending' only once one is slow", () => {
    const orders = [
      { command: { type: "spawn" as const, tile: 5 }, sentAt: 1000 },
      { command: { type: "confirmSpawn" as const }, sentAt: 1010 },
    ];
    expect(pendingRings(orders, 1100)).toEqual([{ tile: 5, ageMs: 100 }]);
    expect(slowOrder(orders, 1000 + SENDING_HINT_MS - 1)).toBe(false);
    expect(slowOrder(orders, 1000 + SENDING_HINT_MS)).toBe(true);
    expect(slowOrder([], 99999)).toBe(false);
  });

  it("rates the round trip", () => {
    expect(latencyTone(40)).toBe("good");
    expect(latencyTone(200)).toBe("fair");
    expect(latencyTone(450)).toBe("poor");
  });
});

describe("the connection banner (3.5, 3.6)", () => {
  const playing: OnlineState = {
    status: "playing",
    gameId: "g",
    players: [],
    you: 0,
    creator: false,
    error: "",
    summary: null,
    public: false,
    startsAt: null,
    watching: false,
    catchingUp: false,
    reconnecting: 0,
    pingMs: 80,
    stalled: false,
  };

  it("says when turns stop coming, after the more urgent states", () => {
    expect(onlineBanner(playing)).toBeNull();
    expect(onlineBanner({ ...playing, stalled: true })?.text).toBe("Waiting for the server…");
    expect(onlineBanner({ ...playing, stalled: true, catchingUp: true })?.text).toMatch(
      /Catching up/,
    );
    expect(onlineBanner({ ...playing, stalled: true, reconnecting: 2 })?.text).toMatch(
      /reconnecting/,
    );
  });
});
