import type {
  PassivePhysiologicalDecayPolicy,
  PhysiologicalState,
  SleepDeprivationHealthDecayPolicy,
} from './physiology';

export const ELAPSED_PHYSIOLOGY_VERSION = 'resident-elapsed-physiology-v1';
export type ElapsedPhysiologyInput = {
  readonly previous: PhysiologicalState;
  readonly elapsedMs: number;
  readonly decay: PassivePhysiologicalDecayPolicy;
  readonly deprivation?: SleepDeprivationHealthDecayPolicy;
  /** A validated, actually active sleep interval; residents cannot supply rates through CLI. */
  readonly sleep?: { readonly energyPerSecond: number; readonly maximum: number };
};

function finiteNonnegative(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw Error('invalid-elapsed-physiology-input');
}

/** Integrate one constant-rate segment, including the time spent strictly below the threshold. */
function energySegment(
  energy: number,
  rate: number,
  seconds: number,
  ceiling: number,
  threshold: number,
) {
  const raw = energy + rate * seconds;
  if (!Number.isFinite(raw)) throw Error('elapsed-physiology-overflow');
  const next = Math.max(0, Math.min(ceiling, raw));
  let belowSeconds = 0;
  if (threshold > 0) {
    if (rate === 0) belowSeconds = energy < threshold ? seconds : 0;
    else if (rate > 0)
      belowSeconds =
        ceiling < threshold ? seconds : Math.min(seconds, Math.max(0, (threshold - energy) / rate));
    else belowSeconds = seconds - Math.min(seconds, Math.max(0, (energy - threshold) / -rate));
  }
  return { energy: next, belowSeconds };
}

/**
 * Simultaneous physical rates; no clock, randomness, resource grant or activity decision.
 * The caller splits at start/end/interrupt/discrete-event boundaries. Equivalent time partitions
 * have equivalent state (within floating-point precision), including caps and threshold crossings.
 */
export function advanceElapsedPhysiology(input: ElapsedPhysiologyInput): {
  readonly next: PhysiologicalState;
  readonly lowEnergyMs: number;
} {
  for (const value of [
    ...Object.values(input.previous),
    input.elapsedMs,
    input.decay.energyPerHour,
    input.decay.satietyPerHour,
    ...(input.deprivation ? Object.values(input.deprivation) : []),
    ...(input.sleep ? Object.values(input.sleep) : []),
  ])
    finiteNonnegative(value);
  const seconds = input.elapsedMs / 1000;
  const decayRate = input.decay.energyPerHour / 3600;
  const threshold = input.deprivation?.energyThreshold ?? 0;
  let energy = input.previous.energy;
  let remaining = seconds;
  let lowSeconds = 0;

  // A reduced recovery cap must not remove previously held energy. Above it, only decay applies
  // until the trajectory reaches the cap; recovery can then counter further decay.
  if (input.sleep && energy > input.sleep.maximum) {
    const aboveSeconds =
      decayRate === 0 ? remaining : Math.min(remaining, (energy - input.sleep.maximum) / decayRate);
    const above = energySegment(energy, -decayRate, aboveSeconds, energy, threshold);
    energy = above.energy;
    lowSeconds += above.belowSeconds;
    remaining -= aboveSeconds;
  }
  if (remaining > 0) {
    const segment = energySegment(
      energy,
      (input.sleep?.energyPerSecond ?? 0) - decayRate,
      remaining,
      input.sleep?.maximum ?? energy,
      threshold,
    );
    energy = segment.energy;
    lowSeconds += segment.belowSeconds;
  }
  const satietyLoss = (input.decay.satietyPerHour * seconds) / 3600;
  const healthLoss = (input.deprivation?.healthDecayPerSecond ?? 0) * lowSeconds;
  if (!Number.isFinite(satietyLoss) || !Number.isFinite(healthLoss))
    throw Error('elapsed-physiology-overflow');
  return {
    next: {
      energy,
      satiety: Math.max(0, input.previous.satiety - satietyLoss),
      // A floor limits new harm; it is never an implicit healing or resurrection rule.
      health: Math.min(
        input.previous.health,
        Math.max(input.deprivation?.minHealth ?? 0, input.previous.health - healthLoss),
      ),
    },
    lowEnergyMs: lowSeconds * 1000,
  };
}
