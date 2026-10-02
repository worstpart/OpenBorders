import { describe, expect, it } from "vitest";
import {
  hexToLab,
  labDistance,
  LOCAL_PLAYER_COLOR,
  MAX_OPPONENTS,
  pickBotNames,
  playerColors,
  MAX_NATIONS,
  pickNationNames,
  generateTribeColors,
} from "../../src/client/app/players.ts";
import { clampLobby } from "../../src/client/app/setup.ts";

describe("player colors", () => {
  const lobby = (nations: number, tribes = 0) =>
    playerColors([
      "human",
      ...Array<"nation">(nations).fill("nation"),
      ...Array<"tribe">(tribes).fill("tribe"),
    ]);
  const colors = lobby(MAX_OPPONENTS);

  it("gives every player of a full lobby its own color", () => {
    expect(colors).toHaveLength(MAX_OPPONENTS + 2); // + neutral at index 0
    expect(new Set(colors.slice(1)).size).toBe(MAX_OPPONENTS + 1);
    expect(colors[1]).toBe(LOCAL_PLAYER_COLOR);
  });

  it("keeps small lobbies on the hand-picked colors", () => {
    expect(lobby(7)).toEqual(colors.slice(0, 9));
    expect(lobby(7)[2]).toBe("#e0453a");
  });

  it("keeps generated colors visibly apart (OKLab distance)", () => {
    const labs = colors.slice(1).map(hexToLab);
    let closest = Infinity;
    for (let a = 0; a < labs.length; a++) {
      for (let b = a + 1; b < labs.length; b++) {
        closest = Math.min(closest, labDistance(labs[a]!, labs[b]!));
      }
    }
    // ~0.02 is barely noticeable side by side; 0.05 is clearly different.
    expect(closest).toBeGreaterThan(0.05);
  });
});

describe("tribe colors", () => {
  it("are dull browns and tans, distinct from each other, while nations stay bright", () => {
    const tribes = generateTribeColors(100);
    expect(new Set(tribes.slice(0, 64)).size).toBe(64);
    for (const hex of tribes) {
      const [L, a, b] = hexToLab(hex);
      expect(Math.hypot(a, b)).toBeLessThan(0.07); // low saturation
      expect(Math.atan2(b, a)).toBeGreaterThan(0.5); // brown/tan/khaki hues (35°–95°)
      expect(Math.atan2(b, a)).toBeLessThan(1.7);
      expect(L).toBeLessThan(0.72);
    }
    const mixed = playerColors(["human", "nation", "tribe", "nation", "tribe"]);
    expect(mixed[2]).toBe("#e0453a"); // first nation: first bright color
    expect(mixed[4]).toBe("#f2c032");
    expect(mixed[3]).toBe(tribes[0]);
    expect(mixed[5]).toBe(tribes[1]);
  });
});

describe("bot names", () => {
  it("has a distinct name for every opponent of a full lobby", () => {
    const names = pickBotNames(MAX_OPPONENTS, () => 0.5);
    expect(names).toHaveLength(MAX_OPPONENTS);
    expect(new Set(names).size).toBe(MAX_OPPONENTS);
    expect(names).not.toContain("You");
  });
});

describe("lobby setup", () => {
  it("keeps nations + tribes within 1..125 (nations win ties)", () => {
    expect(clampLobby(7, 25)).toEqual({ nations: 7, tribes: 25 });
    expect(clampLobby(10, 200)).toEqual({ nations: 10, tribes: 115 });
    expect(clampLobby(40, 0)).toEqual({ nations: MAX_NATIONS, tribes: 0 });
    expect(clampLobby(0, 0)).toEqual({ nations: 1, tribes: 0 });
    expect(pickNationNames(MAX_NATIONS, () => 0.3)).toHaveLength(MAX_NATIONS);
  });
});
