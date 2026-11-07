import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import {
  createWorldProjection,
  applyWorldEvent,
  chooseResidentHousingStandard,
  enableHousingChoiceEvent,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  residentialUpkeep: {
    costs: [
      { residentialTier: 1, currencyCostPerHour: 3 },
      { residentialTier: 2, currencyCostPerHour: 10 },
    ],
  },
  residentialTierUpgrade: {
    maxResidentialTier: 2,
    costs: [{ targetResidentialTier: 2, currencyCost: 5 }],
  },
};
function fixture() {
  const initial = createWorldProjection({
    moneySupply: 100,
    agents: [
      {
        agentId: asAgentId('a'),
        locationId: asLocationId('home'),
        residenceLocationId: asLocationId('home'),
        balance: 100,
        residentialTier: 2,
        upkeepArrears: 17,
        job: null,
        educationScore: 0,
        inventory: { Wood: 2 },
        physiology: { energy: 80, satiety: 90, health: 70 },
      },
    ],
    locations: [
      {
        locationId: asLocationId('home'),
        name: 'Existing real home',
        kind: 'residence',
        capacity: 2,
        activityAffinities: [],
      },
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const commit = (es: readonly WorldEvent[]) => {
    w = es.reduce(applyWorldEvent, w);
    events.push(...es);
  };
  const ctx = () => ({
    projection: w,
    simulationId: 'housing-test',
    requestId: `h-${++n}`,
    nextSequence: events.length + 1,
  });
  const enable = () => commit([enableHousingChoiceEvent({ ...ctx(), policies })]);
  const choose = (targetTier = 1, expectedRevision = 1) =>
    chooseResidentHousingStandard({ ...ctx(), actorId: 'a', targetTier, expectedRevision });
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `t-${++n}`,
          simulationId: 'housing-test',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  return {
    initial,
    events,
    get w() {
      return w;
    },
    commit,
    choose,
    enable,
    time,
    ctx,
  };
}
test('self-selected lower standard preserves past debt, body, actual residence, assets and all other world facts; future upkeep uses the chosen level', () => {
  const t = fixture();
  expect(t.choose()).toMatchObject({ accepted: false });
  t.enable();
  const before = structuredClone(t.w);
  const d = t.choose();
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  t.commit(d.events);
  expect(t.w).toEqual({
    ...before,
    housingChoice: { ...before.housingChoice, revisions: { a: 2 } },
    agents: { ...before.agents, a: { ...before.agents.a, residentialTier: 1 } },
  });
  expect(() => applyWorldEvent(t.w, d.events[0]!)).toThrow(
    'housing-standard-choice-source-mismatch',
  );
  t.time(3600000);
  expect(t.w.agents.a!.balance).toBe(97);
  expect(t.w.moneySupply).toBe(97);
  expect(t.w.agents.a!.upkeepArrears).toBe(17);
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});
test('legacy upgrades invalidate previews after re-entering the same tier, and busy physical activity is never edited', () => {
  const t = fixture();
  t.enable();
  const d = t.choose();
  if (!d.accepted) throw Error(d.reason);
  t.commit(d.events);
  t.commit(
    dispatchWorldCommand({
      projection: t.w,
      policies,
      nextSequence: t.events.length + 1,
      command: createCommandEnvelope({
        id: 'upgrade',
        simulationId: 'housing-test',
        actorId: 'a',
        type: 'AgentUpgradeResidentialTier',
        issuedAt: 0,
        payload: { targetResidentialTier: 2 },
      }),
    }),
  );
  expect(t.w.agents.a!.residentialTier).toBe(2);
  expect(t.w.housingChoice!.revisions.a).toBe(3);
  expect(t.choose(1, 1)).toMatchObject({
    accepted: false,
    reason: 'housing-choice-revision-conflict',
  });
  expect(t.choose(1, 3).accepted).toBe(true);
  const busy = {
    ...t.w,
    activityTimeByAgent: {
      a: {
        agentId: asAgentId('a'),
        activity: 'sleep' as const,
        commandType: 'AgentSleep' as const,
        policyVersion: 'exclusive-agent-activity-time-v1' as const,
        settlementTiming: 'effects-at-commit' as const,
        committedAt: 0,
        startedAt: 0,
        availableAt: 1000,
        durationSeconds: 1,
      },
    },
  };
  expect(
    chooseResidentHousingStandard({
      ...t.ctx(),
      projection: busy,
      actorId: 'a',
      targetTier: 1,
      expectedRevision: 3,
    }),
  ).toMatchObject({
    accepted: false,
    reason: 'housing-choice-requires-no-active-physical-commitment',
  });
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});
test('fee settlement across an actual choice is equivalent to segmented time and activation does not rewrite legacy worlds', () => {
  const large = fixture(),
    split = fixture();
  for (const t of [large, split]) {
    t.enable();
    t.time(3600000);
    const d = t.choose();
    if (!d.accepted) throw Error(d.reason);
    t.commit(d.events);
  }
  large.time(7200000);
  split.time(3600000);
  split.time(3600000);
  expect(large.w.agents.a!.balance).toBe(84);
  expect(large.w.agents.a).toEqual(split.w.agents.a);
  expect(large.w.moneySupply).toBe(split.w.moneySupply);
  const legacy = fixture();
  legacy.time(3600000);
  expect(legacy.w.agents.a!.balance).toBe(90);
  expect(legacy.w.housingChoice).toBeUndefined();
  expect(() =>
    enableHousingChoiceEvent({
      ...legacy.ctx(),
      policies: {
        ...policies,
        timeSettlementAmortization: { buckets: 2 },
      },
    }),
  ).toThrow('housing-choice-requires-exact-time-settlement');
});
