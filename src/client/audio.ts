import { surfaceAt, type CarKind, type CarState, type GameState, type Track } from '../sim';
import type { SoundEvent } from './soundEvents';

const MUTE_KEY = 'gg-muted';
/** Cars with an engine voice: the nearest few to the listener. */
const VOICES = 4;
/** Distance where a sound has faded to about a third. */
const HEAR_RANGE = 520;

/** Engine note per car: idle pitch and how many fake gears it runs through. */
const ENGINE: Record<CarKind, { base: number; span: number; gears: number[] }> = {
  rally: { base: 62, span: 1.5, gears: [0, 110, 210, 300, 390, 520] },
  f1: { base: 105, span: 1.9, gears: [0, 140, 260, 370, 480, 600, 760] },
  buggy: { base: 55, span: 1.35, gears: [0, 100, 190, 280, 380, 460] },
  truck: { base: 38, span: 1.2, gears: [0, 80, 150, 230, 310, 420] },
  kart: { base: 140, span: 1.6, gears: [0, 140, 280, 460] },
};

interface Voice {
  carId: number;
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  skid: GainNode;
  rumble: GainNode;
  rumbleFilter: BiquadFilterNode;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Synthesised sound, no audio files: engines (pitch from speed through fake
 * gears), tyre squeal from slip, rumble on loose ground, and one-shots for
 * crashes, cones, the pit crew, countdown and laps.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private lastSpeed = new Map<number, number>();
  private recent = new Map<string, number>();
  muted = readMuted();

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      for (let i = 0; i < VOICES; i++) this.voices.push(this.makeVoice());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Private mode: the toggle still works for this page.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Quiet everything (menu open, race reset). */
  silence(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(0, t, 0.05);
      v.skid.gain.setTargetAtTime(0, t, 0.05);
      v.rumble.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private makeVoice(): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master!);
    osc.start();
    sub.start();

    const skidBand = ctx.createBiquadFilter();
    skidBand.type = 'bandpass';
    skidBand.frequency.value = 1900;
    skidBand.Q.value = 6;
    const skid = ctx.createGain();
    skid.gain.value = 0;
    this.loopNoise().connect(skidBand).connect(skid).connect(this.master!);

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 400;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    this.loopNoise().connect(rumbleFilter).connect(rumble).connect(this.master!);
    return { carId: -1, osc, sub, filter, gain, skid, rumble, rumbleFilter };
  }

  /** Per frame: point engine voices at the nearest cars and set pitch and noise. */
  update(state: GameState, track: Track, listener: { x: number; y: number }, racing: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const near = [...state.cars]
      .map((c) => ({ c, d: Math.hypot(c.x - listener.x, c.y - listener.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, VOICES);
    this.voices.forEach((v, i) => {
      const hit = near[i];
      if (!hit || !racing) {
        v.gain.gain.setTargetAtTime(0, t, 0.08);
        v.skid.gain.setTargetAtTime(0, t, 0.05);
        v.rumble.gain.setTargetAtTime(0, t, 0.08);
        return;
      }
      this.voiceFor(v, hit.c, hit.d, track, t);
    });
  }

  private voiceFor(v: Voice, car: CarState, dist: number, track: Track, t: number) {
    const fall = 1 / (1 + (dist / HEAR_RANGE) ** 2 * 2);
    const speed = Math.hypot(car.vx, car.vy);
    const last = this.lastSpeed.get(car.id) ?? speed;
    this.lastSpeed.set(car.id, speed);
    const pulling = speed > last + 0.3;
    const e = ENGINE[car.kind] ?? ENGINE.rally;
    let gear = 0;
    while (gear < e.gears.length - 2 && speed > e.gears[gear + 1]) gear++;
    const lo = e.gears[gear];
    const hi = e.gears[gear + 1];
    const rev = Math.min(1.15, Math.max(0, (speed - lo) / (hi - lo)));
    const freq = e.base * (1 + rev * e.span + gear * 0.08);
    if (v.carId !== car.id) {
      // Voice moved to another car: jump straight to its note.
      v.osc.frequency.setValueAtTime(freq, t);
      v.carId = car.id;
    }
    v.osc.frequency.setTargetAtTime(freq, t, 0.04);
    v.sub.frequency.setTargetAtTime(freq / 2, t, 0.04);
    v.filter.frequency.setTargetAtTime(400 + rev * 1400 + (pulling ? 600 : 0), t, 0.05);
    v.gain.gain.setTargetAtTime((0.05 + (pulling ? 0.07 : 0.03) + rev * 0.04) * fall, t, 0.06);

    const surface = surfaceAt(track, car.x, car.y);
    const squeal = surface === 'asphalt' || surface === 'ice' ? Math.max(0, Math.min(1, (car.slip - 60) / 160)) : 0;
    v.skid.gain.setTargetAtTime(squeal * 0.09 * fall, t, 0.04);
    const loose = surface !== 'asphalt' && surface !== 'ice';
    const roll = loose ? Math.min(1, speed / 260) : 0;
    v.rumbleFilter.frequency.setTargetAtTime(surface === 'water' ? 900 : surface === 'gravel' || surface === 'dirt' ? 700 : surface === 'mud' ? 260 : 350, t, 0.1);
    v.rumble.gain.setTargetAtTime(roll * 0.12 * fall, t, 0.06);
  }

  /** Once per tick or snapshot: play the one-shots. */
  play(events: SoundEvent[], state: GameState, listener: { x: number; y: number }): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const at = (x: number, y: number) => 1 / (1 + (Math.hypot(x - listener.x, y - listener.y) / HEAR_RANGE) ** 2 * 2);
    const carAt = (id: number) => state.cars.find((c) => c.id === id);
    for (const e of events) {
      const key = e.kind === 'cone' ? `cone${e.index}` : 'car' in e ? `${e.kind}${e.car}` : e.kind;
      const gap = e.kind === 'pit' ? 0.22 : e.kind === 'cone' ? 0.35 : e.kind === 'crash' ? 0.12 : 0;
      if (gap && now - (this.recent.get(key) ?? -1) < gap) continue;
      this.recent.set(key, now);
      if (e.kind === 'beep') this.tone(e.final ? 880 : 440, e.final ? 0.35 : 0.16, 0.22, 'sine');
      else if (e.kind === 'lap') this.chime([660, 990], 0.12);
      else if (e.kind === 'lastLap') this.chime([1175, 1175, 1175], 0.18);
      else if (e.kind === 'finish') this.chime([523, 659, 784, 1047], 0.14);
      else if (e.kind === 'cone') this.tok(at(e.x, e.y) * (0.5 + e.strength * 0.5));
      else {
        const c = carAt(e.car);
        if (!c) continue;
        if (e.kind === 'crash') this.thump(at(c.x, c.y) * (0.35 + e.strength * 0.65));
        else this.airGun(at(c.x, c.y));
      }
    }
  }

  private envelope(peak: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private tone(freq: number, length: number, peak: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.envelope(peak, 0.01, length));
    o.start();
    o.stop(ctx.currentTime + length + 0.05);
  }

  private chime(notes: number[], step: number) {
    notes.forEach((f, i) => setTimeout(() => this.ctx && this.tone(f, 0.25, 0.16, 'triangle'), i * step * 1000));
  }

  private burst(length: number, peak: number, filterType: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    src.connect(f).connect(this.envelope(peak, 0.005, length));
    src.start();
    src.stop(ctx.currentTime + length + 0.05);
  }

  private thump(volume: number) {
    this.burst(0.25, 0.5 * volume, 'lowpass', 900);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);
    o.connect(this.envelope(0.6 * volume, 0.005, 0.22));
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  private tok(volume: number) {
    this.tone(820, 0.08, 0.25 * volume, 'triangle');
    this.burst(0.05, 0.12 * volume, 'highpass', 2500);
  }

  private airGun(volume: number) {
    this.burst(0.12, 0.18 * volume, 'bandpass', 3200);
  }
}
