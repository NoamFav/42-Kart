/** Every sound here is synthesised on the fly, so there are no audio files to ship or license. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem('kart:muted') === '1';
} catch {
  // Private mode: sound stays on for this visit.
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  at?: number;
  dur: number;
  gain?: number;
}

function tone({ type = 'square', from, to, at = 0, dur, gain = 0.3 }: ToneOptions) {
  const c = audio();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, cutoff: number, at = 0) {
  const c = audio();
  if (!c || !master) return;
  const length = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const g = c.createGain();
  const t = c.currentTime + at;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

let engine: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

export const sfx = {
  isMuted: () => muted,
  setMuted(value: boolean) {
    muted = value;
    try {
      localStorage.setItem('kart:muted', value ? '1' : '0');
    } catch {
      // Not remembered: fine.
    }
    if (value) sfx.engineStop();
  },
  tick: () => tone({ type: 'triangle', from: 1100, dur: 0.05, gain: 0.1 }),
  honk() {
    tone({ type: 'sawtooth', from: 370, dur: 0.26, gain: 0.2 });
    tone({ type: 'sawtooth', from: 466, dur: 0.26, gain: 0.16 });
  },
  boost() {
    tone({ type: 'sawtooth', from: 130, to: 980, dur: 0.6, gain: 0.2 });
    noise(0.7, 0.2, 2600);
  },
  fanfare() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ type: 'square', from: f, at: i * 0.11, dur: 0.17, gain: 0.15 }));
  },
  validate() {
    [392, 523, 659, 784].forEach((f, i) => tone({ type: 'square', from: f, at: i * 0.07, dur: 0.13, gain: 0.14 }));
  },
  spin() {
    tone({ type: 'sawtooth', from: 620, to: 70, dur: 0.8, gain: 0.2 });
    noise(0.9, 0.14, 900);
  },
  throw: () => tone({ type: 'triangle', from: 300, to: 1200, dur: 0.5, gain: 0.16 }),
  hit() {
    noise(0.34, 0.34, 1300);
    tone({ type: 'square', from: 210, to: 50, dur: 0.3, gain: 0.2 });
  },
  zap() {
    noise(0.5, 0.42, 7000);
    tone({ type: 'sawtooth', from: 2400, to: 60, dur: 0.42, gain: 0.2 });
  },
  block: () => tone({ type: 'triangle', from: 900, to: 1500, dur: 0.2, gain: 0.2 }),
  powerup() {
    [523, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, at: i * 0.06, dur: 0.14, gain: 0.18 }));
  },
  item() {
    for (let i = 0; i < 9; i++) tone({ type: 'square', from: 600 + (i % 3) * 180, at: i * 0.06, dur: 0.05, gain: 0.08 });
  },
  wall: () => noise(0.09, 0.09, 1500),
  barrier() {
    tone({ type: 'square', from: 180, dur: 0.14, gain: 0.2 });
    tone({ type: 'square', from: 140, at: 0.15, dur: 0.2, gain: 0.2 });
  },
  engine(speed: number) {
    const c = audio();
    if (!c || !master) return;
    if (!engine) {
      const osc = c.createOscillator();
      const sub = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      osc.type = 'sawtooth';
      sub.type = 'square';
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      gain.gain.value = 0.07;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(master);
      osc.start();
      sub.start();
      engine = { osc, sub, gain, filter };
    }
    const rev = Math.abs(speed) / 92;
    engine.osc.frequency.setTargetAtTime(58 + rev * 240, c.currentTime, 0.05);
    engine.sub.frequency.setTargetAtTime(29 + rev * 120, c.currentTime, 0.05);
    engine.filter.frequency.setTargetAtTime(420 + rev * 1900, c.currentTime, 0.05);
  },
  engineStop() {
    if (!engine) return;
    engine.osc.stop();
    engine.sub.stop();
    engine = null;
  },
};
