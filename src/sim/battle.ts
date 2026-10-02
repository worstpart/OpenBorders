/**
 * Battle estimates (GAME_DESIGN.md §3.6): how much of a defender's land an army can be
 * expected to take. Bots use them to choose targets; the HUD uses the same numbers for
 * its battle preview and odds labels, so what the player sees is what bots believe.
 * Rough guides only — the real fight also depends on terrain, growth and other wars.
 */
import type { GameRules } from "./rules.ts";

/**
 * Multiplier on the attacker's losses per tile: anyone but a tribe pays less to take a
 * tribe's land (D-017, GAME_DESIGN.md §3.13).
 */
export function attackLossFactor(
  rules: GameRules,
  attackerIsTribe: boolean,
  defenderIsTribe: boolean,
): number {
  return defenderIsTribe && !attackerIsTribe ? rules.tribe.lossWhenAttacked : 1;
}

/**
 * Share of a defender's land an army is expected to take before it runs out. With
 * losses ∝ r = D/A, a fight follows A² − A₀² = k·(D² − D₀²) (k = lossDensity), so the
 * defenders left when the army is spent are D = √(D₀² − A₀²/k), and land falls in
 * proportion to defenders lost. It ignores growth and the per-tile base cost, so it's
 * padded by 15%. Cheaper losses (`lossFactor` < 1) scale k down the same way.
 */
export function expectedLandShare(
  rules: GameRules,
  army: number,
  defenders: number,
  lossFactor = 1,
): number {
  const k = rules.combat.lossDensity * 1.15 * lossFactor;
  const left = 1 - (army * army) / (k * defenders * defenders);
  return left <= 0 ? 1 : 1 - Math.sqrt(left);
}

/**
 * Troops needed just to pay for every tile of a defender's land: even an undefended tile
 * costs at least half the base loss, a bit more on rough terrain. Big, thinly held
 * empires are cheap per tile but have many tiles.
 */
export function tileCostOfAll(
  rules: GameRules,
  tiles: number,
  homeTroops: number,
  lossFactor = 1,
): number {
  const { combat } = rules;
  return lossFactor * 0.6 * (combat.lossBase * 1.15 * tiles + combat.lossDensity * homeTroops);
}

/** Qualitative odds of an attack, from the attacker's point of view (GAME_DESIGN.md §5.1). */
export type Odds = "overwhelming" | "advantage" | "even" | "costly" | "hopeless";

export interface BattleOutlook {
  /** Expected share of the defender's land taken (0–1). */
  readonly landShare: number;
  readonly odds: Odds;
}

/**
 * The expected outcome of sending `army` against a defender with `homeTroops` at home
 * on `tiles` tiles: limited by both the Lanchester estimate and the per-tile cost.
 */
export function battleOutlook(
  rules: GameRules,
  army: number,
  homeTroops: number,
  tiles: number,
  lossFactor = 1,
): BattleOutlook {
  const defenders = Math.max(1, homeTroops);
  const landShare = Math.max(
    0,
    Math.min(
      expectedLandShare(rules, army, defenders, lossFactor),
      army / Math.max(1, tileCostOfAll(rules, tiles, homeTroops, lossFactor)),
      1,
    ),
  );
  // Twice the defenders: half the losses per tile and a front that floods (§3.6).
  const odds: Odds =
    landShare >= 1
      ? army >= 2 * defenders
        ? "overwhelming"
        : "advantage"
      : landShare >= 0.4
        ? "even"
        : landShare >= 0.1
          ? "costly"
          : "hopeless";
  return { landShare, odds };
}
