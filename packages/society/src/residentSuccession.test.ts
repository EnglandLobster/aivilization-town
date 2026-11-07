import { expect, test } from 'vitest';
import {
  applySuccessionEvent,
  decideSuccessionArrangement,
  expireSuccessionArrangement,
  triggerSuccessionArrangement,
  assertSuccessionArrangementsState,
} from './residentSuccession';
import {
  RESIDENT_SUCCESSION_POLICY as POLICY,
  type SuccessionCommand,
  type SuccessionDecision,
  type SuccessionEvent,
  type SuccessionResourceFact,
  type SuccessionTerms,
} from './residentSuccessionModel';
function fixture() {
  let state = applySuccessionEvent(undefined, {
    type: 'SuccessionArrangementsEnabled',
    policy: POLICY,
  });
  const events: SuccessionEvent[] = [{ type: 'SuccessionArrangementsEnabled', policy: POLICY }];
  const present = new Set(['a', 'b', 'c', 'd']);
  const facts: Record<string, SuccessionResourceFact> = {
    'personal-cash:a': {
      kind: 'personal-cash',
      id: 'a',
      ownerId: 'a',
      sourceRevision: 1,
      entitlementVersion: 1,
      available: true,
    },
    'stock:s': {
      kind: 'stock',
      id: 's',
      ownerId: 'a',
      sourceRevision: 4,
      entitlementVersion: 2,
      available: true,
    },
  };
  const ports = {
    residentAvailable: (id: string) => present.has(id),
    resource: (b: { kind: string; id: string }) => facts[`${b.kind}:${b.id}`],
  };
  const terms: SuccessionTerms = {
    id: 'will',
    ownerId: 'a',
    executorId: 'b',
    beneficiaryId: 'c',
    text: '只安排本人既有权利，不允许消灭债务或造新屋',
    acceptBy: 1000,
    expiresAt: 10000,
    executionWindowMs: 5000,
    bindings: [
      {
        kind: 'personal-cash',
        id: 'a',
        entitlementVersion: 1,
        duty: 'cash-settlement',
        maximumAmountMicros: 100000000,
      },
      { kind: 'stock', id: 's', entitlementVersion: 2, duty: 'control-handover' },
    ],
  };
  const commit = (d: SuccessionDecision) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    events.push(...d.events);
    state = d.events.reduce(applySuccessionEvent, state);
    return d;
  };
  const decide = (cmd: SuccessionCommand, actor = 'a', at = 0) =>
    decideSuccessionArrangement(state, actor, at, cmd, ports);
  const ok = (cmd: SuccessionCommand, actor = 'a', at = 0) => commit(decide(cmd, actor, at));
  const response = (
    role: 'executor' | 'beneficiary',
    accept = true,
    termsRevision = state.arrangements.will!.termsRevision,
  ): Extract<SuccessionCommand, { type: 'respond' }> => ({
    type: 'respond',
    id: 'will',
    expectedRevision: state.arrangements.will!.revision,
    role,
    accept,
    termsRevision,
  });
  const ready = () => {
    ok({ type: 'create', terms });
    ok(response('executor'), 'b', 10);
    ok(response('beneficiary'), 'c', 20);
  };
  const trigger = (at = 5000) =>
    triggerSuccessionArrangement(
      state,
      'will',
      {
        eventId: 'death-real',
        residentId: 'a',
        kind: 'death',
        at,
        policyVersion: 'explicit-population-v2',
      },
      ports,
    );
  const replay = () => {
    const restored = events.reduce<ReturnType<typeof applySuccessionEvent> | undefined>(
      (s, e) => applySuccessionEvent(s, JSON.parse(JSON.stringify(e)) as SuccessionEvent),
      undefined,
    );
    expect(restored).toEqual(state);
    assertSuccessionArrangementsState(restored!);
  };
  return {
    get state() {
      return state;
    },
    events,
    present,
    facts,
    ports,
    terms,
    commit,
    decide,
    ok,
    response,
    ready,
    trigger,
    replay,
  };
}
test('owner chooses limited current rights and two independently authenticated roles accept exact terms without any asset or balance effect', () => {
  const t = fixture(),
    before = structuredClone(t.facts);
  t.ok({ type: 'create', terms: t.terms });
  expect(t.state.arrangements.will!.status).toBe('offered');
  expect(t.decide(t.response('executor'), 'a', 10)).toMatchObject({
    accepted: false,
    reason: 'succession-independent-role-consent-required',
  });
  expect(t.decide(t.response('beneficiary'), 'b', 10).accepted).toBe(false);
  t.ok(t.response('executor'), 'b', 10);
  expect(t.state.arrangements.will!.status).toBe('offered');
  t.ok(t.response('beneficiary'), 'c', 20);
  expect(t.state.arrangements.will!.status).toBe('ready');
  expect(t.facts).toEqual(before);
  expect(t.trigger()).toMatchObject({
    accepted: false,
    reason: 'succession-real-population-trigger-required',
  });
  t.replay();
});
test('revision freezes new terms and clears old consents while preserving the original creation and role signatures in event history', () => {
  const t = fixture();
  t.ready();
  const old = t.response('executor');
  t.ok(
    {
      type: 'revise',
      expectedRevision: 3,
      terms: { ...t.terms, text: '新原文', acceptBy: 2000, expiresAt: 12000 },
    },
    'a',
    100,
  );
  expect(t.state.arrangements.will).toMatchObject({
    revision: 4,
    termsRevision: 2,
    createdAt: 0,
    termsAt: 100,
    status: 'offered',
    consents: {},
  });
  expect(t.decide({ ...old, expectedRevision: 4 }, 'b', 110).accepted).toBe(false);
  t.ok(t.response('executor'), 'b', 110);
  t.ok(t.response('beneficiary'), 'c', 120);
  expect(t.events.filter((e) => e.type === 'SuccessionConsentRecorded')).toHaveLength(4);
  t.replay();
});
test('an executor can independently retract accepted duties after the initial response deadline; owner cannot restore consent by editing names', () => {
  const t = fixture();
  t.ready();
  t.ok(t.response('executor', false), 'b', 2000);
  expect(t.state.arrangements.will!.status).toBe('declined');
  t.present.delete('a');
  expect(t.trigger().accepted).toBe(false);
  t.replay();
});
test('owner withdrawal and exact expiry preserve terms/history and cannot be retroactively undone or trigger an inheritance', () => {
  const t = fixture();
  t.ready();
  t.ok({ type: 'withdraw', id: 'will', expectedRevision: 3 }, 'a', 40);
  t.present.delete('a');
  expect(t.trigger().accepted).toBe(false);
  t.replay();
  const x = fixture();
  x.ok({ type: 'create', terms: x.terms });
  expect(x.decide(x.response('executor'), 'b', 1000).accepted).toBe(false);
  expect(expireSuccessionArrangement(x.state, 'will', 999).accepted).toBe(false);
  x.commit(expireSuccessionArrangement(x.state, 'will', 1000));
  expect(x.state.arrangements.will!.status).toBe('expired');
  x.replay();
});
test('a real trigger preserves historical consent, records missing/exchanged sources and unavailable executor without substituting anyone or transferring assets', () => {
  const t = fixture();
  t.ready();
  t.present.delete('a');
  t.present.delete('b');
  t.facts['stock:s'] = {
    ...t.facts['stock:s']!,
    ownerId: 'd',
    entitlementVersion: 3,
    sourceRevision: 9,
  };
  const facts = structuredClone(t.facts);
  t.commit(t.trigger());
  const c = t.state.arrangements.will!;
  expect(c.trigger).toMatchObject({
    executorAvailable: false,
    executeBefore: 10000,
    resources: [{ eligible: true }, { eligible: false, reason: 'entitlement-changed' }],
  });
  expect(c.executorId).toBe('b');
  expect(c.beneficiaryId).toBe('c');
  expect(t.facts).toEqual(facts);
  expect(t.trigger().accepted).toBe(false);
  t.replay();
  const x = fixture();
  x.ready();
  x.present.delete('a');
  delete x.facts['stock:s'];
  x.commit(x.trigger());
  expect(x.state.arrangements.will!.trigger!.resources[1]).toMatchObject({
    fact: null,
    eligible: false,
    reason: 'source-unavailable',
  });
  x.replay();
});
test('cannot arrange someone else property, another person cash, a stale entitlement or multiple active alternatives that silently choose a successor', () => {
  const t = fixture();
  t.facts['stock:s'] = { ...t.facts['stock:s']!, ownerId: 'd' };
  expect(t.decide({ type: 'create', terms: t.terms }).accepted).toBe(false);
  const x = fixture();
  x.ready();
  expect(x.decide({ type: 'create', terms: { ...x.terms, id: 'second' } }).accepted).toBe(false);
  expect(
    x.decide({ type: 'revise', expectedRevision: 3, terms: { ...x.terms, ownerId: 'd' } }, 'a', 30)
      .accepted,
  ).toBe(false);
  expect(
    x.decide(
      {
        type: 'revise',
        expectedRevision: 3,
        terms: {
          ...x.terms,
          bindings: [
            {
              kind: 'personal-cash',
              id: 'd',
              entitlementVersion: 1,
              duty: 'cash-settlement',
              maximumAmountMicros: 1,
            },
          ],
        },
      },
      'a',
      30,
    ).accepted,
  ).toBe(false);
  expect(x.state.arrangements.will!.revision).toBe(3);
  x.replay();
});
test('closed finite limits refuse nonfinite/fractional/safe-time overflow, duplicate bindings, extra caller authority and source-kind duty changes', () => {
  const t = fixture();
  for (const terms of [
    { ...t.terms, executionWindowMs: Infinity },
    { ...t.terms, acceptBy: 0 },
    { ...t.terms, expiresAt: Number.MAX_SAFE_INTEGER },
    { ...t.terms, bindings: [...t.terms.bindings, t.terms.bindings[0]!] },
    { ...t.terms, bindings: [{ ...t.terms.bindings[0]!, maximumAmountMicros: 0.5 }] },
    {
      ...t.terms,
      bindings: [
        { ...t.terms.bindings[1]!, duty: 'cash-settlement' as const, maximumAmountMicros: 1 },
      ],
    },
  ])
    expect(t.decide({ type: 'create', terms }).accepted).toBe(false);
  const c = { type: 'create' as const, terms: t.terms, actorId: 'a' };
  expect(t.decide(c).accepted).toBe(false);
  expect(t.state.arrangements).toEqual({});
});
test('replay and snapshots reject manufactured ready consent, rewritten beneficiary, retroactive population time and invented eligible rights', () => {
  const t = fixture();
  t.ready();
  t.present.delete('a');
  const before = t.state;
  const d = t.trigger();
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error('fixture');
  const e = d.events[0]!;
  if (e.type !== 'SuccessionArrangementTriggered') throw Error('fixture');
  const c = before.arrangements.will!;
  expect(() =>
    assertSuccessionArrangementsState({
      ...before,
      arrangements: { will: { ...c, beneficiaryId: 'd' } },
    }),
  ).toThrow('succession-exact-independent-consent-required');
  expect(() =>
    assertSuccessionArrangementsState({
      ...before,
      arrangements: { will: { ...c, consents: {} } },
    }),
  ).toThrow('succession-consent-status-mismatch');
  expect(() =>
    applySuccessionEvent(before, {
      ...e,
      at: 1,
      trigger: { ...e.trigger, fact: { ...e.trigger.fact, at: 1 } },
    }),
  ).toThrow('succession-revision-or-time-conflict');
  expect(() =>
    applySuccessionEvent(before, {
      ...e,
      trigger: {
        ...e.trigger,
        resources: e.trigger.resources.map((r, i) =>
          i === 1 ? { ...r, fact: null, eligible: true } : r,
        ),
      },
    }),
  ).toThrow('succession-trigger-entitlement-mismatch');
  expect(() => applySuccessionEvent(undefined, e)).toThrow('succession-arrangements-not-enabled');
  t.commit(d);
  t.replay();
});
