import { describe, expect, test } from 'vitest';
import { createAgentCycleTrace } from './index';

describe('createAgentCycleTrace', () => {
  test('captures planner, simulator, command, and memory evidence in one record', () => {
    const trace = createAgentCycleTrace({
      traceId: 'trace-1',
      simulationId: 'sim-1',
      agentId: 'agent-1',
      cycleStartedAt: 100,
      observedStateSummary: 'energy=450 satiety=290 health=500 balance=191696904',
      selectedBranch: 'production-resource-management',
      contextualPrioritization: {
        status: 'accepted',
        source: 'llm',
        requestId: 'trace-1:prioritize',
        providerId: 'scripted-prioritizer',
        model: 'prioritizer-model',
        choices: [
          {
            branchId: 'production-resource-management',
            subtaskId: 'craft-transistor',
            priorityScore: 7.25,
            rationale: 'Crafting aligns with production goals after checking inventory.',
          },
        ],
      },
      subtaskCandidates: [
        {
          branchId: 'production-resource-management',
          subtaskId: 'craft-transistor',
          description: 'craft Transistor',
          score: 7.25,
          scoreBreakdown: {
            basePriorityScore: 3,
            signalInfluenceScore: 2,
            intentionInfluenceScore: 0,
            memoryInfluenceScore: 1.25,
            profileInfluenceScore: 1,
            contextualReasoningScore: 0,
          },
        },
      ],
      actionSynthesis: {
        acceptedActions: [
          {
            id: 'craft-1',
            description: 'craft Transistor 1',
            commandType: 'AgentProduce',
            priority: 3,
            synthesisContext: {
              branchId: 'production-resource-management',
              subtaskId: 'craft-transistor',
              subtaskScore: 7.25,
              strategicAlignment: 2,
            },
            resourceEstimate: {
              actionSeconds: 60,
              energyCost: 4,
              inventoryCosts: { 'Iron Ingot': 1 },
            },
          },
        ],
        rejectedActions: [
          {
            action: {
              id: 'buy-fish-1',
              description: 'buy Fish 1',
              commandType: 'AgentTrade',
              priority: 1,
              synthesisContext: {
                branchId: 'recovery',
                subtaskId: 'restore-satiety',
                branchUrgency: 3,
              },
              resourceEstimate: { currencyCost: 10 },
            },
            reason: 'maxActions exhausted',
          },
        ],
      },
      candidateActions: ['craft Transistor 1', 'buy Fish 1'],
      simulatorResult: { status: 'repaired', reason: 'missing Iron Ingot, buy first' },
      simulatorEvents: [
        {
          actionId: 'craft-1',
          attempt: 'original',
          status: 'rejected',
          reason: 'missing Iron Ingot',
          events: [{ type: 'ActionRejected', sequence: 10, summary: 'missing Iron Ingot' }],
        },
        {
          actionId: 'buy-fish-1',
          attempt: 'repair',
          status: 'accepted',
          events: [{ type: 'TradeExecuted', sequence: 11, summary: 'bought Fish' }],
        },
      ],
      selectionEvidence: {
        selectedSubtaskId: 'craft-transistor',
        intentionInfluenceScore: 0,
        memoryInfluenceScore: 1.2,
        profileInfluenceScore: 1.4,
        memoryEvidenceRecordIds: ['stm-context-1'],
        profileEntryKeys: ['rest-recovery'],
        profileEvidenceRecordIds: ['reflection-rest-1'],
      },
      replanningDecision: {
        kind: 'memory-guided-correction',
        trigger: 'simulator-rejection',
        reason: 'missing Iron Ingot',
        failedActionIds: ['craft-1'],
        evidenceRecordIds: ['stm-context-1'],
      },
      replanMaterialization: {
        status: 'replanned',
        objectiveId: 'objective-production',
        planId: 'objective-production',
        progressReset: true,
        trigger: 'repeated-failure',
        failedActionIds: ['craft-1'],
        evidenceRecordIds: ['stm-context-1'],
        matchingFailureCount: 2,
      },
      subtaskReplanningDecisions: [
        {
          branchId: 'production-resource-management',
          subtaskId: 'craft-transistor',
          decision: {
            kind: 'memory-guided-correction',
            trigger: 'simulator-rejection',
            reason: 'missing Iron Ingot',
            failedActionIds: ['craft-1'],
            evidenceRecordIds: ['stm-context-1'],
          },
        },
        {
          branchId: 'recovery',
          subtaskId: 'restore-satiety',
          decision: { kind: 'none' },
        },
      ],
      emittedCommandIds: ['cmd-1', 'cmd-2'],
      memoryContextIds: ['stm-context-1'],
      memoryWriteIds: ['stm-1'],
    });

    expect(trace.selectedBranch).toBe('production-resource-management');
    expect(trace.contextualPrioritization).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'trace-1:prioritize',
      choices: [{ subtaskId: 'craft-transistor' }],
    });
    expect(trace.replanMaterialization).toEqual({
      status: 'replanned',
      objectiveId: 'objective-production',
      planId: 'objective-production',
      progressReset: true,
      trigger: 'repeated-failure',
      failedActionIds: ['craft-1'],
      evidenceRecordIds: ['stm-context-1'],
      matchingFailureCount: 2,
    });
    expect(trace.simulatorResult.status).toBe('repaired');
    expect(trace.simulatorEvents).toEqual([
      {
        actionId: 'craft-1',
        attempt: 'original',
        status: 'rejected',
        reason: 'missing Iron Ingot',
        events: [{ type: 'ActionRejected', sequence: 10, summary: 'missing Iron Ingot' }],
      },
      {
        actionId: 'buy-fish-1',
        attempt: 'repair',
        status: 'accepted',
        events: [{ type: 'TradeExecuted', sequence: 11, summary: 'bought Fish' }],
      },
    ]);
    expect(trace.replanningDecision.kind).toBe('memory-guided-correction');
    expect(trace.subtaskReplanningDecisions).toEqual([
      {
        branchId: 'production-resource-management',
        subtaskId: 'craft-transistor',
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'missing Iron Ingot',
          failedActionIds: ['craft-1'],
          evidenceRecordIds: ['stm-context-1'],
        },
      },
      {
        branchId: 'recovery',
        subtaskId: 'restore-satiety',
        decision: { kind: 'none' },
      },
    ]);
    expect(trace.selectionEvidence.profileEvidenceRecordIds).toEqual(['reflection-rest-1']);
    expect(trace.subtaskCandidates[0]?.scoreBreakdown.memoryInfluenceScore).toBe(1.25);
    expect(trace.actionSynthesis.rejectedActions[0]?.reason).toBe('maxActions exhausted');
    expect(trace.actionSynthesis.acceptedActions[0]?.synthesisContext).toEqual({
      branchId: 'production-resource-management',
      subtaskId: 'craft-transistor',
      subtaskScore: 7.25,
      strategicAlignment: 2,
    });
    expect(trace.actionSynthesis.rejectedActions[0]?.action.synthesisContext).toEqual({
      branchId: 'recovery',
      subtaskId: 'restore-satiety',
      branchUrgency: 3,
    });
    expect(trace.actionSynthesis.acceptedActions[0]?.resourceEstimate?.inventoryCosts).toEqual({
      'Iron Ingot': 1,
    });
    expect(trace.emittedCommandIds).toEqual(['cmd-1', 'cmd-2']);
    expect(trace.memoryContextIds).toEqual(['stm-context-1']);
  });

  test('captures blocked cycles when action synthesis rejects every proposal', () => {
    const trace = createAgentCycleTrace({
      traceId: 'trace-action-synthesis-blocked',
      simulationId: 'sim-1',
      agentId: 'agent-1',
      cycleStartedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 balance=100',
      selectedBranch: 'development',
      subtaskCandidates: [
        {
          branchId: 'development',
          subtaskId: 'study',
          description: 'study carefully',
          score: 5,
          scoreBreakdown: {
            basePriorityScore: 5,
            signalInfluenceScore: 0,
            intentionInfluenceScore: 0,
            memoryInfluenceScore: 0,
            profileInfluenceScore: 0,
          },
        },
      ],
      actionSynthesis: {
        acceptedActions: [],
        rejectedActions: [
          {
            action: {
              id: 'study-expensive',
              description: 'study with high energy cost',
              commandType: 'AgentStudy',
              priority: 3,
              resourceEstimate: { actionSeconds: 60, energyCost: 1 },
            },
            reason: 'energy budget exceeded',
          },
        ],
      },
      candidateActions: [],
      simulatorResult: {
        status: 'rejected',
        reason: 'action synthesis rejected action: energy budget exceeded',
      },
      simulatorEvents: [
        {
          actionId: 'study-expensive',
          attempt: 'original',
          status: 'rejected',
          reason: 'action synthesis rejected action: energy budget exceeded',
          events: [],
        },
      ],
      selectionEvidence: {
        selectedSubtaskId: 'study',
        intentionInfluenceScore: 0,
        memoryInfluenceScore: 0,
        profileInfluenceScore: 0,
        memoryEvidenceRecordIds: [],
        profileEntryKeys: [],
        profileEvidenceRecordIds: [],
      },
      replanningDecision: {
        kind: 'memory-guided-correction',
        trigger: 'simulator-rejection',
        reason: 'action synthesis rejected action: energy budget exceeded',
        failedActionIds: ['study-expensive'],
        evidenceRecordIds: [],
      },
      subtaskReplanningDecisions: [
        {
          branchId: 'development',
          subtaskId: 'study',
          decision: {
            kind: 'memory-guided-correction',
            trigger: 'simulator-rejection',
            reason: 'action synthesis rejected action: energy budget exceeded',
            failedActionIds: ['study-expensive'],
            evidenceRecordIds: [],
          },
        },
      ],
      emittedCommandIds: [],
      memoryContextIds: [],
      memoryWriteIds: [],
    });

    expect(trace.actionSynthesis.acceptedActions).toEqual([]);
    expect(trace.actionSynthesis.rejectedActions[0]?.reason).toBe('energy budget exceeded');
    expect(trace.candidateActions).toEqual([]);
    expect(trace.simulatorResult.status).toBe('rejected');
  });
});
