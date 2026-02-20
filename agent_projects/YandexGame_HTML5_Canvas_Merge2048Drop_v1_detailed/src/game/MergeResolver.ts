import { GRID_ROWS, GRID_COLS } from './constants';

const DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export interface ResolveResult {
  merged: boolean;
  gainedScore: number;
  lastCell: { r: number; c: number };
  /** Клетки, в которых произошло слияние (для вспышки). */
  flashCells: { r: number; c: number }[];
}

/**
 * Разрешает слияния от клетки (startR, startC): ищет соседей с тем же значением v,
 * объединяет в текущую (v*2), обнуляет соседа, начисляет очки. После каждого merge
 * снова проверяет 4 направления (цепочка). Ограничение итераций — от зацикливания.
 */
export function resolve(
  board: number[][],
  startR: number,
  startC: number
): ResolveResult {
  const result: ResolveResult = {
    merged: false,
    gainedScore: 0,
    lastCell: { r: startR, c: startC },
    flashCells: [],
  };

  let r = startR;
  let c = startC;
  const maxIterations = GRID_ROWS * GRID_COLS;

  for (let iter = 0; iter < maxIterations; iter++) {
    const v = board[r][c];
    if (v <= 0) break;

    let found = false;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      if (board[nr][nc] !== v) continue;

      board[r][c] = v * 2;
      board[nr][nc] = 0;
      result.gainedScore += v * 2;
      result.merged = true;
      result.flashCells.push({ r, c });
      found = true;
      break;
    }

    if (!found) break;
  }

  result.lastCell = { r, c };
  return result;
}
