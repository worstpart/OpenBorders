<script lang="ts">
  import { allianceStatus, formatCountdown, traitorSecondsLeft } from "../../app/diplomacy.ts";
  import { describeBot } from "../../app/players.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { ODDS_LABEL, outcomeText, previewClick } from "../../app/preview.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatPercent, formatTroops } from "../../format.ts";

  const TERRAIN: Record<number, { name: string; note: string }> = {
    1: { name: "Plains", note: "" },
    2: { name: "Highland", note: "slower, costlier" },
    3: { name: "Mountain", note: "much slower and costlier" },
  };
  const OFFSET = 18;
  const CARD_WIDTH = 270;

  let height = $state(0);
  let viewportWidth = $state(1280);
  let viewportHeight = $state(800);

  const hover = $derived(ui.phase === "playing" ? ui.hover : null);
  const owner = $derived(hover && hover.owner !== 0 ? ui.players[hover.owner - 1] : undefined);
  const isMe = $derived(hover?.owner === ui.localPlayerId);
  const preview = $derived(
    hover ? previewClick(ui.previewContext, hover.owner, ui.attackPercent) : null,
  );
  const attacksMe = $derived(
    !!hover && ui.attacks.some((a) => a.attacker === hover.owner && a.target === ui.localPlayerId),
  );
  const myAttack = $derived(
    hover && hover.owner !== 0
      ? ui.attacks.find((a) => a.attacker === ui.localPlayerId && a.target === hover.owner)
      : undefined,
  );
  const terrain = $derived(hover ? TERRAIN[hover.terrain] : undefined);
  const alliance = $derived(hover ? allianceStatus(ui.diplomacyContext, hover.owner) : null);
  const traitorFor = $derived(traitorSecondsLeft(DEFAULT_RULES, ui.tick, owner));

  // Keep the card on screen: flip to the other side of the cursor near the edges.
  const left = $derived(
    hover
      ? hover.x + OFFSET + CARD_WIDTH > viewportWidth
        ? hover.x - OFFSET - CARD_WIDTH
        : hover.x + OFFSET
      : 0,
  );
  const top = $derived(
    hover
      ? hover.y + OFFSET + height > viewportHeight
        ? Math.max(0, hover.y - OFFSET - height)
        : hover.y + OFFSET
      : 0,
  );
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

{#if hover && preview}
  <div
    class="card"
    bind:clientHeight={height}
    style:left="{left}px"
    style:top="{top}px"
    style:width="{CARD_WIDTH}px"
    style:--player-color={ui.colorOf(hover.owner)}
    role="tooltip"
  >
    <div class="head">
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{isMe ? "Your land" : ui.playerName(hover.owner)}</span>
      {#if terrain}
        <span class="terrain">{terrain.name}</span>
      {/if}
    </div>

    {#if owner && !isMe}
      <div class="stats">
        <span>{formatTroops(owner.homeTroops)} troops</span>
        <span>{formatPercent(owner.tiles / ui.landTiles)} land</span>
        {#if owner.tier}<span class="muted personality">{describeBot(owner)}</span>{/if}
      </div>
      {#if alliance?.kind === "ally"}
        <div class="badge ally">Ally · {formatCountdown(alliance.secondsLeft)} left</div>
      {:else if alliance?.kind === "theyAsked"}
        <div class="badge ally">Wants an alliance</div>
      {/if}
      {#if traitorFor > 0}
        <div class="badge traitor">
          Traitor · {Math.ceil(traitorFor)} s — attacks on them cost less
        </div>
      {/if}
      {#if attacksMe}<div class="badge danger">Attacking you</div>{/if}
      {#if myAttack}<div class="badge">
          You're attacking ({formatTroops(myAttack.troops)} left)
        </div>{/if}
    {/if}

    <div class="preview">
      {#if preview.kind === "expand"}
        <span class="click">Click:</span> expand with {formatTroops(preview.army)}
        <span class="muted">→ up to ~{preview.tiles.toLocaleString("en-US")} tiles</span>
      {:else if preview.kind === "attack"}
        <div>
          <span class="click">Click:</span> send {formatTroops(preview.army)}
          <span class="muted">({ui.attackPercent}%)</span>
          <span class="odds {preview.outlook.odds}">{ODDS_LABEL[preview.outlook.odds]}</span>
        </div>
        <div class="muted">Expected: {outcomeText(preview.outlook)}</div>
      {/if}
      {#if (preview.kind === "expand" || preview.kind === "attack") && terrain?.note}
        <div class="muted">{terrain.name}: {terrain.note}</div>
      {/if}
      {#if preview.kind === "allied"}
        <span class="muted">Allied — break the alliance first (right-click)</span>
      {:else if preview.kind === "notReachable"}
        <span class="muted">
          {hover.owner === 0
            ? "Not reachable — you don't border this land"
            : "Not reachable — you don't border them"}
        </span>
      {:else if preview.kind === "protected"}
        <span class="muted">Spawn protection: {Math.ceil(preview.seconds)} s</span>
      {:else if preview.kind === "noTroops"}
        <span class="muted">No troops at home to send</span>
      {:else if preview.kind === "own"}
        <span class="muted">{formatTroops(ui.me?.homeTroops ?? 0)} troops defend it</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .card {
    position: absolute;
    padding: var(--space-3);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    font-size: var(--text-sm);
    line-height: 1.45;
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-md);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--player-color);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
  }

  .terrain {
    margin-left: auto;
    color: var(--text-muted);
  }

  .stats {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-1);
    color: var(--text-secondary);
  }

  .badge {
    display: inline-block;
    margin-top: var(--space-2);
    margin-right: var(--space-2);
    padding: 1px var(--space-2);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
  }

  .badge.ally {
    color: var(--color-ally);
  }

  .badge.traitor {
    color: var(--color-traitor);
    font-weight: 600;
  }

  .badge.danger {
    color: var(--color-danger);
    font-weight: 600;
  }

  .preview {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--surface-hairline);
  }

  .personality {
    text-transform: capitalize;
  }

  .click {
    font-weight: 650;
  }

  .muted {
    color: var(--text-muted);
  }

  .odds {
    margin-left: var(--space-1);
    padding: 1px var(--space-2);
    border-radius: 999px;
    font-weight: 650;
    background: rgb(255 255 255 / 0.08);
  }

  .odds.overwhelming,
  .odds.advantage {
    color: var(--color-success);
  }

  .odds.even {
    color: var(--color-warning);
  }

  .odds.costly,
  .odds.hopeless {
    color: var(--color-danger);
  }
</style>
