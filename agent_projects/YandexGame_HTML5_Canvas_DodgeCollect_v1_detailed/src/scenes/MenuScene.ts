import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import type { InputManager } from '../core/InputManager';
import { VW, VH } from '../core/CanvasHost';
import { load, save } from '../core/SaveManager';
import { Rect } from '../utils/Rect';
import { hitRect } from '../utils/HitTest';
import { t } from '../ui/i18n';
import { drawCenteredText, drawButton } from '../ui/draw';
import { audioManager } from '../core/AudioManager';
import { PlayScene } from './PlayScene';

/** Сцена меню: заголовок, кнопка Play, кнопка Sound ON/OFF. */
export class MenuScene implements Scene {
  private readonly sceneManager: SceneManager;
  private readonly inputManager: InputManager;
  private playRect: Rect;
  private soundRect: Rect;
  private soundOn = true;
  private unsubscribeTap: (() => void) | null = null;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    this.sceneManager = sceneManager;
    this.inputManager = inputManager;
    const cx = VW / 2;
    const playW = 200;
    const playH = 56;
    this.playRect = new Rect(cx - playW / 2, 420, playW, playH);

    const soundW = 180;
    const soundH = 44;
    this.soundRect = new Rect(cx - soundW / 2, 520, soundW, soundH);
  }

  enter(): void {
    const data = load();
    this.soundOn = data.soundEnabled;
    this.unsubscribeTap = this.inputManager.onTap((pos) => this.handleTap(pos));
  }

  exit(): void {
    if (this.unsubscribeTap) {
      this.unsubscribeTap();
      this.unsubscribeTap = null;
    }
  }

  private handleTap(pos: { x: number; y: number }): void {
    if (hitRect(this.playRect, pos.x, pos.y)) {
      audioManager.playClick();
      this.sceneManager.setScene(
        new PlayScene(this.sceneManager, this.inputManager)
      );
      return;
    }
    if (hitRect(this.soundRect, pos.x, pos.y)) {
      this.soundOn = !this.soundOn;
      save({ soundEnabled: this.soundOn });
      if (!audioManager.muted) audioManager.playClick();
    }
  }

  fixedUpdate(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D, _alpha: number, _fps?: number): void {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VW, VH);

    drawCenteredText(ctx, t('title'), VW / 2, 280, 48, 1, '#e0e0e0', true);
    drawButton(ctx, this.playRect, t('play'), true, true);
    drawButton(ctx, this.soundRect, this.soundOn ? t('sound_on') : t('sound_off'), true, false);
  }
}
