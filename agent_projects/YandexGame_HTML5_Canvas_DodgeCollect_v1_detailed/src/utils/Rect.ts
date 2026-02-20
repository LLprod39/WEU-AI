export class Rect {
  x: number;
  y: number;
  w: number;
  h: number;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  contains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px < this.x + this.w &&
      py >= this.y &&
      py < this.y + this.h
    );
  }
}
