import { GRID_ROWS, GRID_COLS } from './constants';
import { Board } from './Board';
import { resolve } from './MergeResolver';
import { applyGravity } from './Gravity';

const DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export interface OriginCell {
  r: number;
  c: number;
}

export interface CascadeResult {
  totalScore: number;
  flashCells: { r: number; c: number }[];
}

/**
 * Находит первую ячейку (обход сверху-слева), у которой есть сосед с тем же значением.
 */
function findMergeOpportunity(grid: number[][]): { r: number; c: number } | null {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const v = grid[r][c];
      if (v <= 0) continue;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS && grid[nr][nc] === v) {
          return { r, c };
        }
      }
    }
  }
  return null;
}

/**
 * Каскад: resolve в origin, затем gravity, затем поиск новых слияний по всему полю
 * (по одному за раз), повтор пока есть изменения или лимит 50 итераций.
 */
export function applyCascade(board: Board, originCell: OriginCell): CascadeResult {
  const grid = board.board;
  let totalScore = 0;
  const flashCells: { r: number; c: number }[] = [];
  const maxIterations = 50;

  const res = resolve(grid, originCell.r, originCell.c);
  totalScore += res.gainedScore;
  flashCells.push(...res.flashCells);
  applyGravity(grid);

  for (let iter = 1; iter < maxIterations; iter++) {
    const cell = findMergeOpportunity(grid);
    if (cell === null) break;
    const resNext = resolve(grid, cell.r, cell.c);
    totalScore += resNext.gainedScore;
    flashCells.push(...resNext.flashCells);
    applyGravity(grid);
  }

  return { totalScore, flashCells };
}
