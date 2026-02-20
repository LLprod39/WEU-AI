import {
  EnemyConfig,
  ProceduralWaveEnemyPoolEntryConfig,
  WaveEntryConfig,
  WaveScalingConfig,
  WavesConfig
} from "./types";
import {
  createSeededRandom,
  randomInt,
  randomRange,
  weightedPick
} from "./random";

export function generateWaveEntries(
  wavesConfig: WavesConfig,
  enemies: EnemyConfig[],
  seed: number
): WaveEntryConfig[] {
  const scaling = wavesConfig.wave_scaling;
  if (!scaling || scaling.enabled === false) {
    return [...wavesConfig.waves];
  }

  const random = createSeededRandom(seed);
  const enemyIds = new Set(enemies.map((enemy) => enemy.id));
  const pool = scaling.enemy_pool.filter(
    (entry) => enemyIds.has(entry.enemy_id) && entry.weight > 0
  );
  if (pool.length === 0) {
    return [...wavesConfig.waves];
  }

  const result: WaveEntryConfig[] = [];
  for (let waveNumber = 1; waveNumber <= scaling.max_waves; waveNumber += 1) {
    result.push(...generateWaveForNumber(scaling, pool, waveNumber, random));
  }

  return result;
}

function generateWaveForNumber(
  scaling: WaveScalingConfig,
  pool: ProceduralWaveEnemyPoolEntryConfig[],
  waveNumber: number,
  random: () => number
): WaveEntryConfig[] {
  const eligiblePool = pool.filter((entry) => (entry.start_wave ?? 1) <= waveNumber);
  const fallbackPool = eligiblePool.length > 0 ? eligiblePool : pool;

  const minEntries = Math.min(scaling.min_entries_per_wave, fallbackPool.length);
  const maxEntries = Math.min(scaling.max_entries_per_wave, fallbackPool.length);
  const entryCount = PhaserSafe.clampInteger(
    randomInt(random, minEntries, maxEntries),
    1,
    fallbackPool.length
  );
  const selectedTypes = pickDistinctWeighted(
    random,
    fallbackPool,
    entryCount,
    (entry) => entry.weight
  );

  const totalEnemies = computeEnemyCountForWave(scaling, waveNumber, random);
  const countsByEnemyId = new Map<string, number>();

  // Make sure every selected type appears at least once.
  for (const entry of selectedTypes) {
    countsByEnemyId.set(entry.enemy_id, 1);
  }

  let remaining = Math.max(0, totalEnemies - selectedTypes.length);
  while (remaining > 0) {
    const picked = weightedPick(random, selectedTypes, (entry) => entry.weight) ?? selectedTypes[0];
    countsByEnemyId.set(picked.enemy_id, (countsByEnemyId.get(picked.enemy_id) ?? 0) + 1);
    remaining -= 1;
  }

  applyBossEntryIfNeeded(countsByEnemyId, scaling, waveNumber);

  const baseInterval = Math.max(
    scaling.spawn_interval_min_sec,
    scaling.spawn_interval_base_sec -
      (waveNumber - 1) * scaling.spawn_interval_decay_per_wave
  );
  return buildInterleavedEntries(
    countsByEnemyId,
    waveNumber,
    baseInterval,
    scaling,
    random
  );
}

function computeEnemyCountForWave(
  scaling: WaveScalingConfig,
  waveNumber: number,
  random: () => number
): number {
  const base =
    scaling.base_enemy_count +
    (waveNumber - 1) * scaling.enemy_count_growth_per_wave +
    Math.floor((waveNumber - 1) / 5) * (scaling.extra_enemy_count_per_5_waves ?? 0);
  const jitter = randomRange(random, -0.12, 0.12) * base;
  return Math.max(1, Math.round(base + jitter));
}

function applyBossEntryIfNeeded(
  countsByEnemyId: Map<string, number>,
  scaling: WaveScalingConfig,
  waveNumber: number
): void {
  if (
    !scaling.boss_wave_interval ||
    !scaling.boss_enemy_id ||
    waveNumber % scaling.boss_wave_interval !== 0
  ) {
    return;
  }

  const bossCount = 1 + Math.floor((waveNumber - 1) / (scaling.boss_wave_interval * 2));
  countsByEnemyId.set(
    scaling.boss_enemy_id,
    (countsByEnemyId.get(scaling.boss_enemy_id) ?? 0) + bossCount
  );
}

function pickDistinctWeighted<T>(
  random: () => number,
  source: T[],
  count: number,
  getWeight: (item: T) => number
): T[] {
  const available = [...source];
  const result: T[] = [];
  while (result.length < count && available.length > 0) {
    const picked = weightedPick(random, available, getWeight) ?? available[0];
    result.push(picked);
    const index = available.indexOf(picked);
    if (index >= 0) {
      available.splice(index, 1);
    } else {
      available.shift();
    }
  }
  return result;
}

function buildInterleavedEntries(
  countsByEnemyId: Map<string, number>,
  waveNumber: number,
  baseInterval: number,
  scaling: WaveScalingConfig,
  random: () => number
): WaveEntryConfig[] {
  const remaining = Array.from(countsByEnemyId.entries())
    .filter(([, count]) => count > 0)
    .map(([enemyId, count]) => ({ enemyId, count }));
  const entries: WaveEntryConfig[] = [];

  while (remaining.some((entry) => entry.count > 0)) {
    for (let index = 0; index < remaining.length; index += 1) {
      const bucket = remaining[index];
      if (bucket.count <= 0) {
        continue;
      }
      const chunkSize = Math.min(bucket.count, randomInt(random, 1, 3));
      bucket.count -= chunkSize;

      const isBoss = scaling.boss_enemy_id === bucket.enemyId;
      const intervalJitter = randomRange(random, 0.92, 1.08);
      const interval = Math.max(
        scaling.spawn_interval_min_sec,
        (isBoss ? baseInterval * 1.3 : baseInterval) * intervalJitter
      );
      entries.push({
        wave: waveNumber,
        enemy_id: bucket.enemyId,
        count: chunkSize,
        spawn_interval_sec: Math.round(interval * 1000) / 1000
      });
    }
  }

  return entries;
}

const PhaserSafe = {
  clampInteger(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }
};
