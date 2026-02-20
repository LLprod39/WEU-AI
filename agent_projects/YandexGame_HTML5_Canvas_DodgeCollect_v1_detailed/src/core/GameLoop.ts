/** Max delta per frame (seconds) — защита от huge delta / spiral of death */
const MAX_DT = 0.25;

/** Фиксированный шаг симуляции (секунды). */
const FIXED_DT = 1 / 60;

/** Окно для усреднения FPS (секунды). */
const FPS_WINDOW = 0.5;

export interface GameLoopCallbacks {
  onFixedUpdate(dt: number): void;
  onRender(alpha: number, fps: number): void;
}

export class GameLoop {
  private callbacks: GameLoopCallbacks;
  private rafId: number | null = null;
  private lastTime: number = 0;
  private accumulator: number = 0;
  private running: boolean = false;
  /** Время последнего кадра для FPS. */
  private frameTimeHistory: number[] = [];

  constructor(callbacks: GameLoopCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.frameTimeHistory = [];
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private getFps(): number {
    if (this.frameTimeHistory.length < 2) return 0;
    const total = this.frameTimeHistory.reduce((a, b) => a + b, 0);
    return total > 0 ? Math.round(this.frameTimeHistory.length / total) : 0;
  }

  private tick(now: number): void {
    if (!this.running) return;

    const frameDt = (now - this.lastTime) / 1000;
    this.frameTimeHistory.push(frameDt);
    let total = this.frameTimeHistory.reduce((a, b) => a + b, 0);
    while (total > FPS_WINDOW && this.frameTimeHistory.length > 2) {
      this.frameTimeHistory.shift();
      total = this.frameTimeHistory.reduce((a, b) => a + b, 0);
    }

    let dt = frameDt;
    this.lastTime = now;

    dt = Math.min(dt, MAX_DT);
    this.accumulator += dt;

    while (this.accumulator >= FIXED_DT) {
      this.callbacks.onFixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    const alpha = this.accumulator / FIXED_DT;
    const fps = this.getFps();
    this.callbacks.onRender(alpha, fps);

    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }
}
