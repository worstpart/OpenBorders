<script lang="ts">
  import { ui } from "../../app/uiState.svelte.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { winLandShare } from "../../../sim/systems/victory.ts";
  import { formatClock, formatPercent, formatTroops } from "../../format.ts";
  import { TEAM_COLORS } from "../../app/players.ts";
  import { teamName, teamStandings } from "../../app/teams.ts";
  import NetStat from "./NetStat.svelte";

  interface Props {
    onMenu: () => void;
  }

  let { onMenu }: Props = $props();

  const TOP = 5;
  let collapsed = $state(false);

  const ranked = $derived(
    ui.players
      .filter((p) => p.alive && p.spawned)
      .toSorted((a, b) => b.tiles - a.tiles || a.id - b.id),
  );
  const myRank = $derived(ranked.findIndex((p) => p.id === ui.localPlayerId));
  const rows = $derived.by(() => {
    const top = ranked.slice(0, TOP).map((p, i) => ({ player: p, rank: i + 1 }));
    const me = ui.me;
    if (me?.spawned && myRank < 0)
      top.push({ player: me, rank: 0 }); // eliminated
    else if (myRank >= TOP) top.push({ player: ranked[myRank]!, rank: myRank + 1 });
    return top;
  });
  const allies = $derived(ui.allies);
  const teammates = $derived(ui.teammates);
  /** Team games (GAME_DESIGN.md §3.15): each team's combined land, above the players. */
  const teams = $derived(ui.teamGame ? teamStandings(ui.players) : []);
  const myTeam = $derived(ui.me?.team ?? 0);
  const alive = $derived(ui.players.filter((p) => p.alive).length);
  const clock = $derived(
    ui.phase === "spawn" ? "Spawn" : formatClock((ui.tick - ui.playStartTick) / 10),
  );
  const victory = DEFAULT_RULES.victory;
  /** Team games need the team's combined share (2B.6: higher than a lone player's). */
  const start = $derived(ui.teamGame ? victory.teamLandShare : victory.landShare);
  const goal = $derived(
    ui.phase === "spawn"
      ? start
      : winLandShare(DEFAULT_RULES, ui.tick - ui.playStartTick, ui.teamGame),
  );
  const wholePercent = (share: number): string => `${Math.round(share * 100)}%`;
  const goalTitle =
    `Land needed to win. Anti-stall: after ${formatClock(victory.declineStartTicks / 10)} ` +
    `it drops ${wholePercent(victory.declineStep)} every ${victory.declineStepTicks / 10} s, ` +
    `down to ${wholePercent(victory.minLandShare)}.`;
</script>

<div class="top-right">
  <div class="bar">
    <span class="clock" title="Match time">{clock}</span>
    <span class="goal" class:dropping={goal < start} title={goalTitle}>
      Win {wholePercent(goal)}
    </span>
    {#if ui.speed !== 1}<span class="speed" title="Game speed">{ui.speed}×</span>{/if}
    <NetStat />
    <button type="button" class="menu" tabindex={-1} title="Pause menu (Esc)" onclick={onMenu}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5h10M3 8h10M3 11.5h10" />
      </svg>
      <span class="sr-only">Pause menu</span>
    </button>
  </div>

  {#if ui.phase !== "spawn" && rows.length > 0}
    <section class="board" aria-label="Leaderboard">
      <button
        type="button"
        class="header"
        tabindex={-1}
        aria-expanded={!collapsed}
        onclick={() => (collapsed = !collapsed)}
      >
        <span>Leaderboard</span>
        <span class="left">{alive} of {ui.players.length} left</span>
        <svg class="chevron" class:collapsed viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {#if !collapsed && teams.length > 0}
        <ol class="teams" aria-label="Teams">
          {#each teams as team (team.team)}
            <li
              class:me={team.team === myTeam}
              class:out={team.alive === 0}
              style:--player-color={TEAM_COLORS[team.team - 1] ?? "#888"}
              title="{teamName(team.team)}: combined land · members still in"
            >
              <span class="rank"></span>
              <span class="dot square" aria-hidden="true"></span>
              <span class="who">
                <span class="name">{teamName(team.team)}</span>
              </span>
              <span class="land">{formatPercent(team.tiles / ui.landTiles)}</span>
              <span class="troops">{team.alive}/{team.members}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#if !collapsed}
        <ol>
          {#each rows as { player, rank } (player.id)}
            <li
              class:me={player.id === ui.localPlayerId}
              class:out={!player.alive}
              class:gap={rank > TOP || rank === 0}
              style:--player-color={ui.colorOf(player.id)}
            >
              <span class="rank">{rank === 0 ? "—" : rank}</span>
              <span class="dot" aria-hidden="true"></span>
              <span class="who">
                <span class="name">{player.name}</span>
                {#if teammates.has(player.id)}
                  <span class="tag ally" title="On your team">team</span>
                {:else if allies.has(player.id)}
                  <span class="tag ally" title="Your ally">ally</span>
                {/if}
                {#if player.alive && player.traitorUntilTick > ui.tick}
                  <span class="tag traitor" title="Broke an alliance: cheaper to attack for a while"
                    >traitor</span
                  >
                {/if}
              </span>
              <span class="land">{formatPercent(player.tiles / ui.landTiles)}</span>
              <span class="troops" title="Troops at home">{formatTroops(player.homeTroops)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>

<style>
  .top-right {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
  }

  .bar,
  .board {
    pointer-events: auto;
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    box-shadow: var(--shadow-card);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 var(--space-1) 0 var(--space-4);
    border-radius: 999px;
  }

  .clock {
    min-width: 40px;
    font-weight: 600;
  }

  .goal {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .goal.dropping {
    color: var(--color-warning);
    font-weight: 600;
  }

  .speed {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--color-warning);
    color: #1d1606;
    font-size: var(--text-sm);
    font-weight: 700;
  }

  button {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .menu {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .menu:hover,
  .header:hover {
    background: rgb(255 255 255 / 0.08);
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .board {
    width: 260px;
    padding: var(--space-1);
    border-radius: var(--radius-card);
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: left;
  }

  .left {
    margin-left: auto;
    color: var(--text-muted);
    font-weight: 400;
  }

  .chevron {
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 18px 10px 1fr auto 48px;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-control);
  }

  li.me {
    background: rgb(255 255 255 / 0.08);
  }

  li.gap {
    margin-top: var(--space-1);
    border-top: 1px dashed var(--surface-hairline);
  }

  li.out {
    opacity: 0.5;
  }

  .teams {
    margin-bottom: var(--space-1);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--surface-hairline);
  }

  .dot.square {
    border-radius: 3px;
  }

  .rank {
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: right;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--player-color);
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .tag {
    flex: none;
    padding: 0 5px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    font-size: 11px;
    font-weight: 600;
  }

  .tag.ally {
    color: var(--color-ally);
  }

  .tag.traitor {
    color: var(--color-traitor);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .land {
    color: var(--text-primary);
  }

  .troops {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: right;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
