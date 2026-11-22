import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createEventEnvelope, advanceClock } from '@aivilization/sim-core';
import { createMaterialsPolicy, type MaterialCommand } from '@aivilization/materials';
import { enablePremisesPrincipalsEvent } from './premisesPrincipals';
import { residentConstructionFixture } from './testFixtures/residentConstruction';
import type {
  SuccessionCommand,
  SuccessionTerms,
  SuccessionControlOfferInput,
} from '@aivilization/society';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  residentExitFixture,
  residentDeathFixture,
  capturedResidentDeparture,
} from './testFixtures/residentExit';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  type MaterialAuthorization,
} from './residentMaterials';
import { enableResidentPublicGovernanceEvent } from './residentPublicGovernance';
import { enableResourcePrincipalsEvent, residentPrincipalControlEvent } from './resourcePrincipals';
import {
  enableResidentSuccessionEvent,
  residentSuccessionArrangementEvent,
  residentSuccessionControlOfferEvent,
  assertResidentSuccessionSnapshot,
} from './residentSuccession';
function fixture() {
  const f = residentExitFixture(),
    a = {
      ...f.agents.a!,
      inventory: { ...f.agents.a!.inventory, Wood: 8 },
      locationId: asLocationId('site'),
    };
  const seed: WorldProjection = {
    ...f,
    agents: {
      a,
      b: { ...a, agentId: asAgentId('b'), balance: 0, inventory: {} },
      c: { ...a, agentId: asAgentId('c'), balance: 0, inventory: {} },
    },
    locations: {
      site: {
        locationId: asLocationId('site'),
        name: '实际工地',
        kind: 'production',
        capacity: 10,
        activityAffinities: [],
      },
    },
  };
  let w = seed,
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `r${++n}`,
    simulationId: 'sim-1',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    const next = es.reduce(applyWorldEvent, w);
    events.push(...es);
    w = next;
    expect(w.moneySupply).toBe(seed.moneySupply);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
    return d.events;
  };
  commit([
    enableResidentMaterialsEvent({
      at: 0,
      requestId: 'materials',
      simulationId: 'sim-1',
      nextSequence: events.length + 1,
      policy: createMaterialsPolicy([
        {
          id: 'boards',
          version: 'v1',
          inputs: { Wood: 2 },
          outputs: { Board: 1 },
          workMs: 1000,
          energyCost: 2,
          satietyCost: 1,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  const authorization: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: () => true,
    hasExternalObligation: () => false,
    mayStoreAt: () => true,
  };
  const material = (command: MaterialCommand) =>
    residentMaterialEvent({ ...ctx(), authorization, command });
  ok(material({ type: 'create-stock', id: 's', locationId: 'site', title: '本人保管库存' }));
  ok(material({ type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 8 } }));
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'fixture',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 1000,
        maximumTreasuryReserve: 10000,
        maximumSubsidyBalanceFloor: 1000,
        maximumSubsidyPerCadence: 1000,
      },
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'fixture',
          description: '显式制度初始来源',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-procedure'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  commit([enableResourcePrincipalsEvent(ctx()), enableResidentSuccessionEvent(ctx())]);
  const terms: SuccessionTerms = {
    id: 'will',
    ownerId: 'a',
    executorId: 'b',
    beneficiaryId: 'c',
    text: '由b有限提议向c交接本人原库存；不得冒充本人或取用物品。',
    acceptBy: 1000,
    expiresAt: 10000,
    executionWindowMs: 5000,
    bindings: [
      {
        kind: 'stock',
        id: 's',
        entitlementVersion: w.materials!.stocks.s!.control.version,
        duty: 'control-handover',
      },
    ],
  };
  const command = (c: SuccessionCommand, actor = 'a') =>
    residentSuccessionArrangementEvent({ ...ctx(actor), command: c });
  ok(command({ type: 'create', terms }));
  for (const [role, actor] of [
    ['executor', 'b'],
    ['beneficiary', 'c'],
  ] as const)
    ok(
      command(
        {
          type: 'respond',
          id: 'will',
          expectedRevision: w.residentExits!.arrangements.arrangements.will!.revision,
          termsRevision: 1,
          role,
          accept: true,
        },
        actor,
      ),
    );
  const preDeath = w;
  const death = capturedResidentDeparture(w, {
    ...residentDeathFixture(),
    sequence: events.length + 1,
  });
  commit([death]);
  const offer: SuccessionControlOfferInput = {
    id: 'handover-1',
    arrangementId: 'will',
    expectedArrangementRevision: w.residentExits!.arrangements.arrangements.will!.revision,
    termsRevision: 1,
    kind: 'stock' as const,
    resourceId: 's',
    expiresAt: 500,
  };
  const propose = (change: Partial<SuccessionControlOfferInput> = {}, actor = 'b') =>
    residentSuccessionControlOfferEvent({ ...ctx(actor), offer: { ...offer, ...change } });
  return {
    seed,
    preDeath,
    death,
    events,
    ctx,
    commit,
    ok,
    command,
    offer,
    propose,
    get w() {
      return w;
    },
  };
}
test('real independent terms, actual body capture, original stock offer and single execution receipt replay with preserved cash/materials/authorship and separate beneficiary acceptance', () => {
  const f = fixture(),
    original = structuredClone(f.w.materials!.stocks.s!),
    sent = f.ok(f.propose());
  expect(f.w.agents.a).toBeUndefined();
  expect(f.w.materials!.stocks.s!.inventory).toEqual({ Wood: 8 });
  expect(f.w.materials!.stocks.s!.ownerId).toBe('a');
  expect(f.w.materials!.stocks.s!.control.controller).toEqual({ kind: 'resident', id: 'a' });
  expect(f.w.materials!.stocks.s!.control.offer).toMatchObject({
    target: { kind: 'resident', id: 'c' },
    authorization: { actorId: 'b', source: { kind: 'succession' } },
  });
  expect(f.w.successionControlExecutions?.records['handover-1']).toMatchObject({
    executorId: 'b',
    beneficiaryId: 'c',
    populationEventId: f.death.id,
    sourceRevision: original.revision,
  });
  expect(f.propose({ id: 'repeat' }).accepted).toBe(false);
  const stock = f.w.materials!.stocks.s!;
  const accepted = f.ok(
    residentPrincipalControlEvent({
      ...f.ctx('c'),
      request: {
        resourceKind: 'stock',
        resourceId: 's',
        resourceRevision: stock.revision,
        controlVersion: stock.control.version,
        command: { type: 'accept' },
      },
    }),
  );
  expect(accepted).toHaveLength(1);
  expect(f.w.materials!.stocks.s!.control.controller).toEqual({ kind: 'resident', id: 'c' });
  expect(f.w.materials!.stocks.s!.ownerId).toBe('a');
  expect(f.w.materials!.stocks.s!.inventory).toEqual({ Wood: 8 });
  expect(f.w.agents.c!.inventory).toEqual({});
  expect(f.w.agents.b!.balance).toBe(0);
  expect(f.events.reduce(applyWorldEvent, f.seed)).toEqual(f.w);
  assertResidentSuccessionSnapshot(f.w);
  expect(sent[0]?.type).toBe('ResidentSuccessionCommitted');
});
test('missing actual population trigger or substituted executor cannot generate an effect or consume an offer scope', () => {
  const f = fixture(),
    before = structuredClone(f.w);
  expect(
    residentSuccessionControlOfferEvent({ ...f.ctx('b'), projection: f.preDeath, offer: f.offer })
      .accepted,
  ).toBe(false);
  for (const actor of ['a', 'c']) expect(f.propose({}, actor).accepted).toBe(false);
  for (const change of [
    { termsRevision: 2 },
    { resourceId: 'other' },
    { kind: 'premises' as const },
    { expiresAt: 5001 },
  ])
    expect(f.propose(change).accepted).toBe(false);
  expect(f.w).toEqual(before);
  expect(f.w.successionControlExecutions?.records).toEqual({});
});
test('forged source receipt, replaced real beneficiary, missing resource effect and copied generic standalone delegate reject atomically', () => {
  const f = fixture(),
    d = f.propose();
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentSuccessionCommitted' || e.payload.kind !== 'control-offer')
    throw Error('expected');
  const before = structuredClone(f.w);
  const mutations: ((x: Extract<WorldEvent, { type: 'ResidentSuccessionCommitted' }>) => void)[] = [
    (x) => {
      if (x.payload.kind === 'control-offer')
        Object.assign(x.payload.event.record, { sourceRevision: 999 });
    },
    (x) => {
      if (x.payload.kind === 'control-offer')
        Object.assign(x.payload.change.control.authorization, { actorId: 'a' });
    },
    (x) => {
      if (x.payload.kind === 'control-offer')
        Object.assign(x.payload.change.request.command, { target: { kind: 'resident', id: 'b' } });
    },
    (x) => {
      if (x.payload.kind === 'control-offer') Object.assign(x.payload, { change: undefined });
    },
    (x) => Object.assign(x.payload, { canWithdraw: true }),
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(e);
    mutate(bad);
    expect(() => applyWorldEvent(f.w, bad)).toThrow();
    expect(f.w).toEqual(before);
  }
  const standalone: WorldEvent = createEventEnvelope({
    id: 'forged-standalone',
    simulationId: 'sim-1',
    sequence: 99,
    occurredAt: f.w.clock.now,
    type: 'ResidentResourcePrincipalControlCommitted',
    payload: { actorId: 'b', change: e.payload.change },
  });
  expect(() => applyWorldEvent(f.w, standalone)).toThrow('authority-source-mismatch');
});
test('actual population capture cannot omit a ready arrangement or forge its resource/party facts; the original body and stock remain on rejection', () => {
  const f = fixture(),
    e = structuredClone(f.death);
  if (!e.payload.exitPreservation) throw Error('expected');
  Object.assign(e.payload.exitPreservation, { successionEvents: [] });
  expect(() => applyWorldEvent(f.preDeath, e)).toThrow('trigger-coverage-mismatch');
  const forged = structuredClone(f.death),
    t = forged.payload.exitPreservation!.successionEvents![0]!;
  if (t.type !== 'SuccessionArrangementTriggered') throw Error('expected');
  Object.assign(t.trigger.resources[0]!.fact!, { sourceRevision: 999 });
  expect(() => applyWorldEvent(f.preDeath, forged)).toThrow('owning-resource-mismatch');
  expect(f.preDeath.agents.a).toBeDefined();
  expect(f.preDeath.materials!.stocks.s!.inventory).toEqual({ Wood: 8 });
});
test('source ACL/body availability, deadline and old mode do not silently grant new execution; current control remains the sole resource truth', () => {
  const f = fixture();
  const gone = { ...f.w, agents: { b: f.w.agents.b! } };
  expect(
    residentSuccessionControlOfferEvent({ ...f.ctx('b'), projection: gone, offer: f.offer })
      .accepted,
  ).toBe(false);
  const advanced: WorldEvent = createEventEnvelope({
    id: 'expired-window',
    simulationId: 'sim-1',
    sequence: 99,
    occurredAt: 0,
    type: 'SimulationTimeAdvanced',
    payload: { previous: f.w.clock, next: advanceClock(f.w.clock, 5000), deltaMs: 5000 },
  });
  const later = applyWorldEvent(f.w, advanced);
  expect(
    residentSuccessionControlOfferEvent({
      ...f.ctx('b'),
      projection: later,
      offer: { ...f.offer, expiresAt: 5100 },
    }).accepted,
  ).toBe(false);
  const old = residentExitFixture();
  expect(
    residentSuccessionArrangementEvent({
      ...f.ctx(),
      projection: old,
      command: { type: 'withdraw', id: 'will', expectedRevision: 1 },
    }).accepted,
  ).toBe(false);
  const changed = {
    ...f.w,
    materials: {
      ...f.w.materials!,
      stocks: {
        ...f.w.materials!.stocks,
        s: {
          ...f.w.materials!.stocks.s!,
          control: { ...f.w.materials!.stocks.s!.control, version: 2 },
        },
      },
    },
  };
  expect(
    residentSuccessionControlOfferEvent({ ...f.ctx('b'), projection: changed, offer: f.offer })
      .accepted,
  ).toBe(false);
});
test('a home completed with actual consumed materials and recorded labor can be offered under the original accepted mandate; control does not itself move or house the beneficiary', () => {
  const construction = residentConstructionFixture();
  construction.start();
  construction.time(480000);
  construction.tick();
  construction.replay();
  expect(construction.w.premises!.projects.p!.status).toBe('completed');
  const baseline: WorldProjection = {
    ...construction.w,
    residentExits: residentExitFixture().residentExits,
  };
  let w = baseline;
  let n = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'builder') => ({
    projection: w,
    actorId,
    requestId: `home${++n}`,
    simulationId: 'sim-1',
    nextSequence: events.length + 50,
  });
  const commit = (es: readonly WorldEvent[]) => {
    w = es.reduce(applyWorldEvent, w);
    events.push(...es);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
  };
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'fixture',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 1000,
        maximumTreasuryReserve: 10000,
        maximumSubsidyBalanceFloor: 1000,
        maximumSubsidyPerCadence: 1000,
      },
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'fixture',
          description: '完整已建实物来源后的授权',
        },
        residents: ['builder', 'donor', 'worker'],
        actions: ['set-procedure'],
      },
      procedure: {
        electorate: ['builder', 'donor', 'worker'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  commit([enableResourcePrincipalsEvent(ctx())]);
  commit([enablePremisesPrincipalsEvent(ctx()), enableResidentSuccessionEvent(ctx())]);
  const building = structuredClone(w.premises!.buildings.home!),
    now = w.clock.now;
  const terms: SuccessionTerms = {
    id: 'home-will',
    ownerId: 'builder',
    executorId: 'donor',
    beneficiaryId: 'worker',
    text: '向worker提议接收本人实建房屋控制，原使用权和义务保留。',
    acceptBy: now + 1000,
    expiresAt: now + 10000,
    executionWindowMs: 5000,
    bindings: [
      {
        kind: 'premises',
        id: 'home',
        entitlementVersion: building.control.version,
        duty: 'control-handover',
      },
    ],
  };
  ok(residentSuccessionArrangementEvent({ ...ctx(), command: { type: 'create', terms } }));
  for (const [role, actor] of [
    ['executor', 'donor'],
    ['beneficiary', 'worker'],
  ] as const)
    ok(
      residentSuccessionArrangementEvent({
        ...ctx(actor),
        command: {
          type: 'respond',
          id: 'home-will',
          expectedRevision: w.residentExits!.arrangements.arrangements['home-will']!.revision,
          termsRevision: 1,
          role,
          accept: true,
        },
      }),
    );
  const baseDeath = residentDeathFixture();
  const death = capturedResidentDeparture(w, {
    ...baseDeath,
    sequence: events.length + 50,
    occurredAt: now,
    payload: { ...baseDeath.payload, agentId: asAgentId('builder'), diedAt: now },
  });
  commit([death]);
  ok(
    residentSuccessionControlOfferEvent({
      ...ctx('donor'),
      offer: {
        id: 'home-transfer',
        arrangementId: 'home-will',
        expectedArrangementRevision:
          w.residentExits!.arrangements.arrangements['home-will']!.revision,
        termsRevision: 1,
        kind: 'premises',
        resourceId: 'home',
        expiresAt: now + 500,
      },
    }),
  );
  const offered = w.premises!.buildings.home!;
  expect(offered.control.controller).toEqual({ kind: 'resident', id: 'builder' });
  ok(
    residentPrincipalControlEvent({
      ...ctx('worker'),
      request: {
        resourceKind: 'premises',
        resourceId: 'home',
        resourceRevision: offered.revision,
        controlVersion: offered.control.version,
        command: { type: 'accept' },
      },
    }),
  );
  const after = w.premises!.buildings.home!;
  expect(after.control.controller).toEqual({ kind: 'resident', id: 'worker' });
  expect(after.ownerId).toBe(building.ownerId);
  expect(after.blueprint).toEqual(building.blueprint);
  expect(after.blueprint.capacity).toBe(2);
  expect(after.embodied).toEqual(building.embodied);
  expect(after.embodied.Wood).toBe(8);
  expect(after.condition).toBe(building.condition);
  expect(after.access).toEqual(building.access);
  expect(after.locationId).toBe(building.locationId);
  expect(w.agents.worker!.locationId).toBe('street');
  expect(w.agents.worker!.residenceLocationId).toBeUndefined();
  expect(w.materials!.reservations!.records.r!.status).toBe('settled');
  expect(w.moneySupply).toBe(baseline.moneySupply);
  expect(events.reduce(applyWorldEvent, baseline)).toEqual(w);
  assertResidentSuccessionSnapshot(w);
});
