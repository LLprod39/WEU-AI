import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import { InputManager } from '../core/InputManager';
import { audioManager } from '../core/AudioManager';
import { load, save } from '../core/SaveManager';
import { VIRTUAL_W, VIRTUAL_H } from '../core/CanvasHost';
import { t } from '../ui/i18n';
import { GameScene } from './GameScene';
import { getApp } from '../core/AppInstance';
import {
  showInterstitial,
  canShowInterstitial,
  setLastInterstitialAt,
  isAdBlockingInput,
} from '../yandex/ads';
import { drawButton } from '../ui/draw';

function isUiInputBlocked(): boolean {
  return getApp().isPaused || isAdBlockingInput();
}

const TITLE_Y = 400;
const SCORE_Y = 480;
const RESTART_BUTTON = { x: VIRTUAL_W / 2 - 140, y: 560, w: 280, h: 72 };
const MENU_BUTTON = { x: VIRTUAL_W / 2 - 140, y: 660, w: 280, h: 72 };

function hitTest(
  px: number,
  py: number,
  r: { x: number; y: number; w: number; h: number }
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export class GameOverScene implements Scene {
  private readonly sceneManager: SceneManager;
  private readonly createMenuScene: () => Scene;
  private readonly finalScore: number;
  private bestScore: number = 0;
  private inputManager: InputManager | null = null;

  constructor(
    sceneManager: SceneManager,
    createMenuScene: () => Scene,
    finalScore: number
  ) {
    this.sceneManager = sceneManager;
    this.createMenuScene = createMenuScene;
    this.finalScore = finalScore;
  }

  enter(): void {
    audioManager.playGameOver();
    if (canShowInterstitial(90)) {
      showInterstitial('gameover')
        .then((result) => {
          if (result.ok) setLastInterstitialAt(Date.now());
        })
        .catch(() => {});
    }
    const data = load();
    this.bestScore = this.finalScore > data.bestScore ? this.finalScore : data.bestScore;
    save({
      lastBoard: null,
      lastScore: 0,
      bestScore: this.bestScore,
    });

    this.inputManager = new InputManager({
      onTap: (point) => {
        if (isUiInputBlocked()) return;
        if (hitTest(point.x, point.y, RESTART_BUTTON)) {
          audioManager.playClick();
          this.sceneManager.setScene(
            new GameScene(this.sceneManager, this.createMenuScene)
          );
        } else if (hitTest(point.x, point.y, MENU_BUTTON)) {
          audioManager.playClick();
          this.sceneManager.setScene(this.createMenuScene());
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
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    ctx.fillStyle = '#f65e3b';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('game_over'), VIRTUAL_W / 2, TITLE_Y);

    ctx.fillStyle = '#eee';
    ctx.font = '28px sans-serif';
    ctx.fillText(`${t('score')}: ${this.finalScore}`, VIRTUAL_W / 2, SCORE_Y);
    ctx.fillText(`${t('best')}: ${this.bestScore}`, VIRTUAL_W / 2, SCORE_Y + 44);

    const buttonsEnabled = !isUiInputBlocked();
    drawButton(ctx, RESTART_BUTTON, t('restart'), buttonsEnabled);
    drawButton(ctx, MENU_BUTTON, t('exit'), buttonsEnabled);
  }
}
