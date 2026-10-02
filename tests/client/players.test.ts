import { describe, expect, it } from "vitest";
import {
  hexToLab,
  labDistance,
  LOCAL_PLAYER_COLOR,
  MAX_OPPONENTS,
  pickBotNames,
  playerColors,
} from "../../src/client/app/players.ts";

describe("player colors", () => {
  const colors = playerColors(MAX_OPPONENTS + 1);

  it("gives every player of a full lobby its own color", () => {
    expect(colors).toHaveLength(MAX_OPPONENTS + 2); // + neutral at index 0
    expect(new Set(colors.slice(1)).size).toBe(MAX_OPPONENTS + 1);
    expect(colors[1]).toBe(LOCAL_PLAYER_COLOR);
  });

  it("keeps small lobbies on the hand-picked colors", () => {
    expect(playerColors(8)).toEqual(colors.slice(0, 9));
    expect(playerColors(8)[2]).toBe("#e0453a");
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

describe("bot names", () => {
  it("has a distinct name for every opponent of a full lobby", () => {
    const names = pickBotNames(MAX_OPPONENTS, () => 0.5);
    expect(names).toHaveLength(MAX_OPPONENTS);
    expect(new Set(names).size).toBe(MAX_OPPONENTS);
    expect(names).not.toContain("You");
  });
});
