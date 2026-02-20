import type { Rect } from '../utils/Rect';

/** Единый стиль: прямоугольные кнопки без скругления. */

const PRIMARY_FILL = '#6c5ce7';
const PRIMARY_STROKE = '#5b4cdb';
const SECONDARY_FILL = '#444';
const SECONDARY_STROKE = '#666';
const PRIMARY_TEXT = '#fff';
const SECONDARY_TEXT = '#e0e0e0';

/**
 * Рисует текст по центру (x,y) с заданным размером шрифта и прозрачностью.
 */
export function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  alpha: number,
  color: string = '#e0e0e0',
  bold: boolean = false
): void {
  ctx.save();
  ctx.font = bold ? `bold ${size}px sans-serif` : `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Рисует кнопку в едином стиле (прямоугольник + обводка + подпись по центру).
 * primary: true — фиолетовая (основное действие), false — серая (второстепенная).
 * enabled: false — рисуется приглушённо (alpha 0.6).
 */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  enabled: boolean,
  primary: boolean = true,
  fontSize: number = 24
): void {
  ctx.save();
  const alpha = enabled ? 1 : 0.6;
  ctx.globalAlpha = alpha;
  const fill = primary ? PRIMARY_FILL : SECONDARY_FILL;
  const stroke = primary ? PRIMARY_STROKE : SECONDARY_STROKE;
  const textColor = primary ? PRIMARY_TEXT : SECONDARY_TEXT;

  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
}
