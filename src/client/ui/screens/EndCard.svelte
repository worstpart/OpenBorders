<script lang="ts">
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatClock, formatPercent } from "../../format.ts";
  import { teamName } from "../../app/teams.ts";

  interface Props {
    onPlayAgain: () => void;
  }

  let { onPlayAgain }: Props = $props();

  const me = $derived(ui.me);
  const over = $derived(ui.phase === "ended");
  const eliminated = $derived(!!me?.spawned && !me.alive);
  /** Team games: the winning team (GAME_DESIGN.md §3.15) — you win with it, even if out. */
  const teamWin = $derived(over && ui.winningTeam > 0);
  const won = $derived(
    over && (teamWin ? me?.team === ui.winningTeam : ui.winner === ui.localPlayerId),
  );
  const visible = $derived(over || (eliminated && !ui.spectating));

  /** Watching an online game (3.5): no country of your own; the end card says who won. */
  /** The winner's land — a team's combined land when a team won. */
  const winnerTiles = $derived(
    teamWin
      ? ui.players.filter((p) => p.team === ui.winningTeam).reduce((sum, p) => sum + p.tiles, 0)
      : (ui.players.find((p) => p.id === ui.winner)?.tiles ?? null),
  );

  const endTick = $derived(me && me.eliminatedTick >= 0 ? me.eliminatedTick : ui.tick);
  const seconds = $derived(Math.max(0, endTick - ui.playStartTick) / 10);

  const title = $derived(won ? "Victory" : eliminated ? "Defeated" : "Game over");
  const line = $derived.by(() => {
    if (won && teamWin) {
      const how =
        ui.gameOverReason === "landShare"
          ? "Your team controls the land it needed to win."
          : "Your team is the last one standing.";
      return eliminated ? `${how} You were knocked out, but your team carried on.` : how;
    }
    if (won) {
      // (The share needed shrinks in long games, so the card doesn't name a number.)
      return ui.gameOverReason === "landShare"
        ? "You control the land you needed to win."
        : "You are the last one standing.";
    }
    const result = !over
      ? ""
      : teamWin
        ? `${teamName(ui.winningTeam)} won the match.`
        : ui.winner !== null
          ? `${ui.playerName(ui.winner)} won the match.`
          : "Nobody is left standing.";
    const fate = !eliminated
      ? ""
      : ui.eliminatedBy !== null
        ? `${ui.playerName(ui.eliminatedBy)} took your last land.`
        : "Your territory is gone.";
    return [result, fate].filter(Boolean).join(" ");
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
{:else if over && !me}
  <div class="backdrop">
    <div class="card watched" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <h1 id="end-title">Game over</h1>
      <p class="line">{line}</p>
      <dl class="stats">
        <div>
          <dt>Match time</dt>
          <dd>{formatClock(seconds)}</dd>
        </div>
        {#if winnerTiles !== null}
          <div>
            <dt>{teamWin ? "Winning team's land" : "Winner's land"}</dt>
            <dd>{formatPercent(winnerTiles / ui.landTiles)}</dd>
          </div>
        {/if}
      </dl>
      <div class="actions">
        <button type="button" class="primary" onclick={onPlayAgain}>Back to start</button>
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

  /* A spectator neither won nor lost. */
  .watched h1 {
    color: var(--text-primary);
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
