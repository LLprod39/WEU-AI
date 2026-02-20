/**
 * Единый стиль UI: центрированный текст и кнопки (фон + текст).
 */

export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

const UI_TEXT_COLOR = '#eee';
const UI_BUTTON_BG = '#4a7c59';
const UI_BUTTON_BG_DISABLED = '#2d4a35';
const UI_BUTTON_TEXT = '#fff';
const UI_BUTTON_TEXT_DISABLED = '#888';

/**
 * Рисует текст по центру (x, y). Базовая линия по y.
 */
export function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number
): void {
  ctx.save();
  ctx.fillStyle = UI_TEXT_COLOR;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Рисует кнопку: прямоугольник + центрированная подпись. Единый стиль с drawCenteredText.
 */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  rect: RectLike,
  label: string,
  enabled: boolean
): void {
  ctx.save();

  ctx.fillStyle = enabled ? UI_BUTTON_BG : UI_BUTTON_BG_DISABLED;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = enabled ? UI_BUTTON_TEXT : UI_BUTTON_TEXT_DISABLED;
  const fontSize = Math.max(14, Math.min(28, Math.floor(rect.h * 0.4)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);

  ctx.restore();
}
