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
      candidateActions: ['craft Transistor 1', 'buy Fish 1'],
      simulatorResult: { status: 'repaired', reason: 'missing Iron Ingot, buy first' },
      emittedCommandIds: ['cmd-1', 'cmd-2'],
      memoryContextIds: ['stm-context-1'],
      memoryWriteIds: ['stm-1'],
    });

    expect(trace.selectedBranch).toBe('production-resource-management');
    expect(trace.simulatorResult.status).toBe('repaired');
    expect(trace.emittedCommandIds).toEqual(['cmd-1', 'cmd-2']);
    expect(trace.memoryContextIds).toEqual(['stm-context-1']);
  });
});
