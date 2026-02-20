import type { SceneManager as ISceneManager } from './App';
import type { Scene } from './Scene';

export class SceneManager implements ISceneManager {
  private _currentScene: Scene | null = null;

  get currentScene(): Scene | null {
    return this._currentScene;
  }

  async setScene(scene: Scene): Promise<void> {
    const prev = this._currentScene;
    if (prev) {
      prev.exit();
    }
    this._currentScene = scene;
    const result = scene.enter();
    if (result instanceof Promise) {
      await result;
    }
  }

  fixedUpdate(dt: number): void {
    this._currentScene?.fixedUpdate(dt);
  }

  render(ctx: CanvasRenderingContext2D, alpha: number, fps?: number): void {
    this._currentScene?.render(ctx, alpha, fps);
  }
}
