import {
  RESIDENT_SUCCESSION_POLICY as POLICY,
  type SuccessionArrangement,
  type SuccessionArrangementsState,
  type SuccessionAvailability,
  type SuccessionBinding,
  type SuccessionCommand,
  type SuccessionDecision,
  type SuccessionEvent,
  type SuccessionPorts,
  type SuccessionResourceFact,
  type SuccessionTerms,
  type SuccessionTriggerFact,
} from './residentSuccessionModel';
const validId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => time(v) && v > 0;
const require = (v: unknown, reason: string): void => {
  if (!v) throw Error(reason);
};
const exact = (v: unknown, keys: readonly string[], optional: readonly string[] = []) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  keys.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => keys.includes(k) || optional.includes(k));
const bindingKey = (b: SuccessionBinding) => `${b.kind}:${b.id}`;
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.entries(a).sort(([k], [l]) => k.localeCompare(l)),
    y = Object.entries(b).sort(([k], [l]) => k.localeCompare(l));
  return x.length === y.length && x.every(([k, v], i) => y[i]?.[0] === k && equal(v, y[i]?.[1]));
}
export function assertSuccessionBinding(b: SuccessionBinding) {
  require(exact(b, ['kind', 'id', 'entitlementVersion', 'duty'], ['maximumAmountMicros']) &&
    validId(b.id) &&
    positive(b.entitlementVersion), 'invalid-succession-binding');
  const expected =
    b.kind === 'personal-cash'
      ? 'cash-settlement'
      : b.kind === 'personal-backpack'
        ? 'custody-recovery'
        : b.kind === 'enterprise-capital'
          ? 'capital-rights'
          : [
                'stock',
                'vehicle',
                'premises',
                'space',
                'register',
                'view',
                'group',
                'service',
              ].includes(b.kind)
            ? 'control-handover'
            : undefined;
  require(expected === b.duty, 'succession-duty-source-kind-mismatch');
  require(b.duty === 'cash-settlement'
    ? positive(b.maximumAmountMicros) && b.maximumAmountMicros <= POLICY.maxAmountMicros
    : b.maximumAmountMicros === undefined, 'invalid-succession-amount-scope');
}
export function assertSuccessionTerms(t: SuccessionTerms, at: number) {
  require(exact(t, [
    'id',
    'ownerId',
    'executorId',
    'beneficiaryId',
    'text',
    'acceptBy',
    'expiresAt',
    'executionWindowMs',
    'bindings',
  ]) &&
    [t.id, t.ownerId, t.executorId, t.beneficiaryId].every(validId), 'invalid-succession-parties');
  require(t.ownerId !== t.executorId &&
    t.ownerId !== t.beneficiaryId, 'succession-independent-parties-required');
  require(time(at) &&
    time(t.acceptBy) &&
    time(t.expiresAt) &&
    t.acceptBy > at &&
    t.expiresAt > t.acceptBy &&
    t.expiresAt - at <= POLICY.maxHorizonMs &&
    positive(t.executionWindowMs) &&
    t.executionWindowMs <= POLICY.maxExecutionMs &&
    Number.isSafeInteger(t.expiresAt + t.executionWindowMs), 'invalid-succession-horizon');
  require(typeof t.text === 'string' &&
    t.text.trim().length > 0 &&
    t.text.length <= POLICY.maxTermsChars, 'invalid-succession-original-text');
  require(Array.isArray(t.bindings) &&
    t.bindings.length > 0 &&
    t.bindings.length <= POLICY.maxBindings, 'succession-bindings-required');
  t.bindings.forEach(assertSuccessionBinding);
  require(new Set(t.bindings.map(bindingKey)).size ===
    t.bindings.length, 'duplicate-succession-binding');
  require(t.bindings.every(
    (b) => !b.kind.startsWith('personal-') || b.id === t.ownerId,
  ), 'succession-personal-source-mismatch');
}
function assertFact(f: SuccessionResourceFact, b: SuccessionBinding) {
  require(exact(f, [
    'kind',
    'id',
    'sourceRevision',
    'entitlementVersion',
    'ownerId',
    'available',
  ]) &&
    f.kind === b.kind &&
    f.id === b.id &&
    positive(f.sourceRevision) &&
    positive(f.entitlementVersion) &&
    validId(f.ownerId) &&
    typeof f.available === 'boolean', 'invalid-succession-owning-resource-fact');
}
function assertOwnership(t: SuccessionTerms, facts: readonly SuccessionResourceFact[]) {
  require(Array.isArray(facts) &&
    facts.length === t.bindings.length, 'succession-owning-sources-required');
  t.bindings.forEach((b, i) => {
    const f = facts[i]!;
    assertFact(f, b);
    require(f.available &&
      f.ownerId === t.ownerId &&
      f.entitlementVersion ===
        b.entitlementVersion, 'succession-personally-owned-entitlement-required');
  });
}
function resourceAvailability(
  t: SuccessionTerms,
  b: SuccessionBinding,
  f: SuccessionResourceFact | null,
): SuccessionAvailability {
  if (f) assertFact(f, b);
  const reason =
    !f || !f.available
      ? ('source-unavailable' as const)
      : f.ownerId !== t.ownerId || f.entitlementVersion !== b.entitlementVersion
        ? ('entitlement-changed' as const)
        : undefined;
  return {
    binding: structuredClone(b),
    fact: structuredClone(f),
    eligible: !reason,
    ...(reason ? { reason } : {}),
  };
}
function ready(c: SuccessionArrangement) {
  return ['executor', 'beneficiary'].every((role) => {
    const consent = c.consents[role as 'executor' | 'beneficiary'];
    return consent?.accepted && consent.termsRevision === c.termsRevision;
  });
}
function assertArrangement(c: SuccessionArrangement) {
  require(exact(
    c,
    [
      'id',
      'ownerId',
      'executorId',
      'beneficiaryId',
      'text',
      'acceptBy',
      'expiresAt',
      'executionWindowMs',
      'bindings',
      'revision',
      'termsRevision',
      'createdAt',
      'termsAt',
      'at',
      'status',
      'ownershipAtConsent',
      'consents',
    ],
    ['trigger'],
  ), 'invalid-succession-arrangement-fields');
  const {
    id,
    ownerId,
    executorId,
    beneficiaryId,
    text,
    acceptBy,
    expiresAt,
    executionWindowMs,
    bindings,
  } = c;
  assertSuccessionTerms(
    {
      id,
      ownerId,
      executorId,
      beneficiaryId,
      text,
      acceptBy,
      expiresAt,
      executionWindowMs,
      bindings,
    },
    c.termsAt,
  );
  require(time(c.createdAt) &&
    time(c.at) &&
    time(c.termsAt) &&
    c.termsAt >= c.createdAt &&
    c.at >= c.termsAt &&
    positive(c.revision) &&
    positive(c.termsRevision) &&
    c.termsRevision <= c.revision &&
    ['offered', 'ready', 'declined', 'withdrawn', 'expired', 'triggered'].includes(
      c.status,
    ), 'invalid-succession-arrangement');
  assertOwnership(c, c.ownershipAtConsent);
  require(exact(c.consents, [], ['executor', 'beneficiary']), 'invalid-succession-consents');
  for (const role of ['executor', 'beneficiary'] as const) {
    const s = c.consents[role];
    if (!s) continue;
    require(exact(s, ['role', 'actorId', 'termsRevision', 'accepted', 'at']) &&
      s.role === role &&
      s.actorId === (role === 'executor' ? c.executorId : c.beneficiaryId) &&
      s.termsRevision === c.termsRevision &&
      typeof s.accepted === 'boolean' &&
      time(s.at) &&
      s.at >= c.termsAt &&
      (s.accepted ? s.at < c.acceptBy : s.at < c.expiresAt) &&
      s.at <= c.at, 'succession-exact-independent-consent-required');
  }
  const hasDecline = Object.values(c.consents).some((consent) => !consent.accepted);
  require(c.status === 'ready' || c.status === 'triggered'
    ? ready(c)
    : c.status === 'declined'
      ? hasDecline
      : c.status !== 'offered' || (!ready(c) && !hasDecline), 'succession-consent-status-mismatch');
  require(c.status === 'expired'
    ? c.at >= (ready(c) || hasDecline ? c.expiresAt : c.acceptBy)
    : c.status === 'offered'
      ? c.at < c.acceptBy
      : c.status === 'triggered' || c.at < c.expiresAt, 'succession-status-time-mismatch');
  require(c.status === 'triggered'
    ? !!c.trigger
    : c.trigger === undefined, 'succession-trigger-status-mismatch');
  if (c.trigger) {
    const {
      fact: f,
      resources,
      executorAvailable,
      beneficiaryAvailable,
      executeBefore,
    } = c.trigger;
    require(exact(c.trigger, [
      'fact',
      'executorAvailable',
      'beneficiaryAvailable',
      'executeBefore',
      'resources',
    ]) &&
      exact(f, ['eventId', 'residentId', 'kind', 'at', 'policyVersion']) &&
      validId(f.eventId) &&
      validId(f.policyVersion) &&
      f.residentId === c.ownerId &&
      ['death', 'emigration'].includes(f.kind) &&
      time(f.at) &&
      f.at === c.at &&
      f.at >= c.createdAt &&
      f.at < c.expiresAt &&
      typeof executorAvailable === 'boolean' &&
      typeof beneficiaryAvailable === 'boolean' &&
      time(executeBefore) &&
      executeBefore === f.at + c.executionWindowMs, 'invalid-succession-population-trigger');
    require(Array.isArray(resources) &&
      resources.length === c.bindings.length, 'succession-current-resource-sources-required');
    resources.forEach((r, i) =>
      require(equal(
        r,
        resourceAvailability(c, c.bindings[i]!, r.fact),
      ), 'succession-trigger-entitlement-mismatch'),
    );
  }
}
export function assertSuccessionArrangementsState(s: SuccessionArrangementsState) {
  require(exact(s, ['policy', 'arrangements']) &&
    equal(s.policy, POLICY) &&
    !!s.arrangements &&
    typeof s.arrangements === 'object' &&
    !Array.isArray(s.arrangements) &&
    Object.keys(s.arrangements).length <=
      POLICY.maxArrangements, 'unsupported-succession-arrangements-state');
  for (const [key, c] of Object.entries(s.arrangements)) {
    require(key === c.id, 'succession-arrangement-id-mismatch');
    assertArrangement(c);
  }
  const owners = Object.values(s.arrangements)
    .filter((c) => c.status === 'offered' || c.status === 'ready' || c.status === 'declined')
    .map((c) => c.ownerId);
  require(new Set(owners).size === owners.length, 'succession-one-current-arrangement-per-owner');
}
export function applySuccessionEvent(
  s: SuccessionArrangementsState | undefined,
  e: SuccessionEvent,
): SuccessionArrangementsState {
  if (e.type === 'SuccessionArrangementsEnabled') {
    require(!s && equal(e.policy, POLICY), 'invalid-succession-activation');
    return { policy: structuredClone(POLICY), arrangements: {} };
  }
  require(!!s, 'succession-arrangements-not-enabled');
  if (!s) throw Error('succession-arrangements-not-enabled');
  let c: SuccessionArrangement;
  if (e.type === 'SuccessionArrangementCreated') {
    c = structuredClone(e.arrangement);
    require(!s.arrangements[c.id] &&
      c.status === 'offered' &&
      c.revision === 1 &&
      c.termsRevision === 1 &&
      c.at === c.createdAt &&
      c.termsAt === c.createdAt &&
      Object.keys(c.consents).length === 0 &&
      !c.trigger, 'invalid-succession-created-state');
  } else {
    const old = s.arrangements[e.id];
    require(!!old, 'succession-arrangement-not-found');
    if (!old) throw Error('succession-arrangement-not-found');
    const at = e.type === 'SuccessionConsentRecorded' ? e.consent.at : e.at;
    require(old.revision === e.previousRevision &&
      Number.isSafeInteger(old.revision + 1) &&
      time(at) &&
      at >= old.at, 'succession-revision-or-time-conflict');
    c = { ...structuredClone(old), revision: old.revision + 1, at };
    if (e.type === 'SuccessionConsentRecorded') {
      require((old.status === 'offered' && at < old.acceptBy) ||
        (old.status === 'ready' &&
          !e.consent.accepted &&
          at < old.expiresAt), 'succession-response-not-open');
      const role = e.consent.role;
      require(['executor', 'beneficiary'].includes(role) &&
        old.consents[role]?.accepted !== e.consent.accepted, 'succession-role-response-unchanged');
      c = { ...c, consents: { ...c.consents, [role]: structuredClone(e.consent) } };
      c = { ...c, status: !e.consent.accepted ? 'declined' : ready(c) ? 'ready' : 'offered' };
    } else if (e.type === 'SuccessionArrangementRevised') {
      require(['offered', 'ready', 'declined'].includes(old.status) &&
        at < old.expiresAt &&
        e.actorId === old.ownerId &&
        e.terms.id === old.id &&
        e.terms.ownerId === old.ownerId, 'succession-revision-not-authorized');
      assertSuccessionTerms(e.terms, at);
      assertOwnership(e.terms, e.ownership);
      c = {
        ...structuredClone(e.terms),
        revision: c.revision,
        termsRevision: old.termsRevision + 1,
        createdAt: old.createdAt,
        termsAt: at,
        at,
        status: 'offered',
        ownershipAtConsent: structuredClone(e.ownership),
        consents: {},
      };
    } else if (e.type === 'SuccessionArrangementWithdrawn') {
      require(['offered', 'ready', 'declined'].includes(old.status) &&
        e.actorId === old.ownerId &&
        at < old.expiresAt, 'succession-withdrawal-not-authorized');
      c = { ...c, status: 'withdrawn' };
    } else if (e.type === 'SuccessionArrangementExpired') {
      require((old.status === 'offered' && at >= old.acceptBy) ||
        (['ready', 'declined'].includes(old.status) &&
          at >= old.expiresAt), 'succession-expiration-not-due');
      c = { ...c, status: 'expired' };
    } else {
      require(old.status === 'ready' && at < old.expiresAt, 'succession-trigger-not-ready');
      c = { ...c, status: 'triggered', trigger: structuredClone(e.trigger) };
    }
  }
  assertArrangement(c);
  const next = { ...s, arrangements: { ...s.arrangements, [c.id]: c } };
  assertSuccessionArrangementsState(next);
  return next;
}
const no = (reason: string): SuccessionDecision => ({ accepted: false, reason });
function accepted(s: SuccessionArrangementsState, e: SuccessionEvent): SuccessionDecision {
  try {
    applySuccessionEvent(s, e);
    return { accepted: true, events: [structuredClone(e)] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-succession-event');
  }
}
function ownership(t: SuccessionTerms, p: SuccessionPorts): readonly SuccessionResourceFact[] {
  const facts = t.bindings.map((b) => p.resource(b));
  require(facts.every((f) => !!f), 'succession-owning-sources-required');
  const result = facts.map((f) => {
    if (!f) throw Error('succession-owning-sources-required');
    return structuredClone(f);
  });
  assertOwnership(t, result);
  return result;
}
export function decideSuccessionArrangement(
  s: SuccessionArrangementsState,
  actorId: string,
  at: number,
  command: SuccessionCommand,
  p: SuccessionPorts,
): SuccessionDecision {
  try {
    require(validId(actorId) &&
      time(at) &&
      p.residentAvailable(actorId), 'succession-current-personal-actor-required');
    require(command.type === 'create'
      ? exact(command, ['type', 'terms'])
      : command.type === 'revise'
        ? exact(command, ['type', 'terms', 'expectedRevision'])
        : command.type === 'withdraw'
          ? exact(command, ['type', 'id', 'expectedRevision'])
          : command.type === 'respond' &&
            exact(command, [
              'type',
              'id',
              'expectedRevision',
              'termsRevision',
              'role',
              'accept',
            ]), 'invalid-succession-command');
    if (command.type === 'create' || command.type === 'revise') {
      const t = command.terms;
      assertSuccessionTerms(t, at);
      require(actorId === t.ownerId, 'succession-personal-owner-consent-required');
      require(p.residentAvailable(t.executorId) &&
        p.residentAvailable(t.beneficiaryId), 'succession-independent-current-parties-required');
      const facts = ownership(t, p);
      return command.type === 'create'
        ? accepted(s, {
            type: 'SuccessionArrangementCreated',
            arrangement: {
              ...structuredClone(t),
              revision: 1,
              termsRevision: 1,
              createdAt: at,
              termsAt: at,
              at,
              status: 'offered',
              ownershipAtConsent: facts,
              consents: {},
            },
          })
        : accepted(s, {
            type: 'SuccessionArrangementRevised',
            id: t.id,
            previousRevision: command.expectedRevision,
            actorId,
            at,
            terms: structuredClone(t),
            ownership: facts,
          });
    }
    const old = s.arrangements[command.id];
    require(!!old, 'succession-arrangement-not-found');
    if (!old) throw Error('succession-arrangement-not-found');
    require(p.residentAvailable(
      old.ownerId,
    ), 'succession-owner-unavailable-use-population-trigger');
    if (command.type === 'withdraw')
      return accepted(s, {
        type: 'SuccessionArrangementWithdrawn',
        id: old.id,
        previousRevision: command.expectedRevision,
        actorId,
        at,
      });
    require(exact(command, ['type', 'id', 'expectedRevision', 'termsRevision', 'role', 'accept']) &&
      command.termsRevision === old.termsRevision &&
      typeof command.accept === 'boolean', 'succession-exact-terms-version-required');
    require(actorId ===
      (command.role === 'executor'
        ? old.executorId
        : old.beneficiaryId), 'succession-independent-role-consent-required');
    return accepted(s, {
      type: 'SuccessionConsentRecorded',
      id: old.id,
      previousRevision: command.expectedRevision,
      consent: {
        actorId,
        role: command.role,
        termsRevision: command.termsRevision,
        accepted: command.accept,
        at,
      },
    });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-succession-command');
  }
}
export function expireSuccessionArrangement(
  s: SuccessionArrangementsState,
  id: string,
  at: number,
): SuccessionDecision {
  const c = s.arrangements[id];
  return c
    ? accepted(s, { type: 'SuccessionArrangementExpired', id, previousRevision: c.revision, at })
    : no('succession-arrangement-not-found');
}
export function triggerSuccessionArrangement(
  s: SuccessionArrangementsState,
  id: string,
  fact: SuccessionTriggerFact,
  p: SuccessionPorts,
): SuccessionDecision {
  const c = s.arrangements[id];
  if (!c) return no('succession-arrangement-not-found');
  if (p.residentAvailable(c.ownerId)) return no('succession-real-population-trigger-required');
  try {
    return accepted(s, {
      type: 'SuccessionArrangementTriggered',
      id,
      previousRevision: c.revision,
      at: fact.at,
      trigger: {
        fact: structuredClone(fact),
        executorAvailable: p.residentAvailable(c.executorId),
        beneficiaryAvailable: p.residentAvailable(c.beneficiaryId),
        executeBefore: fact.at + c.executionWindowMs,
        resources: c.bindings.map((b) => resourceAvailability(c, b, p.resource(b) ?? null)),
      },
    });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-succession-trigger');
  }
}
