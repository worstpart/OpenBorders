<script lang="ts">
  import { ATTACK_PRESETS, troopsToSend } from "../../app/attackPercent.ts";
  import { BOAT_PREVIEW_TEXT, boatPreview, needsBoat } from "../../app/boats.ts";
  import { allianceStatus, formatCountdown } from "../../app/diplomacy.ts";
  import { donationOptions } from "../../app/economy.ts";
  import { DEFAULT_RULES } from "../../../sim/rules.ts";
  import { ODDS_LABEL, previewClick } from "../../app/preview.ts";
  import { teamName } from "../../app/teams.ts";
  import { ui } from "../../app/uiState.svelte.ts";
  import { formatPercent, formatTroops } from "../../format.ts";
  import { cooldownLeft, PING_INFO } from "../../app/chat.ts";
  import { PING_KINDS, type PingKind } from "../../../sim/rules.ts";

  interface Props {
    onAttack: (tile: number, percent: number) => void;
    onBoat: (tile: number, percent: number) => void;
    onRetreatFrom: (target: number) => void;
    onRequestAlliance: (target: number) => void;
    onRenewAlliance: (ally: number) => void;
    onBreakAlliance: (ally: number) => void;
    onDonate: (to: number, resource: "troops" | "gold", percent: number) => void;
    onPing: (tile: number, kind: PingKind) => void;
    onEmote: (to: number, emoji: number) => void;
    onClose: () => void;
  }

  let {
    onAttack,
    onBoat,
    onRetreatFrom,
    onRequestAlliance,
    onRenewAlliance,
    onBreakAlliance,
    onDonate,
    onPing,
    onEmote,
    onClose,
  }: Props = $props();
  const TRAITOR_SECONDS = (DEFAULT_RULES.diplomacy.traitorTicks * DEFAULT_RULES.tickMs) / 1000;

  const WIDTH = 250;
  let menuElement = $state<HTMLElement | null>(null);
  let height = $state(0);
  let viewportWidth = $state(1280);
  let viewportHeight = $state(800);

  const menu = $derived(ui.menu?.kind === "context" ? ui.menu : null);
  const owner = $derived(menu && menu.owner !== 0 ? ui.players[menu.owner - 1] : undefined);
  const isMe = $derived(menu?.owner === ui.localPlayerId);
  const options = $derived(
    menu
      ? ATTACK_PRESETS.map((percent) => ({
          percent,
          preview: previewClick(ui.previewContext, menu.owner, percent, menu.tile),
        }))
      : [],
  );
  /** Why no attack option is available, if none is. */
  const blocked = $derived(options[0]?.preview);
  /** Land across the sea: a click (and these options) would send a boat, so offer only that. */
  const overSea = $derived(menu ? needsBoat(ui.boatContext, menu.tile) : false);
  const canAct = $derived(
    !overSea && options.some((o) => o.preview.kind === "expand" || o.preview.kind === "attack"),
  );
  const myAttacks = $derived(
    menu
      ? ui.attacks.filter(
          (a) => a.attacker === ui.localPlayerId && a.target === menu.owner && !a.retreating,
        )
      : [],
  );
  const alliance = $derived(menu ? allianceStatus(ui.diplomacyContext, menu.owner) : null);
  /**
   * A boat to this land (GAME_DESIGN.md §3.18), when one could go: not ours, not a friend's,
   * and a coast of theirs near the click on a sea we touch. Planned once, when the menu opens.
   */
  const boat = $derived.by(() => {
    if (!menu || isMe || ui.friends.has(menu.owner)) return null;
    const me = ui.me;
    if (!me) return null;
    const preview = boatPreview({ ...ui.boatContext, me: { ...me, neighbors: [] } }, menu.tile);
    return preview?.plan ? preview : null;
  });
  const boatTroops = $derived(ui.me ? troopsToSend(ui.me.homeTroops, ui.attackPercent) : 0);
  /** Gifts to an ally or teammate (GAME_DESIGN.md §3.16). */
  const gifts = $derived(
    owner && !isMe && DEFAULT_RULES.economy.enabled && ui.friends.has(owner.id)
      ? donationOptions(ui.donationContext, owner, ui.attackPercent)
      : [],
  );
  /** Pings (GAME_DESIGN.md §3.20) are seen by allies and teammates only. */
  const canPing = $derived(ui.friends.size > 0);
  const pingWait = $derived(
    cooldownLeft(ui.myLastPingTick, DEFAULT_RULES.chat.pingCooldownTicks, ui.tick),
  );
  /** Emojis go to the player whose land this is; from your own or open land, to everyone. */
  const emoteTo = $derived(menu && !isMe && owner?.alive ? menu.owner : 0);
  const emoteWait = $derived(
    cooldownLeft(ui.myLastEmoteTick, DEFAULT_RULES.chat.emoteCooldownTicks, ui.tick),
  );
  /** Breaking needs a second click (it makes you a traitor). */
  let confirmBreak = $state(false);
  $effect(() => {
    if (menu) confirmBreak = false;
  });
  const left = $derived(menu ? Math.max(8, Math.min(menu.x, viewportWidth - WIDTH - 8)) : 0);
  const top = $derived(menu ? Math.max(8, Math.min(menu.y, viewportHeight - height - 8)) : 0);

  // Keyboard path: focus the first item when the menu opens; arrows move between items.
  $effect(() => {
    if (menu && menuElement) menuElement.querySelector<HTMLButtonElement>("button")?.focus();
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(menuElement?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  function act(run: () => void) {
    run();
    onClose();
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

{#if menu}
  <!-- Clicking anywhere outside closes the menu without acting on the map. -->
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={onClose}
    oncontextmenu={(e) => e.preventDefault()}
  ></div>
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    aria-label="Actions for {ui.playerName(menu.owner)}"
    bind:this={menuElement}
    bind:clientHeight={height}
    style:left="{left}px"
    style:top="{top}px"
    style:width="{WIDTH}px"
    style:--player-color={ui.colorOf(menu.owner)}
    onkeydown={onKeydown}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="head">
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{isMe ? "Your land" : ui.playerName(menu.owner)}</span>
      {#if owner && !isMe}
        <span class="muted"
          >{formatTroops(owner.homeTroops)} · {formatPercent(owner.tiles / ui.landTiles)}</span
        >
      {/if}
    </div>

    {#if canAct}
      <div class="group-label">{menu.owner === 0 ? "Expand with" : "Attack with"}</div>
      {#each options as { percent, preview } (percent)}
        {#if preview.kind === "expand" || preview.kind === "attack"}
          <button
            type="button"
            role="menuitem"
            class:current={percent === ui.attackPercent}
            onclick={() => act(() => onAttack(menu.tile, percent))}
          >
            <span class="pct">{percent}%</span>
            <span class="troops">{formatTroops(preview.army)}</span>
            {#if preview.kind === "attack"}
              <span class="odds {preview.outlook.odds}">{ODDS_LABEL[preview.outlook.odds]}</span>
            {:else}
              <span class="muted">~{preview.tiles.toLocaleString("en-US")} tiles</span>
            {/if}
          </button>
        {/if}
      {/each}
    {:else if blocked && !isMe && !(overSea && boat)}
      <div class="info">
        {#if blocked.kind === "teammate"}
          Your teammate{#if owner?.team}&nbsp;· {teamName(owner.team)}{/if}. Teammates can't attack
          each other.
        {:else if blocked.kind === "allied"}
          Allies can't attack each other.
        {:else if blocked.kind === "notReachable"}
          You don't border {menu.owner === 0 ? "this land" : "them"}{boat
            ? " by land — send a boat"
            : " yet"}.
        {:else if blocked.kind === "protected"}
          Spawn protection: {Math.ceil(blocked.seconds)} s.
        {:else if blocked.kind === "noTroops"}
          No troops at home to send.
        {:else}
          Nothing to do here right now.
        {/if}
      </div>
    {:else if isMe}
      <div class="info">
        {formatTroops(ui.me?.homeTroops ?? 0)} troops at home defend it. Click neutral or enemy land to
        act.
      </div>
    {/if}

    {#if boat}
      <div class="divider"></div>
      <button
        type="button"
        role="menuitem"
        disabled={boat.problem !== null || boatTroops < 1}
        title="Sail for their coast nearest this spot; the troops land and attack from there"
        onclick={() => act(() => onBoat(menu.tile, ui.attackPercent))}
      >
        ⛵ Boat with {ui.attackPercent}%
        <span class="troops">{formatTroops(boatTroops)}</span>
        <span class="muted"
          >{boat.problem
            ? BOAT_PREVIEW_TEXT[boat.problem]
            : `lands in ${Math.ceil(boat.seconds)} s`}</span
        >
      </button>
    {/if}

    {#if alliance && alliance.kind !== "none" && alliance.kind !== "teammate"}
      <div class="divider"></div>
      {#if alliance.kind === "ally"}
        <div class="info ally">
          Allied · {formatCountdown(alliance.secondsLeft)} left
          {#if alliance.renewable && alliance.renewedByMe}· waiting for them to renew{/if}
        </div>
        {#if alliance.renewable && !alliance.renewedByMe}
          <button
            type="button"
            role="menuitem"
            onclick={() => act(() => onRenewAlliance(menu.owner))}
          >
            Renew alliance <span class="muted">+5:00</span>
          </button>
        {/if}
        {#if confirmBreak}
          <button
            type="button"
            role="menuitem"
            class="danger"
            onclick={() => act(() => onBreakAlliance(menu.owner))}
          >
            Break it — you'll be a traitor for {TRAITOR_SECONDS} s
          </button>
        {:else}
          <button type="button" role="menuitem" onclick={() => (confirmBreak = true)}>
            Break alliance…
          </button>
        {/if}
      {:else if alliance.kind === "theyAsked"}
        <button
          type="button"
          role="menuitem"
          class="ally"
          onclick={() => act(() => onRequestAlliance(menu.owner))}
        >
          Accept their alliance <span class="muted">{Math.ceil(alliance.secondsLeft)} s</span>
        </button>
      {:else if alliance.kind === "sent"}
        <div class="info">
          Alliance request sent · {Math.ceil(alliance.secondsLeft)} s
        </div>
      {:else if alliance.kind === "cooldown"}
        <div class="info">Ask again for an alliance in {Math.ceil(alliance.secondsLeft)} s</div>
      {:else}
        <button
          type="button"
          role="menuitem"
          class="ally"
          onclick={() => act(() => onRequestAlliance(menu.owner))}
        >
          Request alliance <span class="muted">K</span>
        </button>
      {/if}
    {/if}

    {#if gifts.length > 0}
      <div class="divider"></div>
      <div class="group-label">Send {ui.attackPercent}% of your…</div>
      {#each gifts as gift (gift.resource)}
        <button
          type="button"
          role="menuitem"
          class={gift.resource}
          disabled={gift.blocked !== null}
          onclick={() => act(() => onDonate(menu.owner, gift.resource, ui.attackPercent))}
        >
          {gift.resource === "troops" ? "Send troops" : "Send gold"}
          <span class="muted">
            {#if gift.blocked === "cooldown"}
              again in {Math.ceil(gift.secondsLeft)} s
            {:else if gift.blocked === "theyAreFull"}
              their army is full
            {:else if gift.blocked === "notBordering"}
              only over a shared border
            {:else if gift.blocked === "nothing"}
              none to send
            {:else}
              {formatTroops(gift.amount)}
            {/if}
          </span>
        </button>
      {/each}
    {/if}

    <div class="divider"></div>
    {#if canPing}
      <div class="group-label">Ping for your allies <span class="key">G</span></div>
      <div class="pings">
        {#each PING_KINDS as kind (kind)}
          <button
            type="button"
            role="menuitem"
            class="ping"
            style:--ping-color={PING_INFO[kind].color}
            disabled={pingWait > 0}
            title="{PING_INFO[kind]
              .label}: a marker your allies and teammates see for {DEFAULT_RULES.chat.pingTicks /
              10} s"
            onclick={() => act(() => onPing(menu.tile, kind))}
          >
            <span aria-hidden="true">{PING_INFO[kind].icon}</span>
            {PING_INFO[kind].label.split(" ")[0]}
          </button>
        {/each}
      </div>
    {/if}
    <div class="group-label">
      {emoteTo === 0 ? "Emoji to everyone" : `Emoji to ${ui.playerName(emoteTo)}`}
      {#if emoteWait > 0}<span class="muted">· {Math.ceil(emoteWait / 10)} s</span>{/if}
    </div>
    <div class="emojis">
      {#each DEFAULT_RULES.chat.emojis as emoji, index (index)}
        <button
          type="button"
          role="menuitem"
          class="emoji"
          disabled={emoteWait > 0}
          aria-label="Send {emoji}"
          onclick={() => act(() => onEmote(emoteTo, index))}>{emoji}</button
        >
      {/each}
    </div>

    {#if myAttacks.length > 0}
      <div class="divider"></div>
      <button type="button" role="menuitem" onclick={() => act(() => onRetreatFrom(menu.owner))}>
        {menu.owner === 0 ? "Stop expanding" : `Retreat from ${ui.playerName(menu.owner)}`}
        <span class="muted">
          {formatTroops(myAttacks.reduce((sum, a) => sum + a.troops, 0))}{menu.owner === 0
            ? ""
            : " −20%"}
        </span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }

  .menu {
    position: absolute;
    pointer-events: auto;
    padding: var(--space-1);
    background: var(--surface-glass-strong);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    font-size: var(--text-sm);
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
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

  .head .muted {
    margin-left: auto;
    font-size: var(--text-sm);
  }

  .group-label {
    padding: var(--space-1) var(--space-2);
    color: var(--text-muted);
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 30px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    background: rgb(255 255 255 / 0.1);
    outline: none;
  }

  button.current .pct {
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .pct {
    width: 36px;
    font-weight: 650;
    color: var(--text-secondary);
  }

  .troops {
    width: 52px;
  }

  button .muted,
  button .odds {
    margin-left: auto;
  }

  .muted {
    color: var(--text-muted);
  }

  .odds {
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

  .info {
    padding: var(--space-1) var(--space-2) var(--space-2);
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .info.ally,
  button.ally {
    color: var(--color-ally);
  }

  button:disabled {
    color: var(--text-muted);
    cursor: default;
  }

  button:disabled:hover {
    background: none;
  }

  button.gold:not(:disabled) {
    color: var(--color-gold);
  }

  button.danger {
    color: var(--color-danger);
    font-weight: 600;
  }

  .key {
    margin-left: var(--space-1);
    padding: 0 5px;
    border: 1px solid var(--surface-hairline);
    border-radius: 4px;
    font-size: 11px;
  }

  .pings {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-1) var(--space-1);
  }

  button.ping {
    flex: 1;
    justify-content: center;
    gap: 4px;
    padding: 0 4px;
    background: rgb(255 255 255 / 0.05);
    color: var(--ping-color);
    font-weight: 600;
  }

  .emojis {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    padding: 0 var(--space-1) var(--space-1);
  }

  button.emoji {
    justify-content: center;
    height: 30px;
    padding: 0;
    font-size: 18px;
  }

  button.emoji:disabled {
    opacity: 0.4;
  }

  .divider {
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--surface-hairline);
  }
</style>
