import { GRID_X, GRID_Y, CELL_SIZE, GAP, GRID_COLS, GRID_ROWS } from "./constants";

/**
 * Преобразует индексы клетки (ряд, колонка) в мировые координаты (x, y) — левый верхний угол клетки.
 */
export function cellToWorld(r: number, c: number): { x: number; y: number } {
  const x = GRID_X + c * (CELL_SIZE + GAP);
  const y = GRID_Y + r * (CELL_SIZE + GAP);
  return { x, y };
}

/**
 * Преобразует мировые координаты (x, y) в индексы клетки и флаг inside (попадание внутрь клетки, не в зазор).
 */
export function worldToCell(x: number, y: number): { r: number; c: number; inside: boolean } {
  const relX = x - GRID_X;
  const relY = y - GRID_Y;
  const c = Math.floor(relX / (CELL_SIZE + GAP));
  const r = Math.floor(relY / (CELL_SIZE + GAP));
  const inSlotX = relX - c * (CELL_SIZE + GAP);
  const inSlotY = relY - r * (CELL_SIZE + GAP);
  const inside =
    c >= 0 &&
    c < GRID_COLS &&
    r >= 0 &&
    r < GRID_ROWS &&
    inSlotX >= 0 &&
    inSlotX < CELL_SIZE &&
    inSlotY >= 0 &&
    inSlotY < CELL_SIZE;
  return { r, c, inside };
}
