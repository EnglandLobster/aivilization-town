import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  estateCashBalance,
  ESTATE_CASH_BANK_POLICY,
  applyEstateCashEvent,
} from '@aivilization/economy';
import { createWorldProjection, applyWorldEvent } from './projection';
import {
  assertResidentExitSnapshot,
  RESIDENT_EXIT_BANK_PRESERVATION_POLICY,
} from './residentExitPreservation';
import {
  prepareResidentExitCapture,
  type ResidentPopulationDeparture,
} from './residentExitCapture';
import {
  residentExitFixture,
  residentDeathFixture,
  capturedResidentDeparture,
} from './testFixtures/residentExit';
test('actual body removal and exact cash/backpack capture form one replayed event without money burn, default heir or fake resident', () => {
  const w = residentExitFixture(),
    e = capturedResidentDeparture(w),
    after = applyWorldEvent(w, e);
  expect(after.agents.a).toBeUndefined();
  expect(after.moneySupply).toBe(w.moneySupply);
  expect(estateCashBalance(after.residentExits?.cash)).toBe(25.12345678);
  expect(after.residentExits?.materials.records['estate-backpack-10']).toMatchObject({
    held: { Bread: 2.5 },
    locationId: null,
  });
  expect(after.residentExits?.records.a).toMatchObject({ populationEventId: e.id, cause: 'death' });
  expect(after.survivalOutcomes?.deathsByCause.starvation).toBe(1);
  assertResidentExitSnapshot(after);
  expect(applyWorldEvent(w, JSON.parse(JSON.stringify(e)) as typeof e)).toEqual(after);
  expect(() => applyWorldEvent(after, e)).toThrow('actual-body-unavailable');
  expect(w.agents.a?.balance).toBe(25.12345678);
  expect(Object.keys(w.residentExits.cash.accounts)).toHaveLength(0);
});
test('permanent emigration retains domestic custody and original responsibilities instead of inventing external transport or forfeiture', () => {
  const w = residentExitFixture(),
    death = residentDeathFixture(),
    e: ResidentPopulationDeparture = {
      ...death,
      type: 'AgentEmigrated',
      payload: {
        agentId: asAgentId('a'),
        cause: 'dissatisfaction',
        emigratedAt: 0,
        wellbeing: 0,
        policyVersion: 'town-migration-v2',
        estate: death.payload.estate,
      },
    };
  const after = applyWorldEvent(w, capturedResidentDeparture(w, e));
  expect(after.moneySupply).toBe(w.moneySupply);
  expect(after.residentExits?.records.a?.cause).toBe('emigration');
  expect(after.survivalOutcomes?.emigrated).toBe(1);
});
test('captured event claims cannot invent money/items, body location, actual population references or a balancing entry', () => {
  const w = residentExitFixture(),
    e = capturedResidentDeparture(w);
  if (!e.payload.exitPreservation) throw Error('missing');
  for (const modify of [
    (x: typeof e) => {
      Object.assign(x.payload.exitPreservation!.record, { populationEventId: 'fake' });
    },
    (x: typeof e) => {
      const c = x.payload.exitPreservation!.cashEvents[0]!;
      if (c.type === 'EstateCashCaptured') Object.assign(c.source, { personalBalance: 999 });
    },
    (x: typeof e) => {
      const m = x.payload.exitPreservation!.materialEvents[0]!;
      if (m.type === 'EstateBackpackCaptured')
        Object.assign(m.custody.source, { locationId: 'invented-home' });
    },
    (x: typeof e) => {
      if (!x.payload.exitPreservation) throw Error('missing capture');
      Object.assign(x.payload.exitPreservation, { transactions: [] });
    },
  ]) {
    const forged = structuredClone(e);
    modify(forged);
    expect(() => applyWorldEvent(w, forged)).toThrow();
  }
  expect(w.agents.a?.inventory).toEqual({ Bread: 2.5, Wood: 0 });
  expect(Object.keys(w.residentExits.records)).toHaveLength(0);
});
test('new protocol cannot run without explicit state, omit capture or follow an old liquidation; legacy events keep their burn semantics', () => {
  const w = residentExitFixture(),
    e = residentDeathFixture();
  expect(() => applyWorldEvent(w, e)).toThrow('population-protocol-mismatch');
  const old = createWorldProjection({
    agents: Object.values(w.agents),
    moneySupply: w.moneySupply,
  });
  expect(prepareResidentExitCapture(old, e)).toMatchObject({
    accepted: false,
    reason: 'resident-exit-preservation-not-enabled',
  });
  expect(() => applyWorldEvent(old, capturedResidentDeparture(w))).toThrow(
    'population-protocol-mismatch',
  );
  const burned = {
    ...e,
    payload: {
      ...e.payload,
      estate: {
        ...e.payload.estate,
        burnedCurrency: w.moneySupply,
        inventoryByCommodity: { Bread: 2.5 },
      },
    },
  };
  expect(prepareResidentExitCapture(w, burned)).toMatchObject({
    accepted: false,
    reason: 'resident-exit-cannot-follow-legacy-liquidation',
  });
  const after = applyWorldEvent(old, burned);
  expect(after.moneySupply).toBe(0);
  expect(after.residentExits).toBeUndefined();
});

test('world preservation pins the actual owning cash policy: v1 cannot silently acquire bank scope and a new v2 scenario records its own capture protocol', () => {
  const w = residentExitFixture();
  const cash = applyEstateCashEvent(undefined, {
    type: 'EstateCashEnabled',
    policy: ESTATE_CASH_BANK_POLICY,
  });
  expect(() =>
    assertResidentExitSnapshot({ ...w, residentExits: { ...w.residentExits, cash } }),
  ).toThrow('owning-policy-version-mismatch');
  const nextScenario = {
    ...w,
    residentExits: { ...w.residentExits, policy: RESIDENT_EXIT_BANK_PRESERVATION_POLICY, cash },
  };
  const event = capturedResidentDeparture(nextScenario);
  expect(event.payload.exitPreservation?.policyVersion).toBe('resident-exit-preservation-v2');
  const departed = applyWorldEvent(nextScenario, event);
  expect(departed.residentExits?.cash.policy.version).toBe('resident-estate-cash-v2');
  expect(departed.moneySupply).toBe(w.moneySupply);
  assertResidentExitSnapshot(departed);
  expect(() => applyWorldEvent(w, event)).toThrow('record-source-mismatch');
});
