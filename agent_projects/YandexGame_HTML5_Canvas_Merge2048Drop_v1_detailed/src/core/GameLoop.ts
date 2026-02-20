/** Фиксированный шаг симуляции (секунды). */
const FIXED_DT = 1 / 60;

/** Максимальный delta за один кадр (защита от "spiral of death"). */
const MAX_DELTA = 0.1;

export interface GameLoopCallbacks {
  onFixedUpdate: (dt: number) => void;
  onRender: (alpha: number) => void;
}

export class GameLoop {
  private rafId: number | null = null;
  private lastTime: number = 0;
  private accumulator: number = 0;
  private readonly callbacks: GameLoopCallbacks;
  private readonly fixedDt: number;

  constructor(callbacks: GameLoopCallbacks, fixedDt: number = FIXED_DT) {
    this.callbacks = callbacks;
    this.fixedDt = fixedDt;
  }

  start(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.tick();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);

    const now = performance.now();
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    delta = Math.min(delta, MAX_DELTA);
    this.accumulator += delta;

    while (this.accumulator >= this.fixedDt) {
      this.callbacks.onFixedUpdate(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }

    const alpha = this.accumulator / this.fixedDt;
    this.callbacks.onRender(alpha);
  };
}
