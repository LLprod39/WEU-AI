import type { Rect } from "./Rect.js";

export function hitRect(rect: Rect, x: number, y: number): boolean {
  return rect.contains(x, y);
}
