/**
 * When the game makes a sound (GAME_DESIGN.md §3.20, retuned at the user's request after
 * playing 2.9: "the attack and emoji noises are annoying because they are constant and can
 * be spammed"). Four alerts, nothing else:
 *
 *  - **attacked** (soft) — a player starts a land attack on you. Once per attacker: the same
 *    attacker is quiet for `ATTACKER_QUIET_TICKS`, so repeated attacks are one sound. Only
 *    for you.
 *  - **boat** (the horn — the user asked to keep it) — an enemy boat sets sail for your
 *    coast: once per boat (the incoming-threat list). Its landing makes no second sound.
 *  - **alliance** — someone asks you for an alliance, or one of yours asks to be renewed.
 *  - **betrayal** — any alliance in the game is broken (everyone hears it).
 *
 * Pings and emojis make no sound (spammable). The planner only decides; audio/sound.ts plays
 * (and still spaces the same alert out).
 */
import type { SoundCue } from "../audio/sound.ts";
import type { SimEvent } from "../../sim/events.ts";
import type { PlayerId } from "../../sim/world.ts";
import type { Threat } from "./threats.ts";

/** After an "attacked" alert, the same attacker is quiet this long (game ticks: 30 s). */
export const ATTACKER_QUIET_TICKS = 300;

export class AlertPlanner {
  /** Tick each attacker was last announced. */
  private announced = new Map<PlayerId, number>();
  private seenThreats = new Set<string>();
  private seenRenewals = new Set<number>();

  /**
   * The sounds for one tick: its events, the incoming threats now (boats heading for you)
   * and the allies whose renewal prompt is showing now.
   */
  cues(
    events: readonly SimEvent[],
    me: PlayerId,
    tick: number,
    threats: readonly Threat[],
    renewals: readonly PlayerId[],
  ): SoundCue[] {
    const cues = new Set<SoundCue>();
    const attackers: PlayerId[] = [];
    for (const e of events) {
      if (e.type === "attackStarted" && e.target === me && e.attacker !== me) {
        // A landing was announced by the horn when the boat set sail.
        if (e.landingTile < 0) attackers.push(e.attacker);
      } else if (e.type === "allianceRequested" && e.to === me) {
        cues.add("alliance");
      } else if (e.type === "allianceBroken") {
        cues.add("betrayal");
      }
    }
    for (const t of threats) if (!this.seenThreats.has(t.key)) cues.add("boat");
    this.seenThreats = new Set(threats.map((t) => t.key));
    for (const attacker of attackers) {
      const last = this.announced.get(attacker);
      if (last !== undefined && tick - last < ATTACKER_QUIET_TICKS) continue;
      this.announced.set(attacker, tick);
      cues.add("attacked");
    }
    for (const ally of renewals) if (!this.seenRenewals.has(ally)) cues.add("alliance");
    this.seenRenewals = new Set(renewals);
    return [...cues];
  }
}
