import {
  canvas,
  ctx,
  resize,
  applyLetterboxTransform,
} from './CanvasHost';
import { GameLoop } from './GameLoop';
import { SceneManager } from './SceneManager';
import { audioManager } from './AudioManager';
import { setHooks } from '../yandex/ads';

export class App {
  private readonly canvasHost = { canvas, ctx, resize, applyLetterboxTransform };
  private readonly sceneManager = new SceneManager();
  private readonly gameLoop: GameLoop;
  private paused = false;
  private soundEnabledBeforeAd = true;

  constructor() {
    this.gameLoop = new GameLoop({
      onFixedUpdate: (dt) => {
        if (!this.paused) {
          this.sceneManager.fixedUpdate(dt);
        }
      },
      onRender: (alpha) => {
        applyLetterboxTransform();
        this.sceneManager.render(ctx, alpha);
      },
    });

    document.addEventListener('visibilitychange', () => {
      this.setPaused(document.hidden);
    });

    setHooks({
      onAdOpen: () => {
        this.setPaused(true);
        this.soundEnabledBeforeAd = !audioManager.isMuted();
        audioManager.setMuted(true);
      },
      onAdClose: () => {
        this.setPaused(false);
        audioManager.setMuted(!this.soundEnabledBeforeAd);
      },
    });
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvasHost.canvas;
  }

  getSceneManager(): SceneManager {
    return this.sceneManager;
  }

  getGameLoop(): GameLoop {
    return this.gameLoop;
  }

  start(): void {
    this.gameLoop.start();
  }

  stop(): void {
    this.gameLoop.stop();
  }
}
