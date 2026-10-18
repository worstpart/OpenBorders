<script lang="ts">
  /**
   * The online lobby (Phase 3, milestones 3.1–3.2): your name, the link to share, the game's
   * settings, who has joined and who is ready, and Start for the game's creator. Nations and
   * tribes fill every place no human takes (D-036). Team games (3.6): the players are shown
   * by team, and each picks theirs; nations then even the teams out.
   */
  import { MAP_SIZE_NAMES, MAP_DIMENSIONS } from "../../../sim/map/generate.ts";
  import { MAX_NAME_LENGTH, nationTeams, type LobbyPlayer } from "../../../shared/protocol.ts";
  import { gameLink } from "../../app/online.ts";
  import { TEAM_COLORS } from "../../app/players.ts";
  import { teamName } from "../../app/teams.ts";
  import { MAP_SIZES, MAP_STYLE_LABELS } from "../../app/setup.ts";
  import { ui } from "../../app/uiState.svelte.ts";

  interface Props {
    onStart: () => void;
    onLeave: () => void;
    onRename: (name: string) => void;
    onReady: (ready: boolean) => void;
    /** Creator: list the game for strangers, or keep it to the link (3.4). */
    onPublic: (listed: boolean) => void;
    /** Team games: play on this team (3.6). */
    onTeam: (team: number) => void;
  }

  let { onStart, onLeave, onRename, onReady, onPublic, onTeam }: Props = $props();
  /** Ticks once a second while a public countdown runs. */
  let clock = $state(Date.now());
  $effect(() => {
    if (!ui.online?.startsAt) return;
    const timer = setInterval(() => (clock = Date.now()), 250);
    return () => clearInterval(timer);
  });
  let copied = $state(false);
  let starting = $state(false);
  /** The name being typed (null = show the server's). */
  let draft = $state<string | null>(null);

  const online = $derived(ui.online);
  const link = $derived(online?.gameId ? gameLink(online.gameId, location) : "");
  const me = $derived(online?.players[online.you]);
  const secondsLeft = $derived(
    online?.startsAt ? Math.max(0, Math.ceil((online.startsAt - clock) / 1000)) : null,
  );
  const notReady = $derived(online ? online.players.filter((p) => !p.ready).length : 0);
  /**
   * Team games (3.6): each team's humans (with their place in `players`) and the nations
   * that will join it, dealt as the server will deal them.
   */
  /** "2 players + 3 nations". */
  function teamCount(players: number, nations: number): string {
    const humans = `${players} ${players === 1 ? "player" : "players"}`;
    return nations > 0 ? `${humans} + ${nations} ${nations === 1 ? "nation" : "nations"}` : humans;
  }
  const teams = $derived.by(() => {
    const s = online?.summary;
    if (!online || !s || s.mode !== "teams") return [];
    const nations = new Array<number>(s.teams + 1).fill(0);
    const dealt = nationTeams(
      s.teams,
      online.players.map((p) => p.team),
      s.nations,
    );
    for (const team of dealt) nations[team]!++;
    return Array.from({ length: s.teams }, (_, k) => ({
      team: k + 1,
      members: online.players
        .map((player, index) => ({ player, index }))
        .filter((m) => m.player.team === k + 1),
      nations: nations[k + 1]!,
    }));
  });
  const summary = $derived.by(() => {
    const s = online?.summary;
    if (!s) return "";
    const size = MAP_SIZE_NAMES.find(
      (n) => MAP_DIMENSIONS[n].width === s.map.width && MAP_DIMENSIONS[n].height === s.map.height,
    );
    const mode = s.mode === "teams" ? `${s.teams} teams` : "Free-for-all";
    const difficulty = s.difficulty[0]!.toUpperCase() + s.difficulty.slice(1);
    return [
      `${MAP_STYLE_LABELS[s.map.style]} · ${size ? MAP_SIZES[size].label : "?"}`,
      mode,
      `${s.nations} nations (${difficulty}) · ${s.tribes} tribes`,
    ].join(" · ");
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function commitName(): void {
    if (draft === null) return;
    const name = draft.trim();
    draft = null;
    if (name && name !== me?.name) onRename(name);
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
  {:else if online.status === "playing"}
    <p class="status" role="status">Starting… preparing the map</p>
  {:else}
    <label class="label" for="lobby-name">Your name</label>
    <input
      id="lobby-name"
      maxlength={MAX_NAME_LENGTH}
      autocomplete="nickname"
      value={draft ?? me?.name ?? ""}
      oninput={(e) => (draft = e.currentTarget.value)}
      onblur={commitName}
      onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />

    <label class="label" for="lobby-link">Invite friends with this link</label>
    <div class="link-row">
      <input id="lobby-link" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
      <button type="button" class="secondary" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>

    {#if summary}<p class="note">{summary}</p>{/if}

    {#if online.creator}
      <label class="switch">
        <input
          type="checkbox"
          checked={online.public}
          onchange={(e) => onPublic(e.currentTarget.checked)}
        />
        <span>Public — anyone can join from the start screen</span>
      </label>
    {:else if online.public}
      <p class="note">Public game — anyone can join from the start screen.</p>
    {/if}
    {#if secondsLeft !== null}
      <p class="countdown" role="status">Starts by itself in {secondsLeft} s</p>
    {:else if online.public}
      <p class="note">Starts by itself 30 s after a second player joins.</p>
    {/if}

    <h2 class="label">Players ({online.players.length})</h2>
    {#snippet row(player: LobbyPlayer, k: number)}
      <li>
        <span class="name">{player.name}</span>
        {#if k === online.you}<span class="tag">you</span>{/if}
        {#if k === 0}<span class="tag">creator</span>{/if}
        <span class="state" class:ready={player.ready}>{player.ready ? "Ready" : "Not ready"}</span>
      </li>
    {/snippet}
    {#if teams.length > 0}
      <div class="teams">
        {#each teams as t (t.team)}
          <section
            class="team"
            class:mine={me?.team === t.team}
            style:--team-color={TEAM_COLORS[(t.team - 1) % TEAM_COLORS.length]}
            aria-label={teamName(t.team)}
          >
            <header>
              <span class="team-dot" aria-hidden="true"></span>
              <span class="team-name">{teamName(t.team)}</span>
              <span class="team-count">{teamCount(t.members.length, t.nations)}</span>
              {#if me?.team !== t.team}
                <button type="button" class="pick" onclick={() => onTeam(t.team)}>Join</button>
              {/if}
            </header>
            {#if t.members.length > 0}
              <ul class="players">
                {#each t.members as m (m.index)}{@render row(m.player, m.index)}{/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>
      <p class="note">Pick a team to play with your friends. Nations even the teams out.</p>
    {:else}
      <ul class="players">
        {#each online.players as player, k (k)}{@render row(player, k)}{/each}
      </ul>
      <p class="note">Nations and tribes fill the rest of the map.</p>
    {/if}

    {#if online.error}<p class="error" role="alert">{online.error}</p>{/if}

    {#if online.creator}
      <button type="button" class="play" onclick={start} disabled={starting}>
        {starting
          ? "Starting…"
          : notReady > 0
            ? `Start anyway — ${notReady} not ready`
            : "Start game"}
      </button>
    {:else}
      <button
        type="button"
        class={me?.ready ? "secondary" : "play"}
        onclick={() => onReady(!me?.ready)}
      >
        {me?.ready ? "Not ready after all" : "I'm ready"}
      </button>
      <p class="status" role="status">
        {online.players[0]?.name ?? "The creator"} starts the game.
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
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    height: 36px;
    flex-shrink: 0;
    padding: 0 var(--space-3);
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-control);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }

  .link-row input {
    flex: 1;
  }

  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .state.ready {
    color: var(--color-success);
  }

  .players li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: rgba(255, 255, 255, 0.05);
  }

  .teams {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .team {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--surface-hairline);
    border-left: 3px solid var(--team-color);
    border-radius: var(--radius-control);
  }

  .team.mine {
    background: color-mix(in srgb, var(--team-color) 12%, transparent);
  }

  .team header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 26px;
    font-size: var(--text-sm);
  }

  .team-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--team-color);
  }

  .team-name {
    font-weight: 650;
  }

  .team-count {
    flex: 1;
    color: var(--text-secondary);
  }

  .pick {
    height: 26px;
    padding: 0 var(--space-3);
    border: 1px solid var(--surface-hairline);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .pick:hover {
    background: rgba(255, 255, 255, 0.08);
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
  .switch {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .switch input {
    width: 16px;
    height: 16px;
    margin: 0;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .countdown {
    margin: 0;
    font-weight: 650;
    color: var(--color-warning);
  }

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
