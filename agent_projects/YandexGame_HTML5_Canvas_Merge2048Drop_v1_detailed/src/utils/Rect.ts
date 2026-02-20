export class Rect {
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number
  ) {}

  contains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px < this.x + this.w &&
      py >= this.y &&
      py < this.y + this.h
    );
  }
}
