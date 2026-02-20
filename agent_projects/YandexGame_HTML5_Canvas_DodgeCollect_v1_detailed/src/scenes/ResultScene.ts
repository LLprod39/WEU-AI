import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import type { InputManager } from '../core/InputManager';
import { VW, VH } from '../core/CanvasHost';
import { load, save } from '../core/SaveManager';
import { Rect } from '../utils/Rect';
import { hitRect } from '../utils/HitTest';
import { drawCenteredText, drawButton } from '../ui/draw';
import { PlayScene } from './PlayScene';
import { MenuScene } from './MenuScene';
import { showInterstitial } from '../yandex/ads';

const BTN_W = 200;
const BTN_H = 52;
const PLAY_AGAIN_RECT = new Rect(VW / 2 - BTN_W / 2, 380, BTN_W, BTN_H);
const EXIT_RECT = new Rect(VW / 2 - BTN_W / 2, 450, BTN_W, BTN_H);

/** Сцена результатов: score, bestScore (SaveManager), кнопки Play Again и Exit. */
export class ResultScene implements Scene {
  private readonly sceneManager: SceneManager;
  private readonly inputManager: InputManager;
  private readonly finalScore: number;
  private unsubTap: (() => void) | null = null;
  private bestScore = 0;

  constructor(
    sceneManager: SceneManager,
    inputManager: InputManager,
    finalScore: number
  ) {
    this.sceneManager = sceneManager;
    this.inputManager = inputManager;
    this.finalScore = finalScore;
  }

  enter(): void {
    showInterstitial('after_round', 90).catch(() => {});
    const data = load();
    this.bestScore = data.bestScore;
    if (this.finalScore > this.bestScore) {
      this.bestScore = this.finalScore;
      save({ bestScore: this.finalScore });
    }

    this.unsubTap = this.inputManager.onTap((pos) => {
      if (hitRect(PLAY_AGAIN_RECT, pos.x, pos.y)) {
        this.sceneManager.setScene(
          new PlayScene(this.sceneManager, this.inputManager)
        );
        return;
      }
      if (hitRect(EXIT_RECT, pos.x, pos.y)) {
        this.sceneManager.setScene(
          new MenuScene(this.sceneManager, this.inputManager)
        );
      }
    });
  }

  exit(): void {
    this.unsubTap?.();
    this.unsubTap = null;
  }

  fixedUpdate(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D, _alpha: number, _fps?: number): void {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VW, VH);

    drawCenteredText(ctx, 'Game Over', VW / 2, 220, 40, 1, '#e0e0e0', true);
    drawCenteredText(ctx, `Score: ${this.finalScore}`, VW / 2, 300, 24, 1);
    drawCenteredText(ctx, `Best: ${this.bestScore}`, VW / 2, 340, 24, 1);
    drawButton(ctx, PLAY_AGAIN_RECT, 'Play Again', true, true);
    drawButton(ctx, EXIT_RECT, 'Exit', true, false);
  }
}
