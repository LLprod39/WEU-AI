import type { Resettable } from '../utils/ObjectPool';

export class Particle implements Resettable {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  active: boolean;

  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.maxLife = 0;
    this.size = 0;
    this.active = false;
  }

  reset(): void {
    this.active = false;
  }
}
