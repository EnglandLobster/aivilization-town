/** Open residents own their interpretations, never the source world facts. */
export const COGNITION_POLICY_VERSION = 'resident-cognition-v1';
export const CONTINUOUS_COGNITION_VERSION = 'resident-cognition-v2';
export type CognitiveEntry = {
  readonly ownerId: string;
  readonly key: string;
  readonly kind: 'belief' | 'goal' | 'note' | 'self';
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly revision: number;
  readonly updatedAt: number;
  readonly active: boolean;
  readonly pinned?: boolean;
  readonly people?: readonly string[];
};
export type CognitiveState = Readonly<Record<string, CognitiveEntry>>;
export type CognitiveUpdate = Omit<CognitiveEntry, 'ownerId' | 'revision' | 'updatedAt'> & {
  readonly expectedRevision: number;
};
export type CognitiveEvent = {
  readonly type: 'PersonalCognitionUpdated';
  readonly entry: CognitiveEntry;
};
export function decideCognitiveUpdate(input: {
  readonly ownerId: string;
  readonly at: number;
  readonly state: CognitiveState;
  readonly update: CognitiveUpdate;
  readonly visibleEvidenceIds: ReadonlySet<string>;
  readonly policyVersion?: 'resident-cognition-v1' | 'resident-cognition-v2';
}):
  | { readonly accepted: true; readonly event: CognitiveEvent }
  | { readonly accepted: false; readonly reason: string } {
  const { update, state, ownerId, at } = input;
  const reject = (reason: string) => ({ accepted: false as const, reason });
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(update.key) ||
    update.key === 'constructor' ||
    update.statement.trim().length === 0 ||
    update.statement.length > 8_000 ||
    !['belief', 'goal', 'note', 'self'].includes(update.kind) ||
    !Number.isFinite(update.confidence) ||
    update.confidence < 0 ||
    update.confidence > 1 ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    typeof update.active !== 'boolean'
  )
    return reject('invalid-cognition');
  if (
    update.evidenceIds.length > 30 ||
    update.evidenceIds.some((id) => !input.visibleEvidenceIds.has(id))
  )
    return reject('evidence-not-visible');
  const existing = state[update.key];
  if (existing !== undefined && existing.ownerId !== ownerId) return reject('permission-denied');
  if (update.expectedRevision !== (existing?.revision ?? 0)) return reject('revision-conflict');
  if (
    input.policyVersion !== undefined &&
    !['resident-cognition-v1', 'resident-cognition-v2'].includes(input.policyVersion)
  )
    return reject('invalid-cognition-policy');
  if (update.pinned !== undefined && typeof update.pinned !== 'boolean')
    return reject('invalid-pinned');
  if (
    update.people !== undefined &&
    (update.people.length > 100 ||
      update.people.some((id) => typeof id !== 'string' || id.length > 96))
  )
    return reject('invalid-people');
  if (input.policyVersion === 'resident-cognition-v2') {
    if (
      update.active &&
      !existing?.active &&
      Object.values(state).filter((e) => e.active).length >= 256
    )
      return reject('active-cognition-limit-archive-an-entry');
  } else if (existing === undefined && Object.keys(state).length >= 256)
    return reject('cognition-limit');
  const pinned = update.pinned ?? existing?.pinned;
  const people = update.people ?? existing?.people;
  return {
    accepted: true,
    event: {
      type: 'PersonalCognitionUpdated',
      entry: {
        ownerId,
        key: update.key,
        kind: update.kind,
        statement: update.statement,
        confidence: update.confidence,
        evidenceIds: [...new Set(update.evidenceIds)],
        revision: update.expectedRevision + 1,
        updatedAt: at,
        active: update.active,
        ...(pinned === undefined ? {} : { pinned }),
        ...(people === undefined ? {} : { people }),
      },
    },
  };
}
export function applyCognitiveEvent(state: CognitiveState, event: CognitiveEvent): CognitiveState {
  return { ...state, [event.entry.key]: event.entry };
}
