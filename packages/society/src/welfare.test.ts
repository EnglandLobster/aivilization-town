import { describe, expect, test } from 'vitest';
import { evaluatePhysiologicalSafetyNet, evaluateSafetyNetSubsidy } from './index';

describe('welfare safety net', () => {
  test('caps subsidy payments while moving agents toward the minimum balance', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'eligible',
      amount: 25,
      previousBalance: 10,
      nextBalance: 35,
    });

    expect(
      evaluateSafetyNetSubsidy({
        balance: 40,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'eligible',
      amount: 10,
      previousBalance: 40,
      nextBalance: 50,
    });
  });

  test('does not pay agents at or above the minimum balance', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 50,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'ineligible',
      reason: 'balance-at-or-above-minimum',
    });
  });

  test('rejects invalid subsidy policy values', () => {
    expect(() =>
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: -1,
        maxSubsidy: 25,
      }),
    ).toThrow(/minimumBalance must be non-negative/);

    expect(() =>
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: -1,
      }),
    ).toThrow(/maxSubsidy must be non-negative/);
  });

  test('caps treasury-funded subsidies at the remaining treasury balance', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: 25,
        treasuryBalance: 12,
      }),
    ).toEqual({
      status: 'eligible',
      amount: 12,
      previousBalance: 10,
      nextBalance: 22,
    });
  });

  test('makes agents ineligible when the treasury is depleted', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: 25,
        treasuryBalance: 0,
      }),
    ).toEqual({
      status: 'ineligible',
      reason: 'treasury-depleted',
    });
  });

  test('rejects invalid treasury balances', () => {
    expect(() =>
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: 25,
        treasuryBalance: -1,
      }),
    ).toThrow(/treasuryBalance must be non-negative/);
  });
});

describe('physiological welfare safety net', () => {
  const policy = {
    policyVersion: 'physiological-safety-net-test',
    criticalThresholds: { satiety: 20, energy: 20, health: 20 },
    persistenceDurationMs: 100,
    grantCooldownMs: 200,
    essentialInventoryTargets: { Apple: 2 },
  } as const;

  test('starts a replayable distress episode without granting before persistence elapses', () => {
    expect(
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 10, energy: 50, health: 50 },
        currentPhysiology: { satiety: 10, energy: 50, health: 50 },
        inventory: {},
        previousSimulationTime: 0,
        currentSimulationTime: 50,
        policy,
      }),
    ).toEqual({
      transition: 'started',
      distressState: {
        policyVersion: 'physiological-safety-net-test',
        distressStartedAt: 0,
        lowAxes: ['satiety'],
        lastGrantedAt: null,
      },
      grant: null,
    });
  });

  test('grants only the essential inventory deficit after persistent distress', () => {
    expect(
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 10, energy: 50, health: 50 },
        currentPhysiology: { satiety: 10, energy: 50, health: 50 },
        inventory: { Apple: 0.5 },
        previousDistressState: {
          policyVersion: 'physiological-safety-net-test',
          distressStartedAt: 0,
          lowAxes: ['satiety'],
          lastGrantedAt: null,
        },
        previousSimulationTime: 50,
        currentSimulationTime: 100,
        policy,
      }),
    ).toEqual({
      transition: 'unchanged',
      distressState: {
        policyVersion: 'physiological-safety-net-test',
        distressStartedAt: 0,
        lowAxes: ['satiety'],
        lastGrantedAt: null,
      },
      grant: {
        grantedAt: 100,
        distressDurationMs: 100,
        lowAxes: ['satiety'],
        inventory: { Apple: 1.5 },
      },
    });
  });

  test('does not duplicate stocked essentials and honors the grant cooldown', () => {
    const base = {
      previousPhysiology: { satiety: 10, energy: 50, health: 50 },
      currentPhysiology: { satiety: 10, energy: 50, health: 50 },
      previousDistressState: {
        policyVersion: 'physiological-safety-net-test',
        distressStartedAt: 0,
        lowAxes: ['satiety'] as const,
        lastGrantedAt: 100,
      },
      previousSimulationTime: 100,
      currentSimulationTime: 200,
      policy,
    };

    expect(evaluatePhysiologicalSafetyNet({ ...base, inventory: {} }).grant).toBeNull();
    expect(
      evaluatePhysiologicalSafetyNet({
        ...base,
        inventory: { Apple: 2 },
        currentSimulationTime: 300,
      }).grant,
    ).toBeNull();
  });

  test('clears distress after all physiological axes recover', () => {
    expect(
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 10, energy: 50, health: 50 },
        currentPhysiology: { satiety: 25, energy: 50, health: 50 },
        inventory: {},
        previousDistressState: {
          policyVersion: 'physiological-safety-net-test',
          distressStartedAt: 0,
          lowAxes: ['satiety'],
          lastGrantedAt: 100,
        },
        previousSimulationTime: 100,
        currentSimulationTime: 150,
        policy,
      }),
    ).toEqual({ transition: 'cleared', distressState: null, grant: null });
  });

  test('starts persistence at the end of an interval when distress begins during that interval', () => {
    expect(
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 25, energy: 50, health: 50 },
        currentPhysiology: { satiety: 10, energy: 50, health: 50 },
        inventory: {},
        previousSimulationTime: 0,
        currentSimulationTime: 100,
        policy,
      }).distressState,
    ).toMatchObject({ distressStartedAt: 100, lowAxes: ['satiety'] });
  });

  test('rejects invalid policy and temporal state', () => {
    expect(() =>
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 10, energy: 50, health: 50 },
        currentPhysiology: { satiety: 10, energy: 50, health: 50 },
        inventory: {},
        previousSimulationTime: 0,
        currentSimulationTime: 100,
        policy: { ...policy, essentialInventoryTargets: {} },
      }),
    ).toThrow(/essentialInventoryTargets/);
    expect(() =>
      evaluatePhysiologicalSafetyNet({
        previousPhysiology: { satiety: 10, energy: 50, health: 50 },
        currentPhysiology: { satiety: 10, energy: 50, health: 50 },
        inventory: {},
        previousDistressState: {
          policyVersion: 'physiological-safety-net-test',
          distressStartedAt: 101,
          lowAxes: ['satiety'],
          lastGrantedAt: null,
        },
        previousSimulationTime: 100,
        currentSimulationTime: 200,
        policy,
      }),
    ).toThrow(/distressStartedAt/);
  });
});
