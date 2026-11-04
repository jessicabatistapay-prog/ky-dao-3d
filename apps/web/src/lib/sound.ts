/** Âm thanh tổng hợp bằng Web Audio: không có file nào phải tải. */
export type SoundName =
  | 'select' | 'place' | 'capture' | 'cannon' | 'check' | 'win' | 'lose' | 'draw' | 'illegal' | 'chat';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;
let enabled = true;

export function setSoundOptions(opts: { volume: number; enabled: boolean }) {
  volume = opts.volume;
  enabled = opts.enabled;
  if (master) master.gain.value = enabled ? volume : 0;
}

/** Trình duyệt chỉ cho phát sau tương tác; gọi từ pointerdown đầu tiên. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function noise(ac: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  return src;
}

function clack(ac: AudioContext, t: number, freq: number, gain: number, dur = 0.07) {
  const src = noise(ac, dur);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 2.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(band).connect(g).connect(master!);
  src.start(t);
}

function tone(ac: AudioContext, t: number, freq: number, gain: number, dur: number, type: OscillatorType = 'sine', to?: number) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playSound(name: SoundName) {
  if (!ctx || !master || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.002;
  switch (name) {
    case 'select':
      clack(ctx, t, 2600, 0.22, 0.04);
      break;
    case 'place':
      clack(ctx, t, 1500, 0.7, 0.07);
      tone(ctx, t, 190, 0.32, 0.09);
      break;
    case 'capture':
      clack(ctx, t, 1100, 0.9, 0.11);
      tone(ctx, t, 140, 0.55, 0.2, 'triangle', 60);
      clack(ctx, t + 0.05, 3200, 0.25, 0.09);
      break;
    case 'cannon':
      tone(ctx, t, 320, 0.4, 0.24, 'sawtooth', 50);
      clack(ctx, t, 500, 0.8, 0.26);
      break;
    case 'check':
      tone(ctx, t, 587, 0.26, 0.2, 'triangle');
      tone(ctx, t + 0.12, 784, 0.3, 0.32, 'triangle');
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(ctx!, t + i * 0.14, f, 0.26, 0.6, 'triangle'));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(ctx!, t + i * 0.2, f, 0.24, 0.6, 'sine'));
      break;
    case 'draw':
      [440, 440].forEach((f, i) => tone(ctx!, t + i * 0.22, f, 0.22, 0.45, 'sine'));
      break;
    case 'illegal':
      tone(ctx, t, 160, 0.2, 0.1, 'square');
      break;
    case 'chat':
      tone(ctx, t, 880, 0.12, 0.12, 'sine');
      break;
  }
}
