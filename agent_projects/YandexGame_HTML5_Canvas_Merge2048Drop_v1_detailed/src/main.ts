import './style.css';
import { App, audioManager } from './core';
import { registerApp } from './core/AppInstance';
import { resize } from './core/CanvasHost';
import { BootScene } from './scenes/BootScene';

const app = new App();
registerApp(app);
const sceneManager = app.getSceneManager();

sceneManager.setScene(new BootScene(sceneManager)).then(() => {
  app.start();
});

window.addEventListener('resize', () => {
  resize();
});
window.addEventListener('orientationchange', () => {
  resize();
});

// Монтируем canvas в #app
const root = document.querySelector<HTMLDivElement>('#app')!;
root.appendChild(app.getCanvas());
resize();

// Разблокировка Web Audio по первому pointerdown (политика браузера)
document.addEventListener('pointerdown', () => audioManager.unlock(), { once: true });
