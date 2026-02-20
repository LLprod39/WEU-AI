import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import { VIRTUAL_W, VIRTUAL_H } from '../core/CanvasHost';
import { t } from '../ui/i18n';
import { setYsdk } from '../yandex/state';
import { initYsdk } from '../yandex/ysdk';
import { MenuScene } from './MenuScene';

const BOOT_DELAY_MS = 400;

export class BootScene implements Scene {
  private readonly sceneManager: SceneManager;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
  }

  async enter(): Promise<void> {
    try {
      const ysdk = await initYsdk();
      setYsdk(ysdk);
    } catch {
      setYsdk(null);
    }
    await new Promise((resolve) => setTimeout(resolve, BOOT_DELAY_MS));
    await this.sceneManager.setScene(new MenuScene(this.sceneManager));
  }

  exit(): void {}

  fixedUpdate(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D, _alpha: number): void {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    ctx.font = '48px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(t('loading'), VIRTUAL_W / 2, VIRTUAL_H / 2 - 24);
  }
}
