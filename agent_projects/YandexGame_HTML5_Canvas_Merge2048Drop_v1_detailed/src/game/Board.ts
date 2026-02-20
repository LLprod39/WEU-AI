import { GRID_ROWS, GRID_COLS } from './constants';

/** Доска: number[rows][cols], 0 — пустая ячейка. */
export class Board {
  board: number[][];

  constructor() {
    this.board = this.createEmpty();
  }

  private createEmpty(): number[][] {
    return Array.from({ length: GRID_ROWS }, () =>
      Array.from({ length: GRID_COLS }, () => 0)
    );
  }

  /** Заполнить доску нулями. */
  reset(): void {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        this.board[r][c] = 0;
      }
    }
  }

  /** Глубокий клон доски. */
  clone(): Board {
    const b = new Board();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        b.board[r][c] = this.board[r][c];
      }
    }
    return b;
  }

  /** Заполнить доску из массива number[rows][cols]. */
  from(data: number[][]): void {
    const rows = Math.min(data.length, GRID_ROWS);
    for (let r = 0; r < rows; r++) {
      const row = data[r];
      if (row) {
        const cols = Math.min(row.length, GRID_COLS);
        for (let c = 0; c < cols; c++) {
          this.board[r][c] = row[c] ?? 0;
        }
        for (let c = cols; c < GRID_COLS; c++) {
          this.board[r][c] = 0;
        }
      } else {
        for (let c = 0; c < GRID_COLS; c++) this.board[r][c] = 0;
      }
    }
    for (let r = rows; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) this.board[r][c] = 0;
    }
  }

  /** Сериализация для сохранения. */
  toJSON(): number[][] {
    return this.board.map((row) => [...row]);
  }

  get(r: number, c: number): number {
    if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) return 0;
    return this.board[r][c];
  }

  set(r: number, c: number, v: number): void {
    if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
      this.board[r][c] = v;
    }
  }

  /** Верхний ряд полностью заполнен — геймовер. */
  isFullTopRow(): boolean {
    for (let c = 0; c < GRID_COLS; c++) {
      if (this.board[0][c] === 0) return false;
    }
    return true;
  }

  /** Есть ли хотя бы одна пустая ячейка на доске. */
  hasEmptyCell(): boolean {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.board[r][c] === 0) return true;
      }
    }
    return false;
  }
}
