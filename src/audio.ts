/** Tiny synthesized sound effects; no audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.15) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  found() {
    this.tone(660, 0, 0.12, 'triangle');
    this.tone(990, 0.09, 0.22, 'triangle');
  }

  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.09, 0.25, 'triangle'));
  }

  reveal() {
    this.tone(1200, 0, 0.08, 'sine', 0.08);
  }

  skip() {
    this.tone(300, 0, 0.15, 'square', 0.06);
  }

  tick() {
    this.tone(880, 0, 0.05, 'square', 0.04);
  }

  over() {
    [523, 415, 330].forEach((f, i) => this.tone(f, i * 0.18, 0.35, 'triangle'));
  }
}
