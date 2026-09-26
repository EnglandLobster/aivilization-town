/**
 * Unit tests for the ambient-life indicators (ambient.js) — pure module.
 */
import { describe, expect, test } from 'vitest';
import {
  computeActivityBubbles,
  computeConversationLinks,
  computePulseTicker,
  describePulseRecord,
} from '../client/map/logic/ambient.js';

describe('computeActivityBubbles', () => {
  const activities = {
    'agent-sleep': {
      agentId: 'agent-sleep',
      activity: 'sleep',
      startedAt: 0,
      durationSeconds: 28_800,
      availableAt: 400_000,
    },
    'agent-work': {
      agentId: 'agent-work',
      activity: 'labor',
      startedAt: 0,
      durationSeconds: 3600,
      availableAt: 500_000,
    },
    'agent-done': {
      agentId: 'agent-done',
      activity: 'education',
      startedAt: 0,
      durationSeconds: 60,
      availableAt: 100_000,
    },
    'agent-travel': {
      agentId: 'agent-travel',
      activity: 'travel',
      startedAt: 0,
      durationSeconds: 300,
      availableAt: 900_000,
    },
  };

  test('bubbles only for ongoing, visualizable activities', () => {
    const bubbles = computeActivityBubbles(activities, 200_000);
    expect(bubbles['agent-sleep']).toBe('zzz');
    expect(bubbles['agent-work']).toBe('hammer');
    expect(bubbles['agent-done']).toBeUndefined();
    // Travel already renders as movement — no bubble.
    expect(bubbles['agent-travel']).toBeUndefined();
  });

  test('flag-gated absence produces empty results', () => {
    expect(computeActivityBubbles(undefined, 1000)).toEqual({});
    expect(computeActivityBubbles({}, 1000)).toEqual({});
  });
});

describe('computeConversationLinks', () => {
  test('keeps only fresh records, newest per conversation', () => {
    const now = 1_000_000;
    const links = computeConversationLinks(
      [
        {
          conversationId: 'c1',
          participantAgentIds: ['agent-1', 'agent-2'],
          topic: 'weather',
          recordedAt: now - 60_000,
        },
        {
          conversationId: 'c1',
          participantAgentIds: ['agent-1', 'agent-2'],
          topic: 'weather',
          recordedAt: now - 20_000,
        },
        {
          conversationId: 'c2',
          participantAgentIds: ['agent-3', 'agent-4'],
          topic: 'work',
          recordedAt: now - 400_000,
        },
      ],
      now,
    );
    expect(links).toHaveLength(1);
    expect(links[0].conversationId).toBe('c1');
    expect(links[0].participantAgentIds).toEqual(['agent-1', 'agent-2']);
    expect(links[0].age01).toBeCloseTo(20_000 / 300_000, 5);
  });

  test('sorts newest first and tolerates missing slices', () => {
    const now = 1_000_000;
    const links = computeConversationLinks(
      [
        { conversationId: 'a', participantAgentIds: [], recordedAt: now - 90_000 },
        { conversationId: 'b', participantAgentIds: [], recordedAt: now - 10_000 },
      ],
      now,
    );
    expect(links.map((link) => link.conversationId)).toEqual(['b', 'a']);
    expect(computeConversationLinks(undefined, now)).toEqual([]);
  });
});

describe('computePulseTicker', () => {
  const now = 2_000_000;

  test('shows the newest records inside the recency window', () => {
    const ticker = computePulseTicker(
      [
        { sequence: 1, occurredAt: now - 700_000, kind: 'arrival' },
        { sequence: 2, occurredAt: now - 100_000, kind: 'weather-change', detail: 'sunny → rainy' },
        { sequence: 3, occurredAt: now - 50_000, kind: 'death', subjectDisplayName: 'Ada' },
        {
          sequence: 4,
          occurredAt: now - 10_000,
          kind: 'enterprise-founded',
          subjectEnterpriseName: 'Bakery',
        },
      ],
      now,
    );
    expect(ticker.map((entry) => entry.sequence)).toEqual([4, 3, 2]);
    expect(ticker[2].age01).toBeCloseTo(100_000 / 600_000, 5);
  });

  test('caps the stack and ignores future or stale records', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      sequence: index + 1,
      occurredAt: now - index * 1000,
      kind: 'arrival',
    }));
    expect(computePulseTicker(many, now)).toHaveLength(3);
    expect(
      computePulseTicker([{ sequence: 1, occurredAt: now + 5_000, kind: 'arrival' }], now),
    ).toEqual([]);
    expect(computePulseTicker(undefined, now)).toEqual([]);
  });
});

describe('describePulseRecord', () => {
  test('humanizes the known kinds', () => {
    expect(describePulseRecord({ kind: 'death', subjectDisplayName: 'Ada' }).text).toBe(
      'Ada passed away',
    );
    expect(describePulseRecord({ kind: 'weather-change', detail: 'sunny → rainy' }).text).toBe(
      'Weather: sunny → rainy',
    );
    expect(describePulseRecord({ kind: 'arrival', subjectDisplayName: 'Bo' }).text).toBe(
      'Bo arrived',
    );
    expect(
      describePulseRecord({ kind: 'enterprise-closed', subjectEnterpriseName: 'Mill' }).text,
    ).toBe('Mill closed');
  });

  test('falls back gracefully for unknown kinds', () => {
    const described = describePulseRecord({ kind: 'mystery', detail: 'something' });
    expect(described.text).toBe('something');
  });
});
