export interface Scene {
  enter(): void | Promise<void>;
  exit(): void;
  fixedUpdate(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number, fps?: number): void;
}
