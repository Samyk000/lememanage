import type { Tone } from "./api";

/** One sine partial: frequency, peak gain, decay in seconds, onset delay. */
type Partial = { f: number; gain: number; decay: number; delay?: number };

/**
 * Three small, soft sounds. Frequencies are picked to sit together as harmonics
 * rather than a melody, so the result reads as a chime and not a ringtone.
 */
const TONES: Record<Tone, Partial[]> = {
  chime: [
    { f: 784, gain: 0.12, decay: 2.2 },
    { f: 1174.7, gain: 0.05, decay: 1.8, delay: 0.015 },
    { f: 1568, gain: 0.025, decay: 1.4, delay: 0.03 },
  ],
  bell: [
    { f: 523.25, gain: 0.11, decay: 2.6 },
    { f: 1444.2, gain: 0.035, decay: 2.0, delay: 0.01 },
    { f: 2824, gain: 0.012, decay: 1.3, delay: 0.02 },
  ],
  bowl: [
    { f: 196, gain: 0.1, decay: 4.2 },
    { f: 294, gain: 0.045, decay: 3.6, delay: 0.03 },
    { f: 588, gain: 0.018, decay: 2.6, delay: 0.06 },
  ],
};

let ctx: AudioContext | null = null;

/** WebView2 starts the context suspended; call this from a real user gesture. */
export function unlockAudio() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // No output device: the reminder still rings the notch, just silently.
  }
}

export function playTone(tone: Tone) {
  unlockAudio();
  if (!ctx) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const soft = ctx.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 3200;
  master.connect(soft).connect(ctx.destination);

  for (const p of TONES[tone]) {
    const t = now + (p.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = p.f;
    const g = ctx.createGain();
    // A hair of attack keeps the strike from clicking; the long tail is the point.
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + p.decay + 0.05);
  }
}
