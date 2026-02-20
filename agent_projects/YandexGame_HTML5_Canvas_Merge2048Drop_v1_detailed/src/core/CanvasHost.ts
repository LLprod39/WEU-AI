/** Виртуальные размеры игрового холста (логические пиксели). */
const VIRTUAL_W = 720;
const VIRTUAL_H = 1280;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D context not available');

/** Масштаб letterbox (виртуальный пиксель → CSS-пиксель на canvas). */
let scale = 1;
/** Смещение отрисовки виртуального прямоугольника (в CSS-пикселях canvas). */
let offsetX = 0;
let offsetY = 0;

function resize(): void {
  const dpr = window.devicePixelRatio ?? 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  const pixelW = Math.round(cssW * dpr);
  const pixelH = Math.round(cssH * dpr);

  canvas.width = pixelW;
  canvas.height = pixelH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const scaleX = cssW / VIRTUAL_W;
  const scaleY = cssH / VIRTUAL_H;
  scale = Math.min(scaleX, scaleY);
  const drawW = VIRTUAL_W * scale;
  const drawH = VIRTUAL_H * scale;
  offsetX = (cssW - drawW) / 2;
  offsetY = (cssH - drawH) / 2;
}

function toGameCoords(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;
  const x = (cssX - offsetX) / scale;
  const y = (cssY - offsetY) / scale;
  return { x, y };
}

/** Вызывать перед кадром: задаёт transform для отрисовки в виртуальных координатах (letterbox). */
function applyLetterboxTransform(): void {
  const dpr = window.devicePixelRatio ?? 1;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
}

export { canvas, ctx, VIRTUAL_W, VIRTUAL_H, resize, toGameCoords, applyLetterboxTransform };
