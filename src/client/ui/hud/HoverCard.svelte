<script lang="ts">
  import { allianceStatus, formatCountdown, traitorSecondsLeft } from "../../app/diplomacy.ts";
  import { describeBot } from "../../app/players.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { ODDS_LABEL, outcomeText, previewClick } from "../../app/preview.ts";
  import { BOAT_PREVIEW_TEXT } from "../../app/boats.ts";
  import { troopsToSend } from "../../app/attackPercent.ts";
  import { teamName } from "../../app/teams.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatPercent, formatTroops } from "../../format.ts";

  const TERRAIN: Record<number, { name: string; note: string }> = {
    1: { name: "Plains", note: "" },
    2: { name: "Highland", note: "slower, costlier" },
    3: { name: "Mountain", note: "much slower and costlier" },
  };
  const OFFSET = 18;
  const CARD_WIDTH = 290;

  let height = $state(0);
  let viewportWidth = $state(1280);
  let viewportHeight = $state(800);

  // No card over unclaimed land or a tribe's (the user after the Phase 2B playtest, D-033):
  // only players worth reading about — you, the nations and other humans.
  const hovered = $derived(ui.phase === "playing" ? ui.hover : null);
  const owner = $derived(
    hovered && hovered.owner !== 0 ? ui.players[hovered.owner - 1] : undefined,
  );
  const hover = $derived(owner && owner.tier !== "tribe" ? hovered : null);
  const isMe = $derived(hover?.owner === ui.localPlayerId);
  const preview = $derived(
    hover ? previewClick(ui.previewContext, hover.owner, ui.attackPercent, hover.tile) : null,
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
  /** Land beyond our border: a click sends a boat (GAME_DESIGN.md §3.18). */
  const boat = $derived(
    hover && ui.boatPreview?.tile === hover.tile && !ui.friends.has(hover.owner)
      ? ui.boatPreview
      : null,
  );
  const alliance = $derived(hover ? allianceStatus(ui.diplomacyContext, hover.owner) : null);
  const traitorFor = $derived(traitorSecondsLeft(DEFAULT_RULES, ui.tick, owner));
  /** Their relation to you, as one chip in the header. */
  const relation = $derived.by((): { text: string; tone: string } | null => {
    if (!owner || isMe) return null;
    if (owner.team !== 0 && owner.team === ui.me?.team) return { text: "Teammate", tone: "ally" };
    if (alliance?.kind === "ally") return { text: "Ally", tone: "ally" };
    if (attacksMe) return { text: "Attacking you", tone: "danger" };
    if (traitorFor > 0) return { text: "Traitor", tone: "traitor" };
    return null;
  });
  // Border Defense (GAME_DESIGN.md §3.17.6); ui.fort isn't reactive, so re-read every tick.
  const wall = $derived.by(() => {
    const level = hover && ui.tick >= 0 ? (ui.fort[hover.tile] ?? 0) : 0;
    return level > 0 ? DEFAULT_RULES.walls.levels[level - 1]! : null;
  });

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
      {#if relation}<span class="chip {relation.tone}">{relation.text}</span>{/if}
    </div>
    {#if owner && !isMe && owner.tier}
      <div class="sub">{describeBot(owner)}</div>
    {/if}

    {#if owner && !isMe}
      <dl class="stats">
        <dt>Troops</dt>
        <dd>{formatTroops(owner.homeTroops)}</dd>
        <dt>Land</dt>
        <dd>{formatPercent(owner.tiles / ui.landTiles)}</dd>
        {#if DEFAULT_RULES.economy.enabled}
          <dt>Gold</dt>
          <dd class="gold">{formatTroops(owner.gold)}</dd>
        {/if}
        {#if owner.capacityBonus > 0}
          <dt>Housing</dt>
          <dd>+{formatTroops(owner.capacityBonus)} capacity</dd>
        {/if}
      </dl>
      {#if owner.team !== 0 || alliance?.kind === "ally" || alliance?.kind === "theyAsked" || traitorFor > 0 || myAttack}
        <div class="badges">
          {#if owner.team !== 0 && owner.team !== ui.me?.team}
            <span class="badge">{teamName(owner.team)}</span>
          {:else if owner.team !== 0}
            <span class="badge ally">{teamName(owner.team)}</span>
          {/if}
          {#if alliance?.kind === "ally"}
            <span class="badge ally">Alliance: {formatCountdown(alliance.secondsLeft)} left</span>
          {:else if alliance?.kind === "theyAsked"}
            <span class="badge ally">Wants an alliance</span>
          {/if}
          {#if traitorFor > 0}
            <span class="badge traitor">
              Traitor {Math.ceil(traitorFor)} s — attacks on them cost less
            </span>
          {/if}
          {#if myAttack}
            <span class="badge">You're attacking ({formatTroops(myAttack.troops)} left)</span>
          {/if}
        </div>
      {/if}
    {/if}

    {#if wall}
      <div class="badges">
        <span class="badge wall">
          {isMe ? "Your wall" : "Wall"} · {wall.name}: holds ~{wall.holdTicks / 10} s per tile, attackers
          lose ×{wall.loss}
        </span>
      </div>
    {/if}

    <div class="action">
      {#if boat?.plan && !boat.problem}
        <div class="line">
          <span class="click">Click</span> ⛵ boat with {formatTroops(
            troopsToSend(ui.me?.homeTroops ?? 0, ui.attackPercent),
          )}
          <span class="muted">({ui.attackPercent}%)</span>
        </div>
        <div class="muted">
          Lands in {Math.ceil(boat.seconds)} s — the troops land on their coast and attack from there
        </div>
      {:else if boat?.problem}
        <span class="muted">No boat: {BOAT_PREVIEW_TEXT[boat.problem]}</span>
      {:else if preview.kind === "attack"}
        <div class="line">
          <span class="click">Click</span> attack with {formatTroops(preview.army)}
          <span class="muted">({ui.attackPercent}%)</span>
          <span class="odds {preview.outlook.odds}">{ODDS_LABEL[preview.outlook.odds]}</span>
        </div>
        <div class="muted">Expected: {outcomeText(preview.outlook)}</div>
      {/if}
      {#if preview.kind === "attack" && !boat && terrain?.note}
        <div class="muted">{terrain.name}: {terrain.note}</div>
      {/if}
      {#if preview.kind === "teammate"}
        <span class="muted">Your teammate — teammates can't attack each other</span>
      {:else if preview.kind === "allied"}
        <span class="muted">Allied — break the alliance first (right-click)</span>
      {:else if preview.kind === "notReachable" && !boat}
        <span class="muted">Not reachable — you don't border them</span>
      {:else if preview.kind === "protected"}
        <span class="muted">Spawn protection: {Math.ceil(preview.seconds)} s</span>
      {:else if preview.kind === "noTroops"}
        <span class="muted">No troops at home to send</span>
      {:else if preview.kind === "own"}
        <span>{formatTroops(ui.me?.homeTroops ?? 0)} troops defend it</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .card {
    position: absolute;
    padding: var(--space-3) 14px;
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-left: 4px solid var(--player-color);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    font-size: 13px;
    line-height: 1.45;
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 16px;
  }

  .dot {
    flex: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--player-color);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }

  .chip {
    flex: none;
    margin-left: auto;
    padding: 1px var(--space-2);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 650;
    background: rgb(255 255 255 / 0.1);
  }

  .chip.ally {
    color: var(--color-ally);
  }

  .chip.danger {
    color: var(--color-danger);
  }

  .chip.traitor {
    color: var(--color-traitor);
  }

  .sub {
    margin-top: 1px;
    color: var(--text-muted);
    font-size: 12px;
    text-transform: capitalize;
  }

  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--space-3);
    margin: var(--space-2) 0 0;
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  dd.gold {
    color: var(--color-gold);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .badge {
    padding: 1px var(--space-2);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    font-size: 12px;
  }

  .badge.ally {
    color: var(--color-ally);
  }

  .badge.traitor {
    color: var(--color-traitor);
    font-weight: 600;
  }

  .action {
    margin-top: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.05);
  }

  .line {
    font-weight: 600;
  }

  .click {
    display: inline-block;
    margin-right: 2px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--player-color);
    color: #fff;
    font-size: 11px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    text-shadow: 0 0 2px rgb(0 0 0 / 0.6);
  }

  .muted {
    color: var(--text-muted);
    font-weight: 400;
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
