/** Explicit simulation assumptions. Resident text cannot register a new effect or credential. */
export const RESIDENT_SERVICE_EFFECTS_POLICY = {
  version: 'resident-service-effects-v1',
  hourMs: 3_600_000,
  maxHealth: 100,
  maxSatiety: 100,
} as const;
export type ResidentServiceEffectId =
  | 'personal-assistance-v1'
  | 'supportive-care-v1'
  | 'guided-study-v1'
  | 'meal-assistance-v1';
export type ResidentServiceEffectModel = {
  readonly id: ResidentServiceEffectId;
  readonly facility: 'none' | 'careStations' | 'teachingStations';
  readonly consumablesPerHour: Readonly<Record<string, number>>;
  readonly tools: Readonly<Record<string, number>>;
  readonly providerEnergyPerHour: number;
  readonly providerSatietyPerHour: number;
  readonly recipientEnergyPerHour: number;
  readonly recipientSatietyPerHour: number;
  readonly healthPerHour: number;
  readonly satietyPerHour: number;
  readonly educationPerHour: number;
};
const base = {
  consumablesPerHour: {},
  tools: {},
  providerEnergyPerHour: 10,
  providerSatietyPerHour: 5,
  recipientEnergyPerHour: 0,
  recipientSatietyPerHour: 0,
  healthPerHour: 0,
  satietyPerHour: 0,
  educationPerHour: 0,
} as const;
export const RESIDENT_SERVICE_EFFECT_MODELS: Readonly<
  Record<ResidentServiceEffectId, ResidentServiceEffectModel>
> = {
  'personal-assistance-v1': { ...base, id: 'personal-assistance-v1', facility: 'none' },
  'supportive-care-v1': {
    ...base,
    id: 'supportive-care-v1',
    facility: 'careStations',
    healthPerHour: 4,
  },
  'guided-study-v1': {
    ...base,
    id: 'guided-study-v1',
    facility: 'teachingStations',
    tools: { Book: 1 },
    recipientEnergyPerHour: 4,
    recipientSatietyPerHour: 2,
    educationPerHour: 1,
  },
  'meal-assistance-v1': {
    ...base,
    id: 'meal-assistance-v1',
    facility: 'none',
    consumablesPerHour: { Apple: 4 },
    satietyPerHour: 80,
  },
};
export const residentServiceEffect = (id: string): ResidentServiceEffectModel | undefined =>
  Object.hasOwn(RESIDENT_SERVICE_EFFECT_MODELS, id)
    ? RESIDENT_SERVICE_EFFECT_MODELS[id as ResidentServiceEffectId]
    : undefined;
export type ServiceParticipantCondition = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
  readonly educationScore: number;
};
const rounded = (n: number) => Math.round(n * 1e10) / 1e10;
export function serviceEffectQuantity(progressMs: number, perHour: number): number {
  if (
    !Number.isSafeInteger(progressMs) ||
    progressMs < 0 ||
    !Number.isFinite(perHour) ||
    perHour < 0
  )
    throw new Error('invalid-service-effect-quantity');
  return rounded((progressMs / RESIDENT_SERVICE_EFFECTS_POLICY.hourMs) * perHour);
}
export function serviceEffectRequirements(model: ResidentServiceEffectModel, durationMs: number) {
  const items: Record<string, number> = { ...model.tools };
  for (const [item, rate] of Object.entries(model.consumablesPerHour))
    items[item] = rounded((items[item] ?? 0) + serviceEffectQuantity(durationMs, rate));
  return items;
}
/** Deltas come from measured cumulative progress; splitting progress does not round each interval separately. */
export function applyResidentServiceEffect(input: {
  modelId: ResidentServiceEffectId;
  previousProgressMs: number;
  nextProgressMs: number;
  provider: ServiceParticipantCondition;
  recipient: ServiceParticipantCondition;
  educationCeiling: number;
}) {
  const model = residentServiceEffect(input.modelId);
  if (
    !model ||
    input.nextProgressMs < input.previousProgressMs ||
    !Number.isFinite(input.educationCeiling) ||
    input.educationCeiling < 0 ||
    [input.provider, input.recipient].some((p) =>
      Object.values(p).some((v) => !Number.isFinite(v) || v < 0),
    )
  )
    throw new Error('invalid-service-effect-input');
  const delta = (rate: number) =>
    rounded(
      serviceEffectQuantity(input.nextProgressMs, rate) -
        serviceEffectQuantity(input.previousProgressMs, rate),
    );
  const cost = (p: ServiceParticipantCondition, energy: number, satiety: number) => {
    const energyCost = delta(energy),
      satietyCost = delta(satiety);
    if (energyCost > p.energy || satietyCost > p.satiety)
      throw new Error('service-effort-unaffordable');
    return {
      ...p,
      energy: rounded(p.energy - energyCost),
      satiety: rounded(p.satiety - satietyCost),
    };
  };
  const provider = cost(input.provider, model.providerEnergyPerHour, model.providerSatietyPerHour);
  let recipient = cost(
    input.recipient,
    model.recipientEnergyPerHour,
    model.recipientSatietyPerHour,
  );
  const facts = serviceLearningAndMaterials(input);
  recipient = {
    ...recipient,
    health:
      model.healthPerHour > 0
        ? Math.max(
            recipient.health,
            Math.min(
              RESIDENT_SERVICE_EFFECTS_POLICY.maxHealth,
              rounded(recipient.health + delta(model.healthPerHour)),
            ),
          )
        : recipient.health,
    satiety:
      model.satietyPerHour > 0
        ? Math.max(
            recipient.satiety,
            Math.min(
              RESIDENT_SERVICE_EFFECTS_POLICY.maxSatiety,
              rounded(recipient.satiety + delta(model.satietyPerHour)),
            ),
          )
        : recipient.satiety,
    educationScore: facts.educationScore,
  };
  return { provider, recipient, consumed: facts.consumed };
}
/** Shared measured learning/material facts; bodily integration may use a separately versioned model. */
export function serviceLearningAndMaterials(input: {
  modelId: ResidentServiceEffectId;
  previousProgressMs: number;
  nextProgressMs: number;
  provider: Pick<ServiceParticipantCondition, 'educationScore'>;
  recipient: Pick<ServiceParticipantCondition, 'educationScore'>;
  educationCeiling: number;
}) {
  const model = residentServiceEffect(input.modelId);
  if (
    !model ||
    input.nextProgressMs < input.previousProgressMs ||
    [input.educationCeiling, input.provider.educationScore, input.recipient.educationScore].some(
      (v) => !Number.isFinite(v) || v < 0,
    )
  )
    throw Error('invalid-service-learning-input');
  const delta = (rate: number) =>
    rounded(
      serviceEffectQuantity(input.nextProgressMs, rate) -
        serviceEffectQuantity(input.previousProgressMs, rate),
    );
  const consumed: Record<string, number> = {};
  for (const [item, rate] of Object.entries(model.consumablesPerHour)) {
    const amount = delta(rate);
    if (amount > 0) consumed[item] = amount;
  }
  return {
    educationScore: Math.max(
      input.recipient.educationScore,
      Math.min(
        input.educationCeiling,
        input.provider.educationScore,
        rounded(input.recipient.educationScore + delta(model.educationPerHour)),
      ),
    ),
    consumed,
  };
}
/** Both people pay their own bodily cost. Payment or group membership never supplies this consent. */
export function affordableServiceDuration(input: {
  modelId: ResidentServiceEffectId;
  progressMs: number;
  elapsedMs: number;
  provider: ServiceParticipantCondition;
  recipient: ServiceParticipantCondition;
  educationCeiling: number;
}) {
  if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0)
    throw new Error('invalid-service-elapsed-time');
  let low = 0,
    high = input.elapsedMs;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    try {
      applyResidentServiceEffect({
        ...input,
        previousProgressMs: input.progressMs,
        nextProgressMs: input.progressMs + mid,
      });
      low = mid;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'service-effort-unaffordable') throw error;
      high = mid - 1;
    }
  }
  return low;
}
