import { GRID_ROWS, GRID_COLS } from './constants';

/** Кулдаун Clear Row: не чаще 1 раза за 3 минуты. */
const CLEAR_ROW_COOLDOWN_MS = 3 * 60 * 1000;

export class GameState {
  score: number = 0;
  best: number = 0;
  moves: number = 0;
  nextValue: number = 0;
  canUndo: boolean = false;
  undoBoard: number[][] | null = null;
  undoScore: number = 0;
  /** Снимок для rewarded undo: состояние до локального undo (после просмотра рекламы восстанавливаем его). */
  rewardedUndoBoard: number[][] | null = null;
  rewardedUndoScore: number = 0;
  /** Время последнего использования Clear Row (rewarded). Для ограничения не чаще 1 раза за 3 мин. */
  lastClearRowTime: number = 0;

  /** Сброс состояния игры. best — опционально сохраняемое значение лучшего счёта. */
  reset(best?: number): void {
    this.score = 0;
    this.moves = 0;
    this.nextValue = 0;
    this.canUndo = false;
    this.undoBoard = null;
    this.undoScore = 0;
    this.rewardedUndoBoard = null;
    this.rewardedUndoScore = 0;
    if (best !== undefined) {
      this.best = best;
    }
  }

  /** Сохранить снимок доски и счёта для отмены. */
  snapshotForUndo(board: number[][]): void {
    this.undoBoard = board.map((row) => [...row]);
    this.undoScore = this.score;
    this.canUndo = true;
  }

  /** Есть ли снимок для отмены за рекламу (после одного локального undo). */
  get canRewardedUndo(): boolean {
    return this.rewardedUndoBoard != null;
  }

  /** Можно ли сейчас использовать Clear Row (прошло не менее 3 минут с последнего использования). */
  get canClearRow(): boolean {
    return Date.now() - this.lastClearRowTime >= CLEAR_ROW_COOLDOWN_MS;
  }

  /** Отметить использование Clear Row (запуск кулдауна 3 мин). */
  markClearRowUsed(): void {
    this.lastClearRowTime = Date.now();
  }

  /** Восстановить доску и счёт из снимка отмены. */
  applyUndo(board: number[][]): void {
    if (!this.undoBoard) return;
    // Сохраняем текущее состояние для возможного rewarded undo
    this.rewardedUndoBoard = board.map((row) => [...row]);
    this.rewardedUndoScore = this.score;
    const rows = Math.min(this.undoBoard.length, board.length, GRID_ROWS);
    for (let r = 0; r < rows; r++) {
      const src = this.undoBoard[r];
      const dst = board[r];
      if (src && dst) {
        const cols = Math.min(src.length, dst.length, GRID_COLS);
        for (let c = 0; c < cols; c++) dst[c] = src[c];
        for (let c = cols; c < GRID_COLS; c++) dst[c] = 0;
      }
    }
    for (let r = rows; r < GRID_ROWS; r++) {
      const dst = board[r];
      if (dst) for (let c = 0; c < GRID_COLS; c++) dst[c] = 0;
    }
    this.score = this.undoScore;
    this.canUndo = false;
    this.undoBoard = null;
  }

  /** Восстановить доску и счёт из снимка rewarded undo (после успешного просмотра рекламы). */
  applyRewardedUndo(board: number[][]): void {
    if (!this.rewardedUndoBoard) return;
    const rows = Math.min(this.rewardedUndoBoard.length, board.length, GRID_ROWS);
    for (let r = 0; r < rows; r++) {
      const src = this.rewardedUndoBoard[r];
      const dst = board[r];
      if (src && dst) {
        const cols = Math.min(src.length, dst.length, GRID_COLS);
        for (let c = 0; c < cols; c++) dst[c] = src[c];
        for (let c = cols; c < GRID_COLS; c++) dst[c] = 0;
      }
    }
    for (let r = rows; r < GRID_ROWS; r++) {
      const dst = board[r];
      if (dst) for (let c = 0; c < GRID_COLS; c++) dst[c] = 0;
    }
    this.score = this.rewardedUndoScore;
    this.rewardedUndoBoard = null;
    this.rewardedUndoScore = 0;
  }
}
