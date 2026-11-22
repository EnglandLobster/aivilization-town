import { expect, test } from 'vitest';
import {
  applySuccessionEvent,
  decideSuccessionArrangement,
  triggerSuccessionArrangement,
} from './residentSuccession';
import {
  RESIDENT_SUCCESSION_POLICY,
  type SuccessionResourceFact,
  type SuccessionTerms,
  type SuccessionCommand,
} from './residentSuccessionModel';
import {
  SUCCESSION_CONTROL_EXECUTION_POLICY as POLICY,
  type SuccessionControlOfferInput,
} from './successionControlExecutionModel';
import {
  applySuccessionControlExecutionEvent,
  prepareSuccessionControlOffer,
  assertSuccessionControlOfferSource,
  assertSuccessionControlExecutionsState,
} from './successionControlExecution';
function fixture() {
  let arrangements = applySuccessionEvent(undefined, {
    type: 'SuccessionArrangementsEnabled',
    policy: RESIDENT_SUCCESSION_POLICY,
  });
  const people = new Set(['a', 'b', 'c', 'd']);
  let fact: SuccessionResourceFact | undefined = {
    kind: 'stock',
    id: 's',
    ownerId: 'a',
    sourceRevision: 4,
    entitlementVersion: 2,
    available: true,
  };
  const ports = { residentAvailable: (id: string) => people.has(id), resource: () => fact };
  const terms: SuccessionTerms = {
    id: 'will',
    ownerId: 'a',
    executorId: 'b',
    beneficiaryId: 'c',
    text: '指定原材料库存有限交接。不能提现、烧债或伪装本人。',
    acceptBy: 1000,
    expiresAt: 10000,
    executionWindowMs: 5000,
    bindings: [{ kind: 'stock', id: 's', entitlementVersion: 2, duty: 'control-handover' }],
  };
  const decide = (actor: string, at: number, command: SuccessionCommand) => {
    const d = decideSuccessionArrangement(arrangements, actor, at, command, ports);
    if (!d.accepted) throw Error(d.reason);
    arrangements = d.events.reduce(applySuccessionEvent, arrangements);
  };
  decide('a', 0, { type: 'create', terms });
  for (const [role, actor, at] of [
    ['executor', 'b', 10],
    ['beneficiary', 'c', 20],
  ] as const)
    decide(actor, at, {
      type: 'respond',
      id: 'will',
      expectedRevision: arrangements.arrangements.will!.revision,
      termsRevision: 1,
      role,
      accept: true,
    });
  const before = arrangements;
  people.delete('a');
  const triggered = triggerSuccessionArrangement(
    arrangements,
    'will',
    {
      eventId: 'actual-population-event',
      residentId: 'a',
      kind: 'death',
      at: 50,
      policyVersion: 'population-fixture-v2',
    },
    ports,
  );
  if (!triggered.accepted) throw Error(triggered.reason);
  arrangements = triggered.events.reduce(applySuccessionEvent, arrangements);
  const executions = applySuccessionControlExecutionEvent(undefined, {
    type: 'SuccessionControlExecutionsEnabled',
    policy: POLICY,
  });
  const input: SuccessionControlOfferInput = {
    id: 'offer-1',
    arrangementId: 'will',
    expectedArrangementRevision: arrangements.arrangements.will!.revision,
    termsRevision: 1,
    kind: 'stock',
    resourceId: 's',
    expiresAt: 500,
  };
  const prepare = (
    change: Partial<SuccessionControlOfferInput> = {},
    actor = 'b',
    at = 60,
    state = executions,
  ) =>
    prepareSuccessionControlOffer(arrangements, state, actor, at, { ...input, ...change }, ports);
  const accepted = () => {
    const d = prepare();
    if (!d.accepted) throw Error(d.reason);
    return d.event;
  };
  return {
    arrangements,
    before,
    executions,
    input,
    ports,
    people,
    prepare,
    accepted,
    get fact() {
      return fact;
    },
    set fact(next: SuccessionResourceFact | undefined) {
      fact = next;
    },
  };
}
test('the actual executor prepares exactly the accepted original resource and beneficiary; preparing alone neither consumes the scope nor changes ownership', () => {
  const f = fixture(),
    before = structuredClone(f.fact),
    e = f.accepted();
  expect(e.record).toMatchObject({
    executorId: 'b',
    ownerId: 'a',
    beneficiaryId: 'c',
    populationEventId: 'actual-population-event',
    kind: 'stock',
    resourceId: 's',
    controlVersion: 2,
    sourceRevision: 4,
  });
  expect(f.executions.records).toEqual({});
  expect(f.fact).toEqual(before);
  expect(f.prepare().accepted).toBe(true);
  const recorded = applySuccessionControlExecutionEvent(f.executions, e);
  expect(f.prepare({}, 'b', 60, recorded)).toMatchObject({
    accepted: false,
    reason: 'succession-control-execution-id-already-used',
  });
  expect(f.prepare({ id: 'offer-2' }, 'b', 60, recorded)).toMatchObject({
    accepted: false,
    reason: 'succession-control-binding-already-used',
  });
});
test('a ready arrangement without actual population trigger and a substituted actor, terms version, resource or expiry cannot grant an offer', () => {
  const f = fixture();
  expect(
    prepareSuccessionControlOffer(f.before, f.executions, 'b', 60, f.input, f.ports),
  ).toMatchObject({ accepted: false, reason: 'succession-control-exact-triggered-terms-required' });
  for (const actor of ['a', 'c', 'd']) expect(f.prepare({}, actor).accepted).toBe(false);
  for (const change of [
    { termsRevision: 2 },
    { expectedArrangementRevision: 1 },
    { resourceId: 'other' },
    { kind: 'premises' as const },
    { expiresAt: 5051 },
    { expiresAt: 60 },
  ])
    expect(f.prepare(change).accepted).toBe(false);
  expect(f.prepare({}, 'b', 49).accepted).toBe(false);
  expect(f.prepare({ expiresAt: 6000 }, 'b', 5050).accepted).toBe(false);
});
test('current control entitlement and source are rechecked rather than accepting an old consent snapshot or another owner', () => {
  const f = fixture(),
    original = f.fact!;
  for (const changed of [
    undefined,
    { ...original, ownerId: 'd' },
    { ...original, entitlementVersion: 3 },
    { ...original, available: false },
    { ...original, kind: 'premises' as const },
    { ...original, id: 'other' },
  ]) {
    f.fact = changed;
    expect(f.prepare().accepted).toBe(false);
  }
  f.fact = { ...original, sourceRevision: 9 };
  const e = f.accepted();
  expect(e.record.sourceRevision).toBe(9);
  f.fact = { ...original, sourceRevision: 10 };
  expect(() => assertSuccessionControlOfferSource(f.arrangements, e.record, f.ports)).toThrow(
    'current-owning-resource-required',
  );
});
test('body termination cannot be substituted by a still-living owner and neither absent executor nor absent beneficiary grants an automatic successor', () => {
  const f = fixture();
  f.people.add('a');
  expect(f.prepare().accepted).toBe(false);
  f.people.delete('a');
  for (const actor of ['b', 'c']) {
    f.people.delete(actor);
    expect(f.prepare().accepted).toBe(false);
    f.people.add(actor);
  }
  expect(f.prepare().accepted).toBe(true);
});
test('receipt references are exact, finite and replayable, rejecting substituted beneficiary/trigger and unexpected powers', () => {
  const f = fixture(),
    e = f.accepted();
  const next = applySuccessionControlExecutionEvent(f.executions, e);
  expect(
    applySuccessionControlExecutionEvent(f.executions, JSON.parse(JSON.stringify(e)) as typeof e),
  ).toEqual(next);
  assertSuccessionControlExecutionsState(JSON.parse(JSON.stringify(next)) as typeof next);
  for (const change of [
    { beneficiaryId: 'd' },
    { populationEventId: 'invented' },
    { ownerId: 'd' },
    { arrangementRevision: 999 },
    { sourceRevision: 999 },
  ]) {
    expect(() =>
      assertSuccessionControlOfferSource(f.arrangements, { ...e.record, ...change }, f.ports),
    ).toThrow();
  }
  const unexpected = structuredClone(e);
  Object.assign(unexpected.record, { canWithdraw: true });
  expect(() => applySuccessionControlExecutionEvent(f.executions, unexpected)).toThrow(
    'invalid-succession-control-offer-record',
  );
  expect(() => applySuccessionControlExecutionEvent(next, e)).toThrow('id-already-used');
});
test('source fields reject invalid amounts, times, private-cash purpose and prototype IDs, retaining the unconsumed original record state', () => {
  const f = fixture(),
    before = structuredClone(f.executions),
    e = f.accepted();
  for (const change of [
    { at: NaN },
    { expiresAt: Infinity },
    { sourceRevision: 0 },
    { controlVersion: 0 },
    { id: '__proto__' },
    { kind: 'personal-cash' },
  ]) {
    const bad = structuredClone(e);
    Object.assign(bad.record, change);
    expect(() => applySuccessionControlExecutionEvent(f.executions, bad)).toThrow();
  }
  expect(f.executions).toEqual(before);
  const wrongPolicy = structuredClone(POLICY);
  Object.assign(wrongPolicy, { version: 'silent-upgrade' });
  expect(() =>
    applySuccessionControlExecutionEvent(undefined, {
      type: 'SuccessionControlExecutionsEnabled',
      policy: wrongPolicy,
    }),
  ).toThrow('invalid-succession-control-executions-state');
});
test('composite binding keys cannot alias arrangements/resources containing colons', () => {
  const f = fixture(),
    e = f.accepted();
  const one = {
    ...e,
    record: {
      ...e.record,
      id: 'one',
      arrangementId: 'will:stock',
      kind: 'premises' as const,
      resourceId: 's',
    },
  };
  const two = {
    ...e,
    record: {
      ...e.record,
      id: 'two',
      arrangementId: 'will',
      kind: 'stock' as const,
      resourceId: 'premises:s',
    },
  };
  const next = [one, two].reduce(applySuccessionControlExecutionEvent, f.executions);
  expect(Object.keys(next.records)).toHaveLength(2);
  assertSuccessionControlExecutionsState(next);
});
