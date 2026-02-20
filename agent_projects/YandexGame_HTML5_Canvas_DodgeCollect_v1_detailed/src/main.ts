import { App, GameLoop, InputManager, SceneManager, audioManager } from './core';
import { CanvasHost } from './core/CanvasHost';
import { BootScene } from './scenes/BootScene';
import { setHooks } from './yandex/ads';

/**
 * Не показывать stack traces в UI: подавляем дефолтное поведение unhandledrejection.
 */
function suppressUnhandledRejection(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
  });
}

/**
 * Запускает игру: создаёт App с CanvasHost, InputManager на canvas,
 * GameLoop (fixedUpdate → sceneManager.fixedUpdate, render → sceneManager.render),
 * выставляет BootScene и стартует цикл.
 */
export function runApp(container: HTMLElement): void {
  suppressUnhandledRejection();

  const canvasHost = new CanvasHost(container);
  const sceneManager = new SceneManager();

  let app: App;
  const gameLoop = new GameLoop({
    onFixedUpdate: (dt) => {
      if (!app.isPaused) sceneManager.fixedUpdate(dt);
    },
    onRender: (alpha, fps) => {
      if (app.isPaused) return;
      const ctx = canvasHost.getContext2D();
      if (ctx) sceneManager.render(ctx, alpha, fps);
    },
  });

  app = new App({ canvasHost, gameLoop, sceneManager });
  try {
    setHooks({ onAdOpen: () => app.onAdOpen(), onAdClose: () => app.onAdClose() });
  } catch {
    // ignore
  }

  const inputManager = new InputManager({
    canvas: canvasHost.getCanvas(),
    toGameCoords: (x, y) => canvasHost.toGameCoords(x, y),
  });

  const canvas = canvasHost.getCanvas();
  canvas.addEventListener('pointerdown', () => audioManager.unlock(), { once: true });

  sceneManager
    .setScene(new BootScene(sceneManager, inputManager))
    .then(() => gameLoop.start())
    .catch(() => {});

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => canvasHost.resize?.());
  }
}
