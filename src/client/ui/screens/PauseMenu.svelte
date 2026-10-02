<script lang="ts">
  import { GAME_SPEEDS, ui } from "../../app/uiState.svelte.ts";

  interface Props {
    onResume: () => void;
    onSpeed: (multiplier: number) => void;
    onLeave: () => void;
  }

  let { onResume, onSpeed, onLeave }: Props = $props();

  const CONTROLS: readonly [string, string][] = [
    ["Click land", "Expand / attack (again: add troops)"],
    ["Right-click", "More options"],
    ["Drag · wheel", "Pan · zoom"],
    ["1–5", "Send 10 / 25 / 50 / 75 / 100%"],
    ["Q / E · Shift+wheel", "Send −5% / +5%"],
    ["WASD · arrows", "Pan"],
    ["Space", "Center on your land"],
    ["K", "Ally with the player under the cursor"],
    ["Y / N", "Answer the top alliance card"],
    ["Esc", "Pause / close menus"],
  ];

  let confirmLeave = $state(false);
  let resumeButton = $state<HTMLButtonElement | null>(null);
  const open = $derived(ui.menu?.kind === "pause");

  $effect(() => {
    if (open) {
      confirmLeave = false;
      resumeButton?.focus();
    }
  });
</script>

{#if open}
  <div class="backdrop">
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <h1 id="pause-title">Paused</h1>

      <button type="button" class="primary" bind:this={resumeButton} onclick={onResume}>
        Resume <kbd>Esc</kbd>
      </button>

      <div class="row">
        <span class="label" id="speed-label">Game speed</span>
        <div class="speeds" role="radiogroup" aria-labelledby="speed-label">
          {#each GAME_SPEEDS as speed (speed)}
            <button
              type="button"
              role="radio"
              aria-checked={ui.speed === speed}
              class:active={ui.speed === speed}
              onclick={() => onSpeed(speed)}>{speed}×</button
            >
          {/each}
        </div>
      </div>

      <h2>Controls</h2>
      <dl>
        {#each CONTROLS as [keys, action] (keys)}
          <dt>{keys}</dt>
          <dd>{action}</dd>
        {/each}
      </dl>

      <button
        type="button"
        class="leave"
        class:confirm={confirmLeave}
        onclick={() => (confirmLeave ? onLeave() : (confirmLeave = true))}
      >
        {confirmLeave ? "Click again to leave the match" : "Leave match"}
      </button>
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
    background: rgb(8 12 18 / 0.45);
    pointer-events: auto;
  }

  .card {
    width: min(400px, 100%);
    padding: var(--space-6);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: var(--text-lg);
    text-align: center;
  }

  h2 {
    margin: var(--space-6) 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  button {
    border-radius: var(--radius-control);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    height: 40px;
    border: none;
    background: var(--accent);
    color: #fff;
  }

  .primary:hover {
    filter: brightness(1.1);
  }

  kbd {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.2);
    font: inherit;
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-4);
  }

  .label {
    color: var(--text-secondary);
  }

  .speeds {
    display: flex;
    padding: 2px;
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.06);
  }

  .speeds button {
    min-width: 44px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
  }

  .speeds button:hover {
    color: var(--text-primary);
  }

  .speeds button.active {
    background: var(--accent);
    color: #fff;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
  }

  dt {
    font-weight: 600;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    color: var(--text-secondary);
  }

  .leave {
    width: 100%;
    height: 36px;
    margin-top: var(--space-6);
    border: 1px solid var(--surface-hairline);
    background: rgb(255 255 255 / 0.04);
    color: var(--text-secondary);
  }

  .leave:hover,
  .leave.confirm {
    border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
    color: var(--color-danger);
  }
</style>
