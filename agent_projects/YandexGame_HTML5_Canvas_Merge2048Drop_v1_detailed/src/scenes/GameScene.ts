import type { Scene } from '../core/Scene';
import type { SceneManager } from '../core/SceneManager';
import { InputManager } from '../core/InputManager';
import { audioManager } from '../core/AudioManager';
import { VIRTUAL_W, VIRTUAL_H } from '../core/CanvasHost';
import { load, save } from '../core/SaveManager';
import { Board } from '../game/Board';
import { GameState } from '../game/GameState';
import { cellToWorld, worldToCell } from '../game/GridMapper';
import { TileDropper } from '../game/TileDropper';
import { rollNextValue } from '../game/NextTile';
import { applyCascade } from '../game/Cascade';
import { applyGravity } from '../game/Gravity';
import { GameOverScene } from './GameOverScene';
import {
  GRID_ROWS,
  GRID_COLS,
  GRID_X,
  GRID_Y,
  CELL_SIZE,
  GAP,
} from '../game/constants';
import { drawButton } from '../ui/draw';
import { t } from '../ui/i18n';
import { getApp } from '../core/AppInstance';
import { showRewarded, isAdBlockingInput } from '../yandex/ads';

function isUiInputBlocked(): boolean {
  return getApp().isPaused || isAdBlockingInput();
}

/** Радиус скругления для рамки, клеток и плиток. */
const ROUND = 8;

/** Длительность затухания вспышки при merge (сек). */
const FLASH_DURATION = 0.2;

/** Цвета плиток по value (2..2048). */
const TILE_COLORS: Record<number, string> = {
  2: '#eee4da',
  4: '#ede0c8',
  8: '#f2b179',
  16: '#f59563',
  32: '#f67c5f',
  64: '#f65e3b',
  128: '#edcf72',
  256: '#edcc61',
  512: '#edc850',
  1024: '#edc53f',
  2048: '#edc22e',
};
const DEFAULT_TILE_COLOR = '#3c3a32';

/** Таблица стилей плиток: value -> { bg, text } (без создания объектов в render). */
const TILE_STYLES: Record<number, { bg: string; text: string }> = {};
for (const k of Object.keys(TILE_COLORS)) {
  const value = Number(k);
  TILE_STYLES[value] = {
    bg: TILE_COLORS[value],
    text: value >= 8 ? '#f9f6f2' : '#776e65',
  };
}
const DEFAULT_TILE_STYLE: { bg: string; text: string } = {
  bg: DEFAULT_TILE_COLOR,
  text: '#776e65',
};

/** Предрасчитанные строки для значений плиток (не создавать строки в render). */
const VALUE_STRINGS: Record<number, string> = {};
for (let v = 2; v <= 2048; v *= 2) VALUE_STRINGS[v] = String(v);

/** Предрасчитанные координаты клеток cellPos[r][c] = { x, y }. */
const cellPos: { x: number; y: number }[][] = (() => {
  const grid: { x: number; y: number }[][] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      grid[r][c] = cellToWorld(r, c);
    }
  }
  return grid;
})();

/** Рисует скруглённый прямоугольник (имитация через path). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (r <= 0) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  const r2 = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r2, y);
  ctx.lineTo(x + w - r2, y);
  ctx.arc(x + w - r2, y + r2, r2, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r2);
  ctx.arc(x + w - r2, y + h - r2, r2, 0, Math.PI / 2);
  ctx.lineTo(x + r2, y + h);
  ctx.arc(x + r2, y + h - r2, r2, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r2);
  ctx.arc(x + r2, y + r2, r2, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();
}

function hitTest(
  px: number,
  py: number,
  r: { x: number; y: number; w: number; h: number }
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Вспышка на клетке: r, c — координаты, t — время старта (performance.now()). */
export interface FlashCell {
  r: number;
  c: number;
  t: number;
}

export class GameScene implements Scene {
  private readonly board = new Board();
  private readonly gameState = new GameState();
  private readonly tileDropper = new TileDropper();
  private readonly sceneManager: SceneManager | null;
  private readonly createMenuScene: (() => Scene) | null;
  private readonly continueLast: boolean;
  private inputManager: InputManager | null = null;

  /** Режим сцены: игра, пауза или оверлей "Watch ad to undo". */
  private mode: 'playing' | 'paused' | 'reward_prompt' = 'playing';

  /** Эффекты: вспышки на клетках при merge. */
  private readonly effects = {
    flashCells: [] as FlashCell[],
  };

  private readonly pauseButton = { x: VIRTUAL_W - 120, y: 24, w: 96, h: 48 };
  private readonly undoButton = { x: 24, y: VIRTUAL_H - 100, w: 140, h: 52 };
  private readonly clearRowRectButton = { x: VIRTUAL_W - 164 - 152, y: VIRTUAL_H - 100, w: 140, h: 52 };
  private readonly clearRowButton = { x: VIRTUAL_W - 164, y: VIRTUAL_H - 100, w: 140, h: 52 };
  private readonly nextTilePanel = { x: VIRTUAL_W / 2 - 54, y: 140, w: 108, h: 72 };

  /** Кнопки панели паузы (центр экрана). */
  private readonly pausePanelButtonW = 200;
  private readonly pausePanelButtonH = 56;
  private readonly pausePanelGap = 16;
  private get pausePanelResume() {
    const totalH = 3 * this.pausePanelButtonH + 2 * this.pausePanelGap;
    const startY = VIRTUAL_H / 2 - totalH / 2;
    return { x: VIRTUAL_W / 2 - this.pausePanelButtonW / 2, y: startY, w: this.pausePanelButtonW, h: this.pausePanelButtonH };
  }
  private get pausePanelRestart() {
    const r = this.pausePanelResume;
    return { ...r, y: r.y + this.pausePanelButtonH + this.pausePanelGap };
  }
  private get pausePanelExit() {
    const r = this.pausePanelRestart;
    return { ...r, y: r.y + this.pausePanelButtonH + this.pausePanelGap };
  }

  /** Кнопки оверлея reward_prompt (Undo за рекламу). */
  private readonly rewardPromptButtonW = 200;
  private readonly rewardPromptButtonH = 52;
  private readonly rewardPromptGap = 12;
  private get rewardPromptPanelWatchAd() {
    const totalH = 2 * this.rewardPromptButtonH + this.rewardPromptGap;
    const startY = VIRTUAL_H / 2 - totalH / 2 - 24;
    return {
      x: VIRTUAL_W / 2 - this.rewardPromptButtonW / 2,
      y: startY,
      w: this.rewardPromptButtonW,
      h: this.rewardPromptButtonH,
    };
  }
  private get rewardPromptPanelCancel() {
    const r = this.rewardPromptPanelWatchAd;
    return { ...r, y: r.y + this.rewardPromptButtonH + this.rewardPromptGap };
  }

  constructor(sceneManager?: SceneManager, createMenuScene?: () => Scene, continueLast = false) {
    this.sceneManager = sceneManager ?? null;
    this.createMenuScene = createMenuScene ?? null;
    this.continueLast = continueLast;
  }

  enter(): void {
    this.mode = 'playing';
    const data = load();
    this.gameState.reset(data.bestScore);
    if (this.continueLast && data.lastBoard != null) {
      this.board.from(data.lastBoard);
      this.gameState.score = data.lastScore;
    } else {
      this.board.reset();
    }
    this.gameState.nextValue = rollNextValue(this.gameState.score);

    this.tileDropper.onLanded = (value: number, col: number, targetRow: number) => {
      audioManager.playDrop();
      this.board.set(targetRow, col, value);
      const { totalScore, flashCells } = applyCascade(this.board, { r: targetRow, c: col });
      if (flashCells.length > 0) audioManager.playMerge();
      const now = performance.now();
      for (const { r, c } of flashCells) {
        this.effects.flashCells.push({ r, c, t: now });
      }
      this.gameState.score += totalScore;
      if (this.gameState.score > this.gameState.best) {
        this.gameState.best = this.gameState.score;
        save({ bestScore: this.gameState.best });
      }
      this.gameState.moves += 1;
      save({ lastBoard: this.board.toJSON(), lastScore: this.gameState.score });
      // Нет места для следующего хода (все колонки заполнены) → Game Over
      if (!this.board.hasEmptyCell()) {
        if (this.sceneManager && this.createMenuScene) {
          this.sceneManager.setScene(
            new GameOverScene(
              this.sceneManager,
              this.createMenuScene,
              this.gameState.score
            )
          );
        }
      }
    };

    this.inputManager = new InputManager({
      onTap: (point) => {
        if (isUiInputBlocked()) return;
        if (this.mode === 'reward_prompt') {
          if (hitTest(point.x, point.y, this.rewardPromptPanelWatchAd)) {
            audioManager.playClick();
            showRewarded('undo')
              .then(({ rewarded }) => {
                if (rewarded) {
                  this.gameState.applyRewardedUndo(this.board.board);
                }
                this.mode = 'playing';
              })
              .catch(() => {
                this.mode = 'playing';
              });
            return;
          }
          if (hitTest(point.x, point.y, this.rewardPromptPanelCancel)) {
            audioManager.playClick();
            this.mode = 'playing';
            return;
          }
          return;
        }
        if (this.mode === 'paused') {
          if (hitTest(point.x, point.y, this.pausePanelResume)) {
            audioManager.playClick();
            this.mode = 'playing';
            return;
          }
          if (hitTest(point.x, point.y, this.pausePanelRestart) && this.sceneManager && this.createMenuScene) {
            audioManager.playClick();
            this.sceneManager.setScene(new GameScene(this.sceneManager, this.createMenuScene));
            return;
          }
          if (hitTest(point.x, point.y, this.pausePanelExit) && this.sceneManager && this.createMenuScene) {
            audioManager.playClick();
            this.sceneManager.setScene(this.createMenuScene());
            return;
          }
          return;
        }
        if (hitTest(point.x, point.y, this.pauseButton)) {
          audioManager.playClick();
          this.mode = 'paused';
          return;
        }
        if (hitTest(point.x, point.y, this.undoButton)) {
          if (this.gameState.canUndo) {
            audioManager.playClick();
            this.gameState.applyUndo(this.board.board);
            return;
          }
          if (this.gameState.canRewardedUndo) {
            audioManager.playClick();
            this.mode = 'reward_prompt';
            return;
          }
          return;
        }
        if (hitTest(point.x, point.y, this.clearRowRectButton)) {
          audioManager.playClick();
          // TODO: rewarded ad → clear row (rect); show rewarded, then clear rectangular region
          return;
        }
        if (hitTest(point.x, point.y, this.clearRowButton)) {
          if (!this.gameState.canClearRow) return;
          audioManager.playClick();
          showRewarded('clear_row')
            .then(({ rewarded }) => {
              if (rewarded) {
                const board = this.board.board;
                const r = GRID_ROWS - 1;
                for (let c = 0; c < GRID_COLS; c++) board[r][c] = 0;
                applyGravity(board);
                this.gameState.markClearRowUsed();
                save({ lastBoard: this.board.toJSON(), lastScore: this.gameState.score });
              }
            })
            .catch(() => {});
          return;
        }
        const { c, inside } = worldToCell(point.x, point.y);
        if (!inside) return;
        let targetRow: number | null = null;
        for (let r = GRID_ROWS - 1; r >= 0; r--) {
          if (this.board.get(r, c) === 0) {
            targetRow = r;
            break;
          }
        }
        if (targetRow === null) return;
        if (this.tileDropper.activeDrop?.isDropping) return;
        audioManager.playClick();
        this.gameState.snapshotForUndo(this.board.board);
        this.tileDropper.startDrop(this.gameState.nextValue, c, targetRow);
        this.gameState.nextValue = rollNextValue(this.gameState.score);
      },
    });
  }

  exit(): void {
    this.tileDropper.onLanded = null;
    this.inputManager?.destroy();
    this.inputManager = null;
  }

  fixedUpdate(dt: number): void {
    if (this.mode === 'paused' || this.mode === 'reward_prompt') return;
    this.tileDropper.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number): void {
    // Фон
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    const fieldW = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * GAP + 2 * GAP;
    const fieldH = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * GAP + 2 * GAP;
    const frameX = GRID_X - GAP;
    const frameY = GRID_Y - GAP;

    // Рамка поля (скруглённый прямоугольник)
    ctx.fillStyle = '#252538';
    roundRect(ctx, frameX, frameY, fieldW, fieldH, ROUND);

    // Клетки — скруглённые, пустые полупрозрачные (кэш cellPos)
    const cellBgStyle = 'rgba(61, 61, 92, 0.45)';
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const pos = cellPos[r][c];
        ctx.fillStyle = cellBgStyle;
        roundRect(ctx, pos.x, pos.y, CELL_SIZE, CELL_SIZE, ROUND);
      }
    }

    // Плитки на доске — таблица стилей, кэш координат, предрасчитанные строки
    const pad = 4;
    const cellHalf = CELL_SIZE / 2;
    const tileFont = 'bold 32px sans-serif';
    const tileInner = CELL_SIZE - pad * 2;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const v = this.board.get(r, c);
        if (v === 0) continue;
        const pos = cellPos[r][c];
        const style = TILE_STYLES[v] ?? DEFAULT_TILE_STYLE;
        ctx.fillStyle = style.bg;
        roundRect(ctx, pos.x + pad, pos.y + pad, tileInner, tileInner, ROUND);
        ctx.fillStyle = style.text;
        ctx.font = tileFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(VALUE_STRINGS[v] ?? String(v), pos.x + cellHalf, pos.y + cellHalf);
      }
    }

    // Падающая плитка (TileDropper) — те же таблица стилей и кэш
    const drop = this.tileDropper.activeDrop;
    if (drop && drop.isDropping) {
      const pos = cellPos[0][drop.col];
      const style = TILE_STYLES[drop.value] ?? DEFAULT_TILE_STYLE;
      ctx.fillStyle = style.bg;
      roundRect(ctx, pos.x + pad, drop.y + pad, tileInner, tileInner, ROUND);
      ctx.fillStyle = style.text;
      ctx.font = tileFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(VALUE_STRINGS[drop.value] ?? String(drop.value), pos.x + cellHalf, drop.y + cellHalf);
    }

    // Вспышки при merge — globalAlpha вместо новой строки rgba каждый кадр
    const now = performance.now();
    for (let i = this.effects.flashCells.length - 1; i >= 0; i--) {
      const fc = this.effects.flashCells[i];
      const ageSec = (now - fc.t) / 1000;
      if (ageSec >= FLASH_DURATION) {
        this.effects.flashCells.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, 1 - ageSec / FLASH_DURATION);
      const pos = cellPos[fc.r][fc.c];
      ctx.save();
      ctx.globalAlpha = 0.5 * alpha;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, pos.x + pad, pos.y + pad, tileInner, tileInner, ROUND);
      ctx.restore();
    }

    // Панель NextTile — таблица стилей и предрасчитанная строка
    ctx.fillStyle = '#252538';
    roundRect(ctx, this.nextTilePanel.x, this.nextTilePanel.y, this.nextTilePanel.w, this.nextTilePanel.h, ROUND);
    ctx.fillStyle = '#eee';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('next_tile'), VIRTUAL_W / 2, this.nextTilePanel.y - 8);
    const nx = this.nextTilePanel.x + this.nextTilePanel.w / 2;
    const ny = this.nextTilePanel.y + this.nextTilePanel.h / 2;
    const nextStyle = TILE_STYLES[this.gameState.nextValue] ?? DEFAULT_TILE_STYLE;
    ctx.fillStyle = nextStyle.bg;
    roundRect(ctx, this.nextTilePanel.x + 12, this.nextTilePanel.y + 12, this.nextTilePanel.w - 24, this.nextTilePanel.h - 24, ROUND);
    ctx.fillStyle = nextStyle.text;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(VALUE_STRINGS[this.gameState.nextValue] ?? String(this.gameState.nextValue), nx, ny);

    // Score / Best
    ctx.fillStyle = '#eee';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${t('score')}: ${this.gameState.score}`, 24, 48);
    ctx.fillText(`${t('best')}: ${this.gameState.best}`, 24, 80);

    // Кнопки Undo, Clear Row (Rect) (rewarded), Clear Row (rewarded), Pause
    drawButton(ctx, this.undoButton, t('undo'), this.gameState.canUndo);
    drawButton(ctx, this.clearRowRectButton, t('clear_row_rect'), true);
    drawButton(ctx, this.clearRowButton, t('clear_row_rewarded'), this.gameState.canClearRow);
    drawButton(ctx, this.pauseButton, t('pause'), true);

    const adBlocking = isUiInputBlocked();
    // Пауза: затемнение и кнопки Resume / Restart / Exit
    if (this.mode === 'paused') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
      drawButton(ctx, this.pausePanelResume, t('resume'), !adBlocking);
      drawButton(ctx, this.pausePanelRestart, t('restart'), !adBlocking);
      drawButton(ctx, this.pausePanelExit, t('exit'), !adBlocking);
    }

    // Оверлей reward_prompt: "Watch ad to undo"
    if (this.mode === 'reward_prompt') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
      ctx.fillStyle = '#eee';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('watch_ad_to_undo'), VIRTUAL_W / 2, VIRTUAL_H / 2 - 56);
      drawButton(ctx, this.rewardPromptPanelWatchAd, t('watch_ad'), !adBlocking);
      drawButton(ctx, this.rewardPromptPanelCancel, t('no_thanks'), !adBlocking);
    }
  }
}
