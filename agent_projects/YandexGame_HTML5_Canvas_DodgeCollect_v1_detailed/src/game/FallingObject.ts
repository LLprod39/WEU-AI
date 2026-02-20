import { VH } from '../core/CanvasHost';

export type FallingObjectType = 'coin' | 'spike';

export class FallingObject {
  type: FallingObjectType;
  x: number;
  y: number;
  speed: number;
  radius: number;
  active: boolean;

  constructor() {
    this.type = 'coin';
    this.x = 0;
    this.y = 0;
    this.speed = 0;
    this.radius = 0;
    this.active = false;
  }

  spawn(type: FallingObjectType, x: number, y: number, speed: number): void {
    this.type = type;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.radius = type === 'coin' ? 24 : 20;
    this.active = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.y += this.speed * dt;
    if (this.y > VH + 100) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;
    if (this.type === 'coin') {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.radius);
      ctx.lineTo(this.x + this.radius, this.y + this.radius);
      ctx.lineTo(this.x, this.y + this.radius * 0.6);
      ctx.lineTo(this.x - this.radius, this.y + this.radius);
      ctx.closePath();
      ctx.fillStyle = '#8b0000';
      ctx.fill();
      ctx.strokeStyle = '#4a0000';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
