export const COLLECTIVES_POLICY = {
  version: 'resident-collectives-v1',
  maxCollectivesPerFounder: 20,
  maxMembers: 30,
  maxOpenDecisions: 20,
  maxDecisions: 500,
  maxText: 8000,
  maxActionChars: 12000,
  maxObjectChars: 20000,
  maxHorizonMs: 30 * 86_400_000,
} as const;
export type CollectivesPolicy = { readonly version: 'resident-collectives-v1' } & {
  readonly [K in Exclude<keyof typeof COLLECTIVES_POLICY, 'version'>]: number;
};
export type CollectiveConfiguration = {
  readonly title: string;
  readonly terms: string;
  readonly members: readonly string[];
  readonly voters: readonly string[];
  readonly threshold: number;
  readonly quorum: number;
  readonly timing: 'deadline' | 'early';
  readonly revote: boolean;
};
export type CollectiveCharter = CollectiveConfiguration & {
  readonly id: string;
  readonly founderId: string;
  readonly revision: number;
  readonly version: number;
  readonly consents: Readonly<
    Record<
      string,
      { readonly version: number; readonly accepted: boolean; readonly decisionId?: string }
    >
  >;
  readonly authorityDecisionId?: string;
  readonly status: 'pending' | 'active' | 'rejected' | 'withdrawn' | 'expired';
  readonly at: number;
  readonly expiresAt: number;
};
export type CollectiveAction =
  | { readonly kind: 'statement' }
  | { readonly kind: 'amend'; readonly configuration: CollectiveConfiguration }
  | {
      readonly kind: 'resource';
      readonly capability: string;
      readonly resourceId: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    };
export type CollectiveDecision = {
  readonly id: string;
  readonly collectiveId: string;
  readonly authorId: string;
  readonly terms: string;
  readonly action: CollectiveAction;
  readonly charterVersion: number;
  readonly voters: readonly string[];
  readonly threshold: number;
  readonly quorum: number;
  readonly timing: CollectiveConfiguration['timing'];
  readonly revote: boolean;
  readonly votes: Readonly<Record<string, 'yes' | 'no' | 'abstain'>>;
  readonly joinConsents: Readonly<Record<string, boolean>>;
  readonly invitedMembers: readonly string[];
  readonly status: 'open' | 'passed' | 'rejected' | 'executed' | 'expired';
  readonly revision: number;
  readonly at: number;
  readonly closesAt: number;
  readonly executeBefore: number;
  readonly decidedAt?: number;
  readonly executedAt?: number;
  readonly executedBy?: string;
};
export type CollectivesState = {
  readonly policy: CollectivesPolicy;
  readonly charters: Readonly<Record<string, CollectiveCharter>>;
  readonly charterHistory: Readonly<Record<string, readonly CollectiveCharter[]>>;
  readonly decisions: Readonly<Record<string, CollectiveDecision>>;
  readonly decisionHistory: Readonly<Record<string, readonly CollectiveDecision[]>>;
};
export type CollectiveEvent =
  | { readonly type: 'CollectivesEnabled'; readonly policy: CollectivesPolicy }
  | { readonly type: 'CollectiveCharterChanged'; readonly charter: CollectiveCharter }
  | { readonly type: 'CollectiveDecisionChanged'; readonly decision: CollectiveDecision };
export type CollectiveCommand =
  | { type: 'create'; id: string; configuration: unknown; expiresAt: number }
  | { type: 'respond'; id: string; expectedRevision: number; accept: boolean }
  | { type: 'withdraw'; id: string; expectedRevision: number }
  | { type: 'leave'; id: string; expectedRevision: number }
  | {
      type: 'propose';
      id: string;
      collectiveId: string;
      expectedVersion: number;
      terms: string;
      action: unknown;
      closesAt: number;
      executeBefore: number;
    }
  | { type: 'vote'; id: string; expectedRevision: number; vote: 'yes' | 'no' | 'abstain' }
  | { type: 'decide' | 'execute'; id: string; expectedRevision: number }
  | { type: 'join'; id: string; expectedRevision: number; accept: boolean };
export type CollectiveResult =
  | { accepted: true; events: readonly CollectiveEvent[] }
  | { accepted: false; reason: string };
export type CollectiveResourceAction = Extract<CollectiveAction, { kind: 'resource' }>;
export const collectiveId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) &&
  !Object.hasOwn(Object.prototype, v);
export const collectiveText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export const collectiveOperable = (c: CollectiveCharter) =>
  c.status === 'active' && c.voters.length >= c.quorum && c.voters.length >= c.threshold;
export const canReadCollective = (c: CollectiveCharter, actorId: string) =>
  c.members.includes(actorId) || (c.founderId === actorId && c.status !== 'active');
export const canReadCollectiveDecision = (
  s: CollectivesState,
  d: CollectiveDecision,
  actorId: string,
) =>
  d.authorId === actorId ||
  d.voters.includes(actorId) ||
  d.invitedMembers.includes(actorId) ||
  !!s.charters[d.collectiveId]?.members.includes(actorId);
export function assertCollectivesPolicy(p: CollectivesPolicy) {
  if (
    p.version !== 'resident-collectives-v1' ||
    Object.keys(COLLECTIVES_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isSafeInteger(p[k as keyof CollectivesPolicy]) ||
          Number(p[k as keyof CollectivesPolicy]) < 1),
    )
  )
    throw new Error('invalid-collectives-policy');
}
export function emptyCollectivesState(
  policy: CollectivesPolicy = COLLECTIVES_POLICY,
): CollectivesState {
  assertCollectivesPolicy(policy);
  return { policy, charters: {}, charterHistory: {}, decisions: {}, decisionHistory: {} };
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(v).length === expected.length && expected.every((k) => Object.hasOwn(v, k));
export function parseCollectiveConfiguration(
  v: unknown,
  p: CollectivesPolicy,
  exists: (id: string) => boolean,
): CollectiveConfiguration | undefined {
  if (
    !object(v) ||
    !keys(v, ['title', 'terms', 'members', 'voters', 'threshold', 'quorum', 'timing', 'revote']) ||
    !collectiveText(v.title, 120) ||
    !collectiveText(v.terms, p.maxText) ||
    !Array.isArray(v.members) ||
    !Array.isArray(v.voters) ||
    v.members.length < 1 ||
    v.members.length > p.maxMembers ||
    !v.members.every((id: unknown) => collectiveId(id) && exists(id)) ||
    new Set(v.members).size !== v.members.length ||
    v.voters.length < 1 ||
    !v.voters.every((id: unknown) => collectiveId(id) && (v.members as unknown[]).includes(id)) ||
    new Set(v.voters).size !== v.voters.length ||
    !Number.isSafeInteger(v.threshold) ||
    Number(v.threshold) < 1 ||
    !Number.isSafeInteger(v.quorum) ||
    Number(v.quorum) < Number(v.threshold) ||
    Number(v.quorum) > v.voters.length ||
    (v.timing !== 'early' && v.timing !== 'deadline') ||
    typeof v.revote !== 'boolean'
  )
    return undefined;
  return {
    title: v.title,
    terms: v.terms,
    members: [...(v.members as string[])],
    voters: [...(v.voters as string[])],
    threshold: Number(v.threshold),
    quorum: Number(v.quorum),
    timing: v.timing,
    revote: v.revote,
  };
}
export function parseCollectiveAction(
  v: unknown,
  p: CollectivesPolicy,
  exists: (id: string) => boolean,
): CollectiveAction | undefined {
  if (!object(v)) return undefined;
  if (keys(v, ['kind']) && v.kind === 'statement') return { kind: 'statement' };
  if (keys(v, ['kind', 'configuration']) && v.kind === 'amend') {
    const configuration = parseCollectiveConfiguration(v.configuration, p, exists);
    return configuration && JSON.stringify(configuration).length <= p.maxActionChars
      ? { kind: 'amend', configuration }
      : undefined;
  }
  if (
    keys(v, ['kind', 'capability', 'resourceId', 'arguments']) &&
    v.kind === 'resource' &&
    typeof v.capability === 'string' &&
    // Match real CLI operation names, including versioned settlement routes. Adapters still authorize a closed operation set.
    v.capability.length <= 120 &&
    /^[a-z][a-zA-Z]*(?:-[a-zA-Z]+)*\.[a-z][a-zA-Z]*(?:-[a-zA-Z]+)*$/.test(v.capability) &&
    collectiveId(v.resourceId) &&
    object(v.arguments)
  ) {
    try {
      const json = JSON.stringify(v.arguments);
      if (json.length > p.maxActionChars) return undefined;
      // Adapters validate a closed, capability-specific JSON schema before accepting a resource action.
      return {
        kind: 'resource',
        capability: v.capability,
        resourceId: v.resourceId,
        arguments: structuredClone(v.arguments),
      };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
