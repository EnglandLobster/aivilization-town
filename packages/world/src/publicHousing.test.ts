import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import type { PublicHousingTerms } from '@aivilization/society';
import {
  createWorldProjection,
  applyWorldEvent,
  enableHousingChoiceEvent,
  enablePublicHousingEvent,
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
  chooseResidentHousingStandard,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';
const hour = 3600000;
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  residentialUpkeep: {
    policyVersion: 'old-housing',
    costs: [
      { residentialTier: 1, currencyCostPerHour: 3 },
      { residentialTier: 2, currencyCostPerHour: 10 },
    ],
    arrearsDowngradeThresholdHours: 1,
  },
  residentialTierUpgrade: {
    maxResidentialTier: 2,
    costs: [{ targetResidentialTier: 2, currencyCost: 5, minEducationScore: 10 }],
  },
};
function fixture(enabled = true) {
  const initial = createWorldProjection({
    moneySupply: 200,
    agents: ['a', 'b', 'c'].map((id) => ({
      agentId: asAgentId(id),
      locationId: asLocationId('home'),
      residenceLocationId: asLocationId('home'),
      balance: id === 'b' ? 0 : 100,
      residentialTier: id === 'c' ? 1 : 2,
      upkeepArrears: 17,
      job: null,
      educationScore: 0,
      inventory: { Wood: 2 },
      physiology: { energy: 80, satiety: 90, health: 70 },
    })),
    locations: [
      {
        locationId: asLocationId('home'),
        name: 'Real home',
        kind: 'residence',
        capacity: 3,
        activityAffinities: [],
      },
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `h-${++n}`,
    simulationId: 'housing',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    w = es.reduce(applyWorldEvent, w);
    events.push(...es);
    expect(w.moneySupply).toBeCloseTo(
      Object.values(w.agents).reduce((s, a) => s + a.balance, 0),
      8,
    );
  };
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'test',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 100,
        maximumTreasuryReserve: 1000,
        maximumSubsidyBalanceFloor: 100,
        maximumSubsidyPerCadence: 10,
      },
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'test',
          description: 'Initial authority',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-procedure'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 10,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  commit([enableHousingChoiceEvent({ ...ctx(), policies })]);
  if (enabled) commit([enablePublicHousingEvent({ ...ctx(), policies })]);
  const act = (
    command: Parameters<typeof residentPublicGovernanceCommand>[0]['command'],
    actorId = 'a',
  ) => residentPublicGovernanceCommand({ ...ctx(actorId), command });
  const ok = (command: Parameters<typeof act>[0], actor = 'a') => {
    const d = act(command, actor);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  const rev = (id: string) => w.publicGovernance!.authority.proposals[id]!.revision;
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `t-${++n}`,
          simulationId: 'housing',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  const propose = (id: string, terms: PublicHousingTerms, expectedRevision = 1) => {
    ok({
      type: 'propose',
      id,
      text: 'Directed institution test',
      action: { kind: 'set-housing', expectedRevision, terms },
      closesAt: w.clock.now + 10,
      expectedProcedureRevision: 1,
    });
    for (const a of ['a', 'b'])
      ok({ type: 'vote', id, choice: 'yes', expectedRevision: rev(id) }, a);
  };
  const upgrade = () => {
    const es = dispatchWorldCommand({
      projection: w,
      policies,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `u-${++n}`,
        simulationId: 'housing',
        actorId: 'c',
        type: 'AgentUpgradeResidentialTier',
        issuedAt: w.clock.now,
        payload: { targetResidentialTier: 2 },
      }),
    });
    commit(es);
    return es;
  };
  return {
    initial,
    events,
    ctx,
    commit,
    act,
    ok,
    rev,
    time,
    propose,
    upgrade,
    get w() {
      return w;
    },
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
const revised = (t: ReturnType<typeof fixture>): PublicHousingTerms => ({
  ...t.w.publicHousing!.revisions[0]!.terms,
  standards: [
    { tier: 1, upkeepPerHour: 0, upgrade: null },
    {
      tier: 2,
      upkeepPerHour: 2,
      upgrade: { currencyCost: 7, minEducationScore: 0, inventoryCosts: { Wood: 1 } },
    },
  ],
});
test('explicit housing migration preserves exact resident facts and old debt, makes future tariffs enforceable without forced standard loss or debt forgiveness', () => {
  const t = fixture(false),
    before = structuredClone(t.w);
  t.commit([enablePublicHousingEvent({ ...t.ctx(), policies })]);
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.locations).toEqual(before.locations);
  expect(t.w.moneySupply).toBe(before.moneySupply);
  expect(t.w.publicHousing).toMatchObject({
    legacyArrearsDowngradeThresholdHours: 1,
    revisions: [
      {
        revision: 1,
        terms: {
          standards: [
            { tier: 1, upkeepPerHour: 3 },
            { tier: 2, upkeepPerHour: 10 },
          ],
        },
      },
    ],
  });
  t.time(hour * 2);
  expect(t.w.agents.b).toMatchObject({ balance: 0, residentialTier: 2, upkeepArrears: 37 });
  expect(t.w.agents.a!.balance).toBe(80);
  expect(t.w.agents.a!.upkeepArrears).toBe(17);
  expect(t.events.some((e) => e.type === 'ResidentialTierDowngraded')).toBe(false);
  const d = chooseResidentHousingStandard({ ...t.ctx('b'), targetTier: 1, expectedRevision: 1 });
  if (!d.accepted) throw Error(d.reason);
  t.commit(d.events);
  t.time(hour);
  expect(t.w.agents.b).toMatchObject({ balance: 0, residentialTier: 1, upkeepArrears: 40 });
  t.replay();
  const old = fixture(false);
  old.time(hour);
  expect(old.w.agents.b).toMatchObject({ residentialTier: 1, upkeepArrears: 0 });
  old.replay();
});
test('independent approval changes only future fees and upgrade eligibility; real money and materials are consumed only by an actual authorized upgrade', () => {
  const t = fixture();
  expect(t.upgrade().some((e) => e.type === 'ResidentialTierUpgraded')).toBe(false);
  t.propose('reform', revised(t));
  expect(t.act({ type: 'execute', id: 'reform', expectedRevision: t.rev('reform') })).toMatchObject(
    { accepted: false },
  );
  t.time(10);
  t.ok({ type: 'close', id: 'reform', expectedRevision: t.rev('reform') });
  const before = structuredClone(t.w);
  t.ok({ type: 'execute', id: 'reform', expectedRevision: t.rev('reform') }, 'c');
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.locations).toEqual(before.locations);
  expect(t.w.moneySupply).toBe(before.moneySupply);
  expect(t.w.publicHousing!.revisions[1]).toMatchObject({
    effectiveAt: 10,
    source: { proposalId: 'reform', actorId: 'c', procedureRevision: 1 },
  });
  t.time(hour);
  expect(t.w.agents.c!.balance).toBe(before.agents.c!.balance);
  expect(t.w.agents.a!.balance).toBeCloseTo(before.agents.a!.balance - 2, 8);
  const upgrade = t.upgrade().find((e) => e.type === 'ResidentialTierUpgraded');
  expect(upgrade?.payload).toMatchObject({
    publicHousingRevision: 2,
    currencyCost: 7,
    consumedInventory: { Wood: 1 },
  });
  expect(t.w.agents.c).toMatchObject({
    residentialTier: 2,
    educationScore: 0,
    inventory: { Wood: 1 },
    physiology: before.agents.c!.physiology,
    upkeepArrears: 17,
  });
  expect(t.w.agents.c!.balance).toBe(before.agents.c!.balance - 7);
  t.replay();
});
test('stale approved tariffs and substituted effects fail atomically and do not consume public authorization', () => {
  const t = fixture();
  for (const id of ['first', 'stale']) t.propose(id, revised(t));
  t.time(10);
  for (const id of ['first', 'stale']) t.ok({ type: 'close', id, expectedRevision: t.rev(id) });
  const d = t.act({ type: 'execute', id: 'first', expectedRevision: t.rev('first') });
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  const change = e.payload.housingChange!,
    { housingChange, ...without } = e.payload;
  expect(housingChange).toBeDefined();
  expect(() => applyWorldEvent(t.w, { ...e, payload: without })).toThrow(
    'public-housing-effect-mismatch',
  );
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        housingChange: { ...change, policy: { ...change.policy, effectiveAt: 0 } },
      },
    }),
  ).toThrow('public-housing-effect-mismatch');
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        housingChange: {
          ...change,
          policy: {
            ...change.policy,
            terms: { ...change.policy.terms, landValueCoefficientPerHour: 99 },
          },
        },
      },
    }),
  ).toThrow('public-housing-effect-mismatch');
  t.commit(d.events);
  const before = t.w;
  expect(t.act({ type: 'execute', id: 'stale', expectedRevision: t.rev('stale') })).toMatchObject({
    accepted: false,
    reason: 'public-housing-revision-conflict',
  });
  expect(t.w).toBe(before);
  expect(t.w.publicGovernance!.authority.proposals.stale!.status).toBe('approved');
  t.replay();
});
test('settlement is additive across a revision boundary and replay rejects source-free new-mode charges and legacy forced downgrades', () => {
  const a = fixture(),
    b = fixture();
  for (const t of [a, b]) {
    t.time(hour);
    t.propose('reform', revised(t));
    t.time(10);
    t.ok({ type: 'close', id: 'reform', expectedRevision: t.rev('reform') });
    t.ok({ type: 'execute', id: 'reform', expectedRevision: t.rev('reform') });
  }
  a.time(hour * 2);
  b.time(hour);
  b.time(hour);
  expect(a.w.agents).toEqual(b.w.agents);
  expect(a.w.moneySupply).toBeCloseTo(b.w.moneySupply, 8);
  a.replay();
  b.replay();
  const charged = a.events.find((e) => e.type === 'ResidentialUpkeepCharged')!;
  if (charged.type !== 'ResidentialUpkeepCharged') throw Error('fixture');
  const { publicHousingRevision, ...payload } = charged.payload;
  expect(publicHousingRevision).toBe(1);
  expect(() => applyWorldEvent(a.w, { ...charged, payload })).toThrow(
    'housing-event-policy-source-mismatch',
  );
  expect(() => applyWorldEvent(a.initial, charged)).toThrow('housing-event-policy-source-mismatch');
  const old = fixture(false);
  old.time(hour);
  const downgraded = old.events.find((e) => e.type === 'ResidentialTierDowngraded')!;
  expect(() => applyWorldEvent(a.w, downgraded)).toThrow('forced-housing-standard-change-disabled');
  expect(() =>
    enablePublicHousingEvent({
      ...old.ctx(),
      policies: { ...policies, timeSettlementAmortization: { buckets: 2 } },
    }),
  ).toThrow('public-housing-requires-exact-time-settlement');
  expect(() =>
    enablePublicHousingEvent({ ...old.ctx(), projection: old.initial, policies }),
  ).toThrow('public-housing-requires-public-authority-choice-and-policy');
});
