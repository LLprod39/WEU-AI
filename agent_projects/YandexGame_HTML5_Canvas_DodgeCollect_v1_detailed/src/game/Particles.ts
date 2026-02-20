import { ObjectPool } from '../utils/ObjectPool';
import { Particle } from './Particle';

const MIN_LIFE = 0.3;
const MAX_LIFE = 0.5;
const MIN_SPEED = 30;
const MAX_SPEED = 80;
const MIN_SIZE = 2;
const MAX_SIZE = 5;

export class Particles {
  private pool: ObjectPool<Particle>;
  private active: Particle[] = [];

  constructor(poolSize: number = 64) {
    this.pool = new ObjectPool<Particle>(() => new Particle(), poolSize);
  }

  emitBurst(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.pool.acquire();
      const angle = Math.random() * Math.PI * 2;
      const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.maxLife = MIN_LIFE + Math.random() * (MAX_LIFE - MIN_LIFE);
      p.life = p.maxLife;
      p.size = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);
      p.active = true;
      this.active.push(p);
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.pool.release(p);
        this.active.splice(i, 1);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.active) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }
  }
}
