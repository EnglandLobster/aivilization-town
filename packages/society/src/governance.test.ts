import { describe, expect, test } from 'vitest';
import {
  applyGovernanceDomainEvent,
  createInitialTownGovernanceState,
  decideGovernanceChange,
  type TownGovernancePolicy,
} from './governance';

const governancePolicy: TownGovernancePolicy = {
  policyVersion: 'town-governance-v1',
  allowedBudgetServices: ['education', 'healthcare'],
  maximumAllocationPerCadence: 1_000,
  maximumTreasuryReserve: 10_000,
  maximumSubsidyBalanceFloor: 1_000,
  maximumSubsidyPerCadence: 500,
  source: 'test',
};

describe('town governance aggregate', () => {
  test('accepts a versioned tax change and replays the final policy', () => {
    const state = createInitialTownGovernanceState();
    const decision = decideGovernanceChange({
      state,
      policy: governancePolicy,
      command: {
        type: 'SetTaxPolicy',
        reason: 'Fund public services',
        authority: { kind: 'operator', subjectId: 'operator-1' },
        expectedRevision: 0,
        policy: {
          policyVersion: 'town-governance-tax-v1',
          neutralRate: 0.12,
          incomeTaxBrackets: [{ upToAmount: null, rate: 0.12 }],
          tradeTaxRate: 0.06,
          dividendTaxRate: 0.1,
          source: 'governance-command',
        },
      },
    });

    expect(decision.status).toBe('accepted');
    if (decision.status !== 'accepted') throw new Error('expected accepted decision');
    const replayed = applyGovernanceDomainEvent(state, decision.event);
    expect(replayed).toMatchObject({
      revision: 1,
      tax: { neutralRate: 0.12, tradeTaxRate: 0.06 },
      consumedPetitionIds: [],
    });
  });

  test('consumes one threshold petition exactly once', () => {
    const authority = {
      kind: 'threshold-petition' as const,
      agentId: 'agent-1',
      petitionId: 'petition-1',
    };
    const first = decideGovernanceChange({
      state: createInitialTownGovernanceState(),
      policy: governancePolicy,
      command: {
        type: 'SetSubsidyPolicy',
        reason: 'Increase the safety net',
        authority,
        policy: {
          policyVersion: 'town-governance-subsidy-v1',
          minimumBalance: 50,
          maxSubsidy: 20,
          source: 'governance-command',
        },
      },
    });
    if (first.status !== 'accepted') throw new Error('expected accepted decision');
    const replayed = applyGovernanceDomainEvent(createInitialTownGovernanceState(), first.event);
    const second = decideGovernanceChange({
      state: replayed,
      policy: governancePolicy,
      command: {
        type: 'SetSubsidyPolicy',
        reason: 'Reuse petition',
        authority,
        policy: {
          policyVersion: 'town-governance-subsidy-v1',
          minimumBalance: 60,
          maxSubsidy: 20,
          source: 'governance-command',
        },
      },
    });
    expect(second).toMatchObject({ status: 'rejected', reason: 'petition-already-consumed' });
  });

  test('rejects revision conflicts, unchanged policies, and invalid budget boundaries', () => {
    const state = {
      ...createInitialTownGovernanceState(),
      revision: 2,
      publicBudget: {
        policyVersion: 'town-governance-public-budget-v1',
        cadenceMs: 3_600_000,
        minimumTreasuryReserve: 100,
        allocations: [{ service: 'education', amountPerCadence: 10 }],
      },
    };
    const command = {
      type: 'SetPublicBudget' as const,
      reason: 'Budget update',
      authority: { kind: 'operator' as const, subjectId: 'operator-1' },
      policy: state.publicBudget,
    };
    expect(
      decideGovernanceChange({
        state,
        policy: governancePolicy,
        command: { ...command, expectedRevision: 1 },
      }),
    ).toMatchObject({ status: 'rejected', reason: 'governance-revision-conflict' });
    expect(decideGovernanceChange({ state, policy: governancePolicy, command })).toMatchObject({
      status: 'rejected',
      reason: 'policy-unchanged',
    });
    expect(
      decideGovernanceChange({
        state,
        policy: governancePolicy,
        command: {
          ...command,
          policy: {
            ...state.publicBudget,
            allocations: [{ service: 'police', amountPerCadence: 10 }],
          },
        },
      }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid-policy' });
  });

  test('accepts configured upper budget and subsidy boundaries', () => {
    const budget = decideGovernanceChange({
      state: createInitialTownGovernanceState(),
      policy: governancePolicy,
      command: {
        type: 'SetPublicBudget',
        reason: 'Boundary budget',
        authority: { kind: 'operator', subjectId: 'operator-1' },
        policy: {
          policyVersion: 'town-governance-public-budget-v1',
          cadenceMs: 1,
          minimumTreasuryReserve: 10_000,
          allocations: [{ service: 'healthcare', amountPerCadence: 1_000 }],
        },
      },
    });
    const subsidy = decideGovernanceChange({
      state: createInitialTownGovernanceState(),
      policy: governancePolicy,
      command: {
        type: 'SetSubsidyPolicy',
        reason: 'Boundary subsidy',
        authority: { kind: 'operator', subjectId: 'operator-1' },
        policy: {
          policyVersion: 'town-governance-subsidy-v1',
          minimumBalance: 1_000,
          maxSubsidy: 500,
          source: 'governance-command',
        },
      },
    });
    expect(budget.status).toBe('accepted');
    expect(subsidy.status).toBe('accepted');
  });
});
