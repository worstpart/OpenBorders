/** Team games in the client (GAME_DESIGN.md §3.15). */
import { describe, expect, it } from "vitest";
import { allianceStatus, type DiplomacyContext } from "../../src/client/app/diplomacy.ts";
import {
  generateTeamShades,
  hexToLab,
  labDistance,
  LOCAL_PLAYER_COLOR,
  TEAM_COLORS,
  teamPlayerColors,
} from "../../src/client/app/players.ts";
import { previewClick, type PreviewContext } from "../../src/client/app/preview.ts";
import {
  clampTeams,
  dealTeam,
  describeSplit,
  maxTeams,
  teamName,
  teamsKnockedOut,
  teamSizes,
  teamStandings,
} from "../../src/client/app/teams.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { PlayerSnapshot } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

function player(id: number, team: number, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
    team,
    neighbors: id === 1 ? [0, 2, 3] : null,
    ...overrides,
  };
}

describe("team lobby", () => {
  it("deals you and the nations round-robin, you on team 1", () => {
    expect([0, 1, 2, 3, 4].map((k) => dealTeam(k, 2))).toEqual([1, 2, 1, 2, 1]);
    expect(teamSizes(7, 2)).toEqual([4, 4]);
    expect(teamSizes(8, 2)).toEqual([5, 4]);
    expect(teamSizes(7, 3)).toEqual([3, 3, 2]);
  });

  it("allows one team per nation plus yours, at most 8", () => {
    expect(maxTeams(1)).toBe(2);
    expect(maxTeams(3)).toBe(4);
    expect(maxTeams(25)).toBe(8);
    expect(clampTeams(5, 2)).toBe(3);
    expect(clampTeams(1, 7)).toBe(2);
  });

  it("describes the split", () => {
    expect(describeSplit(7, 2)).toBe("Your team: you + 3 nations · 4 v 4");
    expect(describeSplit(1, 2)).toBe("Your team: just you · 1 v 1");
    expect(describeSplit(2, 2)).toBe("Your team: you + 1 nation · 2 v 1");
    expect(teamName(1)).toBe("Team Blue");
    expect(teamName(2)).toBe("Team Red");
  });
});

describe("team colors", () => {
  it("gives each team its hue: you keep the blue, members get distinct shades", () => {
    const colors = teamPlayerColors([
      { tier: "human", team: 1 },
      { tier: "nation", team: 2 },
      { tier: "nation", team: 1 },
      { tier: "nation", team: 2 },
      { tier: "tribe", team: 0 },
    ]);
    expect(colors).toHaveLength(6);
    expect(colors[1]).toBe(LOCAL_PLAYER_COLOR);
    expect(colors[2]).toBe(TEAM_COLORS[1]);
    expect(new Set(colors.slice(1)).size).toBe(5);
    // A teammate's shade stays closer to the team's color than to the other team's.
    const blue = hexToLab(TEAM_COLORS[0]!);
    const red = hexToLab(TEAM_COLORS[1]!);
    const mate = hexToLab(colors[3]!);
    expect(labDistance(mate, blue)).toBeLessThan(labDistance(mate, red));
  });

  it("keeps up to 13 teammates apart", () => {
    for (const base of TEAM_COLORS.slice(0, 2)) {
      const shades = generateTeamShades(base, 13);
      expect(new Set(shades).size).toBe(13);
      let closest = Infinity;
      for (let i = 0; i < shades.length; i++) {
        for (let j = i + 1; j < shades.length; j++) {
          closest = Math.min(closest, labDistance(hexToLab(shades[i]!), hexToLab(shades[j]!)));
        }
      }
      expect(closest).toBeGreaterThan(0.04);
    }
  });
});

describe("team HUD", () => {
  const players = [player(1, 1), player(2, 1), player(3, 2), player(4, 2, { alive: false })];

  it("sums each team's land and members left", () => {
    expect(teamStandings(players)).toEqual([
      { team: 1, tiles: 200, alive: 2, members: 2 },
      { team: 2, tiles: 100, alive: 1, members: 2 },
    ]);
    expect(teamStandings([player(1, 0)])).toEqual([]);
  });

  it("notices a team whose last member went out", () => {
    const after = players.map((p) => (p.id === 3 ? { ...p, alive: false } : p));
    expect(teamsKnockedOut(players, after)).toEqual([2]);
    expect(teamsKnockedOut(players, players)).toEqual([]);
  });

  it("the preview and menus treat teammates as friends", () => {
    const ctx: PreviewContext = {
      rules: DEFAULT_RULES,
      phase: "playing",
      tick: 1_000,
      playStartTick: 0,
      me: players[0],
      players,
      teammates: new Set([2]),
    };
    expect(previewClick(ctx, 2, 25)).toEqual({ kind: "teammate" });
    // Even one we don't border (player 4 isn't in our neighbours).
    expect(previewClick({ ...ctx, teammates: new Set([2, 4]) }, 4, 25)).toEqual({
      kind: "teammate",
    });
    expect(previewClick(ctx, 3, 25).kind).toBe("attack");

    const diplomacy: DiplomacyContext = {
      rules: DEFAULT_RULES,
      phase: "playing",
      tick: 1_000,
      me: players[0],
      players,
      alliances: [],
      requests: [],
      myRequests: new Map(),
    };
    expect(allianceStatus(diplomacy, 2)).toEqual({ kind: "teammate" });
    expect(allianceStatus(diplomacy, 3)).toEqual({ kind: "canAsk" });
  });

  it("a teammate's elimination is always news", () => {
    const toasts = toastsForEvents(
      [{ type: "eliminated", playerId: 2, by: 3, loot: 0 }],
      1,
      (id) => `P${id}`,
      () => false, // a big lobby: others' eliminations aren't news…
      (id) => players[id - 1]!.team,
    );
    expect(toasts).toEqual([{ text: "P3 eliminated your teammate P2", tone: "danger", player: 2 }]);
  });
});
