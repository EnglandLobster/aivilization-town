import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { runReactiveSteeringRoute } from './index';

describe('reactive steering route', () => {
  test('uses a localized planner and simulator without branch planning', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        tags: ['fish', 'trade'],
      },
      localizedPlanners: [
        {
          domain: 'trade',
          supports: ({ summary }) => summary.includes('fish'),
          propose: () => [
            {
              id: 'buy-fish',
              description: 'buy 10 fish',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedPlannerDomain).toBe('trade');
    expect(result.commandDrafts).toEqual([
      {
        simulationId: 'sim-1',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
        issuedAt: 100,
      },
    ]);
    expect(result.needsReplan).toBe(false);
    expect(result.shortTermMemoryRecords.map((record) => record.status)).toEqual([
      'observed',
      'succeeded',
    ]);
  });

  test('uses repair for minor reactive command failures', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-sleep',
        summary: 'sleep for 8 hours',
      },
      localizedPlanners: [
        {
          domain: 'recovery',
          supports: ({ summary }) => summary.includes('sleep'),
          propose: () => [
            {
              id: 'sleep-too-long',
              description: 'sleep for 8 hours',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 28800 },
            },
          ],
        },
      ],
      simulate: ({ action }) =>
        action.id === 'sleep-too-long'
          ? { status: 'rejected', action, reason: 'duration exceeds safe local route limit' }
          : { status: 'accepted', action },
      repair: ({ rejectedAction }) => ({
        ...rejectedAction,
        id: 'sleep-repaired',
        payload: { durationSeconds: 7200 },
      }),
    });

    expect(result.commandDrafts[0]).toMatchObject({
      type: 'AgentSleep',
      payload: { durationSeconds: 7200 },
    });
    expect(result.simulationResults[0]).toMatchObject({ status: 'repaired' });
    expect(result.shortTermMemoryRecords[1]).toMatchObject({
      kind: 'human-command',
      status: 'repaired',
    });
  });

  test('records failed STM outcome and emits no command drafts when repair cannot recover', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-work',
        summary: 'work immediately',
      },
      localizedPlanners: [
        {
          domain: 'work',
          supports: ({ summary }) => summary.includes('work'),
          propose: () => [
            {
              id: 'work-now',
              description: 'work now',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    });

    expect(result.commandDrafts).toEqual([]);
    expect(result.needsReplan).toBe(true);
    expect(result.shortTermMemoryRecords[1]).toMatchObject({
      kind: 'human-command',
      status: 'failed',
      summary: 'Reactive command "work immediately" failed: energy too low.',
    });
  });
});
