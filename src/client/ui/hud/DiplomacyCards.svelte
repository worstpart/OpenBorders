<script lang="ts">
  import { fly } from "svelte/transition";
  import { describeBot } from "../../app/players.ts";
  import { diplomacyCards, formatCountdown } from "../../app/diplomacy.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatPercent, formatTroops } from "../../format.ts";

  interface Props {
    onReply: (from: number, accept: boolean) => void;
    onRenew: (ally: number) => void;
    onDismissRenewal: (ally: number) => void;
  }

  let { onReply, onRenew, onDismissRenewal }: Props = $props();

  /** Decisions waiting for the local player (GAME_DESIGN.md §3.14), at most four shown. */
  const cards = $derived(
    diplomacyCards(ui.diplomacyContext)
      .filter((c) => c.kind === "request" || !ui.dismissedRenewals.has(c.ally))
      .slice(0, 4),
  );
  /** The card Y / N answer (the first one still waiting for us). */
  const keyed = $derived(cards.findIndex((c) => c.kind === "request" || !c.waiting));
</script>

{#if cards.length > 0}
  <ul class="cards" aria-label="Diplomacy" aria-live="polite">
    {#each cards as card, index (card.kind + (card.kind === "request" ? card.from : card.ally))}
      {@const id = card.kind === "request" ? card.from : card.ally}
      {@const player = ui.players[id - 1]}
      <li
        class="card"
        style:--player-color={ui.colorOf(id)}
        transition:fly={{ x: -16, duration: 180 }}
      >
        <div class="head">
          <span class="dot" aria-hidden="true"></span>
          <span class="name">{ui.playerName(id)}</span>
          {#if player}
            <span class="muted">
              {formatTroops(player.homeTroops + player.fieldTroops)} · {formatPercent(
                player.tiles / ui.landTiles,
              )}
            </span>
          {/if}
        </div>
        {#if card.kind === "request"}
          <div class="text">
            Wants an alliance{#if player?.tier}<span class="muted">
                · {describeBot(player)}</span
              >{/if}
          </div>
        {:else if card.waiting}
          <div class="text">
            Alliance ends in {formatCountdown(card.secondsLeft)} — waiting for them to renew…
          </div>
        {:else}
          <div class="text">
            Alliance ends in {formatCountdown(card.secondsLeft)}. Renew for 5 min?
          </div>
        {/if}
        <div class="timer" aria-hidden="true"><span style:width="{card.share * 100}%"></span></div>
        {#if card.kind === "request"}
          <div class="actions">
            <button type="button" class="yes" tabindex={-1} onclick={() => onReply(id, true)}>
              Accept{#if index === keyed}<kbd>Y</kbd>{/if}
            </button>
            <button type="button" tabindex={-1} onclick={() => onReply(id, false)}>
              Decline{#if index === keyed}<kbd>N</kbd>{/if}
            </button>
          </div>
        {:else if !card.waiting}
          <div class="actions">
            <button type="button" class="yes" tabindex={-1} onclick={() => onRenew(id)}>
              Renew{#if index === keyed}<kbd>Y</kbd>{/if}
            </button>
            <button type="button" tabindex={-1} onclick={() => onDismissRenewal(id)}>
              Let it end{#if index === keyed}<kbd>N</kbd>{/if}
            </button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .cards {
    position: absolute;
    top: calc(var(--space-4) + 36px + var(--space-2));
    left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 280px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    pointer-events: auto;
    padding: var(--space-2) var(--space-3) var(--space-3);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid color-mix(in srgb, var(--color-ally) 35%, transparent);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    font-size: var(--text-sm);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-md);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--player-color);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
  }

  .head .muted {
    margin-left: auto;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .text {
    margin-top: var(--space-1);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .timer {
    height: 3px;
    margin-top: var(--space-2);
    border-radius: 2px;
    background: rgb(255 255 255 / 0.08);
    overflow: hidden;
  }

  .timer span {
    display: block;
    height: 100%;
    background: var(--color-ally);
    transition: width var(--duration-normal) linear;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 26px;
    padding: 0 var(--space-3);
    border: none;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    color: var(--text-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: rgb(255 255 255 / 0.16);
  }

  button.yes {
    background: var(--color-ally);
    color: #0c1f17;
  }

  button.yes:hover {
    filter: brightness(1.08);
  }

  kbd {
    padding: 0 4px;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.18);
    font: inherit;
    font-size: 11px;
    opacity: 0.8;
  }
</style>
