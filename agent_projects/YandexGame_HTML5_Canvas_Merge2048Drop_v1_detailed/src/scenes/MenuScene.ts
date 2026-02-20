import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import { InputManager } from '../core/InputManager';
import { audioManager } from '../core/AudioManager';
import { VIRTUAL_W, VIRTUAL_H } from '../core/CanvasHost';
import { load, save } from '../core/SaveManager';
import { t } from '../ui/i18n';
import { getApp } from '../core/AppInstance';
import { drawButton } from '../ui/draw';
import { isAdBlockingInput } from '../yandex/ads';
import { GameScene } from './GameScene';

function isUiInputBlocked(): boolean {
  return getApp().isPaused || isAdBlockingInput();
}

const TITLE_Y = 280;
const PLAY_BUTTON = { x: VIRTUAL_W / 2 - 140, y: 480, w: 280, h: 72 };
const CONTINUE_BUTTON = { x: VIRTUAL_W / 2 - 140, y: 380, w: 280, h: 72 };
const SOUND_BUTTON = { x: VIRTUAL_W / 2 - 100, y: 620, w: 200, h: 56 };
const BEST_Y = 340;

function hitTest(px: number, py: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export class MenuScene implements Scene {
  private readonly sceneManager: SceneManager;
  private inputManager: InputManager | null = null;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
  }

  enter(): void {
    this.inputManager = new InputManager({
      onTap: (point) => {
        if (isUiInputBlocked()) return;
        const data = load();
        if (data.lastBoard != null && hitTest(point.x, point.y, CONTINUE_BUTTON)) {
          audioManager.playClick();
          this.sceneManager.setScene(
            new GameScene(this.sceneManager, () => new MenuScene(this.sceneManager), true)
          );
          return;
        }
        if (hitTest(point.x, point.y, PLAY_BUTTON)) {
          audioManager.playClick();
          this.sceneManager.setScene(
            new GameScene(this.sceneManager, () => new MenuScene(this.sceneManager))
          );
          return;
        }
        if (hitTest(point.x, point.y, SOUND_BUTTON)) {
          audioManager.playClick();
          const data = load();
          save({ soundEnabled: !data.soundEnabled });
          return;
        }
      },
    });
  }

  exit(): void {
    this.inputManager?.destroy();
    this.inputManager = null;
  }

  fixedUpdate(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D, _alpha: number): void {
    const data = load();

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    ctx.fillStyle = '#eee';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('title'), VIRTUAL_W / 2, TITLE_Y);

    ctx.font = '28px sans-serif';
    ctx.fillText(`${t('best')}: ${data.bestScore}`, VIRTUAL_W / 2, BEST_Y);

    const buttonsEnabled = !isUiInputBlocked();
    if (data.lastBoard != null) {
      drawButton(ctx, CONTINUE_BUTTON, t('continue'), buttonsEnabled);
    }
    drawButton(ctx, PLAY_BUTTON, t('play'), buttonsEnabled);
    drawButton(ctx, SOUND_BUTTON, data.soundEnabled ? t('sound_on') : t('sound_off'), buttonsEnabled);
  }
}
