export class AudioEngine {
  private ctx: AudioContext | null = null;
  enabled = true;

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  // Called on first user gesture to unlock AudioContext in all browsers
  init(): void { this.getCtx(); }

  private osc(
    freq: number, duration: number, type: OscillatorType,
    gainVal: number, delay = 0, freqEnd?: number,
  ): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.start(t);
    o.stop(t + duration + 0.01);
  }

  private noise(duration: number, gainVal: number, delay = 0): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const size = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.start(t);
  }

  playBlockLand():    void { this.noise(0.08, 0.18); this.osc(70, 0.12, 'sine', 0.2); }
  playBlockRotate():  void { this.osc(380, 0.04, 'sine', 0.08); }
  playBlockMove():    void { this.osc(280, 0.03, 'sine', 0.06); }
  playHit():          void { this.noise(0.05, 0.2); this.osc(220, 0.07, 'square', 0.12); }
  playPlayerDamage(): void { this.osc(140, 0.15, 'sawtooth', 0.28); this.osc(90, 0.18, 'sawtooth', 0.2, 0.12); }
  playPoison():       void { this.osc(200, 0.1, 'triangle', 0.14); this.osc(140, 0.12, 'triangle', 0.1, 0.09); }
  playShop():         void { this.osc(900, 0.06, 'sine', 0.15); this.osc(1100, 0.07, 'sine', 0.12, 0.07); }
  playPerk():         void { [550, 700, 900, 1100].forEach((f, i) => this.osc(f, 0.09, 'sine', 0.18, i * 0.08)); }

  playKill(): void {
    this.osc(280, 0.07, 'square', 0.18);
    this.osc(420, 0.07, 'square', 0.14, 0.07);
    this.osc(560, 0.09, 'square', 0.1,  0.14);
  }

  playLineClear(count: number): void {
    if (count >= 4) {
      [300, 400, 600, 900].forEach((f, i) => this.osc(f, 0.14, 'square', 0.22, i * 0.07));
      this.noise(0.1, 0.15, 0.28);
    } else {
      this.osc(450, 0.09, 'sine', 0.25);
      this.osc(650, 0.09, 'sine', 0.2, 0.09);
      this.osc(850, 0.12, 'sine', 0.15, 0.18);
    }
  }

  playLevelUp(): void {
    [350, 440, 550, 700, 880].forEach((f, i) => this.osc(f, 0.1, 'sine', 0.22, i * 0.08));
  }

  playDescend(): void {
    this.osc(350, 0.12, 'sawtooth', 0.18);
    this.osc(250, 0.14, 'sawtooth', 0.14, 0.12);
    this.osc(160, 0.18, 'sawtooth', 0.1,  0.26);
  }

  playBossWarn(): void {
    this.osc(80, 0.6, 'sawtooth', 0.3);
    this.osc(160, 0.4, 'sawtooth', 0.2, 0.25);
    this.noise(0.15, 0.25, 0.6);
    this.osc(320, 0.2, 'square', 0.15, 0.8);
  }

  playDeath(): void {
    this.noise(0.2, 0.12);
    this.osc(260, 0.3, 'sawtooth', 0.28, 0.05);
    this.osc(180, 0.4, 'sawtooth', 0.22, 0.3);
    this.osc(100, 0.5, 'sawtooth', 0.16, 0.65);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}

export const audio = new AudioEngine();
