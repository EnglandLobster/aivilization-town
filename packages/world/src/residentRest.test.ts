import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import {
  RESIDENT_REST_POLICY,
  PHYSICAL_HOUSING_REST_POLICY,
  HOUSING_OCCUPANCY_POLICY,
} from '@aivilization/society';
import {
  emptyPremisesState,
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
} from '@aivilization/premises';
import { enablePhysicalHousingRestEvent } from './physicalHousingRest';
import { expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
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
  sleep: { energyRecoveryPerSecond: 0.1, maxEnergy: 100 },
  sleepDeprivation: { energyThreshold: 20, healthDecayPerSecond: 0.01, minHealth: 0 },
  calendar: {
    policyVersion: 'town-calendar-v1',
    dayLengthMs: 86400000,
    phases: [{ phase: 'night', startFraction: 0 }],
    physiologicalDecay: { energyPerHour: 36, satietyPerHour: 18 },
  },
};
function setup(enabled = true, physicalHousing = false) {
  const initial = createWorldProjection({
    agents: ['a', 'b'].map((id) => ({
      agentId: asAgentId(id),
      locationId: asLocationId('home'),
      physiology: { energy: 10, satiety: 80, health: 90 },
      educationScore: 0,
      balance: 100,
      residentialTier: 1,
      job: null,
      inventory: {},
    })),
    moneySupply: 200,
    locations: [
      {
        locationId: asLocationId('home'),
        name: 'Home',
        kind: 'residence',
        activityAffinities: [],
        capacity: 10,
      },
    ],
  });
  const seeded = physicalHousing
    ? {
        ...initial,
        premises: emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
        housingOccupancy: { policy: HOUSING_OCCUPANCY_POLICY, revisions: {} },
      }
    : initial;
  let w = seeded,
    n = 0;
  const events: WorldEvent[] = [];
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(w.moneySupply).toBe(200);
    expect(w.agents.a!.balance + w.agents.b!.balance).toBe(200);
  };
  const enable = () =>
    commit([
      createEventEnvelope({
        id: `enable-${++n}`,
        simulationId: 'test',
        type: 'ResidentRestEnabled',
        payload: { policy: RESIDENT_REST_POLICY },
        occurredAt: w.clock.now,
        sequence: events.length + 1,
      }),
    ]);
  if (enabled) enable();
  if (physicalHousing)
    commit([
      enablePhysicalHousingRestEvent({
        projection: w,
        requestId: 'physical',
        simulationId: 'test',
        nextSequence: events.length + 1,
      }),
    ]);
  const act = (type: CoreCommandType, payload: unknown, actorId = 'a', p = policies) => {
    const es = dispatchWorldCommand({
      projection: w,
      policies: p,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `cmd-${++n}`,
        simulationId: 'test',
        type,
        payload,
        issuedAt: w.clock.now,
        ...(type === 'AdvanceSimulationTime' ? { source: 'system' as const } : { actorId }),
      }),
    });
    commit(es);
    return es;
  };
  return {
    get w() {
      return w;
    },
    initial: seeded,
    events,
    act,
    enable,
    commit,
    time: (deltaMs: number) => act('AdvanceSimulationTime', { deltaMs }),
    rest: () => Object.values(w.residentRest!.sessions)[0]!,
    replay: () => expect(events.reduce(applyWorldEvent, seeded)).toEqual(w),
  };
}
test('sleep reserves time without prepaid recovery; exact off-grid completion splits sleeping from waking decay', () => {
  const t = setup();
  const started = t.act('AgentSleep', { durationSeconds: 125 });
  expect(started.map((e) => e.type)).toEqual([
    'ResidentRestSessionChanged',
    'AgentActivityTimeCommitted',
    'ShortTermMemoryRecorded',
  ]);
  expect(t.w.agents.a!.physiology.energy).toBe(10);
  expect(t.w.activityTimeByAgent.a).toMatchObject({
    availableAt: 125000,
    settlementTiming: 'effects-during-activity',
  });
  t.time(30000);
  expect(t.w.agents.a!.physiology.energy).toBeCloseTo(12.7);
  expect(t.rest()).toMatchObject({ status: 'active', elapsedMs: 30000 });
  t.time(150000);
  expect(t.rest()).toMatchObject({ status: 'completed', elapsedMs: 125000, settledAt: 125000 });
  expect(t.w.agents.a!.physiology.energy).toBeCloseTo(20.7);
  expect(t.w.agents.a!.physiology.satiety).toBeCloseTo(79.1);
  expect(t.w.agents.a!.physiology.health).toBeCloseTo(90 - (10 / 0.09) * 0.01);
  expect(t.w.residentRest!.activeByActor.a).toBeUndefined();
  t.replay();
});
test('only the sleeper may interrupt the current revision; future recovery is cancelled and busy time is released', () => {
  const t = setup();
  t.act('AgentSleep', { durationSeconds: 125 });
  t.time(30000);
  const { id, revision } = t.rest();
  for (const [actor, expectedRevision] of [
    ['b', revision],
    ['a', 1],
  ] as const) {
    const es = t.act('AgentStopRest', { id, expectedRevision }, actor);
    expect(es.some((e) => e.type === 'ActionRejected')).toBe(true);
    expect(t.rest().status).toBe('active');
    expect(t.w.activityTimeByAgent.a!.availableAt).toBe(125000);
  }
  t.act('AgentStopRest', { id, expectedRevision: revision });
  expect(t.rest()).toMatchObject({ status: 'interrupted', elapsedMs: 30000 });
  expect(t.w.activityTimeByAgent.a!.availableAt).toBe(30000);
  t.time(60000);
  expect(t.w.agents.a!.physiology.energy).toBeCloseTo(12.1);
  t.replay();
});
test('large and irregular small advances produce equivalent physical effects and actual sleep duration', () => {
  const large = setup(),
    small = setup();
  for (const t of [large, small]) t.act('AgentSleep', { durationSeconds: 125 });
  large.time(240000);
  for (const ms of [17500, 48750, 70250, 35000, 68500]) small.time(ms);
  for (const actor of ['a', 'b'])
    for (const axis of ['energy', 'satiety', 'health'] as const)
      expect(small.w.agents[actor]!.physiology[axis]).toBeCloseTo(
        large.w.agents[actor]!.physiology[axis],
        10,
      );
  expect(small.rest().elapsedMs).toBe(large.rest().elapsedMs);
  expect(small.rest().status).toBe('completed');
  large.replay();
  small.replay();
});
test('legacy sleep keeps upfront semantics; migration rejects unexpired prepaid reservations', () => {
  const t = setup(false);
  t.act('AgentSleep', { durationSeconds: 125 });
  expect(t.w.agents.a!.physiology.energy).toBe(22.5);
  expect(t.w.residentRest).toBeUndefined();
  expect(() => t.enable()).toThrow('rest-activation-requires-no-active-prepaid-effects');
  t.time(125000);
  t.enable();
  t.replay();
});
test('elapsed mode rejects unsupported amortization instead of silently skipping sleeping bodies', () => {
  const t = setup();
  const before = t.w;
  expect(() =>
    t.act('AdvanceSimulationTime', { deltaMs: 60000 }, 'a', {
      ...policies,
      timeSettlementAmortization: { buckets: 2 },
    }),
  ).toThrow('resident-rest-needs-versioned-unamortized-living-resident-cadences');
  expect(t.w).toBe(before);
});

test('explicit physical housing keeps initial endowed rest rate, real source evidence and legacy caps with exact replay', () => {
  const t = setup(true, true);
  t.act('AgentSleep', { durationSeconds: 125 });
  t.time(30000);
  const effect = t.events.find(
    (e) => e.type === 'PhysiologyChanged' && e.payload.elapsed?.restSessionId,
  );
  expect(effect).toMatchObject({
    payload: {
      elapsed: {
        physicalHousing: {
          policyVersion: PHYSICAL_HOUSING_REST_POLICY.version,
          source: { kind: 'initial-world-residence', locationId: 'home' },
          at: 0,
          multiplier: 1,
          energyPerSecond: 0.1,
        },
      },
    },
  });
  expect(t.w.agents.a!.physiology.energy).toBeCloseTo(12.7);
  const index = t.events.indexOf(effect!),
    before = t.events.slice(0, index).reduce(applyWorldEvent, t.initial);
  if (!effect || effect.type !== 'PhysiologyChanged' || !effect.payload.elapsed?.physicalHousing)
    throw Error('missing real evidence');
  const forged = {
    ...effect,
    payload: {
      ...effect.payload,
      elapsed: {
        ...effect.payload.elapsed,
        physicalHousing: { ...effect.payload.elapsed.physicalHousing, multiplier: 2 },
      },
    },
  };
  expect(() => applyWorldEvent(before, forged)).toThrow('physical-housing-rest-source-mismatch');
  const { physicalHousing: omitted, ...elapsed } = effect.payload.elapsed;
  void omitted;
  expect(() =>
    applyWorldEvent(before, { ...effect, payload: { ...effect.payload, elapsed } }),
  ).toThrow('physical-housing-rest-source-mismatch');
  t.replay();
});
test('physical policy cannot alter an active sleep or activate without real prerequisites', () => {
  const t = setup();
  expect(() =>
    enablePhysicalHousingRestEvent({
      projection: t.w,
      requestId: 'x',
      simulationId: 'test',
      nextSequence: 1,
    }),
  ).toThrow('physical-housing-needs-elapsed-rest-premises-and-occupancy');
  const world = {
    ...t.w,
    premises: emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
    housingOccupancy: { policy: HOUSING_OCCUPANCY_POLICY, revisions: {} },
  };
  t.act('AgentSleep', { durationSeconds: 125 });
  expect(() =>
    enablePhysicalHousingRestEvent({
      projection: { ...world, residentRest: t.w.residentRest! },
      requestId: 'x',
      simulationId: 'test',
      nextSequence: 1,
    }),
  ).toThrow('physical-housing-activation-needs-no-active-sleep');
});
