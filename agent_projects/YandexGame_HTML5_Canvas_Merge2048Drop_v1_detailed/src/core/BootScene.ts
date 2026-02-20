import type { Scene } from './Scene';
import { VIRTUAL_W, VIRTUAL_H } from './CanvasHost';
import { t } from '../ui/i18n';

export class BootScene implements Scene {
  enter(): void {
    // Стартовая сцена
  }

  exit(): void {
    // Выход из сцены
  }

  fixedUpdate(_dt: number): void {
    // Физика/логика при необходимости
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number): void {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    ctx.font = '48px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(t('loading'), VIRTUAL_W / 2, VIRTUAL_H / 2 - 24);
  }
}
