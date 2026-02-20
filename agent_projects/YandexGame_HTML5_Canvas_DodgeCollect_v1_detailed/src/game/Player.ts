import { VW } from '../core/CanvasHost';
import { clamp } from '../utils/Math';

/** Нижняя граница зоны движения игрока по Y (virtual coords). */
const PLAYER_Y_MIN = 900;
/** Верхняя граница зоны движения игрока по Y (virtual coords). */
const PLAYER_Y_MAX = 1220;
/** Скорость движения к цели (px/s). */
const MOVE_SPEED = 400;

export class Player {
  x: number;
  y: number;
  radius: number;
  private targetX: number;
  private targetY: number;

  constructor(x: number, y: number, radius: number) {
    this.radius = radius;
    this.x = clamp(x, this.radius, VW - this.radius);
    this.y = clamp(y, PLAYER_Y_MIN, PLAYER_Y_MAX);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  setTarget(x: number, y: number): void {
    this.targetX = clamp(x, this.radius, VW - this.radius);
    this.targetY = clamp(y, PLAYER_Y_MIN, PLAYER_Y_MAX);
  }

  update(dt: number): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0) return;
    const step = MOVE_SPEED * dt;
    if (step >= dist) {
      this.x = this.targetX;
      this.y = this.targetY;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
    this.x = clamp(this.x, this.radius, VW - this.radius);
    this.y = clamp(this.y, PLAYER_Y_MIN, PLAYER_Y_MAX);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#4a9eff';
    ctx.fill();
    ctx.strokeStyle = '#2d6bb8';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
