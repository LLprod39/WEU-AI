/**
 * Ограничивает значение в диапазоне [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Линейная интерполяция между a и b по t ∈ [0, 1].
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Случайное число в диапазоне [min, max] (включительно при целых min/max).
 */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
