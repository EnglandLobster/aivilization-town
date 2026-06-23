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
          },
        },
      ],
      candidateActions: ['craft Transistor 1', 'buy Fish 1'],
      simulatorResult: { status: 'repaired', reason: 'missing Iron Ingot, buy first' },
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
      emittedCommandIds: ['cmd-1', 'cmd-2'],
      memoryContextIds: ['stm-context-1'],
      memoryWriteIds: ['stm-1'],
    });

    expect(trace.selectedBranch).toBe('production-resource-management');
    expect(trace.simulatorResult.status).toBe('repaired');
    expect(trace.replanningDecision.kind).toBe('memory-guided-correction');
    expect(trace.selectionEvidence.profileEvidenceRecordIds).toEqual(['reflection-rest-1']);
    expect(trace.subtaskCandidates[0]?.scoreBreakdown.memoryInfluenceScore).toBe(1.25);
    expect(trace.emittedCommandIds).toEqual(['cmd-1', 'cmd-2']);
    expect(trace.memoryContextIds).toEqual(['stm-context-1']);
  });
});
