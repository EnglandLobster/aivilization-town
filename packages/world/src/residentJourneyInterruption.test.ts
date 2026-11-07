import { freightEscrowBalance } from '@aivilization/logistics';
import { emptyCommerceState } from '@aivilization/commerce';
import { handleAgentMoveToCommand } from './handlers/movement';
import { handleAdvanceSimulationTimeCommand } from './agentActions';
import { residentMobilityCommand } from './residentMobility';
import type { WorldProjection } from './projection';
import { prepareResidentEmploymentDeparture } from './residentEmploymentDeparture';
import { residentDeathFixture, residentExitFixture } from './testFixtures/residentExit';
import { advanceResidentMobility } from './residentMobility';
import { expect, test } from 'vitest';
import { interruptVehicleJourney } from '@aivilization/mobility';
import { asAgentId, createCommandEnvelope, createEventEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, createWorldProjection } from './projection';
import { freightWorldFixture } from './testFixtures/residentFreight';
test('standalone vehicle interruption cannot bypass the pending atomic body and cargo adapter', () => {
  const t = freightWorldFixture({ vehicle: true });
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  t.ok(
    t.mobility('carrier', {
      type: 'vehicles.drive',
      id: 'car',
      destinationId: 'east',
      expectedRevision: 1,
    }),
  );
  const before = structuredClone(t.w);
  const d = interruptVehicleJourney({
    state: t.w.residentMobility,
    vehicleId: 'car',
    expectedRevision: 2,
    source: {
      executor: 'system',
      participantId: 'carrier',
      populationEventId: 'death-carrier',
      populationPolicyVersion: 'starvation-v1',
      populationType: 'AgentDied',
      stoppedAt: 0,
    },
  });
  if (!d.accepted) throw Error(d.reason);
  const event = createEventEnvelope({
    id: 'isolated-interruption',
    simulationId: 'sim',
    sequence: 100,
    occurredAt: 0,
    type: 'ResidentMobilityCommitted',
    payload: { policyVersion: 'resident-mobility-v1' as const, events: [d.event] },
  });
  expect(() => applyWorldEvent(t.w, event)).toThrow(
    'vehicle-interruption-requires-atomic-transport-adapter',
  );
  expect(t.w).toEqual(before);
});

for (const fraction of [0, 0.5])
  test(`vehicle departure batch preserves interrupted physical reference and original cargo at ${fraction}`, () => {
    const t = freightWorldFixture({ vehicle: true });
    t.ready();
    t.ok(t.freight('carrier', 'load'));
    t.ok(
      t.mobility('carrier', {
        type: 'vehicles.drive',
        id: 'car',
        destinationId: 'east',
        expectedRevision: 1,
      }),
    );
    const at = t.w.residentMobility.vehicles.car!.journey!.arrivesAt * fraction;
    const w = {
      ...t.w,
      residentExits: residentExitFixture().residentExits,
      clock: { ...t.w.clock, now: at },
    };
    const before = structuredClone(w);
    const death = residentDeathFixture();
    const d = prepareResidentEmploymentDeparture({
      projection: w,
      departure: {
        ...death,
        occurredAt: at,
        payload: { ...death.payload, agentId: asAgentId('carrier'), diedAt: at },
      },
    });
    if (!d.accepted) throw Error(d.reason);
    const interruption = d.events.find((e) => e.type === 'ResidentMobilityCommitted')!;
    if (interruption.type !== 'ResidentMobilityCommitted') throw Error('expected interruption');
    const stopped = applyWorldEvent(w, interruption);
    expect(stopped.agents.carrier!.locationId).toBeNull();
    expect(stopped.transitByAgent?.carrier).toBeUndefined();
    expect(stopped.activityTimeByAgent.carrier!.availableAt).toBe(at);
    expect(stopped.interruptedTravelByAgent!.carrier!.transit).toEqual(w.transitByAgent!.carrier);
    expect(stopped.agents.carrier!.physiology).toEqual(w.agents.carrier!.physiology);
    const after = d.events.reduce(applyWorldEvent, w);
    expect(after.agents.carrier).toBeUndefined();
    expect(after.interruptedTravelByAgent!.carrier).toEqual(
      stopped.interruptedTravelByAgent!.carrier,
    );
    expect(after.materials).toEqual(w.materials);
    expect(after.logistics).toEqual(w.logistics);
    const estateCash = Object.values(after.residentExits!.cash.accounts).reduce(
      (n, a) => n + a.balance,
      0,
    );
    expect(
      Object.values(after.agents).reduce((n, a) => n + a.balance, estateCash) +
        freightEscrowBalance(after.logistics),
    ).toBe(after.moneySupply);
    expect(after.agents.friend).toEqual(w.agents.friend);
    expect(Object.values(after.residentExits!.materials.records)[0]?.locationId).toBeNull();
    expect(d.events.reduce(applyWorldEvent, structuredClone(w))).toEqual(after);
    expect(
      createWorldProjection({
        agents: [],
        moneySupply: 0,
        interruptedTravelByAgent: after.interruptedTravelByAgent!,
      }).interruptedTravelByAgent,
    ).toEqual(after.interruptedTravelByAgent);
    const { transportInterruption, ...without } = interruption.payload;
    expect(() => applyWorldEvent(w, { ...interruption, payload: without })).toThrow();
    expect(() =>
      applyWorldEvent(w, {
        ...interruption,
        payload: {
          ...interruption.payload,
          transportInterruption: { ...transportInterruption!, transits: [] },
        },
      }),
    ).toThrow();
    expect(() => applyWorldEvent(stopped, interruption)).toThrow();
    const future = { ...after, clock: { ...after.clock, now: at + 1000000 } };
    expect(advanceResidentMobility({ ...t.context('system'), projection: future })).toEqual([]);
    expect(w).toEqual(before);
  });

test('a surviving passenger stays at the interrupted route after the clock advances and cannot use unplaced movement', () => {
  const t = freightWorldFixture({ vehicle: true });
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  let w: WorldProjection = { ...t.w, residentCommerce: emptyCommerceState() };
  let sequence = 100;
  const act = (
    actorId: string,
    command: Parameters<typeof residentMobilityCommand>[0]['command'],
  ) => {
    const d = residentMobilityCommand({
      ...t.context(actorId),
      projection: w,
      command,
      nextSequence: sequence,
    });
    if (!d.accepted) throw Error(d.reason);
    w = d.events.reduce(applyWorldEvent, w);
    sequence += d.events.length;
  };
  act('carrier', { type: 'drivers.register', vehicleId: 'car' });
  act('carrier', { type: 'drivers.online' });
  act('friend', { type: 'rides.request', id: 'ride', destinationId: 'east', expiresAt: 1000000 });
  act('carrier', { type: 'rides.quote', id: 'quote', rideId: 'ride', fare: 2, expiresAt: 900000 });
  act('friend', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 });
  act('carrier', { type: 'rides.pickup', id: 'ride', expectedRevision: 2 });
  act('friend', { type: 'rides.board', id: 'ride', expectedRevision: 3 });
  w = {
    ...w,
    residentExits: residentExitFixture().residentExits,
    clock: { ...w.clock, now: w.residentMobility!.vehicles.car!.journey!.arrivesAt / 2 },
  };
  const raw = residentDeathFixture();
  const d = prepareResidentEmploymentDeparture({
    projection: w,
    departure: {
      ...raw,
      sequence,
      occurredAt: w.clock.now,
      payload: { ...raw.payload, agentId: asAgentId('carrier'), diedAt: w.clock.now },
    },
  });
  if (!d.accepted) throw Error(d.reason);
  const after = d.events.reduce(applyWorldEvent, w);
  expect(after.agents.friend!.locationId).toBeNull();
  expect(after.interruptedTravelByAgent!.friend!.transit).toEqual(w.transitByAgent!.friend);
  expect(after.residentCommerce).toEqual(w.residentCommerce);
  expect(after.materials).toEqual(w.materials);
  const advanced = handleAdvanceSimulationTimeCommand({
    projection: after,
    nextSequence: sequence + d.events.length,
    command: createCommandEnvelope({
      id: 'time-after-stop',
      simulationId: 'sim',
      source: 'system',
      type: 'AdvanceSimulationTime',
      issuedAt: after.clock.now,
      payload: { deltaMs: 120000 },
    }),
  }).reduce(applyWorldEvent, after);
  expect(advanced.agents.friend!.locationId).toBeNull();
  expect(advanced.interruptedTravelByAgent).toEqual(after.interruptedTravelByAgent);
  expect(advanceResidentMobility({ ...t.context('system'), projection: advanced })).toEqual([]);
  const move = handleAgentMoveToCommand({
    projection: advanced,
    nextSequence: 1000,
    command: createCommandEnvelope({
      id: 'no-teleport',
      simulationId: 'sim',
      source: 'agent-runtime',
      actorId: 'friend',
      type: 'AgentMoveTo',
      issuedAt: advanced.clock.now,
      payload: { targetLocationId: 'east' },
    }),
  });
  expect(
    move.some(
      (e) =>
        e.type === 'ActionRejected' &&
        e.payload.reason === 'interrupted-travel-requires-resumption-protocol',
    ),
  ).toBe(true);
});
