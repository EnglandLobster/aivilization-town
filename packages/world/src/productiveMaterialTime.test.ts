import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
} from '@aivilization/sim-core';
import { createMaterialsPolicy, type MaterialCommand } from '@aivilization/materials';
import { RESIDENT_REST_POLICY } from '@aivilization/society';
import { expect, test } from 'vitest';
import {
  createWorldProjection,
  applyWorldEvent,
  dispatchWorldCommand,
  enableResidentLaborEvent,
  enableProductiveEmploymentEvent,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  type MaterialAuthorization,
} from './residentMaterials';
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 100,
  laborPay: { version: 'labor-proportional-pay-v1', referenceSeconds: 3600 },
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 4 },
  criticalThresholds: { energy: 0, health: 0 },
  calendar: {
    policyVersion: 'town-calendar-v1',
    dayLengthMs: 86400000,
    phases: [{ phase: 'night', startFraction: 0 }],
    physiologicalDecay: { energyPerHour: 2, satietyPerHour: 1 },
  },
  sleepDeprivation: { energyThreshold: 25, healthDecayPerSecond: 0.001, minHealth: 0 },
};
function fixture(energy = 30) {
  const initial = createWorldProjection({
    agents: [
      {
        agentId: asAgentId('worker'),
        balance: 100,
        inventory: { Wood: 3 },
        physiology: { energy, satiety: 50, health: 100 },
        educationScore: 0,
        residentialTier: 1,
        job: null,
        locationId: asLocationId('site'),
      },
    ],
    moneySupply: 100,
    locations: [
      {
        locationId: asLocationId('site'),
        name: 'Workshop',
        kind: 'production',
        activityAffinities: ['work'],
        capacity: 10,
      },
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = () => ({
    projection: w,
    actorId: 'worker',
    simulationId: 'sim',
    requestId: `m${++n}`,
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  };
  const auth: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: (c) => c.kind === 'resident' && !!w.agents[c.id],
    hasExternalObligation: () => false,
    mayStoreAt: () => true,
  };
  const act = (command: MaterialCommand) => {
    const d = residentMaterialEvent({ ...context(), authorization: auth, command });
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  commit([
    createEventEnvelope({
      id: 'rest',
      simulationId: 'sim',
      sequence: 1,
      occurredAt: 0,
      type: 'ResidentRestEnabled',
      payload: { policy: RESIDENT_REST_POLICY },
    }),
  ]);
  commit([
    enableResidentMaterialsEvent({
      simulationId: 'sim',
      requestId: 'materials',
      nextSequence: 2,
      at: 0,
      policy: createMaterialsPolicy([
        {
          id: 'book',
          version: 'book-v1',
          inputs: { Wood: 1 },
          outputs: { Book: 1 },
          workMs: 3600000,
          energyCost: 10,
          satietyCost: 4,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  commit([enableResidentLaborEvent({ ...context(), policies })]);
  commit([enableProductiveEmploymentEvent(context())]);
  act({ type: 'create-stock', id: 'stock', title: 'Stock', locationId: 'site' });
  act({ type: 'deposit', id: 'stock', expectedRevision: 1, items: { Wood: 3 } });
  act({
    type: 'create-production',
    id: 'job',
    stockId: 'stock',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 3,
    workers: ['worker'],
    productName: 'Book',
    description: 'Original words',
  });
  act({ type: 'start-production', id: 'job', expectedRevision: 1, until: 3600000 });
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time${++n}`,
          simulationId: 'sim',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs },
          issuedAt: w.clock.now,
        }),
      }),
    );
  return {
    initial,
    get w() {
      return w;
    },
    events,
    time,
    act,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('one body interval produces actual progress with combined decay, threshold health damage and deterministic replay', () => {
  const t = fixture();
  t.time(3600000);
  expect(t.w.materials!.stocks.stock!.inventory).toEqual({ Book: 1 });
  expect(t.w.materials!.productions.job!.progressMs).toBe(3600000);
  expect(t.w.agents.worker!.physiology.energy).toBeCloseTo(18, 8);
  expect(t.w.agents.worker!.physiology.satiety).toBeCloseTo(45, 8);
  expect(t.w.agents.worker!.physiology.health).toBeCloseTo(97.9, 8);
  expect(t.w.moneySupply).toBe(100);
  t.replay();
  const split = fixture();
  for (const delta of [17777, 900003, 1234567, 1447653]) split.time(delta);
  expect(split.w.materials!.stocks.stock!.inventory).toEqual(
    t.w.materials!.stocks.stock!.inventory,
  );
  expect(split.w.materials!.productions.job!.progressMs).toBe(3600000);
  for (const k of ['energy', 'satiety', 'health'] as const)
    expect(split.w.agents.worker!.physiology[k]).toBeCloseTo(t.w.agents.worker!.physiology[k], 8);
  split.replay();
});
test('early personal departure retains actual partial progress and rejects forged body work proof', () => {
  const t = fixture();
  t.time(123456);
  const job = t.w.materials!.productions.job!;
  t.act({ type: 'leave-production', id: 'job', expectedRevision: job.revision });
  const before = t.w.agents.worker!.physiology.energy;
  t.time(3600000);
  expect(t.w.materials!.productions.job!.progressMs).toBe(123456);
  expect(t.w.agents.worker!.physiology.energy).toBeCloseTo(before - 2, 8);
  const event = t.events.find(
    (e) => e.type === 'ResidentMaterialsCommitted' && e.payload.elapsedBody,
  );
  expect(event).toBeDefined();
  if (event?.type !== 'ResidentMaterialsCommitted' || !event.payload.elapsedBody)
    throw Error('missing-body-proof');
  const originalBody = event.payload.elapsedBody;
  expect(() =>
    applyWorldEvent(t.events.slice(0, t.events.indexOf(event)).reduce(applyWorldEvent, t.initial), {
      ...event,
      payload: {
        ...event.payload,
        elapsedBody: { ...originalBody, workedMs: 999999 },
      },
    }),
  ).toThrow('invalid-productive-body-proof');
  t.replay();
});
test('natural decay can exhaust a planned productive shift; different advance partitions preserve actual earned work', () => {
  const whole = fixture(10);
  whole.time(3600000);
  const split = fixture(10);
  for (const delta of [17777, 900003, 1234567, 1447653]) split.time(delta);
  expect(whole.w.materials!.productions.job!.progressMs).toBe(3000000);
  expect(split.w.materials!.productions.job!.progressMs).toBe(3000000);
  expect(whole.w.materials!.productions.job!.session).toBeUndefined();
  expect(split.w.materials!.productions.job!.session).toBeUndefined();
  expect(whole.w.activityTimeByAgent.worker!.availableAt).toBe(3000000);
  expect(split.w.activityTimeByAgent.worker!.availableAt).toBe(3000000);
  for (const k of ['energy', 'satiety', 'health'] as const)
    expect(split.w.agents.worker!.physiology[k]).toBeCloseTo(
      whole.w.agents.worker!.physiology[k],
      8,
    );
  whole.replay();
  split.replay();
});
