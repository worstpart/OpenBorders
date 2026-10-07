/** The HUD's emojis, pings, incoming-threat warning and alert sounds (GAME_DESIGN.md §3.20). */
import { describe, expect, it } from "vitest";
import {
  cuesForEvents,
  CueThrottle,
  CUE_GAP_MS,
  DEFAULT_SOUND,
  loadSoundSettings,
  saveSoundSettings,
  type SettingsStore,
} from "../../src/client/audio/sound.ts";
import {
  cooldownLeft,
  emoteAge,
  quickPingKind,
  updateEmotes,
  visiblePings,
} from "../../src/client/app/chat.ts";
import { incomingThreats, newKeys } from "../../src/client/app/threats.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { BoatSnapshot, PingSnapshot } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

const R = DEFAULT_RULES;
const ping = (from: number, id = from): PingSnapshot => ({
  id,
  from,
  tile: 5,
  kind: "attack",
  target: 3,
  tick: 10,
  expiresTick: 110,
});

describe("pings in the HUD", () => {
  it("show only our own and our friends'", () => {
    const pings = [ping(1), ping(2), ping(3)];
    expect(visiblePings(pings, 1, new Set([2])).map((p) => p.from)).toEqual([1, 2]);
  });

  it("the ping key picks attack on enemies, defend on friends, watch elsewhere", () => {
    const friends = new Set([2]);
    expect(quickPingKind(3, true, 1, friends)).toBe("attack");
    expect(quickPingKind(2, true, 1, friends)).toBe("defend");
    expect(quickPingKind(1, true, 1, friends)).toBe("defend");
    expect(quickPingKind(0, true, 1, friends)).toBe("watch");
    expect(quickPingKind(3, false, 1, friends)).toBe("watch");
  });

  it("friends' pings become toasts; others' don't", () => {
    const events: SimEvent[] = [
      { type: "pinged", pingId: 1, from: 2, tile: 5, kind: "attack", target: 3 },
      { type: "pinged", pingId: 2, from: 4, tile: 5, kind: "attack", target: 3 },
    ];
    const toasts = toastsForEvents(
      events,
      1,
      (id) => `P${id}`,
      () => true,
      () => 0,
      new Set([2]),
    );
    expect(toasts.map((t) => t.text)).toEqual(["P2: 🎯 Attack here — P3"]);
  });
});

describe("emojis in the HUD", () => {
  const emoted = (from: number, to: number, emoji = 0): SimEvent => ({
    type: "emoted",
    from,
    to,
    emoji,
  });

  it("show those to everyone, to us and ours; a newer one replaces the sender's older", () => {
    let list = updateEmotes([], [emoted(2, 0), emoted(3, 1), emoted(4, 5), emoted(1, 4)], 1, 10, R);
    expect(list.map((e) => e.from)).toEqual([2, 3, 1]);
    list = updateEmotes(list, [emoted(2, 0, 7)], 1, 12, R);
    expect(list.filter((e) => e.from === 2).map((e) => e.emoji)).toEqual([R.chat.emojis[7]]);
  });

  it("disappear after emoteShowTicks", () => {
    const list = updateEmotes([], [emoted(2, 0)], 1, 10, R);
    expect(emoteAge(list[0]!, 10 + R.chat.emoteShowTicks / 2, R)).toBeCloseTo(0.5);
    expect(updateEmotes(list, [], 1, 10 + R.chat.emoteShowTicks, R)).toEqual([]);
  });

  it("an emoji to us is a toast", () => {
    const toasts = toastsForEvents([emoted(2, 1, 0), emoted(3, 0, 0)], 1, (id) => `P${id}`);
    expect(toasts.map((t) => t.text)).toEqual([`P2: ${R.chat.emojis[0]}`]);
  });

  it("cooldowns count down from the last use", () => {
    expect(cooldownLeft(-1, 30, 100)).toBe(0);
    expect(cooldownLeft(90, 30, 100)).toBe(20);
    expect(cooldownLeft(50, 30, 100)).toBe(0);
  });
});

describe("the incoming-threat warning", () => {
  const owner = new Uint16Array([1, 1, 0, 2, 2]);
  const boat = (id: number, o: number, landingTile: number, recallTick = -1): BoatSnapshot => ({
    id,
    owner: o,
    target: 1,
    troops: 500,
    launchTile: 4,
    landingTile,
    focusTile: landingTile,
    route: new Int32Array(0),
    launchTick: 0,
    tilesPerTick: 1,
    arriveTick: 50 + id,
    recallTick,
  });

  it("lists boats landing on our land, soonest first — not ours, not recalled", () => {
    const threats = incomingThreats({
      rules: R,
      owner,
      boats: [boat(3, 2, 0), boat(1, 2, 1), boat(2, 1, 3), boat(4, 2, 1, 20), boat(5, 2, 2)],
      me: 1,
      tick: 40,
    });
    expect(threats.map((t) => t.key)).toEqual(["boat:1", "boat:3"]);
    expect(threats[0]).toMatchObject({ from: 2, troops: 500, tile: 1, secondsLeft: 1.1 });
  });

  it("is empty for a spectator", () => {
    expect(incomingThreats({ rules: R, owner, boats: [boat(1, 2, 1)], me: 0, tick: 0 })).toEqual(
      [],
    );
  });

  it("new keys sound once", () => {
    expect(newKeys(new Set(["boat:1"]), [{ key: "boat:1" }, { key: "boat:2" }])).toEqual([
      "boat:2",
    ]);
  });
});

describe("alert sounds", () => {
  it("are the attacks on us, alliance requests to us and friends' pings", () => {
    const events: SimEvent[] = [
      { type: "attackStarted", attackId: 1, attacker: 2, target: 1, landingTile: -1 },
      { type: "attackStarted", attackId: 2, attacker: 1, target: 2, landingTile: -1 },
      { type: "allianceRequested", from: 3, to: 1 },
      { type: "pinged", pingId: 1, from: 1, tile: 0, kind: "watch", target: 0 },
    ];
    expect(cuesForEvents(events, 1, new Set([2]))).toEqual(["underAttack", "alliance"]);
    expect(
      cuesForEvents(
        [{ type: "pinged", pingId: 2, from: 2, tile: 0, kind: "watch", target: 0 }],
        1,
        new Set([2]),
      ),
    ).toEqual(["ping"]);
  });

  it("don't repeat the same alert within its gap", () => {
    const throttle = new CueThrottle();
    expect(throttle.allow("underAttack", 0)).toBe(true);
    expect(throttle.allow("underAttack", CUE_GAP_MS.underAttack - 1)).toBe(false);
    expect(throttle.allow("ping", 1)).toBe(true);
    expect(throttle.allow("underAttack", CUE_GAP_MS.underAttack)).toBe(true);
  });

  it("settings are remembered, and bad or missing storage falls back to the defaults", () => {
    const data = new Map<string, string>();
    const store: SettingsStore = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    expect(loadSoundSettings(store)).toEqual(DEFAULT_SOUND);
    saveSoundSettings(store, { volume: 0.3, muted: true });
    expect(loadSoundSettings(store)).toEqual({ volume: 0.3, muted: true });
    data.set("openborder.sound", "{not json");
    expect(loadSoundSettings(store)).toEqual(DEFAULT_SOUND);
    data.set("openborder.sound", JSON.stringify({ volume: 7 }));
    expect(loadSoundSettings(store).volume).toBe(1);
    const broken: SettingsStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSoundSettings(broken)).toEqual(DEFAULT_SOUND);
    expect(() => saveSoundSettings(broken, DEFAULT_SOUND)).not.toThrow();
    expect(loadSoundSettings(null)).toEqual(DEFAULT_SOUND);
  });
});
