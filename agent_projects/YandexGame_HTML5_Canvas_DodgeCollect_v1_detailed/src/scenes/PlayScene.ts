import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import type { InputManager } from '../core/InputManager';
import { VW, VH } from '../core/CanvasHost';
import { clamp } from '../utils/Math';
import { GameState } from '../game/GameState';
import { Player } from '../game/Player';
import { FallingObject } from '../game/FallingObject';
import { Spawner } from '../game/Spawner';
import { Particles } from '../game/Particles';
import { ObjectPool } from '../utils/ObjectPool';
import { Rect } from '../utils/Rect';
import { hitRect } from '../utils/HitTest';
import { circleIntersects } from '../utils/Collision';
import { t } from '../ui/i18n';
import { drawCenteredText, drawButton } from '../ui/draw';
import { audioManager } from '../core/AudioManager';
import { load, save } from '../core/SaveManager';
import { DEBUG } from '../core/config';
import { showRewarded } from '../yandex/ads';
import { ResultScene } from './ResultScene';
import { MenuScene } from './MenuScene';

export type PlaySceneMode = 'playing' | 'paused' | 'continue' | 'ending';

/** Границы зоны движения игрока (совпадают с Player). */
const ZONE_X_MIN = 0;
const ZONE_X_MAX = VW;
const ZONE_Y_MIN = 900;
const ZONE_Y_MAX = 1220;

const PLAYER_RADIUS = 32;
const POOL_INITIAL_SIZE = 32;
/** Лимит активных объектов: при достижении Spawner пропускает спавн до следующего тика (сохранение FPS). */
const ACTIVE_OBJECTS_LIMIT = 40;

const HUD_PAD = 24;
const HUD_Y = 48;
const PAUSE_BTN_W = 56;
const PAUSE_BTN_H = 36;
const PAUSE_RECT = new Rect(VW - HUD_PAD - PAUSE_BTN_W, HUD_Y + 4, PAUSE_BTN_W, PAUSE_BTN_H);

const PAUSED_BTN_W = 200;
const PAUSED_BTN_H = 48;
const PAUSED_BTN_GAP = 12;
const PAUSED_CENTER_Y = VH / 2 + 20;
const RESUME_RECT = new Rect(VW / 2 - PAUSED_BTN_W / 2, PAUSED_CENTER_Y - PAUSED_BTN_H - PAUSED_BTN_GAP, PAUSED_BTN_W, PAUSED_BTN_H);
const RESTART_RECT = new Rect(VW / 2 - PAUSED_BTN_W / 2, PAUSED_CENTER_Y, PAUSED_BTN_W, PAUSED_BTN_H);
const EXIT_RECT = new Rect(VW / 2 - PAUSED_BTN_W / 2, PAUSED_CENTER_Y + PAUSED_BTN_H + PAUSED_BTN_GAP, PAUSED_BTN_W, PAUSED_BTN_H);

const CONTINUE_BTN_W = 160;
const CONTINUE_BTN_H = 44;
const CONTINUE_BTN_GAP = 8;
const WATCH_AD_RECT = new Rect(VW / 2 - CONTINUE_BTN_W - CONTINUE_BTN_GAP / 2, VH / 2 + 48, CONTINUE_BTN_W, CONTINUE_BTN_H);
const NO_THANKS_RECT = new Rect(VW / 2 + CONTINUE_BTN_GAP / 2, VH / 2 + 48, CONTINUE_BTN_W, CONTINUE_BTN_H);

const CONTINUE_PANEL_W = 380;
const CONTINUE_PANEL_H = 200;
const CONTINUE_PANEL_RECT = new Rect((VW - CONTINUE_PANEL_W) / 2, (VH - CONTINUE_PANEL_H) / 2, CONTINUE_PANEL_W, CONTINUE_PANEL_H);

const COIN_SCORE = 10;
const BURST_COUNT = 12;
const SCREEN_FLASH_DURATION = 0.15;
const INVULNERABILITY_DURATION = 0.5;
/** Иммунитет после продолжения за рекламу (сек). */
const CONTINUE_INVULNERABILITY_DURATION = 1;

export class PlayScene implements Scene {
  private readonly sceneManager: SceneManager;
  private readonly inputManager: InputManager;

  private state: GameState;
  private player: Player | null = null;
  private pool: ObjectPool<FallingObject> | null = null;
  private activeObjects: FallingObject[] = [];
  private spawner: Spawner | null = null;
  private particles: Particles | null = null;

  /** State machine: playing | paused | continue (lives=0, offer continue) | ending (go to Result). */
  private mode: PlaySceneMode = 'playing';
  private unsubTap: (() => void) | null = null;
  /** Ожидание ответа от showRewarded — блокирует повторный клик по Watch Ad. */
  private watchAdPending = false;
  /** Красная вспышка экрана (сек). */
  private screenFlashRemaining = 0;
  /** Неуязвимость после удара шипом (сек). */
  private invulnerabilityRemaining = 0;
  /** Вспышка урона 0..1, затухает со временем. */
  private damageFlash = 0;
  /** Показывать подсказку "Drag to move" (первый запуск). */
  private tutorialHintVisible = false;
  /** Оставшееся время показа подсказки (сек). */
  private tutorialHintTimer = 0;
  /** Best из SaveManager (загружается при enter, не обновляется в процессе). */
  private bestScore = 0;

  constructor(
    sceneManager: SceneManager,
    inputManager: InputManager
  ) {
    this.sceneManager = sceneManager;
    this.inputManager = inputManager;
    this.state = new GameState();
  }

  enter(): void {
    this.mode = 'playing';
    this.watchAdPending = false;
    this.screenFlashRemaining = 0;
    this.invulnerabilityRemaining = 0;
    this.damageFlash = 0;
    this.state.reset();

    this.player = new Player(
      VW / 2,
      (ZONE_Y_MIN + ZONE_Y_MAX) / 2,
      PLAYER_RADIUS
    );

    this.pool = new ObjectPool<FallingObject>(
      () => new FallingObject(),
      POOL_INITIAL_SIZE
    );
    this.activeObjects = [];

    this.spawner = new Spawner(
      this.pool,
      (obj) => this.activeObjects.push(obj),
      () => this.activeObjects.length,
      ACTIVE_OBJECTS_LIMIT
    );

    this.particles = new Particles(64);

    const saved = load();
    this.bestScore = saved.bestScore;
    if (!saved.tutorialShown) {
      this.tutorialHintVisible = true;
      this.tutorialHintTimer = 2;
    } else {
      this.tutorialHintVisible = false;
    }

    this.inputManager.onDragMove((pos) => {
      if (this.mode !== 'playing' || !this.player) return;
      if (this.tutorialHintVisible) {
        save({ tutorialShown: true });
        this.tutorialHintVisible = false;
      }
      const x = clamp(pos.x, ZONE_X_MIN, ZONE_X_MAX);
      const y = clamp(pos.y, ZONE_Y_MIN, ZONE_Y_MAX);
      this.player.setTarget(x, y);
    });

    this.unsubTap = this.inputManager.onTap((pos) => {
      if (this.mode === 'ending') return;
      if (this.mode === 'continue') {
        if (hitRect(WATCH_AD_RECT, pos.x, pos.y)) {
          if (this.watchAdPending) return;
          this.watchAdPending = true;
          showRewarded('second_chance')
            .then((res) => {
              if (res.ok && res.rewarded) {
                this.state.usedContinue = true;
                this.state.lives = 1;
                this.mode = 'playing';
                this.invulnerabilityRemaining = CONTINUE_INVULNERABILITY_DURATION;
              } else {
                this.mode = 'ending';
              }
            })
            .catch(() => {
              this.mode = 'ending';
            })
            .finally(() => {
              this.watchAdPending = false;
            });
        } else if (hitRect(NO_THANKS_RECT, pos.x, pos.y)) {
          this.sceneManager.setScene(
            new ResultScene(this.sceneManager, this.inputManager, this.state.score)
          );
        }
        return;
      }
      if (this.mode === 'paused') {
        if (hitRect(RESUME_RECT, pos.x, pos.y) || hitRect(PAUSE_RECT, pos.x, pos.y)) {
          this.mode = 'playing';
        } else if (hitRect(RESTART_RECT, pos.x, pos.y)) {
          this.sceneManager.setScene(new PlayScene(this.sceneManager, this.inputManager));
        } else if (hitRect(EXIT_RECT, pos.x, pos.y)) {
          this.sceneManager.setScene(new MenuScene(this.sceneManager, this.inputManager));
        }
        return;
      }
      if (hitRect(PAUSE_RECT, pos.x, pos.y)) {
        if (this.mode === 'playing') this.mode = 'paused';
      }
    });
  }

  exit(): void {
    this.mode = 'playing';
    this.watchAdPending = false;
    this.unsubTap?.();
    this.unsubTap = null;
    this.player = null;
    this.pool = null;
    this.activeObjects = [];
    this.spawner = null;
    this.particles = null;
  }

  fixedUpdate(dt: number): void {
    // В режимах continue/ending не обновляем игру (заморозка); в paused — тоже стоп
    if (this.mode !== 'playing') {
      if (this.mode === 'ending') {
        this.sceneManager.setScene(
          new ResultScene(this.sceneManager, this.inputManager, this.state.score)
        );
      }
      return;
    }

    this.screenFlashRemaining = Math.max(0, this.screenFlashRemaining - dt);
    this.invulnerabilityRemaining = Math.max(0, this.invulnerabilityRemaining - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);

    if (this.mode === 'playing' && this.tutorialHintVisible && this.tutorialHintTimer > 0) {
      this.tutorialHintTimer -= dt;
      if (this.tutorialHintTimer <= 0) this.tutorialHintVisible = false;
    }

    this.state.time += dt;
    this.state.difficulty = Math.floor(this.state.time / 15);

    if (this.player) this.player.update(dt);
    if (this.spawner) this.spawner.update(dt, this.state.difficulty);

    for (let i = this.activeObjects.length - 1; i >= 0; i--) {
      const obj = this.activeObjects[i];
      obj.update(dt);
      if (!obj.active && this.pool) {
        this.pool.release(obj);
        this.activeObjects.splice(i, 1);
      }
    }

    // Коллизии каждого active объекта с игроком
    if (this.player) {
      const px = this.player.x;
      const py = this.player.y;
      const pr = this.player.radius;
      for (const obj of this.activeObjects) {
        if (!obj.active) continue;
        if (!circleIntersects(px, py, pr, obj.x, obj.y, obj.radius)) continue;
        if (obj.type === 'coin') {
          this.state.score += COIN_SCORE;
          obj.active = false;
          audioManager.playCoin();
          if (this.particles) this.particles.emitBurst(obj.x, obj.y, BURST_COUNT);
        } else if (obj.type === 'spike') {
          if (this.invulnerabilityRemaining <= 0) {
            this.state.lives--;
            this.screenFlashRemaining = SCREEN_FLASH_DURATION;
            this.invulnerabilityRemaining = INVULNERABILITY_DURATION;
            this.damageFlash = 1;
            audioManager.playHit();
          }
          obj.active = false;
        }
      }
    }

    // При lives==0: continue (заморозка) или ending (переход в ResultScene)
    if (this.state.lives <= 0) {
      if (!this.state.usedContinue) {
        this.mode = 'continue';
      } else {
        this.mode = 'ending';
      }
    }

    // Удаление объектов, помеченных deactivate в коллизиях
    for (let i = this.activeObjects.length - 1; i >= 0; i--) {
      const obj = this.activeObjects[i];
      if (!obj.active && this.pool) {
        this.pool.release(obj);
        this.activeObjects.splice(i, 1);
      }
    }

    if (this.particles) this.particles.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number, fps?: number): void {
    // Фон
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, VW, VH);

    // Объекты
    for (const obj of this.activeObjects) {
      obj.render(ctx);
    }

    // Игрок
    if (this.player) this.player.render(ctx);

    // Частицы
    if (this.particles) this.particles.render(ctx);

    // HUD: Score слева, Time по центру, Lives справа, Best под Score (из SaveManager, не обновляется в процессе)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '22px sans-serif';

    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${this.state.score}`, HUD_PAD, HUD_Y);
    ctx.font = '18px sans-serif';
    ctx.fillText(`${t('best')}: ${this.bestScore}`, HUD_PAD, HUD_Y + 26);
    ctx.font = '22px sans-serif';

    ctx.textAlign = 'center';
    ctx.fillText(`Time: ${Math.floor(this.state.time)}s`, VW / 2, HUD_Y);

    ctx.textAlign = 'right';
    ctx.fillText(`Lives: ${this.state.lives}`, VW - HUD_PAD - PAUSE_BTN_W - 8, HUD_Y);

    const isPaused = this.mode === 'paused';
    drawButton(ctx, PAUSE_RECT, isPaused ? t('resume') : t('pause'), true, isPaused, 16);

    if (this.tutorialHintVisible && this.mode === 'playing') {
      drawCenteredText(ctx, t('drag_to_move'), VW / 2, VH / 2, 28, 1, '#b0b0c0');
    }

    // Красная вспышка при ударе шипом
    if (this.screenFlashRemaining > 0) {
      const alpha = Math.min(1, this.screenFlashRemaining / SCREEN_FLASH_DURATION);
      ctx.fillStyle = `rgba(200,0,0,${alpha * 0.6})`;
      ctx.fillRect(0, 0, VW, VH);
    }

    // Вспышка урона (поверх всего, затухает)
    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255,0,0,${this.damageFlash * 0.35})`;
      ctx.fillRect(0, 0, VW, VH);
    }

    if (this.mode === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VW, VH);
      drawCenteredText(ctx, 'PAUSED', VW / 2, PAUSED_CENTER_Y - 120, 48, 1, '#fff');
      drawButton(ctx, RESUME_RECT, t('resume'), true, true);
      drawButton(ctx, RESTART_RECT, t('restart'), true, true);
      drawButton(ctx, EXIT_RECT, t('exit'), true, false);
    }

    if (this.mode === 'continue') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = '#2a2a3a';
      ctx.fillRect(CONTINUE_PANEL_RECT.x, CONTINUE_PANEL_RECT.y, CONTINUE_PANEL_RECT.w, CONTINUE_PANEL_RECT.h);
      ctx.strokeStyle = '#4a4a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(CONTINUE_PANEL_RECT.x, CONTINUE_PANEL_RECT.y, CONTINUE_PANEL_RECT.w, CONTINUE_PANEL_RECT.h);
      drawCenteredText(ctx, t('continue'), VW / 2, CONTINUE_PANEL_RECT.y + 50, 36, 1, '#fff');
      drawButton(ctx, WATCH_AD_RECT, t('watch_ad'), !this.watchAdPending, true);
      drawButton(ctx, NO_THANKS_RECT, t('no_thanks'), true, false);
    }

    if (DEBUG && typeof fps === 'number') {
      ctx.fillStyle = 'rgba(200,200,200,0.8)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`FPS: ${fps}`, VW - 8, VH - 8);
    }
  }
}
