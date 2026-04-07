type ToneConfig = {
  type?: OscillatorType;
  frequency: number;
  durationMs: number;
  gain?: number;
  attackMs?: number;
  releaseMs?: number;
  slideTo?: number;
};

export class UiSfx {
  private ctx: AudioContext | null = null;
  private isDragActive = false;
  private lastDragPulseAt = 0;

  private getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  async resume(): Promise<void> {
    const ctx = this.getCtx();
    if (!ctx) return;
    if (ctx.state !== "running") {
      await ctx.resume();
    }
  }

  private tone(cfg: ToneConfig): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    if (ctx.state !== "running") {
      void ctx.resume().then(() => {
        this.tone(cfg);
      });
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const attack = (cfg.attackMs ?? 6) / 1000;
    const release =
      (cfg.releaseMs ?? Math.max(30, cfg.durationMs * 0.75)) / 1000;
    const total = cfg.durationMs / 1000;
    const peak = cfg.gain ?? 0.04;

    osc.type = cfg.type ?? "triangle";
    osc.frequency.setValueAtTime(cfg.frequency, now);
    if (typeof cfg.slideTo === "number") {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, cfg.slideTo),
        now + total,
      );
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + total + 0.03);
  }

  playTap(): void {
    this.tone({
      frequency: 520,
      slideTo: 640,
      durationMs: 70,
      gain: 0.03,
      type: "triangle",
    });
  }

  playConfirm(): void {
    this.tone({
      frequency: 392,
      durationMs: 90,
      gain: 0.032,
      type: "triangle",
    });
    setTimeout(() => {
      this.tone({ frequency: 523, durationMs: 110, gain: 0.03, type: "sine" });
    }, 60);
  }

  playReveal(): void {
    this.tone({
      frequency: 300,
      slideTo: 760,
      durationMs: 260,
      gain: 0.028,
      type: "sawtooth",
      attackMs: 8,
      releaseMs: 220,
    });
    setTimeout(() => {
      this.tone({ frequency: 880, durationMs: 120, gain: 0.02, type: "sine" });
    }, 120);
  }

  playError(): void {
    this.tone({
      frequency: 320,
      slideTo: 220,
      durationMs: 180,
      gain: 0.03,
      type: "square",
      attackMs: 4,
      releaseMs: 140,
    });
  }

  playHover(): void {
    this.tone({
      frequency: 660,
      slideTo: 760,
      durationMs: 56,
      gain: 0.036,
      type: "sine",
      attackMs: 4,
      releaseMs: 44,
    });
  }

  playDragScrub(speed = 0.5): void {
    const clamped = Math.max(0, Math.min(1, speed));
    const base = 420 + clamped * 210;
    this.tone({
      frequency: base,
      slideTo: base * 0.82,
      durationMs: 42,
      gain: 0.042 + clamped * 0.024,
      type: "sine",
      attackMs: 2,
      releaseMs: 36,
    });
  }

  startDragLoop(): void {
    this.isDragActive = true;
    this.lastDragPulseAt = 0;
  }

  updateDragLoop(speed = 0.5): void {
    if (!this.isDragActive) return;
    const clamped = Math.max(0, Math.min(1, speed));
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const intervalMs = 52 - clamped * 20;

    if (now - this.lastDragPulseAt < intervalMs) return;
    this.lastDragPulseAt = now;
    this.playDragScrub(clamped);
  }

  stopDragLoop(): void {
    this.isDragActive = false;
    this.lastDragPulseAt = 0;
  }
}
