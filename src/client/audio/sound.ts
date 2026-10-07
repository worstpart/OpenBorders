/**
 * Alert sounds (GAME_DESIGN.md §3.20, milestone 2.9). The user chose "alerts only" for the
 * first sound pass: a few warnings, nothing else makes a sound. When each plays is decided
 * by app/alerts.ts. Every sound is synthesized
 * in the browser with the Web Audio API — no audio files, so nothing to license (OpenFront's
 * sounds are all-rights-reserved, D-001).
 *
 * Browsers only allow audio after the player has clicked or pressed a key, so the audio
 * context is created on the first such gesture. Volume and mute are remembered per browser.
 */
/**
 * The alerts: a player starts attacking you (soft) · an enemy boat sails for your coast (the
 * horn) · alliance asks · an alliance somewhere was broken.
 */
export type SoundCue = "attacked" | "boat" | "alliance" | "betrayal";

export interface SoundSettings {
  /** 0–1. */
  readonly volume: number;
  readonly muted: boolean;
}

export const DEFAULT_SOUND: SoundSettings = { volume: 0.6, muted: false };

/** The same alert at most this often (ms): a flurry of attacks is one warning, not ten. */
export const CUE_GAP_MS: Readonly<Record<SoundCue, number>> = {
  attacked: 6_000,
  boat: 3_000,
  alliance: 1_500,
  betrayal: 2_000,
};

/** Lets each cue through at most once per CUE_GAP_MS. */
export class CueThrottle {
  private readonly last = new Map<SoundCue, number>();

  allow(cue: SoundCue, now: number): boolean {
    const last = this.last.get(cue);
    if (last !== undefined && now - last < CUE_GAP_MS[cue]) return false;
    this.last.set(cue, now);
    return true;
  }
}

/** Where settings are kept (localStorage in the browser; may be missing or throw). */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORE_KEY = "openborder.sound";

export function loadSoundSettings(store: SettingsStore | null): SoundSettings {
  try {
    const raw = store?.getItem(STORE_KEY);
    if (!raw) return DEFAULT_SOUND;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    const volume = Number(parsed.volume);
    return {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SOUND.volume,
      muted: parsed.muted === true,
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function saveSoundSettings(store: SettingsStore | null, settings: SoundSettings): void {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows may refuse storage: the setting just isn't remembered.
  }
}

/** One synthesized note: an oscillator with a quick attack and an exponential fade. */
interface Note {
  /** Seconds after the cue starts. */
  readonly at: number;
  readonly freq: number;
  /** Glide to this frequency over the note (optional). */
  readonly to?: number;
  readonly length: number;
  readonly wave: OscillatorType;
  /** Relative loudness (0–1). */
  readonly gain: number;
}

/** The cues as notes. Short (≤ 0.6 s), distinct in pitch and rhythm, never shrill. */
export const CUE_NOTES: Readonly<Record<SoundCue, readonly Note[]>> = {
  // Two soft low tones, falling — subtle (the user: attack sounds must not nag).
  attacked: [
    { at: 0, freq: 392, length: 0.22, wave: "sine", gain: 0.3 },
    { at: 0.16, freq: 294, length: 0.32, wave: "sine", gain: 0.3 },
  ],
  // A low two-tone horn, falling: a boat is coming for you (the user asked to keep it).
  boat: [
    { at: 0, freq: 233, length: 0.2, wave: "sawtooth", gain: 0.55 },
    { at: 0.2, freq: 175, length: 0.32, wave: "sawtooth", gain: 0.55 },
  ],
  // A soft two-note bell, rising: someone wants to talk.
  alliance: [
    { at: 0, freq: 660, length: 0.45, wave: "sine", gain: 0.6 },
    { at: 0, freq: 1320, length: 0.25, wave: "sine", gain: 0.15 },
    { at: 0.14, freq: 990, length: 0.5, wave: "sine", gain: 0.6 },
    { at: 0.14, freq: 1980, length: 0.25, wave: "sine", gain: 0.12 },
  ],
  // Three falling notes, slightly sour: someone broke an alliance.
  betrayal: [
    { at: 0, freq: 622, length: 0.16, wave: "triangle", gain: 0.5 },
    { at: 0.15, freq: 523, length: 0.16, wave: "triangle", gain: 0.5 },
    { at: 0.3, freq: 370, length: 0.4, wave: "triangle", gain: 0.55 },
  ],
};

/** The alert player. Safe to call anywhere: without Web Audio it stays silent. */
export class SoundBoard {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly throttle = new CueThrottle();
  private current: SoundSettings;
  private readonly store: SettingsStore | null;

  constructor(store: SettingsStore | null) {
    this.store = store;
    this.current = loadSoundSettings(store);
  }

  get settings(): SoundSettings {
    return this.current;
  }

  /** The cues played so far, and the audio state (dev checks: the browser pane can't be heard). */
  readonly played: SoundCue[] = [];
  get state(): string {
    return this.context?.state ?? "locked";
  }

  setVolume(volume: number): void {
    this.update({ ...this.current, volume: Math.min(1, Math.max(0, volume)), muted: false });
  }

  setMuted(muted: boolean): void {
    this.update({ ...this.current, muted });
  }

  /** Call from a click or key press: browsers only start audio after a gesture. */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.context) {
      try {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.applyVolume();
      } catch {
        this.context = null;
        return;
      }
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => {});
  }

  /** Plays an alert (unless muted, not yet unlocked, or the same alert just played). */
  play(cue: SoundCue): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.current.muted || this.current.volume <= 0) return;
    if (ctx.state !== "running") return;
    if (!this.throttle.allow(cue, performance.now())) return;
    this.played.push(cue);
    if (this.played.length > 50) this.played.shift();
    const start = ctx.currentTime + 0.01;
    for (const note of CUE_NOTES[cue]) this.playNote(ctx, this.master, note, start);
  }

  private playNote(ctx: AudioContext, out: AudioNode, note: Note, start: number): void {
    const t0 = start + note.at;
    const t1 = t0 + note.length;
    const osc = ctx.createOscillator();
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.freq, t0);
    if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, t1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(note.gain, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    // Saw waves are buzzy: a low-pass keeps the horn warm.
    let head: AudioNode = gain;
    if (note.wave === "sawtooth") {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1_200;
      gain.connect(filter);
      head = filter;
    }
    osc.connect(gain);
    head.connect(out);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }

  private update(settings: SoundSettings): void {
    this.current = settings;
    saveSoundSettings(this.store, settings);
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.master || !this.context) return;
    // Perceived loudness is roughly the square of the gain; 0.35 keeps alerts below speech level.
    const level = this.current.muted ? 0 : 0.35 * this.current.volume * this.current.volume;
    this.master.gain.setValueAtTime(level, this.context.currentTime);
  }
}
