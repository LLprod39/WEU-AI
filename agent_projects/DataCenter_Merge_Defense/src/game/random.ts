export type RandomFn = () => number;

const UINT32_SIZE = 0x100000000;

export function hashStringToSeed(source: string, baseSeed = 2166136261): number {
  let hash = baseSeed >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mixSeed(baseSeed: number, salt: string | number): number {
  return hashStringToSeed(String(salt), baseSeed >>> 0);
}

export function createSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_SIZE;
  };
}

export function randomInt(random: RandomFn, min: number, maxInclusive: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(maxInclusive);
  if (high <= low) {
    return low;
  }
  const span = high - low + 1;
  return low + Math.floor(random() * span);
}

export function randomRange(random: RandomFn, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + random() * (max - min);
}

export function weightedPick<T>(
  random: RandomFn,
  items: readonly T[],
  getWeight: (item: T) => number
): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  let totalWeight = 0;
  const normalizedWeights = items.map((item) => {
    const weight = Math.max(0, getWeight(item));
    totalWeight += weight;
    return weight;
  });

  if (totalWeight <= 0) {
    return items[0];
  }

  let threshold = random() * totalWeight;
  for (let index = 0; index < items.length; index += 1) {
    threshold -= normalizedWeights[index];
    if (threshold <= 0) {
      return items[index];
    }
  }

  return items[items.length - 1];
}

export function shuffledCopy<T>(random: RandomFn, source: readonly T[]): T[] {
  const array = [...source];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}
