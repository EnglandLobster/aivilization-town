import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import {
  createWorldProjection,
  applyWorldEvent,
  enableHousingOccupancyEvent,
  leaveResidentHousing,
  dispatchWorldCommand,
  resolveResidentialOccupancy,
  resolveAgentResidenceLocationId,
  residentHousingOccupancyFacts,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  residentialAssignment: {
    policyVersion: 'test',
    arrivalSelection: 'most-vacancies-then-location-id',
  },
};
function fixture() {
  const initial = createWorldProjection({
    agents: [
      {
        agentId: asAgentId('a'),
        balance: 100,
        inventory: { Wood: 2 },
        job: null,
        educationScore: 0,
        residentialTier: 2,
        upkeepArrears: 17,
        physiology: { energy: 80, satiety: 70, health: 90 },
        locationId: asLocationId('home'),
      },
    ],
    locations: [
      {
        locationId: asLocationId('home'),
        name: 'Home',
        kind: 'residence',
        capacity: 1,
        activityAffinities: [],
      },
    ],
    moneySupply: 100,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = () => ({
    projection: w,
    simulationId: 'test',
    requestId: `o-${++n}`,
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    w = es.reduce(applyWorldEvent, w);
    events.push(...es);
  };
  const leave = (expectedRevision = 1) =>
    leaveResidentHousing({ ...ctx(), actorId: 'a', expectedResidenceId: 'home', expectedRevision });
  return {
    initial,
    events,
    ctx,
    commit,
    leave,
    get w() {
      return w;
    },
  };
}
test('personal departure normalizes legacy implicit residence to explicit null without moving a body or erasing responsibility', () => {
  const t = fixture();
  expect(t.leave()).toMatchObject({ accepted: false });
  const before = t.w;
  t.commit([enableHousingOccupancyEvent(t.ctx())]);
  expect(t.w.agents).toEqual(before.agents);
  expect(resolveAgentResidenceLocationId(t.w, t.w.agents.a!)).toBe('home');
  const d = t.leave();
  if (!d.accepted) throw Error(d.reason);
  t.commit(d.events);
  expect(t.w.agents.a).toEqual({ ...before.agents.a, residenceLocationId: null });
  expect(t.w.moneySupply).toBe(100);
  expect(t.w.locations).toEqual(before.locations);
  expect(resolveAgentResidenceLocationId(t.w, t.w.agents.a!)).toBeNull();
  expect(resolveResidentialOccupancy(t.w, asLocationId('home'))).toBe(0);
  expect(residentHousingOccupancyFacts(t.w, 'a')).toMatchObject({
    residenceId: null,
    locationId: 'home',
    currentPermission: false,
    registeredOccupants: 0,
  });
  expect(() => applyWorldEvent(t.w, d.events[0]!)).toThrow('housing-departure-source-mismatch');
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});
test('actual reentry advances personal residence version, denies stale departure, and only the named actor changes', () => {
  const t = fixture();
  t.commit([enableHousingOccupancyEvent(t.ctx())]);
  const d = t.leave();
  if (!d.accepted) throw Error(d.reason);
  t.commit(d.events);
  t.commit(
    dispatchWorldCommand({
      projection: t.w,
      policies,
      nextSequence: t.events.length + 1,
      command: createCommandEnvelope({
        id: 'return',
        simulationId: 'test',
        actorId: 'a',
        type: 'AgentChooseResidence',
        issuedAt: 0,
        payload: { locationId: asLocationId('home') },
      }),
    }),
  );
  expect(t.w.agents.a!.residenceLocationId).toBe('home');
  expect(t.w.housingOccupancy!.revisions.a).toBe(3);
  expect(t.leave(1)).toMatchObject({
    accepted: false,
    reason: 'housing-occupancy-revision-conflict',
  });
  expect(t.leave(3).accepted).toBe(true);
  expect(
    leaveResidentHousing({
      ...t.ctx(),
      actorId: 'intruder',
      expectedResidenceId: 'home',
      expectedRevision: 3,
    }),
  ).toMatchObject({ accepted: false });
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});
