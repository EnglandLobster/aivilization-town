/** Personal service-standard choice, distinct from physical premises or private leases. */
export const HOUSING_CHOICE_POLICY = {
  version: 'resident-housing-choice-v1',
  maximumTier: 32,
} as const;
export type HousingChoiceState = {
  readonly policy: typeof HOUSING_CHOICE_POLICY;
  readonly availableTiers: readonly number[];
  readonly revisions: Readonly<Record<string, number>>;
};
export type HousingStandardChoice = {
  readonly policyVersion: typeof HOUSING_CHOICE_POLICY.version;
  readonly actorId: string;
  readonly at: number;
  readonly previousRevision: number;
  readonly revision: number;
  readonly previousTier: number;
  readonly nextTier: number;
};
const validActor = (id: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) &&
  !Object.hasOwn(Object.prototype, id) &&
  id !== 'system';
const validTier = (n: number) =>
  Number.isSafeInteger(n) && n >= 1 && n <= HOUSING_CHOICE_POLICY.maximumTier;
const isArray = (v: unknown): boolean => Array.isArray(v);
export function assertHousingChoiceState(s: HousingChoiceState) {
  if (
    !isArray(s.availableTiers) ||
    !s.availableTiers.length ||
    s.availableTiers.length > 32 ||
    s.availableTiers.some((t) => !validTier(t)) ||
    new Set(s.availableTiers).size !== s.availableTiers.length ||
    Object.keys(s.policy).length !== 2 ||
    s.policy.version !== HOUSING_CHOICE_POLICY.version ||
    s.policy.maximumTier !== HOUSING_CHOICE_POLICY.maximumTier ||
    Object.entries(s.revisions).some(
      ([id, r]) => !validActor(id) || !Number.isSafeInteger(r) || r < 1,
    )
  )
    throw Error('invalid-housing-choice-state');
}
export const housingChoiceRevision = (s: HousingChoiceState, actor: string) =>
  s.revisions[actor] ?? 1;
export function recordHousingStandardChange(
  s: HousingChoiceState,
  actor: string,
): HousingChoiceState {
  assertHousingChoiceState(s);
  const revision = housingChoiceRevision(s, actor) + 1;
  if (!Number.isSafeInteger(revision)) throw Error('housing-choice-revision-exhausted');
  return { ...s, revisions: { ...s.revisions, [actor]: revision } };
}
export function decideHousingStandardChoice(input: {
  state: HousingChoiceState;
  actorId: string;
  at: number;
  currentTier: number;
  targetTier: number;
  expectedRevision: number;
}) {
  const { state, actorId, at, currentTier, targetTier, expectedRevision } = input;
  assertHousingChoiceState(state);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (
    !validActor(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    ![currentTier, targetTier].every(validTier)
  )
    return no('invalid-housing-standard-choice');
  if (expectedRevision !== housingChoiceRevision(state, actorId))
    return no('housing-choice-revision-conflict');
  if (!state.availableTiers.includes(targetTier)) return no('housing-standard-not-supported');
  if (targetTier >= currentTier) return no('housing-choice-requires-lower-standard');
  if (!Number.isSafeInteger(expectedRevision + 1)) return no('housing-choice-revision-exhausted');
  return {
    accepted: true as const,
    event: {
      policyVersion: state.policy.version,
      actorId,
      at,
      previousRevision: expectedRevision,
      revision: expectedRevision + 1,
      previousTier: currentTier,
      nextTier: targetTier,
    } satisfies HousingStandardChoice,
  };
}
export function applyHousingStandardChoice(
  s: HousingChoiceState,
  currentTier: number,
  e: HousingStandardChoice,
) {
  assertHousingChoiceState(s);
  if (
    !validActor(e.actorId) ||
    !Number.isSafeInteger(e.at) ||
    e.at < 0 ||
    ![e.previousTier, e.nextTier].every(validTier) ||
    e.nextTier >= e.previousTier ||
    e.previousRevision !== housingChoiceRevision(s, e.actorId) ||
    !Number.isSafeInteger(e.revision) ||
    e.policyVersion !== s.policy.version ||
    !s.availableTiers.includes(e.nextTier) ||
    e.previousTier !== currentTier ||
    e.revision !== e.previousRevision + 1
  )
    throw Error('housing-standard-choice-source-mismatch');
  return { state: recordHousingStandardChange(s, e.actorId), tier: e.nextTier };
}
