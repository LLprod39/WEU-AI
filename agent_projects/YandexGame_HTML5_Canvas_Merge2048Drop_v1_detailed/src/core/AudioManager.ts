import { load, save } from './SaveManager';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  isMuted(): boolean {
    return !load().soundEnabled;
  }

  setMuted(muted: boolean): void {
    save({ soundEnabled: !muted });
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    envelope: { attack: number; decay: number; peak: number }
  ): void {
    if (this.isMuted()) return;
    if (!this.ctx || this.ctx.state === 'suspended') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(envelope.peak, now + envelope.attack);
      gain.gain.linearRampToValueAtTime(0, now + envelope.attack + envelope.decay);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // audio not unlocked or context invalid — do not break
    }
  }

  playClick(): void {
    this.playTone(640, 0.06, 'sine', { attack: 0.01, decay: 0.05, peak: 0.15 });
  }

  playDrop(): void {
    this.playTone(180, 0.12, 'sine', { attack: 0.01, decay: 0.11, peak: 0.2 });
  }

  playMerge(): void {
    this.playTone(440, 0.14, 'sine', { attack: 0.02, decay: 0.12, peak: 0.18 });
  }

  playGameOver(): void {
    if (this.isMuted()) return;
    if (!this.ctx || this.ctx.state === 'suspended') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sine';
      const f1 = 392;
      const f2 = 330;
      const t1 = 0.15;
      const t2 = 0.3;
      osc.frequency.setValueAtTime(f1, now);
      osc.frequency.setValueAtTime(f2, now + t1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
      gain.gain.setValueAtTime(0.2, now + t1 - 0.02);
      gain.gain.linearRampToValueAtTime(0, now + t2);
      osc.start(now);
      osc.stop(now + t2);
    } catch {
      // audio not unlocked or context invalid — do not break
    }
  }
}

export const audioManager = new AudioManager();
