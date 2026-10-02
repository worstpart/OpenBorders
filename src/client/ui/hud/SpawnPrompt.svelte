<script lang="ts">
  import { ui } from "../../app/uiState.svelte.ts";

  interface Props {
    onConfirm: () => void;
  }

  let { onConfirm }: Props = $props();
  const me = $derived(ui.me);
</script>

{#if me && !me.ready}
  <div class="prompt" role="status">
    {#if !me.spawned}
      <p><strong>Choose your start.</strong> Click anywhere on the land.</p>
    {:else}
      <p>Good spot? Click elsewhere to move.</p>
      <button type="button" onclick={onConfirm}>Start here <kbd>Enter</kbd></button>
    {/if}
  </div>
{:else if me?.ready && ui.phase === "spawn"}
  <div class="prompt" role="status"><p>Starting…</p></div>
{/if}

<style>
  .prompt {
    pointer-events: auto;
    position: absolute;
    top: var(--space-6);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    white-space: nowrap;
  }

  p {
    margin: 0;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-control);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    filter: brightness(1.1);
  }

  kbd {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.2);
    font: inherit;
    font-size: var(--text-sm);
  }
</style>
