<script lang="ts">
  /**
   * The online lobby (Phase 3, milestones 3.1–3.2): the link to share, who has joined, and
   * Start for the game's creator. Nations and tribes fill every place no human takes.
   */
  import { gameLink } from "../../app/online.ts";
  import { ui } from "../../app/uiState.svelte.ts";

  interface Props {
    onStart: () => void;
    onLeave: () => void;
  }

  let { onStart, onLeave }: Props = $props();
  let copied = $state(false);
  let starting = $state(false);

  const online = $derived(ui.online);
  const link = $derived(online?.gameId ? gameLink(online.gameId, location) : "");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function start(): void {
    if (starting) return;
    starting = true;
    onStart();
  }
</script>

<section class="card" aria-labelledby="lobby-title">
  <h1 id="lobby-title">Online game</h1>

  {#if !online || online.status === "connecting"}
    <p class="status" role="status">Connecting to the game server…</p>
  {:else if online.status === "error"}
    <p class="error" role="alert">{online.error}</p>
  {:else}
    <label class="label" for="lobby-link">Invite friends with this link</label>
    <div class="link-row">
      <input id="lobby-link" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
      <button type="button" class="secondary" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>

    <h2 class="label">Players ({online.players.length})</h2>
    <ul class="players">
      {#each online.players as player, k (k)}
        <li>
          <span>{player.name}</span>
          {#if k === online.you}<span class="tag">you</span>{/if}
          {#if k === 0}<span class="tag">creator</span>{/if}
        </li>
      {/each}
    </ul>
    <p class="note">Nations and tribes fill the rest of the map.</p>

    {#if online.error}<p class="error" role="alert">{online.error}</p>{/if}

    {#if online.creator}
      <button type="button" class="play" onclick={start} disabled={starting}>
        {starting ? "Starting…" : "Start game"}
      </button>
    {:else}
      <p class="status" role="status">
        Waiting for {online.players[0]?.name ?? "the creator"} to start…
      </p>
    {/if}
  {/if}

  <button type="button" class="leave" onclick={onLeave}>Leave</button>
</section>

<style>
  .card {
    pointer-events: auto;
    width: min(380px, calc(100vw - 32px));
    padding: var(--space-8) var(--space-8) var(--space-6);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h1 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-display);
    letter-spacing: -0.02em;
    font-weight: 700;
  }

  .label {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .link-row {
    display: flex;
    gap: var(--space-2);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-control);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }

  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .players li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: rgba(255, 255, 255, 0.05);
  }

  .tag {
    font-size: 11px;
    color: var(--text-secondary);
    border: 1px solid var(--surface-hairline);
    border-radius: 999px;
    padding: 0 var(--space-2);
  }

  .note,
  .status {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  button {
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-control);
  }

  .secondary,
  .leave {
    height: 36px;
    padding: 0 var(--space-4);
    border: 1px solid var(--surface-hairline);
    background: transparent;
    color: var(--text-primary);
  }

  .play {
    height: 44px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .play:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .leave {
    margin-top: var(--space-2);
  }
</style>
