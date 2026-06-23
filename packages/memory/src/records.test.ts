import { asAgentId, asCommandId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord } from './index';

describe('short-term memory records', () => {
  test('keeps command and event provenance with a validated importance score', () => {
    const record = createShortTermMemoryRecord({
      id: 'memory-1',
      agentId: asAgentId('agent-1'),
      kind: 'action',
      status: 'succeeded',
      summary: 'Produced one unit of grain.',
      occurredAt: 1000,
      importanceScore: 0.8,
      source: {
        commandId: asCommandId('command-1'),
        eventIds: [asEventId('event-1')],
      },
      tags: ['production', 'grain'],
    });

    expect(record.id).toBe('memory-1');
    expect(record.source.commandId).toBe('command-1');
    expect(record.source.eventIds).toEqual(['event-1']);
    expect(record.tags).toEqual(['production', 'grain']);
  });

  test('rejects empty summaries and out-of-range importance scores', () => {
    expect(() =>
      createShortTermMemoryRecord({
        id: 'memory-2',
        agentId: asAgentId('agent-1'),
        kind: 'observation',
        status: 'observed',
        summary: '',
        occurredAt: 1000,
        importanceScore: 0.5,
        source: { eventIds: [] },
      }),
    ).toThrow(/summary/);

    expect(() =>
      createShortTermMemoryRecord({
        id: 'memory-3',
        agentId: asAgentId('agent-1'),
        kind: 'action',
        status: 'failed',
        summary: 'Failed to work due to low energy.',
        occurredAt: 1000,
        importanceScore: 1.2,
        source: { eventIds: [] },
      }),
    ).toThrow(/importanceScore/);
  });
});
