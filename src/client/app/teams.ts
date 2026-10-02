/**
 * Team games as the start screen and HUD show them (GAME_DESIGN.md §3.15): team names,
 * how a lobby is split into teams, and each team's standing. The rules themselves live in
 * the simulation (victory.ts, diplomacy.ts).
 */
import type { PlayerSnapshot } from "../../sim/frame.ts";

export type GameMode = "ffa" | "teams";

export const MAX_TEAMS = 8;
export const DEFAULT_TEAMS = 2;
/** Team 1 is the local player's (blue); the order matches TEAM_COLORS in players.ts. */
export const TEAM_NAMES = ["Blue", "Red", "Gold", "Violet", "Teal", "Orange", "Pink", "Slate"];

/** "Team Blue". */
export function teamName(team: number): string {
  return `Team ${TEAM_NAMES[team - 1] ?? team}`;
}

/** Most teams a lobby can have: one per nation, plus yours (and at most MAX_TEAMS). */
export function maxTeams(nations: number): number {
  return Math.min(MAX_TEAMS, nations + 1);
}

/** A valid team count for this many nations (at least 2; a lobby needs a nation). */
export function clampTeams(teams: number, nations: number): number {
  return Math.max(2, Math.min(maxTeams(nations), teams));
}

/**
 * The team of the k-th contender — 0 is you, then the nations in order — dealt
 * round-robin, so team sizes differ by at most one. Tribes have no team.
 */
export function dealTeam(index: number, teams: number): number {
  return (index % teams) + 1;
}

/** Contenders per team (you included), team 1 first. */
export function teamSizes(nations: number, teams: number): number[] {
  const sizes = new Array<number>(teams).fill(0);
  for (let k = 0; k <= nations; k++) sizes[dealTeam(k, teams) - 1]!++;
  return sizes;
}

/** "Your team: you + 3 nations · 4 v 4". */
export function describeSplit(nations: number, teams: number): string {
  const sizes = teamSizes(nations, teams);
  const mates = sizes[0]! - 1;
  const yours = mates === 0 ? "just you" : `you + ${mates} nation${mates === 1 ? "" : "s"}`;
  return `Your team: ${yours} · ${sizes.join(" v ")}`;
}

/** Two different players on the same team. */
export function areTeammates(
  a: Pick<PlayerSnapshot, "id" | "team"> | undefined,
  b: Pick<PlayerSnapshot, "id" | "team"> | undefined,
): boolean {
  return !!a && !!b && a.id !== b.id && a.team !== 0 && a.team === b.team;
}

export interface TeamStanding {
  readonly team: number;
  /** Combined land of the team's members. */
  readonly tiles: number;
  /** Members still in the game… */
  readonly alive: number;
  /** …of this many. */
  readonly members: number;
}

/** Each team's combined land and members left, most land first (ties: lower team first). */
export function teamStandings(players: readonly PlayerSnapshot[]): TeamStanding[] {
  const byTeam = new Map<number, { tiles: number; alive: number; members: number }>();
  for (const p of players) {
    if (p.team === 0) continue;
    const entry = byTeam.get(p.team) ?? { tiles: 0, alive: 0, members: 0 };
    entry.members++;
    if (p.alive) {
      entry.alive++;
      entry.tiles += p.tiles;
    }
    byTeam.set(p.team, entry);
  }
  return [...byTeam]
    .map(([team, entry]) => ({ team, ...entry }))
    .sort((a, b) => b.tiles - a.tiles || a.team - b.team);
}

/** Teams that had a member alive before and have none now (for the "Team Red is out" toast). */
export function teamsKnockedOut(
  before: readonly Pick<PlayerSnapshot, "team" | "alive">[],
  after: readonly Pick<PlayerSnapshot, "team" | "alive">[],
): number[] {
  const aliveTeams = (players: readonly Pick<PlayerSnapshot, "team" | "alive">[]) =>
    new Set(players.filter((p) => p.alive && p.team !== 0).map((p) => p.team));
  const now = aliveTeams(after);
  return [...aliveTeams(before)].filter((team) => !now.has(team)).sort((a, b) => a - b);
}
