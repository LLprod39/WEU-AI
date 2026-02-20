import { GRID_ROWS, GRID_COLS } from './constants';

/**
 * Для каждой колонки сдвигает значения вниз, заполняя пустоты (0).
 * Возвращает true, если доска изменилась.
 * Используется после merge, чтобы плитки осыпались и могли снова смержиться.
 */
export function applyGravity(board: number[][]): boolean {
  let changed = false;
  for (let c = 0; c < GRID_COLS; c++) {
    const vals: number[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      const v = board[r][c];
      if (v !== 0) vals.push(v);
    }
    const emptyCount = GRID_ROWS - vals.length;
    for (let r = 0; r < GRID_ROWS; r++) {
      const newVal = r < emptyCount ? 0 : vals[r - emptyCount];
      if (board[r][c] !== newVal) changed = true;
      board[r][c] = newVal;
    }
  }
  return changed;
}
