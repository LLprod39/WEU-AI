import { load } from './SaveManager';

/**
 * Звуки через Web Audio API: осциллятор + огибающая громкости (короткие бипы без ассетов).
 * Звук не воспроизводится до первого пользовательского взаимодействия — вызовите unlock() при pointerdown.
 * Mute привязан к SaveManager.soundEnabled.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  /** Временное отключение звука (например, при рекламе), не меняет SaveManager. */
  private _forceMuted = false;

  /**
   * Вызвать при первом pointerdown (или другом user gesture), чтобы разблокировать воспроизведение.
   * Создаёт AudioContext при необходимости и возобновляет его, если приостановлен.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!this.ctx) {
      const Ctor =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private getContext(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private shouldPlay(): boolean {
    if (this._forceMuted) return false;
    const data = load();
    return typeof data.soundEnabled === 'boolean' ? data.soundEnabled : true;
  }

  /** Временно отключить/включить звук (не меняет SaveManager). При false снова учитывается SaveManager.soundEnabled. */
  mute(forceMuted: boolean): void {
    this._forceMuted = forceMuted;
  }

  /**
   * Воспроизвести короткий бип с заданной частотой и длительностью (огибающая: быстрый attack, decay).
   */
  private beep(frequencyHz: number, durationSec: number, type: OscillatorType = 'sine'): void {
    if (!this.unlocked) return;
    if (!this.shouldPlay()) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequencyHz, now);
    osc.connect(gain);
    gain.connect(ctx.destination);

    const attack = 0.01;
    const decay = Math.max(0.02, durationSec - attack);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    osc.start(now);
    osc.stop(now + attack + decay);
  }

  /** Короткий клик (UI). Не бросает исключений, если audio ещё не unlocked. */
  playClick(): void {
    try {
      this.beep(520, 0.06, 'sine');
    } catch {
      // игнорируем при незаблокированном audio
    }
  }

  /** Сбор монеты / бонус. Не бросает исключений, если audio ещё не unlocked. */
  playCoin(): void {
    try {
      this.beep(880, 0.08, 'sine');
    } catch {
      // игнорируем при незаблокированном audio
    }
  }

  /** Удар / попадание по игроку. Не бросает исключений, если audio ещё не unlocked. */
  playHit(): void {
    try {
      this.beep(180, 0.1, 'square');
    } catch {
      // игнорируем при незаблокированном audio
    }
  }

  /** Проверка: включён ли звук по настройкам (SaveManager.soundEnabled). */
  get soundEnabled(): boolean {
    return this.shouldPlay();
  }

  /** Mute: не меняет SaveManager, только проверка при воспроизведении идёт через load(). Для переключения используйте SaveManager.save({ soundEnabled }). */
  get muted(): boolean {
    return !this.shouldPlay();
  }
}

/** Общий экземпляр для использования в сценах (playClick, playCoin, playHit). В main при первом pointerdown вызывается audioManager.unlock(). */
export const audioManager = new AudioManager();
