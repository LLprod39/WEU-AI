/** Виртуальные размеры холста (совпадают с CanvasHost). */
const VIRTUAL_W = 720;
const VIRTUAL_H = 1280;

export const GRID_COLS = 6;
export const GRID_ROWS = 8;
export const CELL_SIZE = 92;
export const GAP = 10;

/** Ширина поля (колонки × ячейка + промежутки). */
export const GRID_WIDTH = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * GAP;
/** Высота поля (ряды × ячейка + промежутки). */
export const GRID_HEIGHT = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * GAP;

/** Позиция поля по центру виртуального экрана. */
export const GRID_X = Math.round((VIRTUAL_W - GRID_WIDTH) / 2);
export const GRID_Y = Math.round((VIRTUAL_H - GRID_HEIGHT) / 2);
