import { audioManager } from './AudioManager';
import { GameLoop } from './GameLoop';
import type { Scene } from './Scene';

/** Контракт менеджера сцен. */
export interface SceneManager {
  setScene(scene: Scene): Promise<void>;
  readonly currentScene: Scene | null;
  fixedUpdate(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number, fps?: number): void;
}

/** Тип для хоста канваса (getContext2D, resize и т.д.). */
export interface ICanvasHost {
  getContext2D(): CanvasRenderingContext2D | null;
  resize?(): void;
}

export interface AppOptions {
  canvasHost: ICanvasHost;
  gameLoop: GameLoop;
  sceneManager: SceneManager;
}

export class App {
  private readonly canvasHost: ICanvasHost;
  private readonly gameLoop: GameLoop;
  private readonly sceneManager: SceneManager;

  private _isPaused = false;

  constructor(options: AppOptions) {
    this.canvasHost = options.canvasHost;
    this.gameLoop = options.gameLoop;
    this.sceneManager = options.sceneManager;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.setPaused(document.hidden);
      });
    }
  }

  getCanvasHost(): ICanvasHost {
    return this.canvasHost;
  }

  getGameLoop(): GameLoop {
    return this.gameLoop;
  }

  getSceneManager(): SceneManager {
    return this.sceneManager;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
  }

  /** Вызывать при открытии рекламы: пауза + отключение звука. */
  onAdOpen(): void {
    this.setPaused(true);
    audioManager.mute(true);
  }

  /** Вызывать при закрытии рекламы: снятие паузы и восстановление звука по SaveManager.soundEnabled. */
  onAdClose(): void {
    this.setPaused(false);
    audioManager.mute(false);
  }
}
