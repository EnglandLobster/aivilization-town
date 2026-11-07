import { expect, test } from 'vitest';
import { createWorldProjection } from './projection';
import {
  RESIDENT_EXIT_PRESERVATION_POLICY as POLICY,
  assertResidentExitSnapshot,
  residentPhysicalFinancialAccount,
  type ResidentExitState,
} from './residentExitPreservation';
import { ESTATE_CASH_POLICY, applyEstateCashEvent, captureEstateCash } from '@aivilization/economy';
import {
  ESTATE_MATERIAL_CUSTODY_POLICY,
  applyEstateMaterialEvent,
  captureEstateBackpack,
} from '@aivilization/materials';
import { RESIDENT_SUCCESSION_POLICY, applySuccessionEvent } from '@aivilization/society';
import { asAgentId } from '@aivilization/sim-core';
function fixture() {
  const base = createWorldProjection({ agents: [], moneySupply: 25 });
  const cashSource = {
    populationEventId: 'actual-death',
    ownerId: 'a',
    populationPolicyVersion: 'explicit-population-v2',
    cause: 'death' as const,
    at: 0,
    personalBalance: 25,
  };
  const initialCash = applyEstateCashEvent(undefined, {
      type: 'EstateCashEnabled',
      policy: ESTATE_CASH_POLICY,
    }),
    capture = captureEstateCash(initialCash, 'estate-a', cashSource);
  if (!capture.accepted) throw Error(capture.reason);
  const cash = capture.events.reduce(applyEstateCashEvent, initialCash);
  const initialMaterials = applyEstateMaterialEvent(undefined, {
    type: 'EstateMaterialCustodyEnabled',
    policy: ESTATE_MATERIAL_CUSTODY_POLICY,
  });
  const c = captureEstateBackpack(initialMaterials, 'bag-a', {
    ownerId: 'a',
    populationEventId: 'actual-death',
    populationPolicyVersion: 'explicit-population-v2',
    cause: 'death',
    at: 0,
    locationId: null,
    sourceRevision: 10,
    items: { Bread: 2 },
  });
  if (!c.accepted) throw Error(c.reason);
  const materials = c.events.reduce(applyEstateMaterialEvent, initialMaterials);
  const state: ResidentExitState = {
    policy: POLICY,
    cash,
    materials,
    arrangements: applySuccessionEvent(undefined, {
      type: 'SuccessionArrangementsEnabled',
      policy: RESIDENT_SUCCESSION_POLICY,
    }),
    records: {
      a: {
        residentId: 'a',
        populationEventId: 'actual-death',
        populationPolicyVersion: 'explicit-population-v2',
        cause: 'death',
        at: 0,
        cashAccountId: 'estate-a',
        backpackCustodyId: 'bag-a',
      },
    },
  };
  return { ...base, residentExits: state };
}
test('an economic rights subject can hold preserved cash without creating a living agent, accepting new obligations or having an invented body location', () => {
  const w = fixture();
  assertResidentExitSnapshot(w);
  expect(residentPhysicalFinancialAccount(w, 'a')).toEqual({
    account: { sector: 'estate', accountId: 'estate:estate-a' },
    ownerId: 'a',
    balance: 25,
    kind: 'estate-custody',
    acceptsNewObligations: false,
    sourceRevision: 1,
    populationEventId: 'actual-death',
  });
  expect(w.agents.a).toBeUndefined();
  expect(w.residentExits.materials.records['bag-a']!.locationId).toBeNull();
  expect(residentPhysicalFinancialAccount(w, 'unknown')).toBeUndefined();
});
test('legacy living resident accounts stay ordinary accounts with no guessed financial revision or silent estate creation', () => {
  const w = createWorldProjection({
    agents: [
      {
        agentId: asAgentId('living'),
        balance: 30,
        inventory: {},
        locationId: null,
        job: null,
        residentialTier: 1,
        educationScore: 0,
        physiology: { energy: 90, satiety: 90, health: 90 },
      },
    ],
  });
  expect(residentPhysicalFinancialAccount(w, 'living')).toMatchObject({
    account: { sector: 'agent', accountId: 'agent:living' },
    balance: 30,
    kind: 'living-resident',
    acceptsNewObligations: true,
    sourceRevision: null,
  });
  expect(Object.hasOwn(w, 'residentExits')).toBe(false);
  assertResidentExitSnapshot(w);
});
test('completed snapshots reject disappeared or orphaned custody, a mismatched actual population reference, future death time and a fake living estate owner', () => {
  const w = fixture(),
    s = w.residentExits;
  expect(() => assertResidentExitSnapshot({ ...w, residentExits: { ...s, records: {} } })).toThrow(
    'resident-exit-orphan-custody',
  );
  expect(() =>
    assertResidentExitSnapshot({
      ...w,
      residentExits: { ...s, materials: { ...s.materials, records: {} } },
    }),
  ).toThrow('resident-exit-owning-custody-source-mismatch');
  expect(() =>
    assertResidentExitSnapshot({
      ...w,
      residentExits: { ...s, records: { a: { ...s.records.a!, populationEventId: 'fake' } } },
    }),
  ).toThrow('resident-exit-owning-custody-source-mismatch');
  expect(() =>
    assertResidentExitSnapshot({
      ...w,
      residentExits: { ...s, records: { a: { ...s.records.a!, at: 1 } } },
    }),
  ).toThrow('resident-exit-body-or-reference-mismatch');
  const alive = createWorldProjection({
    agents: [
      {
        agentId: asAgentId('a'),
        balance: 25,
        inventory: {},
        locationId: null,
        job: null,
        residentialTier: 1,
        educationScore: 0,
        physiology: { energy: 90, satiety: 90, health: 90 },
      },
    ],
  });
  expect(() => residentPhysicalFinancialAccount({ ...alive, residentExits: s }, 'a')).toThrow(
    'resident-financial-body-and-estate-conflict',
  );
});
