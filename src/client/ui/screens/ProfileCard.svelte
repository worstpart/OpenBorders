<script lang="ts">
  /** A signed-in player's public profile (3.7, D-037): name, join date, games, wins. */
  import type { PublicProfile } from "../../../shared/accounts.ts";
  import { fetchProfile, joinedDate } from "../../app/account.svelte.ts";

  interface Props {
    name: string;
    onClose: () => void;
  }

  let { name, onClose }: Props = $props();

  let profile = $state<PublicProfile | null>(null);
  let failed = $state(false);

  $effect(() => {
    let live = true;
    fetchProfile(name).then(
      (p) => live && (profile = p),
      () => live && (failed = true),
    );
    return () => {
      live = false;
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <header>
      <h2 id="profile-title">{profile?.name ?? name}</h2>
      <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
    </header>
    {#if profile}
      <dl class="stats">
        <div>
          <dt>Joined</dt>
          <dd>{joinedDate(profile.joined)}</dd>
        </div>
        <div>
          <dt>Games</dt>
          <dd>{profile.games}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{profile.wins}</dd>
        </div>
      </dl>
    {:else if failed}
      <p class="note">
        This profile isn't available (the account may have been renamed or deleted).
      </p>
    {:else}
      <p class="note">Loading…</p>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.45);
    pointer-events: auto;
  }

  .dialog {
    width: min(320px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .close {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .stats {
    display: flex;
    gap: var(--space-2);
    margin: 0;
  }

  .stats div {
    flex: 1;
    padding: var(--space-2);
    border-radius: var(--radius-control);
    background: rgba(255, 255, 255, 0.05);
    text-align: center;
  }

  .stats dt {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .stats dd {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
</style>
