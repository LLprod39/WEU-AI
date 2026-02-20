import { VW } from '../core/CanvasHost';
import { ObjectPool } from '../utils/ObjectPool';
import type { FallingObjectType } from './FallingObject';
import { FallingObject } from './FallingObject';

const MAX_CONSECUTIVE_SPIKES = 2;

export class Spawner {
  private timer: number;
  private spawnInterval: number;
  private speed: number;
  private consecutiveSpikes: number;
  private readonly pool: ObjectPool<FallingObject>;
  private readonly onSpawned: (obj: FallingObject) => void;
  private readonly getActiveCount: () => number;
  private readonly maxActive: number;

  constructor(
    pool: ObjectPool<FallingObject>,
    onSpawned: (obj: FallingObject) => void,
    getActiveCount: () => number,
    maxActive: number
  ) {
    this.pool = pool;
    this.onSpawned = onSpawned;
    this.getActiveCount = getActiveCount;
    this.maxActive = maxActive;
    this.timer = 0;
    this.spawnInterval = 0.9;
    this.speed = 280;
    this.consecutiveSpikes = 0;
  }

  private computeFromDifficulty(difficulty: number): void {
    this.spawnInterval = Math.max(0.25, 0.9 - difficulty * 0.05);
    this.speed = 280 + difficulty * 35;
  }

  private chooseType(difficulty: number): FallingObjectType {
    if (this.consecutiveSpikes >= MAX_CONSECUTIVE_SPIKES) {
      return 'coin';
    }
    const coinChance = Math.max(0.7, Math.min(0.8, 0.8 - difficulty * 0.03));
    return Math.random() < coinChance ? 'coin' : 'spike';
  }

  private spawnObject(difficulty: number): void {
    const type = this.chooseType(difficulty);
    if (type === 'spike') {
      this.consecutiveSpikes += 1;
    } else {
      this.consecutiveSpikes = 0;
    }
    const radius = type === 'coin' ? 24 : 20;
    const x = radius + Math.random() * (VW - 2 * radius);
    const y = -radius - 10;

    const obj = this.pool.acquire();
    obj.spawn(type, x, y, this.speed);
    this.onSpawned(obj);
  }

  update(dt: number, difficulty: number): void {
    this.computeFromDifficulty(difficulty);
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.getActiveCount() >= this.maxActive) {
        return;
      }
      this.spawnObject(difficulty);
      this.timer = this.spawnInterval;
    }
  }
}
