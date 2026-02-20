import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import type { InputManager } from '../core/InputManager';
import { VW, VH } from '../core/CanvasHost';
import { initYsdk } from '../yandex/ysdk';
import { setYsdk } from '../yandex/state';
import { MenuScene } from './MenuScene';

/** Сцена загрузки: инициализация SDK, затем переход в MenuScene. */
export class BootScene implements Scene {
  /** Фейковый прогресс 0..1 для отрисовки. */
  private progress = 0;
  private readonly sceneManager: SceneManager;
  private readonly inputManager: InputManager;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    this.sceneManager = sceneManager;
    this.inputManager = inputManager;
  }

  enter(): void | Promise<void> {
    return initYsdk().then((res) => {
      setYsdk(res.ok ? res.sdk : null);
      return this.sceneManager.setScene(
        new MenuScene(this.sceneManager, this.inputManager)
      );
    });
  }

  exit(): void {}

  fixedUpdate(dt: number): void {
    this.progress = Math.min(1, this.progress + dt * 2);
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number, _fps?: number): void {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VW, VH);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SDK...', VW / 2, VH / 2 - 40);
    ctx.textAlign = 'left';

    const barW = 320;
    const barH = 12;
    const x = (VW - barW) / 2;
    const y = VH / 2;
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barW, barH);
    ctx.fillStyle = '#6c5ce7';
    ctx.fillRect(x, y, barW * this.progress, barH);
  }
}
