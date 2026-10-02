<script lang="ts">
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatClock, formatPercent } from "../../format.ts";

  interface Props {
    onPlayAgain: () => void;
  }

  let { onPlayAgain }: Props = $props();

  const me = $derived(ui.me);
  const over = $derived(ui.phase === "ended");
  const eliminated = $derived(!!me?.spawned && !me.alive);
  const won = $derived(over && ui.winner === ui.localPlayerId);
  const visible = $derived(over || (eliminated && !ui.spectating));

  const endTick = $derived(me && me.eliminatedTick >= 0 ? me.eliminatedTick : ui.tick);
  const seconds = $derived(Math.max(0, endTick - ui.playStartTick) / 10);

  const title = $derived(won ? "Victory" : eliminated ? "Defeated" : "Game over");
  const line = $derived.by(() => {
    if (won) {
      return ui.gameOverReason === "landShare"
        ? "You control 70% of the land."
        : "You are the last one standing.";
    }
    if (eliminated && ui.eliminatedBy !== null) {
      return `${ui.playerName(ui.eliminatedBy)} took your last land.`;
    }
    if (eliminated) return "Your territory is gone.";
    if (ui.winner !== null) return `${ui.playerName(ui.winner)} won the match.`;
    return "Nobody is left standing.";
  });
</script>

{#if visible && me}
  <div class="backdrop">
    <div class="card" class:won role="dialog" aria-modal="true" aria-labelledby="end-title">
      <h1 id="end-title">{title}</h1>
      <p class="line">{line}</p>
      <dl class="stats">
        <div>
          <dt>{eliminated ? "Survived" : "Match time"}</dt>
          <dd>{formatClock(seconds)}</dd>
        </div>
        <div>
          <dt>Most land held</dt>
          <dd>{formatPercent(me.peakTiles / ui.landTiles)}</dd>
        </div>
        <div>
          <dt>Land now</dt>
          <dd>{formatPercent(me.tiles / ui.landTiles)}</dd>
        </div>
      </dl>
      <div class="actions">
        {#if eliminated && !over}
          <button type="button" class="secondary" onclick={() => (ui.spectating = true)}>
            Keep watching
          </button>
        {/if}
        <button type="button" class="primary" onclick={onPlayAgain}>Play again</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: rgb(8 12 18 / 0.35);
    pointer-events: auto;
  }

  .card {
    width: min(380px, 100%);
    padding: var(--space-8);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: var(--text-display);
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--color-danger);
  }

  .won h1 {
    color: var(--color-success);
  }

  .line {
    margin: var(--space-2) 0 var(--space-6);
    color: var(--text-secondary);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    margin: 0 0 var(--space-6);
  }

  dt {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  dd {
    margin: var(--space-1) 0 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: var(--space-3);
  }

  button {
    flex: 1;
    height: 40px;
    border-radius: var(--radius-control);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .primary {
    border: none;
    background: var(--accent);
    color: #fff;
  }

  .secondary {
    border: 1px solid var(--surface-hairline);
    background: rgb(255 255 255 / 0.06);
    color: var(--text-primary);
  }

  button:hover {
    filter: brightness(1.1);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
