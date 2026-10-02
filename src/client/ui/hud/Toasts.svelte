<script lang="ts">
  import { fly } from "svelte/transition";
  import { ui } from "../../app/uiState.svelte.ts";
</script>

<ul class="toasts" aria-live="polite" aria-label="Notifications">
  {#each ui.toasts as toast (toast.id)}
    <li
      class="toast {toast.tone}"
      style:--player-color={toast.player !== undefined ? ui.colorOf(toast.player) : "transparent"}
      transition:fly={{ y: -12, duration: 180 }}
    >
      {#if toast.player !== undefined}<span class="dot" aria-hidden="true"></span>{/if}
      {toast.text}
    </li>
  {/each}
</ul>

<style>
  .toasts {
    position: absolute;
    top: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: 999px;
    box-shadow: var(--shadow-card);
    white-space: nowrap;
  }

  .toast.danger {
    border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
    color: var(--color-danger);
    font-weight: 600;
  }

  .toast.success {
    border-color: color-mix(in srgb, var(--color-success) 50%, transparent);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--player-color);
  }
</style>
