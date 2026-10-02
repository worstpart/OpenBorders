<script lang="ts">
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatTroops } from "../../format.ts";

  interface Props {
    onRetreat: (attackId: number) => void;
  }

  let { onRetreat }: Props = $props();

  const outgoing = $derived(ui.attacks.filter((a) => a.attacker === ui.localPlayerId));
  const incoming = $derived(
    ui.attacks.filter((a) => a.target === ui.localPlayerId && a.target !== 0),
  );
</script>

{#if outgoing.length > 0 || incoming.length > 0}
  <ul class="chips" aria-label="Active attacks">
    {#each incoming as attack (attack.id)}
      <li class="chip incoming" style:--player-color={ui.colors[attack.attacker]}>
        <span class="dot" aria-hidden="true"></span>
        <span class="label">{ui.playerName(attack.attacker)} attacks you</span>
        <span class="troops">{formatTroops(attack.troops)}</span>
      </li>
    {/each}
    {#each outgoing as attack (attack.id)}
      <li
        class="chip"
        class:retreating={attack.retreating}
        style:--player-color={attack.target === 0 ? "#9aa5b4" : ui.colors[attack.target]}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="label">
          {attack.target === 0 ? "Expanding" : ui.playerName(attack.target)}
        </span>
        <span class="troops">{formatTroops(attack.troops)}</span>
        <span class="tiles">+{attack.tilesTaken}</span>
        {#if attack.retreating}
          <span class="status">Retreating…</span>
        {:else}
          <button
            type="button"
            class="retreat"
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
    bottom: var(--space-6);
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
    padding-right: var(--space-4);
    border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
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

  .troops,
  .tiles,
  .status {
    color: var(--text-secondary);
  }

  .tiles {
    color: var(--color-success);
  }

  .retreat {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: var(--text-primary);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }

  .retreat:hover {
    background: rgb(255 255 255 / 0.18);
  }
</style>
