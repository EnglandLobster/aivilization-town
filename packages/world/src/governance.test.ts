import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { TOWN_GOVERNANCE_POLICY_VERSION, type TownGovernancePolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const governance: TownGovernancePolicy = {
  policyVersion: TOWN_GOVERNANCE_POLICY_VERSION,
  allowedBudgetServices: ['education', 'healthcare'],
  maximumAllocationPerCadence: 1_000,
  maximumTreasuryReserve: 10_000,
  maximumSubsidyBalanceFloor: 1_000,
  maximumSubsidyPerCadence: 500,
};

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  governance,
};

function projectionWithAgent(input: { readonly petitionTopic?: string } = {}): WorldProjection {
  const agentId = asAgentId('agent-1');
  return createWorldProjection({
    agents: [
      {
        agentId,
        locationId: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    clock: { now: 5_000, tickDurationMs: 1_000 },
    ...(input.petitionTopic === undefined
      ? {}
      : {
          petitions: [
            {
              petitionId: 'petition-1',
              topic: input.petitionTopic,
              statement: 'Change town policy.',
              raisedByAgentId: agentId,
              raisedAt: 1_000,
              expiresAt: 100_000,
              signatureAgentIds: [agentId],
              status: 'threshold-reached' as const,
              thresholdReachedAt: 2_000,
            },
          ],
        }),
  });
}

function operatorCommand(type: 'SetTaxPolicy' | 'SetPublicBudget' | 'SetSubsidyPolicy', payload: unknown) {
  return createCommandEnvelope({
    id: `operator-${type}`,
    simulationId: 'sim-governance',
    source: 'human',
    humanAttribution: {
      principalSubjectId: 'operator-1',
      principalRoles: ['operator'],
      accessPolicyVersion: 'access-v1',
      consentPolicyVersion: 'consent-v1',
    },
    type,
    payload,
    issuedAt: 5_000,
  });
}

function rejection(events: readonly WorldEvent[]) {
  const event = events[0];
  return event?.type === 'GovernanceChangeRejected' ? event.payload : undefined;
}

describe('town governance world integration', () => {
  test('an operator enacts a tax policy and replay restores the complete final fact', () => {
    const projection = projectionWithAgent();
    const events = dispatchWorldCommand({
      command: operatorCommand('SetTaxPolicy', {
        neutralRate: 0.15,
        incomeTaxBrackets: [
          { upToAmount: 300, rate: 0 },
          { upToAmount: null, rate: 0.15 },
        ],
        tradeTaxRate: 0.08,
        dividendTaxRate: 0.12,
        reason: 'Fund education and healthcare',
        expectedGovernanceRevision: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'GovernancePolicyChanged',
      payload: {
        policyKind: 'tax',
        governancePolicyVersion: 'town-governance-v1',
        governanceRevision: 1,
        changedAt: 5_000,
        authority: { kind: 'operator', subjectId: 'operator-1' },
        taxPolicy: { neutralRate: 0.15, tradeTaxRate: 0.08, dividendTaxRate: 0.12 },
      },
    });
    const replayed = events.reduce(applyWorldEvent, projection);
    expect(replayed.governance).toMatchObject({
      revision: 1,
      tax: {
        policyVersion: 'town-governance-tax-v1',
        incomeTaxBrackets: [
          { upToAmount: 300, rate: 0 },
          { upToAmount: null, rate: 0.15 },
        ],
      },
      consumedPetitionIds: [],
      lastChangeReason: 'Fund education and healthcare',
    });
  });

  test('a threshold-reaching matching petition authorizes one resident budget change', () => {
    const projection = projectionWithAgent({ petitionTopic: 'public-budget' });
    const command = createCommandEnvelope({
      id: 'agent-budget',
      simulationId: 'sim-governance',
      actorId: 'agent-1',
      source: 'agent-runtime',
      type: 'SetPublicBudget',
      payload: {
        cadenceMs: 3_600_000,
        minimumTreasuryReserve: 100,
        allocations: [
          { service: 'education', amountPerCadence: 20 },
          { service: 'healthcare', amountPerCadence: 30 },
        ],
        reason: 'Honor the public service petition',
        petitionId: 'petition-1',
      },
      issuedAt: 5_000,
    });
    const accepted = dispatchWorldCommand({
      command,
      projection,
      policies,
      nextSequence: 1,
    });
    const replayed = accepted.reduce(applyWorldEvent, projection);
    expect(replayed.governance).toMatchObject({
      revision: 1,
      publicBudget: { minimumTreasuryReserve: 100 },
      consumedPetitionIds: ['petition-1'],
      lastChangedBy: {
        kind: 'threshold-petition',
        agentId: 'agent-1',
        petitionId: 'petition-1',
      },
    });

    const reused = dispatchWorldCommand({
      command: createCommandEnvelope({
        ...command,
        id: 'agent-budget-reuse',
        payload: { ...command.payload, minimumTreasuryReserve: 200 },
      }),
      projection: replayed,
      policies,
      nextSequence: 2,
    });
    expect(rejection(reused)).toMatchObject({ reason: 'petition-already-consumed' });
  });

  test('rejects wrong-topic petitions, participant bypass, and invalid policy values durably', () => {
    const projection = projectionWithAgent({ petitionTopic: 'tax-policy' });
    const wrongTopic = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'wrong-topic',
        simulationId: 'sim-governance',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'SetSubsidyPolicy',
        payload: {
          minimumBalance: 50,
          maxSubsidy: 20,
          reason: 'Wrong petition',
          petitionId: 'petition-1',
        },
        issuedAt: 5_000,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejection(wrongTopic)).toMatchObject({
      reason: 'governance-authorization-rejected',
      actorAgentId: 'agent-1',
    });

    const participantBypass = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'participant-bypass',
        simulationId: 'sim-governance',
        actorId: 'agent-1',
        source: 'human',
        humanAttribution: {
          principalSubjectId: 'participant-1',
          principalRoles: ['participant'],
          accessPolicyVersion: 'access-v1',
          consentPolicyVersion: 'consent-v1',
        },
        type: 'SetSubsidyPolicy',
        payload: { minimumBalance: 50, maxSubsidy: 20, reason: 'No petition' },
        issuedAt: 5_000,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejection(participantBypass)?.detail).toContain('requires petitionId');

    const invalid = dispatchWorldCommand({
      command: operatorCommand('SetTaxPolicy', {
        neutralRate: 2,
        incomeTaxBrackets: [{ upToAmount: null, rate: 2 }],
        tradeTaxRate: 0,
        reason: 'Invalid confiscatory rate',
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejection(invalid)).toMatchObject({
      reason: 'invalid-policy',
      humanAttribution: { principalSubjectId: 'operator-1' },
    });
  });

  test('changing budget or subsidy policy does not itself move treasury or money supply', () => {
    const projection = createWorldProjection({ agents: [], treasury: 500, moneySupply: 500 });
    const commands = [
      operatorCommand('SetPublicBudget', {
        cadenceMs: 3_600_000,
        minimumTreasuryReserve: 100,
        allocations: [{ service: 'education', amountPerCadence: 40 }],
        reason: 'Allocate education funds',
      }),
      operatorCommand('SetSubsidyPolicy', {
        minimumBalance: 50,
        maxSubsidy: 25,
        reason: 'Provide a cash floor',
        expectedGovernanceRevision: 1,
      }),
    ];
    const settled = commands.reduce((current, command, index) => {
      const events = dispatchWorldCommand({
        command,
        projection: current,
        policies,
        nextSequence: index + 1,
      });
      return events.reduce(applyWorldEvent, current);
    }, projection);
    expect(settled.treasury).toBe(500);
    expect(settled.moneySupply).toBe(500);
    expect(settled.governance?.revision).toBe(2);
  });
});
