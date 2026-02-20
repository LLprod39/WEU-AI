import type { Scene } from './Scene';

export class SceneManager {
  private current: Scene | null = null;

  async setScene(scene: Scene): Promise<void> {
    const prev = this.current;
    if (prev) {
      prev.exit();
      this.current = null;
    }
    this.current = scene;
    const enterResult = scene.enter();
    if (enterResult instanceof Promise) {
      await enterResult;
    }
  }

  fixedUpdate(dt: number): void {
    this.current?.fixedUpdate(dt);
  }

  render(ctx: CanvasRenderingContext2D, alpha: number): void {
    this.current?.render(ctx, alpha);
  }
}
