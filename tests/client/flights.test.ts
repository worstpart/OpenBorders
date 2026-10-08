/** Flights in the HUD (GAME_DESIGN.md §3.17.7, milestone 2B.0). */
import { describe, expect, it } from "vitest";
import { flightPosition, flightSecondsLeft } from "../../src/client/app/flights.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { FlightSnapshot } from "../../src/sim/frame.ts";
import { createMap } from "../../src/sim/map/gameMap.ts";

const map = createMap(40, 20, new Uint8Array(800));
const at = (x: number, y: number) => y * 40 + x;

const flight: FlightSnapshot = {
  id: 3,
  owner: 2,
  kind: "test",
  source: -1,
  target: 1,
  fromTile: at(2, 2),
  toTile: at(22, 12),
  planes: 4,
  escorts: 0,
  troops: 0,
  launchTick: 100,
  arriveTick: 112,
};

describe("flights on the map", () => {
  it("glide along their straight line between ticks, heading for the target", () => {
    expect(flightPosition(map, flight, 100)).toEqual({ x: 2.5, y: 2.5, dx: 20, dy: 10 });
    expect(flightPosition(map, flight, 103)).toMatchObject({ x: 7.5, y: 5 });
    expect(flightPosition(map, flight, 106.6).x).toBeCloseTo(13.5, 10);
    expect(flightPosition(map, flight, 130)).toMatchObject({ x: 22.5, y: 12.5 });
  });

  it("count down to their arrival", () => {
    expect(flightSecondsLeft(flight, 100, 100)).toBe(1.2);
    expect(flightSecondsLeft(flight, 111.5, 100)).toBeCloseTo(0.05, 10);
    expect(flightSecondsLeft(flight, 120, 100)).toBe(0);
  });

  it("a hostile flight at our land is a toast — not one at someone else, not a friend's", () => {
    const launched = (owner: number, target: number): SimEvent => ({
      type: "flightLaunched",
      flightId: owner * 10 + target,
      owner,
      kind: "test",
      target,
      fromTile: 0,
      toTile: 1,
      planes: 4,
      escorts: 0,
      troops: 0,
      arriveTick: 50,
    });
    const name = (id: number) => `P${id}`;
    const texts = toastsForEvents(
      [launched(2, 1), launched(2, 3), launched(1, 2), launched(4, 1)],
      1,
      name,
      () => true,
      () => 0,
      new Set([4]),
    ).map((t) => t.text);
    expect(texts).toEqual(["✈ P2's test flight is heading for your land"]);
  });
});
