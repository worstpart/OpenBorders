<script lang="ts">
  import { battleOutlook } from "../../../sim/battle.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { troopsToSend } from "../../app/attackPercent.ts";
  import { ODDS_LABEL, outcomeText, THREAT_LABEL } from "../../app/preview.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";

  interface Props {
    onRetreat: (attackId: number) => void;
    onCounter: (attackId: number) => void;
  }

  let { onRetreat, onCounter }: Props = $props();

  const me = $derived(ui.me);
  const outgoing = $derived(ui.attacks.filter((a) => a.attacker === ui.localPlayerId));
  const incoming = $derived(
    ui.attacks.filter((a) => a.target === ui.localPlayerId && a.target !== 0),
  );

  /** Odds of an army against a player's current home troops. */
  function outlook(army: number, defender: number) {
    const p = ui.players[defender - 1];
    return battleOutlook(DEFAULT_RULES, army, p?.homeTroops ?? 0, p?.tiles ?? 0);
  }

  function remaining(id: number, troops: number): string {
    const peak = ui.attackPeak.get(id) ?? troops;
    return `${Math.max(0, Math.min(100, (troops / Math.max(1, peak)) * 100)).toFixed(1)}%`;
  }

  const counterTroops = $derived(me ? troopsToSend(me.homeTroops, ui.attackPercent) : 0);
</script>

{#if outgoing.length > 0 || incoming.length > 0}
  <ul class="chips" aria-label="Active attacks">
    {#each incoming as attack (attack.id)}
      {@const threat = me
        ? battleOutlook(DEFAULT_RULES, attack.troops, me.homeTroops, me.tiles)
        : null}
      <li class="chip incoming" style:--player-color={ui.colorOf(attack.attacker)}>
        <span class="dot" aria-hidden="true"></span>
        <span class="label">{ui.playerName(attack.attacker)} attacks you</span>
        <span class="troops">{formatTroops(attack.troops)}</span>
        {#if threat}
          <span
            class="odds {threat.odds}"
            title="If you do nothing, this army {outcomeText(threat).replace('their', 'your')}"
          >
            Threat: {THREAT_LABEL[threat.odds]}
          </span>
        {/if}
        <button
          type="button"
          class="action"
          tabindex={-1}
          title="Attack {ui.playerName(
            attack.attacker,
          )} back with {ui.attackPercent}% ({formatTroops(
            counterTroops,
          )}): opposing armies cancel each other out"
          disabled={counterTroops < 1 || attack.retreating}
          onclick={() => onCounter(attack.id)}>Counter {formatTroops(counterTroops)}</button
        >
      </li>
    {/each}
    {#each outgoing as attack (attack.id)}
      {@const odds = attack.target === 0 ? null : outlook(attack.troops, attack.target)}
      <li
        class="chip"
        class:retreating={attack.retreating}
        style:--player-color={ui.colorOf(attack.target)}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="label">
          {attack.target === 0 ? "Expanding" : ui.playerName(attack.target)}
        </span>
        <span class="army" title="Army left">
          <span class="army-bar"
            ><span style:width={remaining(attack.id, attack.troops)}></span></span
          >
          <span class="troops">{formatTroops(attack.troops)}</span>
        </span>
        <span class="tiles" title="Tiles taken">+{attack.tilesTaken.toLocaleString("en-US")}</span>
        {#if odds && !attack.retreating}
          <span class="odds {odds.odds}" title="From here, this army {outcomeText(odds)}">
            {ODDS_LABEL[odds.odds]}
          </span>
        {/if}
        {#if attack.retreating}
          <span class="status">Retreating…</span>
        {:else}
          <button
            type="button"
            class="retreat"
            tabindex={-1}
            title="Retreat (troops return after 2 s{attack.target === 0 ? '' : ', minus 20%'})"
            aria-label="Retreat"
            onclick={() => onRetreat(attack.id)}>×</button
          >
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .chips {
    position: absolute;
    left: 50%;
    bottom: calc(var(--space-4) + var(--command-bar-height) + var(--space-3));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-3);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: 999px;
    box-shadow: var(--shadow-card);
    white-space: nowrap;
  }

  .chip.incoming {
    border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
    background: color-mix(in srgb, var(--color-danger) 14%, var(--surface-glass));
  }

  .chip.retreating {
    opacity: 0.65;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--player-color);
  }

  .label {
    font-weight: 600;
  }

  .incoming .label {
    color: var(--color-danger);
  }

  .army {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .army-bar {
    width: 48px;
    height: 6px;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.1);
    overflow: hidden;
  }

  .army-bar span {
    display: block;
    height: 100%;
    background: var(--text-secondary);
    transition: width var(--duration-normal) var(--ease-out);
  }

  .troops,
  .status {
    color: var(--text-secondary);
  }

  .tiles {
    color: var(--color-success);
  }

  .odds {
    padding: 1px var(--space-2);
    border-radius: 999px;
    font-size: var(--text-sm);
    font-weight: 600;
    background: rgb(255 255 255 / 0.08);
  }

  .odds.overwhelming,
  .odds.advantage {
    color: var(--color-success);
  }

  .odds.even {
    color: var(--color-warning);
  }

  .odds.costly,
  .odds.hopeless {
    color: var(--color-danger);
  }

  /* Seen from the defender's side, good odds for them are bad news for you. */
  .incoming .odds.overwhelming,
  .incoming .odds.advantage {
    color: var(--color-danger);
  }

  .incoming .odds.costly,
  .incoming .odds.hopeless {
    color: var(--text-secondary);
  }

  .action,
  .retreat {
    border: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .action {
    height: 24px;
    padding: 0 var(--space-3);
    border-radius: 999px;
    background: var(--color-danger);
    color: #1b0d0b;
    font-size: var(--text-sm);
    font-weight: 650;
  }

  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .retreat {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    font-size: var(--text-lg);
    line-height: 1;
  }

  .action:not(:disabled):hover {
    filter: brightness(1.1);
  }

  .retreat:hover {
    background: rgb(255 255 255 / 0.18);
  }
</style>
