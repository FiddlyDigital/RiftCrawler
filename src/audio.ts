export class AudioEngine {
  private ctx: AudioContext | null = null;
  enabled = true;

  private ambientOscs: OscillatorNode[] = [];
  private ambientGain: GainNode | null = null;

  // All output routes through one master gain so a single volume setting
  // scales every effect and the ambient bed together.
  private master: GainNode | null = null;
  private volume = 1;

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private masterNode(ctx: AudioContext): GainNode {
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
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
    g.connect(this.masterNode(ctx));
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
    g.connect(this.masterNode(ctx));
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

  playTeleport(): void {
    this.osc(180, 0.28, 'sine', 0.20, 0, 900);
    this.noise(0.06, 0.10, 0.22);
  }

  // Warm two-note hail — a friendly stranger noticing you.
  playNpcGreeting(): void {
    this.osc(440, 0.12, 'sine', 0.16);
    this.osc(550, 0.14, 'sine', 0.14, 0.11);
    this.osc(660, 0.18, 'sine', 0.10, 0.22);
  }

  // Eerie, hollow descent — detuned sines sliding down with a cold hiss.
  playGhost(): void {
    this.osc(620, 0.9, 'sine', 0.12, 0, 210);
    this.osc(624, 0.9, 'sine', 0.10, 0.05, 205);
    this.osc(311, 0.5, 'triangle', 0.08, 0.35, 155);
    this.noise(0.5, 0.05, 0.15);
  }

  // Triumphant oath-fulfilled fanfare — brighter than a plain perk.
  playBountyFulfilled(): void {
    [392, 494, 587, 784].forEach((f, i) => this.osc(f, 0.13, 'square', 0.14, i * 0.09));
    this.osc(988, 0.22, 'sine', 0.12, 0.36);
    this.noise(0.08, 0.08, 0.36);
  }

  // Low solemn chord swelling into a bright overtone — an oath made binding.
  playPactSworn(): void {
    this.osc(110, 0.8, 'triangle', 0.20);
    this.osc(165, 0.8, 'triangle', 0.16, 0.05);
    this.osc(220, 0.6, 'sine', 0.14, 0.3);
    this.osc(440, 0.5, 'sine', 0.10, 0.55);
    this.osc(880, 0.35, 'sine', 0.07, 0.8);
  }

  playComboMilestone(mult: number): void {
    const freqs = mult >= 5 ? [300, 420, 560, 750, 1000] : [300, 420, 560, 750];
    freqs.forEach((f, i) => this.osc(f, 0.09, 'square', 0.16, i * 0.07));
    this.noise(0.08, 0.12, freqs.length * 0.07);
  }

  startAmbient(): void {
    const ctx = this.getCtx();
    if (!ctx || this.ambientOscs.length > 0) return;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 3.0);
    master.connect(this.masterNode(ctx));
    this.ambientGain = master;

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(55, ctx.currentTime);
    o1.connect(master);
    o1.start();

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(82.5, ctx.currentTime);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o2.connect(g2);
    g2.connect(master);
    o2.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    lfoGain.connect(o1.frequency);
    lfo.start();

    this.ambientOscs = [o1, o2, lfo];
  }

  stopAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambientGain) return;
    this.ambientGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    const gain = this.ambientGain;
    const oscs = this.ambientOscs;
    setTimeout(() => {
      oscs.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
      gain.disconnect();
    }, 1600);
    this.ambientOscs = [];
    this.ambientGain = null;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.startAmbient();
    } else {
      this.stopAmbient();
    }
    return this.enabled;
  }
}

export const audio = new AudioEngine();
