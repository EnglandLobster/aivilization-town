import { advanceElapsedPhysiology, type ElapsedPhysiologyInput } from './elapsedPhysiology';
import { advanceElapsedLaborPhysiology } from './residentLabor';
import {
  residentServiceEffect,
  serviceLearningAndMaterials,
  type ResidentServiceEffectId,
  type ServiceParticipantCondition,
} from './serviceEffects';

export const SERVICE_PHYSIOLOGY_VERSION = 'resident-service-physiology-v2';
// Cancellation near an exhausted axis can lose relative precision. Bound the allowance to
// one hundred-millionth of the 1 ms work quantum; zero resources can never buy positive work.
export const SERVICE_PHYSIOLOGY_TIME_PRECISION_MS = 1e-8;
const within = (cost: number, available: number, ratePerHour: number) =>
  cost <= available ||
  (available > 0 &&
    cost - available <=
      Math.max(Math.abs(cost), Math.abs(available)) * 8 * Number.EPSILON +
        (ratePerHour / 3600000) * SERVICE_PHYSIOLOGY_TIME_PRECISION_MS);
/** A recovery ceiling never destroys an existing value; a harm floor never heals it. */
function simultaneousGainAndLoss(
  previous: number,
  seconds: number,
  gain: number,
  loss: number,
  floor: number,
  ceiling: number,
): number {
  let value = previous,
    remaining = seconds;
  if (value > ceiling) {
    const above = loss === 0 ? remaining : Math.min(remaining, (value - ceiling) / loss);
    value -= above * loss;
    remaining -= above;
  }
  if (value < floor) {
    const below = gain === 0 ? remaining : Math.min(remaining, (floor - value) / gain);
    value += below * gain;
    remaining -= below;
  }
  if (remaining > 0) value = Math.max(floor, Math.min(ceiling, value + (gain - loss) * remaining));
  return value;
}
export function advanceServicePhysiology(input: {
  readonly modelId: ResidentServiceEffectId;
  readonly previousProgressMs: number;
  readonly provider: ServiceParticipantCondition;
  readonly recipient: ServiceParticipantCondition;
  readonly educationCeiling: number;
  readonly elapsedMs: number;
  readonly workLimitMs: number;
  readonly decay: ElapsedPhysiologyInput['decay'];
  readonly deprivation?: NonNullable<ElapsedPhysiologyInput['deprivation']>;
}) {
  const model = residentServiceEffect(input.modelId);
  if (
    !model ||
    !Number.isSafeInteger(input.elapsedMs) ||
    input.elapsedMs < 0 ||
    !Number.isSafeInteger(input.workLimitMs) ||
    input.workLimitMs < 0 ||
    input.workLimitMs > input.elapsedMs ||
    !Number.isSafeInteger(input.previousProgressMs) ||
    input.previousProgressMs < 0 ||
    (input.deprivation?.minHealth ?? 0) > 100
  )
    throw Error('invalid-service-physiology-input');
  for (const previous of [input.provider, input.recipient])
    advanceElapsedPhysiology({ ...input, previous, elapsedMs: 0 });
  serviceLearningAndMaterials({ ...input, nextProgressMs: input.previousProgressMs });
  const advance = (previous: ServiceParticipantCondition, ms: number, provider: boolean) => {
    const energyCostPerHour = provider ? model.providerEnergyPerHour : model.recipientEnergyPerHour;
    const satietyCostPerHour = provider
      ? model.providerSatietyPerHour
      : model.recipientSatietyPerHour;
    const base = advanceElapsedLaborPhysiology({
      ...input,
      previous,
      elapsedMs: ms,
      labor: { energyCostPerHour, satietyCostPerHour },
    });
    if (provider)
      return { ...base, next: { ...base.next, educationScore: previous.educationScore } };
    const highSeconds = (ms - base.lowEnergyMs) / 1000;
    const healthBeforeLow = simultaneousGainAndLoss(
      previous.health,
      highSeconds,
      model.healthPerHour / 3600,
      0,
      0,
      100,
    );
    const health = simultaneousGainAndLoss(
      healthBeforeLow,
      base.lowEnergyMs / 1000,
      model.healthPerHour / 3600,
      input.deprivation?.healthDecayPerSecond ?? 0,
      input.deprivation?.minHealth ?? 0,
      100,
    );
    return {
      ...base,
      next: {
        ...base.next,
        health,
        satiety: simultaneousGainAndLoss(
          previous.satiety,
          ms / 1000,
          model.satietyPerHour / 3600,
          (input.decay.satietyPerHour + satietyCostPerHour) / 3600,
          0,
          100,
        ),
        educationScore: previous.educationScore,
      },
    };
  };
  const affordable = (ms: number) => {
    const h = ms / 3600000;
    return ([true, false] as const).every((provider) => {
      const before = provider ? input.provider : input.recipient;
      const energy = provider ? model.providerEnergyPerHour : model.recipientEnergyPerHour;
      const satiety = provider ? model.providerSatietyPerHour : model.recipientSatietyPerHour;
      return (
        before.health > 0 &&
        (energy === 0 ||
          within(
            (input.decay.energyPerHour + energy) * h,
            before.energy,
            input.decay.energyPerHour + energy,
          )) &&
        (satiety === 0 ||
          within(
            Math.max(
              0,
              input.decay.satietyPerHour + satiety - (provider ? 0 : model.satietyPerHour),
            ) * h,
            before.satiety,
            Math.max(
              0,
              input.decay.satietyPerHour + satiety - (provider ? 0 : model.satietyPerHour),
            ),
          )) &&
        advance(before, ms, provider).next.health > 0
      );
    });
  };
  let low = 0,
    high = input.workLimitMs;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (affordable(mid)) low = mid;
    else high = mid - 1;
  }
  const workedMs = low;
  const providerWork = advance(input.provider, workedMs, true),
    recipientWork = advance(input.recipient, workedMs, false);
  const facts = serviceLearningAndMaterials({
    ...input,
    nextProgressMs: input.previousProgressMs + workedMs,
  });
  const remainder = (previous: ServiceParticipantCondition) =>
    advanceElapsedPhysiology({ ...input, previous, elapsedMs: input.elapsedMs - workedMs });
  const providerAfter = remainder(providerWork.next),
    recipientAfter = remainder(recipientWork.next);
  return {
    workedMs,
    provider: { ...providerAfter.next, educationScore: input.provider.educationScore },
    recipient: { ...recipientAfter.next, educationScore: facts.educationScore },
    consumed: facts.consumed,
    providerLowEnergyMs: providerWork.lowEnergyMs + providerAfter.lowEnergyMs,
    recipientLowEnergyMs: recipientWork.lowEnergyMs + recipientAfter.lowEnergyMs,
  };
}
