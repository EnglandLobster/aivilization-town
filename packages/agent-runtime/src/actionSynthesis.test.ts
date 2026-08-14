import { describe, expect, test } from 'vitest';
import type { ActionResourceEstimate, AtomicActionProposal } from './actions';
import { synthesizeActionCandidates } from './index';

describe('action synthesis', () => {
  test('prioritizes proposals before applying max action budget', () => {
    const study = createAction('study', 1);
    const sleep = createAction('sleep', 3);
    const work = createAction('work', 2);

    const result = synthesizeActionCandidates({
      actions: [study, sleep, work],
      policy: { maxActions: 2 },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['sleep', 'work']);
    expect(result.rejectedActions).toEqual([
      { action: study, reason: 'maxActions exhausted' },
    ]);
  });

  test('rejects actions that would exceed shared resource budgets', () => {
    const bread = createAction('eat-bread', 1, {
      actionSeconds: 30,
      inventoryCosts: { Bread: 1 },
    });
    const work = createAction('work', 2, {
      actionSeconds: 3600,
      energyCost: 20,
    });
    const secondMeal = createAction('eat-second-bread', 1, {
      actionSeconds: 30,
      inventoryCosts: { Bread: 1 },
    });

    const result = synthesizeActionCandidates({
      actions: [bread, work, secondMeal],
      policy: {
        budget: {
          availableActionSeconds: 3630,
          energyBudget: 20,
          inventoryBudget: { Bread: 1 },
        },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['work', 'eat-bread']);
    expect(result.rejectedActions).toEqual([
      { action: secondMeal, reason: 'inventory budget exceeded for Bread' },
    ]);
  });

  test('enforces per-branch action caps before lower-priority branches are starved', () => {
    const produceFirst = createAction('produce-first', 5, undefined, {
      branchId: 'production',
      subtaskId: 'craft-circuit',
    });
    const produceSecond = createAction('produce-second', 4, undefined, {
      branchId: 'production',
      subtaskId: 'craft-transistor',
    });
    const recover = createAction('recover-energy', 3, undefined, {
      branchId: 'recovery',
      subtaskId: 'sleep',
    });

    const result = synthesizeActionCandidates({
      actions: [produceFirst, produceSecond, recover],
      policy: {
        maxActions: 2,
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual([
      'produce-first',
      'recover-energy',
    ]);
    expect(result.rejectedActions).toEqual([
      {
        action: produceSecond,
        reason: 'branch action budget exhausted for production',
      },
    ]);
  });

  test('scores strategic alignment and branch urgency alongside base priority', () => {
    const urgentRecovery = createAction('urgent-recovery', 1, undefined, {
      branchId: 'recovery',
      strategicAlignment: 2,
      branchUrgency: 4,
    });
    const highBasePriorityWork = createAction('high-base-priority-work', 5, undefined, {
      branchId: 'income',
      strategicAlignment: 0,
      branchUrgency: 0,
    });

    const result = synthesizeActionCandidates({
      actions: [highBasePriorityWork, urgentRecovery],
      policy: {
        maxActions: 1,
        scoring: {
          priorityWeight: 1,
          strategicAlignmentWeight: 2,
          branchUrgencyWeight: 1,
        },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['urgent-recovery']);
    expect(result.rejectedActions).toEqual([
      {
        action: highBasePriorityWork,
        reason: 'maxActions exhausted',
      },
    ]);
  });

  test('rejects non-positive candidate subtask limits', () => {
    expect(() =>
      synthesizeActionCandidates({
        actions: [createAction('study', 1)],
        policy: { candidateSubtasks: { maxSubtasks: 0 } },
      }),
    ).toThrow('action synthesis candidateSubtasks.maxSubtasks must be a positive integer');
  });

  test('caps struggling-tier non-survival spending at a share of the currency budget', () => {
    const buyFood = createTradeAction('buy-food', 3, 'Apple', 40);
    const buyTransistor = createTradeAction('buy-transistor', 2, 'Transistor', 40);

    const struggling = synthesizeActionCandidates({
      actions: [buyFood, buyTransistor],
      policy: {
        budget: { currencyBudget: 100 },
        lifestyle: {
          tier: 'struggling',
          nonSurvivalSpendCapRatio: 0.3,
          survivalCommodities: ['Apple'],
        },
      },
    });

    // Food purchases are survival spending and stay exempt; the non-food buy
    // exceeds the 100 * 0.3 = 30 non-survival cap.
    expect(struggling.acceptedActions.map((action) => action.id)).toEqual(['buy-food']);
    expect(struggling.rejectedActions).toEqual([
      { action: buyTransistor, reason: 'struggling lifestyle non-survival currency budget exceeded' },
    ]);

    const stable = synthesizeActionCandidates({
      actions: [buyFood, buyTransistor],
      policy: {
        budget: { currencyBudget: 100 },
        lifestyle: {
          tier: 'stable',
          nonSurvivalSpendCapRatio: 0.3,
          survivalCommodities: ['Apple'],
        },
      },
    });
    expect(stable.acceptedActions.map((action) => action.id)).toEqual([
      'buy-food',
      'buy-transistor',
    ]);
  });

  test('treats upgrades, study, and unknown commands as non-survival spending and accumulates the cap', () => {
    const seeDoctor: AtomicActionProposal = {
      ...createAction('see-doctor', 5, { currencyCost: 50 }),
      commandType: 'AgentSeeDoctor',
      payload: {},
    };
    const upgrade: AtomicActionProposal = {
      ...createAction('upgrade-home', 4, { currencyCost: 20 }),
      commandType: 'AgentUpgradeResidentialTier',
      payload: { targetResidentialTier: 2 },
    };
    const study: AtomicActionProposal = {
      ...createAction('study', 3, { currencyCost: 20 }),
      commandType: 'AgentStudy',
      payload: {},
    };

    const result = synthesizeActionCandidates({
      actions: [seeDoctor, upgrade, study],
      policy: {
        budget: { currencyBudget: 200 },
        lifestyle: { tier: 'struggling', nonSurvivalSpendCapRatio: 0.3 },
      },
    });

    // Non-survival cap is 200 * 0.3 = 60; medical treatment is exempt, the
    // upgrade (20) fits, and study (20 + 20 = 40 <= 60) also fits.
    expect(result.acceptedActions.map((action) => action.id)).toEqual([
      'see-doctor',
      'upgrade-home',
      'study',
    ]);

    const tighter = synthesizeActionCandidates({
      actions: [seeDoctor, upgrade, study],
      policy: {
        budget: { currencyBudget: 100 },
        lifestyle: { tier: 'struggling', nonSurvivalSpendCapRatio: 0.3 },
      },
    });
    // Cap is now 30: the upgrade fits but study (20 + 20 = 40 > 30) does not.
    expect(tighter.acceptedActions.map((action) => action.id)).toEqual([
      'see-doctor',
      'upgrade-home',
    ]);
    expect(tighter.rejectedActions).toEqual([
      { action: study, reason: 'struggling lifestyle non-survival currency budget exceeded' },
    ]);
  });

  test('imposes no lifestyle cap without a currency budget and validates the ratio', () => {
    const buyTransistor = createTradeAction('buy-transistor', 1, 'Transistor', 40);

    const uncapped = synthesizeActionCandidates({
      actions: [buyTransistor],
      policy: {
        lifestyle: { tier: 'struggling', nonSurvivalSpendCapRatio: 0.3 },
      },
    });
    expect(uncapped.acceptedActions.map((action) => action.id)).toEqual(['buy-transistor']);

    expect(() =>
      synthesizeActionCandidates({
        actions: [buyTransistor],
        policy: {
          budget: { currencyBudget: 100 },
          lifestyle: { tier: 'struggling', nonSurvivalSpendCapRatio: 1.5 },
        },
      }),
    ).toThrow('action synthesis lifestyle nonSurvivalSpendCapRatio must be between 0 and 1');
  });
});

function createTradeAction(
  id: string,
  priority: number,
  commodityName: string,
  currencyCost: number,
): AtomicActionProposal {
  return {
    ...createAction(id, priority, { currencyCost }),
    commandType: 'AgentTrade',
    payload: { side: 'buy', commodityName, quantity: 1 },
  };
}

function createAction(
  id: string,
  priority: number,
  resourceEstimate?: ActionResourceEstimate,
  synthesisContext?: AtomicActionProposal['synthesisContext'],
): AtomicActionProposal {
  return {
    id,
    description: id,
    commandType: 'AgentWork',
    payload: { occupationName: 'Cleaner', laborSeconds: 60 },
    priority,
    ...(resourceEstimate === undefined ? {} : { resourceEstimate }),
    ...(synthesisContext === undefined ? {} : { synthesisContext }),
  };
}
