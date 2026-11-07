import { prepareResidentEmploymentDeparture } from './residentEmploymentDeparture';
import { residentExitFixture, residentDeathFixture } from './testFixtures/residentExit';
import { estateCashBalance } from '@aivilization/economy';
import { residentConstructionFixture } from './testFixtures/residentConstruction';
import { expect, test } from 'vitest';
import { createCommandEnvelope, asLocationId, asAgentId } from '@aivilization/sim-core';
import { applyWorldEvent, resolveAgentResidenceLocationId } from './projection';
import {
  residentConstructionEvent,
  settleResidentConstructionEvent,
  residentPremisesEvent,
} from './residentPremises';
import { handleAgentChooseResidenceCommand } from './agentActions';
const setup = residentConstructionFixture;
test('funded construction consumes materials and real personal time atomically, adds a reachable regional location and replays', () => {
  const t = setup();
  expect(t.w.locations['premises-home']).toBeUndefined();
  expect(t.w.agents.donor!.inventory.Wood).toBe(12);
  t.start();
  expect(t.w.activityTimeByAgent.worker).toMatchObject({
    commandType: 'ResidentConstructionWork',
    availableAt: 480000,
  });
  expect(
    t.material(
      { type: 'create-stock', id: 'other', title: '冲突时间', locationId: 'street' },
      'worker',
    ),
  ).toMatchObject({ accepted: false });
  t.time(120000);
  t.tick();
  expect(t.w.locations['premises-home']).toBeUndefined();
  expect(t.w.premises!.projects.p!.progressMs).toBe(120000);
  expect(t.w.agents.worker!.physiology.energy).toBeCloseTo(100 - (120000 / 3600000) * 10, 8);
  t.time(360000);
  t.tick();
  expect(t.w.premises!.projects.p!.status).toBe('completed');
  expect(t.w.materials!.reservations!.records.r).toMatchObject({
    status: 'settled',
    allocated: { Wood: 8 },
    held: {},
  });
  expect(t.w.locations['premises-home']).toMatchObject({
    kind: 'residence',
    capacity: 2,
    regionId: 'north',
    connections: [{ targetLocationId: 'street', travelDurationSeconds: 60 }],
  });
  expect(t.w.locations.street!.connections).toEqual([
    { targetLocationId: 'premises-home', travelDurationSeconds: 60 },
  ]);
  expect(t.move('donor').find((e) => e.type === 'ActionRejected')?.payload.reason).toBe(
    'premises-entry-not-authorized',
  );
  const es = t.move('builder');
  expect(es.some((e) => e.type === 'AgentTravelStarted')).toBe(true);
  t.commit(es);
  expect(t.w.agents.builder!.locationId).toBe('street');
  t.time(60000);
  expect(t.w.agents.builder!.locationId).toBe('premises-home');
  t.replay();
});
test('cancellation preserves actual work and refunds held materials; stale consent and unrelated busy reservation cannot be bypassed', () => {
  const t = setup();
  t.start();
  t.time(100000);
  expect(
    residentConstructionEvent({
      ...t.context('donor'),
      command: { type: 'cancel', id: 'p', revision: 2 },
    }).accepted,
  ).toBe(false);
  t.ok(
    residentConstructionEvent({
      ...t.context(),
      command: { type: 'cancel', id: 'p', revision: 2 },
    }),
  );
  expect(t.w.materials!.stocks.s!.inventory.Wood).toBe(8);
  expect(t.w.locations['premises-home']).toBeUndefined();
  expect(t.w.activityTimeByAgent.worker!.availableAt).toBe(100000);
  expect(t.w.premises!.sites.site!.reservedFloorArea).toBe(0);
  expect(t.w.agents.worker!.physiology.energy).toBeLessThan(100);
  t.replay();
});
test('public entry is separate from residence rights, occupied premises cannot be closed, and old worlds do not gain land', () => {
  const t = setup();
  expect(t.initial.premises).toBeUndefined();
  t.start();
  t.time(480000);
  t.tick();
  t.ok(
    residentPremisesEvent({
      ...t.context(),
      id: 'home',
      revision: 1,
      command: {
        type: 'configure',
        title: '公共门厅',
        access: { entry: 'public', visitors: [], operators: [], residents: [] },
      },
    }),
  );
  t.commit(t.move('donor'));
  t.time(60000);
  expect(resolveAgentResidenceLocationId(t.w, t.w.agents.donor!)).toBeNull();
  const es = handleAgentChooseResidenceCommand({
    projection: t.w,
    nextSequence: t.events.length + 1,
    policy: {
      policyVersion: 'residential-assignment-v1',
      arrivalSelection: 'most-vacancies-then-location-id',
    },
    command: createCommandEnvelope({
      id: 'choose',
      simulationId: 'sim',
      source: 'agent-runtime',
      actorId: 'donor',
      type: 'AgentChooseResidence',
      issuedAt: t.w.clock.now,
      payload: { locationId: asLocationId('premises-home') },
    }),
  });
  expect(es.find((e) => e.type === 'ActionRejected')?.payload.reason).toBe(
    'premises-residence-not-authorized',
  );
  expect(
    residentPremisesEvent({ ...t.context(), id: 'home', revision: 2, command: { type: 'close' } }),
  ).toMatchObject({ accepted: false, reason: 'premises-unsettled' });
  t.replay();
});
test('material or building facts cannot be detached from their matching physical completion transaction', () => {
  const t = setup();
  t.start();
  t.time(480000);
  const d = settleResidentConstructionEvent({ ...t.context('system'), projectId: 'p' });
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentPremisesCommitted') throw Error('wrong event');
  expect(() =>
    applyWorldEvent(t.w, { ...e, payload: { ...e.payload, materialEvents: [] } }),
  ).toThrow('unused-material-allocation-evidence');
  expect(() => applyWorldEvent(t.w, { ...e, payload: { ...e.payload, efforts: [] } })).toThrow(
    'construction-work-conservation',
  );
  expect(t.w.premises!.buildings).toEqual({});
  t.replay();
});
test('a construction session and its exclusive world reservation cannot be split or released by an unrelated event', () => {
  const t = setup();
  const d = residentConstructionEvent({
    ...t.context('worker'),
    command: { type: 'start', id: 'p', revision: 1, until: 480000 },
  });
  if (!d.accepted) throw Error(d.reason);
  const event = d.events[0]!;
  if (event.type !== 'ResidentPremisesCommitted') throw Error('wrong event');
  const { reservation, ...payload } = event.payload;
  expect(reservation).toBeDefined();
  expect(() => applyWorldEvent(t.w, { ...event, payload })).toThrow(
    'construction-work-reservation-required',
  );
  t.ok(d);
  const forged = {
    ...event,
    payload: {
      policyVersion: 'resident-premises-v1' as const,
      events: [],
      materialEvents: [],
      efforts: [],
      release: { actorId: 'worker', startedAt: 0, previousAvailableAt: 480000, endedAt: 0 },
    },
  };
  expect(() => applyWorldEvent(t.w, forged)).toThrow('construction-work-stop-required');
  expect(t.w.activityTimeByAgent.worker!.availableAt).toBe(480000);
  t.replay();
});

test.each([0, 120000])(
  'construction worker departure at %s preserves physical obligations and stops future work',
  (elapsed) => {
    const t = setup();
    t.start();
    if (elapsed) {
      t.time(elapsed);
      t.tick();
    }
    const initial = { ...t.w, residentExits: residentExitFixture().residentExits },
      before = structuredClone(initial);
    const death = residentDeathFixture();
    const departure = {
      ...death,
      occurredAt: initial.clock.now,
      payload: { ...death.payload, agentId: asAgentId('worker'), diedAt: initial.clock.now },
    };
    const d = prepareResidentEmploymentDeparture({ projection: initial, departure });
    if (!d.accepted) throw Error(d.reason);
    const event = d.events.find((e) => e.type === 'ResidentPremisesCommitted');
    if (event?.type !== 'ResidentPremisesCommitted' || !event.payload.departure)
      throw Error('missing-construction-interruption');
    expect(event.payload.departure.executor).toBe('system');
    expect(event.payload.materialEvents).toEqual([]);
    expect(event.payload.efforts).toEqual([]);
    const beforeStop = d.events.slice(0, d.events.indexOf(event)).reduce(applyWorldEvent, initial);
    const stopped = applyWorldEvent(beforeStop, event);
    expect(stopped.agents.worker!.physiology).toEqual(initial.agents.worker!.physiology);
    expect(stopped.activityTimeByAgent.worker!.availableAt).toBe(elapsed);
    const changed = event.payload.events[0]!;
    if (changed.type !== 'ConstructionProjectChanged') throw Error('missing-project');
    expect(() =>
      applyWorldEvent(beforeStop, {
        ...event,
        payload: {
          ...event.payload,
          events: [
            {
              ...changed,
              project: { ...changed.project, progressMs: changed.project.progressMs + 1 },
            },
          ],
        },
      }),
    ).toThrow('departure-construction-changed-physical-facts');
    const source = event.payload.departure;
    expect(() =>
      applyWorldEvent(beforeStop, {
        ...event,
        payload: { ...event.payload, departure: { ...source, actorId: 'donor' } },
      }),
    ).toThrow('departure-construction-source-mismatch');
    const { release, ...withoutRelease } = event.payload;
    expect(release).toBeDefined();
    expect(() => applyWorldEvent(beforeStop, { ...event, payload: withoutRelease })).toThrow(
      'departure-construction-release-mismatch',
    );
    const next = d.events.reduce(applyWorldEvent, initial);
    expect(next.premises!.projects.p!.session).toBeUndefined();
    expect(next.premises!.projects.p).toMatchObject({
      status: 'open',
      progressMs: elapsed,
      plan: initial.premises!.projects.p!.plan,
      controller: initial.premises!.projects.p!.controller,
      reservations: initial.premises!.projects.p!.reservations,
    });
    expect(next.premises!.sites).toEqual(initial.premises!.sites);
    expect(next.premises!.buildings).toEqual(initial.premises!.buildings);
    expect(next.materials).toEqual(initial.materials);
    expect(next.agents.worker).toBeUndefined();
    expect(next.activityTimeByAgent.worker).toBeUndefined();
    expect(next.agents.builder).toEqual(initial.agents.builder);
    expect(next.agents.donor).toEqual(initial.agents.donor);
    expect(estateCashBalance(next.residentExits!.cash)).toBe(initial.agents.worker!.balance);
    expect(next.moneySupply).toBe(initial.moneySupply);
    expect(d.events.reduce(applyWorldEvent, initial)).toEqual(next);
    expect(initial).toEqual(before);
    expect(
      prepareResidentEmploymentDeparture({
        projection: { ...initial, clock: { ...initial.clock, now: elapsed + 1 } },
        departure: {
          ...departure,
          occurredAt: elapsed + 1,
          payload: { ...departure.payload, diedAt: elapsed + 1 },
        },
      }),
    ).toMatchObject({
      accepted: false,
      reason: 'construction-interruption-needs-settled-boundary',
    });
  },
);
