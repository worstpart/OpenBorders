<script lang="ts">
  import { formatPercent } from "../../format.ts";
  import { teamName } from "../../app/teams.ts";
  import { ui } from "../../app/uiState.svelte.ts";

  const me = $derived(ui.me);
  const color = $derived(ui.colors[ui.localPlayerId] ?? "#888");
  const rank = $derived(
    me ? 1 + ui.players.filter((p) => p.alive && p.tiles > me.tiles).length : 0,
  );
</script>

{#if me?.spawned}
  <div class="chip" style:--player-color={color}>
    <span class="dot" aria-hidden="true"></span>
    <span class="name">{me.name}</span>
    {#if me.team !== 0}<span class="stat team">{teamName(me.team)}</span>{/if}
    <span class="stat" title="Share of all land">
      {formatPercent(me.tiles / ui.landTiles)} land
    </span>
    {#if me.alive}
      <span class="stat" title="Rank by land">#{rank}</span>
    {:else}
      <span class="stat out">Eliminated</span>
    {/if}
  </div>
{/if}

<style>
  .chip {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 36px;
    padding: 0 var(--space-4) 0 var(--space-3);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: 999px;
    box-shadow: var(--shadow-card);
    font-size: var(--text-md);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--player-color);
    box-shadow: 0 0 0 2px rgb(255 255 255 / 0.18);
  }

  .name {
    font-weight: 650;
  }

  .stat {
    color: var(--text-secondary);
  }

  .team {
    color: var(--color-ally);
    font-weight: 600;
  }

  .out {
    color: var(--color-danger);
  }
</style>
