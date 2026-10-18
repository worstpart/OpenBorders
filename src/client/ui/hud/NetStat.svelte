<script lang="ts">
  /**
   * Online games (3.6): the connection at a glance — the round trip to the server with a
   * coloured dot (good / fair / poor), or "sending…" while one of your orders is slow to come
   * back. Its tooltip also says how long orders take to reach the game.
   */
  import { latencyTone } from "../../app/pendingOrders.ts";
  import { ui } from "../../app/uiState.svelte.ts";

  const ping = $derived(ui.online?.pingMs ?? null);
  const title = $derived(
    ping === null
      ? ""
      : `Round trip to the server: ${Math.round(ping)} ms` +
          (ui.orderDelayMs !== null
            ? ` · your orders reach the game in about ${Math.round(ui.orderDelayMs)} ms`
            : ""),
  );
</script>

{#if ping !== null}
  <span class="net {latencyTone(ping)}" {title}>
    <span class="dot" aria-hidden="true"></span>
    {ui.sendingOrder ? "sending…" : `${Math.round(ping)} ms`}
  </span>
{/if}

<style>
  .net {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 56px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-success);
  }

  .fair .dot {
    background: var(--color-warning);
  }

  .poor .dot {
    background: var(--color-danger);
  }
</style>
