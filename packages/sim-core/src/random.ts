export type SeededRandom = {
  readonly seed: string;
  nextFloat(): number;
};

const UINT32_RANGE = 0x1_0000_0000;

export function createSeededRandom(seed: string): SeededRandom {
  if (seed.length === 0) {
    throw new Error('seed must not be empty');
  }

  let state = hashSeed(seed);
  return {
    seed,
    nextFloat() {
      state = nextState(state);
      return state / UINT32_RANGE;
    },
  };
}

export function rollProbabilityPercent(probabilityPercent: number, rng: SeededRandom): boolean {
  if (!Number.isFinite(probabilityPercent) || probabilityPercent < 0 || probabilityPercent > 100) {
    throw new Error(
      `probabilityPercent must be a finite number between 0 and 100, received ${probabilityPercent}`,
    );
  }

  if (probabilityPercent === 0) {
    return false;
  }
  if (probabilityPercent === 100) {
    return true;
  }
  return rng.nextFloat() < probabilityPercent / 100;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextState(current: number): number {
  let value = current;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}
