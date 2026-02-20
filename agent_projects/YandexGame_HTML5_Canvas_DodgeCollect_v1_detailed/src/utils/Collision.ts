/**
 * Проверка пересечения двух кругов без sqrt (через квадрат расстояния).
 * Круги пересекаются, если расстояние между центрами <= ar + br,
 * т.е. (dx² + dy²) <= (ar + br)².
 */
export function circleIntersects(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const sumR = ar + br;
  return dx * dx + dy * dy <= sumR * sumR;
}
