import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { ESTATE_CASH_POLICY, applyEstateCashEvent } from '@aivilization/economy';
import { ESTATE_MATERIAL_CUSTODY_POLICY, applyEstateMaterialEvent } from '@aivilization/materials';
import { RESIDENT_SUCCESSION_POLICY, applySuccessionEvent } from '@aivilization/society';
import { createWorldProjection, type WorldProjection } from '../projection';
import { RESIDENT_EXIT_PRESERVATION_POLICY } from '../residentExitPreservation';
import {
  prepareResidentExitCapture,
  type ResidentPopulationDeparture,
} from '../residentExitCapture';
export function residentExitFixture() {
  const base = createWorldProjection({
    moneySupply: 25.12345678,
    agents: [
      {
        agentId: asAgentId('a'),
        balance: 25.12345678,
        inventory: { Bread: 2.5, Wood: 0 },
        locationId: null,
        job: null,
        residentialTier: 1,
        educationScore: 0,
        physiology: { energy: 90, satiety: 90, health: 90 },
      },
    ],
  });
  return {
    ...base,
    residentExits: {
      policy: RESIDENT_EXIT_PRESERVATION_POLICY,
      records: {},
      cash: applyEstateCashEvent(undefined, {
        type: 'EstateCashEnabled',
        policy: ESTATE_CASH_POLICY,
      }),
      materials: applyEstateMaterialEvent(undefined, {
        type: 'EstateMaterialCustodyEnabled',
        policy: ESTATE_MATERIAL_CUSTODY_POLICY,
      }),
      arrangements: applySuccessionEvent(undefined, {
        type: 'SuccessionArrangementsEnabled',
        policy: RESIDENT_SUCCESSION_POLICY,
      }),
    },
  };
}
export const residentDeathFixture = (): Extract<
  ResidentPopulationDeparture,
  { type: 'AgentDied' }
> =>
  createEventEnvelope({
    id: 'actual-death-a',
    simulationId: 'sim-1',
    sequence: 10,
    occurredAt: 0,
    type: 'AgentDied',
    payload: {
      agentId: asAgentId('a'),
      cause: 'starvation',
      diedAt: 0,
      ageDays: 0,
      retired: false,
      policyVersion: 'starvation-v1',
      estate: {
        burnedCurrency: 0,
        inventoryByCommodity: {},
        depositForfeited: 0,
        writtenOffLoanIds: [],
      },
    },
  });
export function capturedResidentDeparture(
  w: WorldProjection = residentExitFixture(),
  e: ResidentPopulationDeparture = residentDeathFixture(),
): ResidentPopulationDeparture {
  const d = prepareResidentExitCapture(w, e);
  if (!d.accepted) throw Error(d.reason);
  return e.type === 'AgentDied'
    ? { ...e, payload: { ...e.payload, exitPreservation: d.capture } }
    : { ...e, payload: { ...e.payload, exitPreservation: d.capture } };
}
