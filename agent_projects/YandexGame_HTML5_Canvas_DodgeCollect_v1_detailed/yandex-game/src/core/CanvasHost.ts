export const VW = 720;
export const VH = 1280;

export class CanvasHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.dpr = Math.max(1, window.devicePixelRatio ?? 1);
    this.scale = Math.min(w / VW, h / VH);
    this.offsetX = (w - VW * this.scale) / 2;
    this.offsetY = (h - VH * this.scale) / 2;

    this.canvas.width = VW * this.dpr;
    this.canvas.height = VH * this.dpr;
    this.canvas.style.width = `${VW * this.scale}px`;
    this.canvas.style.height = `${VH * this.scale}px`;

    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext2D(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  toGameCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / this.scale;
    const y = (clientY - rect.top) / this.scale;
    return { x, y };
  }

  getScale(): number {
    return this.scale;
  }

  getOffsetX(): number {
    return this.offsetX;
  }

  getOffsetY(): number {
    return this.offsetY;
  }
}
