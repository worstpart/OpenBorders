<script lang="ts">
  import { fly } from "svelte/transition";
  import { HINT_TEXT, type HintId } from "../../app/hints.ts";
  import { ui } from "../../app/uiState.svelte.ts";

  interface Props {
    onDismiss: (id: HintId) => void;
  }

  let { onDismiss }: Props = $props();
</script>

{#if ui.hint}
  {@const id = ui.hint}
  <aside class="hint" role="status" transition:fly={{ x: -12, duration: 180 }}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 12.5h4M6.5 14.5h3M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.7.6 1.2v.6h4v-.6c0-.5.2-.9.6-1.2A4.5 4.5 0 0 0 8 1.5z"
      />
    </svg>
    <p>{HINT_TEXT[id]}</p>
    <button type="button" tabindex={-1} aria-label="Dismiss hint" onclick={() => onDismiss(id)}>
      ×
    </button>
  </aside>
{/if}

<style>
  .hint {
    pointer-events: auto;
    position: absolute;
    left: var(--space-4);
    bottom: var(--space-4);
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    width: min(320px, calc(50% - 300px));
    min-width: 220px;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
  }

  svg {
    flex: none;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    fill: none;
    stroke: var(--color-warning);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  p {
    margin: 0;
    line-height: 1.45;
  }

  button {
    flex: none;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }

  button:hover {
    background: rgb(255 255 255 / 0.18);
  }
</style>
