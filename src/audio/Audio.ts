/**
 * All sound is synthesised with the Web Audio API: no files to download or license.
 * Sound effects are short oscillator/noise envelopes; the music is a small step sequencer
 * playing synthwave drums, bass, pads and arpeggios.
 */

export type Sfx =
  | 'shoot'
  | 'hit'
  | 'kill'
  | 'bigkill'
  | 'gateGood'
  | 'gateBad'
  | 'gem'
  | 'power'
  | 'hurt'
  | 'block'
  | 'shieldbreak'
  | 'boss'
  | 'bossdown'
  | 'win'
  | 'lose'
  | 'click'
  | 'wipe'
  | 'alarm'
  | 'meteor'
  | 'boom'
  | 'summon';

export type MusicMode = 'menu' | 'run' | 'boss';

/** Minimum gap between repeats, so rapid events don't turn into noise. */
const THROTTLE: Partial<Record<Sfx, number>> = { shoot: 0.07, hit: 0.045, gem: 0.04, kill: 0.03, block: 0.08 };

/** 0.1 s of silence as a WAV data URI (used to unlock the iOS media channel). */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Song {
  bpm: number;
  /** One chord per bar: [bass root, ...chord tones] as MIDI notes. */
  bars: number[][];
  drums: boolean;
  hats16: boolean;
  arp16: boolean;
  lead: boolean;
}

const SONGS: Record<MusicMode, Song> = {
  menu: {
    bpm: 92,
    bars: [
      [45, 57, 60, 64],
      [41, 57, 60, 65],
      [48, 55, 60, 64],
      [43, 55, 59, 62],
    ],
    drums: false,
    hats16: false,
    arp16: false,
    lead: false,
  },
  run: {
    bpm: 112,
    bars: [
      [45, 57, 60, 64],
      [41, 57, 60, 65],
      [48, 55, 60, 64],
      [43, 55, 59, 62],
    ],
    drums: true,
    hats16: false,
    arp16: true,
    lead: false,
  },
  boss: {
    bpm: 124,
    bars: [
      [45, 57, 60, 64],
      [43, 55, 59, 62],
      [41, 53, 57, 60],
      [40, 52, 56, 59],
    ],
    drums: true,
    hats16: true,
    arp16: true,
    lead: true,
  },
};

/** A short minor motif for the boss lead, as offsets from the chord's first tone (-1 = rest). */
const LEAD = [12, -1, 15, -1, 19, 17, 15, -1, 12, -1, 10, 12, -1, -1, 7, -1];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private echo!: GainNode;
  private arpBus!: GainNode;
  private noise!: AudioBuffer;
  private last: Partial<Record<Sfx, number>> = {};

  private musicOn = true;
  private sfxOn = true;
  private mode: MusicMode | null = null;
  private pending: MusicMode | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  /** Scheduled kick times, so visuals can pulse in time with the music. */
  private beats: number[] = [];
  private silentEl: HTMLAudioElement | null = null;

  /**
   * Call from a user gesture (touchend / pointerup / click / keydown — a touch's pointerdown
   * does not count on mobile): browsers only allow audio to start after one.
   */
  unlock(): void {
    // iOS: route Web Audio as media playback so the ring/silent switch doesn't mute it.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* older Safari */
      }
    } else if (!this.silentEl && /iP(hone|ad|od)/.test(navigator.userAgent)) {
      // Older iOS: a looping silent <audio> element switches the page to the media channel.
      const el = document.createElement('audio');
      el.src = SILENT_WAV;
      el.loop = true;
      el.setAttribute('playsinline', '');
      void el.play().catch(() => {});
      this.silentEl = el;
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(comp).connect(ctx.destination);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.55 : 0;
      this.sfxBus.connect(this.master);

      // A dotted-eighth echo for the arpeggio: the classic synthwave shimmer.
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.4;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.echo = ctx.createGain();
      this.echo.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(this.musicBus);
      this.arpBus = ctx.createGain();
      this.arpBus.connect(this.musicBus);
      this.arpBus.connect(this.echo);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      if (this.pending) this.startMusic(this.pending);
    }
    const ctx = this.ctx;
    // 'suspended' on first use, 'interrupted' on iOS after a call or app switch.
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    // Some mobile browsers only truly start after a sound is played inside the gesture.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }

  /** Silence everything while the page or app is in the background. */
  setHidden(hidden: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** 1 right on a beat, decaying towards 0 until the next. */
  beat(): number {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.musicOn || !this.mode) return -1;
    const now = ctx.currentTime;
    let last = -1;
    for (const t of this.beats) if (t <= now && t > last) last = t;
    return last < 0 ? 0 : Math.exp(-(now - last) * 7);
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1);
  }

  setSfxEnabled(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  /** Switch the music; the change lands on the next bar so it stays in time. */
  music(mode: MusicMode): void {
    this.pending = mode;
    if (this.ctx && this.timer === null) this.startMusic(mode);
  }

  play(name: Sfx, vol = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const gap = THROTTLE[name];
    if (gap && t - (this.last[name] ?? -1) < gap) return;
    this.last[name] = t;
    const out = this.sfxBus;

    switch (name) {
      case 'shoot':
        this.tone('triangle', 1250, 520, 0.06, 0.05 * vol, t, out);
        break;
      case 'hit':
        this.hiss(0.03, 0.05 * vol, 'bandpass', 2600, 2600, t, out);
        break;
      case 'kill':
        this.tone('square', 560, 130, 0.11, 0.07 * vol, t, out, 2400);
        this.hiss(0.12, 0.08 * vol, 'lowpass', 2200, 400, t, out);
        break;
      case 'bigkill':
        this.tone('sawtooth', 320, 55, 0.3, 0.14 * vol, t, out, 1600);
        this.hiss(0.3, 0.14 * vol, 'lowpass', 2500, 200, t, out);
        break;
      case 'gateGood':
        [72, 76, 79, 84].forEach((m, i) => this.tone('triangle', mtof(m), mtof(m), 0.12, 0.13 * vol, t + i * 0.055, out));
        break;
      case 'gateBad':
        this.tone('sawtooth', 300, 110, 0.32, 0.12 * vol, t, out, 1100);
        this.tone('sawtooth', 306, 104, 0.32, 0.1 * vol, t, out, 1100);
        break;
      case 'gem': {
        const f = 1568 * (1 + Math.random() * 0.06);
        this.tone('sine', f, f, 0.07, 0.09 * vol, t, out);
        this.tone('sine', f * 1.335, f * 1.335, 0.09, 0.07 * vol, t + 0.04, out);
        break;
      }
      case 'power':
        this.tone('sawtooth', 220, 1400, 0.35, 0.09 * vol, t, out, 3000);
        [76, 83, 88].forEach((m, i) => this.tone('square', mtof(m), mtof(m), 0.09, 0.06 * vol, t + 0.15 + i * 0.07, out, 4000));
        break;
      case 'hurt':
        this.tone('sine', 150, 45, 0.28, 0.4 * vol, t, out);
        this.hiss(0.2, 0.18 * vol, 'lowpass', 900, 200, t, out);
        break;
      case 'block':
        this.tone('triangle', 620, 940, 0.14, 0.12 * vol, t, out);
        this.tone('sine', 1880, 1880, 0.18, 0.05 * vol, t + 0.03, out);
        break;
      case 'shieldbreak':
        this.hiss(0.3, 0.16 * vol, 'highpass', 3500, 1500, t, out);
        this.tone('square', 980, 180, 0.22, 0.08 * vol, t, out, 3000);
        break;
      case 'boss':
        for (let i = 0; i < 4; i++) this.tone('square', i % 2 ? 233 : 220, i % 2 ? 233 : 220, 0.16, 0.08 * vol, t + i * 0.18, out, 1800);
        this.tone('sawtooth', 55, 50, 1.2, 0.18 * vol, t, out, 300);
        break;
      case 'bossdown':
        this.hiss(1.3, 0.35 * vol, 'lowpass', 4000, 120, t, out);
        this.tone('sine', 90, 28, 0.9, 0.45 * vol, t, out);
        break;
      case 'win':
        [72, 76, 79, 84, 88].forEach((m, i) => this.tone('triangle', mtof(m), mtof(m), 0.22, 0.12 * vol, t + i * 0.11, out));
        [60, 64, 67].forEach((m) => this.tone('sawtooth', mtof(m), mtof(m), 1.0, 0.05 * vol, t + 0.55, out, 1800, 0.05));
        break;
      case 'lose':
        [67, 65, 62, 60].forEach((m, i) => this.tone('sawtooth', mtof(m), mtof(m) * 0.98, 0.3, 0.09 * vol, t + i * 0.2, out, 1200));
        break;
      case 'click':
        this.tone('triangle', 1100, 900, 0.035, 0.06 * vol, t, out);
        break;
      case 'wipe':
        this.tone('sawtooth', 420, 50, 0.6, 0.12 * vol, t, out, 1500);
        this.hiss(0.5, 0.12 * vol, 'lowpass', 1500, 150, t, out);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone('square', 660, 880, 0.18, 0.08 * vol, t + i * 0.22, out, 2600);
        break;
      case 'meteor':
        this.tone('sine', 1800, 300, 1.2, 0.05 * vol, t, out);
        this.hiss(1.2, 0.04 * vol, 'bandpass', 3000, 600, t, out);
        break;
      case 'boom':
        this.tone('sine', 120, 35, 0.5, 0.45 * vol, t, out);
        this.hiss(0.6, 0.25 * vol, 'lowpass', 2500, 120, t, out);
        break;
      case 'summon':
        this.tone('sawtooth', 90, 180, 0.5, 0.12 * vol, t, out, 900);
        this.tone('square', 440, 220, 0.3, 0.05 * vol, t + 0.1, out, 1800);
        break;
    }
  }

  // ---------- Synth helpers ----------

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    when: number,
    out: AudioNode,
    cutoff = 0,
    attack = 0.004,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node: AudioNode = osc;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = node.connect(f);
    }
    node.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private hiss(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, when: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(out);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.02);
  }

  // ---------- Music sequencer ----------

  private startMusic(mode: MusicMode): void {
    const ctx = this.ctx!;
    this.mode = mode;
    this.pending = mode;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.08;
    // A lookahead scheduler: wake every 25 ms and queue notes ~120 ms ahead.
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.step % 16 === 0 && this.pending !== this.mode) {
        this.mode = this.pending;
        this.step = 0;
      }
      if (this.mode) this.playStep(SONGS[this.mode], this.step, this.nextTime);
      const song = SONGS[this.mode ?? 'menu'];
      this.nextTime += 60 / song.bpm / 4;
      this.step = (this.step + 1) % (16 * song.bars.length);
    }
  }

  private playStep(song: Song, step: number, t: number): void {
    const out = this.musicBus;
    const bar = song.bars[Math.floor(step / 16) % song.bars.length];
    const s = step % 16;
    const beat = 60 / song.bpm;

    if (s % 4 === 0) {
      this.beats.push(t);
      if (this.beats.length > 8) this.beats.shift();
    }
    if (song.drums) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (song.hats16 || s % 2 === 1) this.hiss(0.04, s % 4 === 2 ? 0.07 : 0.045, 'highpass', 8000, 8000, t, out);
    } else if (s === 0) {
      this.kick(t, 0.5);
    }

    // Bass: eighth notes with an octave bounce.
    if (s % 2 === 0) {
      const m = bar[0] + (song.drums && s % 4 === 2 ? 12 : 0);
      this.tone('sawtooth', mtof(m), mtof(m), beat * 0.45, song.drums ? 0.22 : 0.14, t, out, 700);
    }

    // Pad: the chord, held for the bar.
    if (s === 0) {
      for (const m of bar.slice(1)) {
        this.tone('sawtooth', mtof(m), mtof(m), beat * 4, 0.035, t, out, 1400, 0.35);
        this.tone('sawtooth', mtof(m) * 1.006, mtof(m) * 1.006, beat * 4, 0.03, t, out, 1400, 0.35);
      }
    }

    // Arpeggio through the echo.
    const every = song.arp16 ? 1 : 2;
    if (s % every === 0) {
      const tones = bar.slice(1);
      const k = Math.floor(s / every);
      const m = tones[k % tones.length] + 12 * (Math.floor(k / tones.length) % 2) + 12;
      this.tone('square', mtof(m), mtof(m), beat * 0.22, 0.045, t, this.arpBus, 2600);
    }

    if (song.lead) {
      const off = LEAD[s];
      if (off >= 0) this.tone('sawtooth', mtof(bar[1] + off + 12), mtof(bar[1] + off + 12), beat * 0.4, 0.05, t, out, 3200);
    }
  }

  private kick(t: number, vol = 1): void {
    this.tone('sine', 150, 42, 0.32, 0.55 * vol, t, this.musicBus);
  }

  private snare(t: number): void {
    this.hiss(0.16, 0.18, 'bandpass', 2200, 1800, t, this.musicBus);
    this.tone('triangle', 240, 180, 0.08, 0.12, t, this.musicBus);
  }
}
