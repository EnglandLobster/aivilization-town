/**
 * Unit tests for the client-side movement interpolation used by the
 * living-town canvas. The module under test is a plain browser ES module
 * (`public/ui/map/interpolation.js`) imported directly — it has no DOM
 * dependencies, which is what makes it testable from node.
 */
import { describe, expect, test } from 'vitest';
import {
  hashAgentId,
  residentOffset,
  resolveAgentPosition,
  transitPosition,
} from '../public/ui/map/interpolation.js';

const fromRect = { x: 0.2, y: 0.3, width: 0.2, height: 0.2 };
const toRect = { x: 0.8, y: 0.7, width: 0.2, height: 0.2 };

const world = {
  locations: {
    school: { locationId: 'school', mapPosition: fromRect },
    market: { locationId: 'market', mapPosition: toRect },
    'no-rect': { locationId: 'no-rect' },
  },
  transitByAgent: {},
};

describe('hashAgentId', () => {
  test('is deterministic and agent-specific', () => {
    expect(hashAgentId('agent-1')).toBe(hashAgentId('agent-1'));
    expect(hashAgentId('agent-1')).not.toBe(hashAgentId('agent-2'));
  });
});

describe('residentOffset', () => {
  test('keeps the agent inside the location rect at any time', () => {
    for (const timeMs of [0, 1234, 60_000, 3_600_000]) {
      const position = residentOffset('agent-1', fromRect, timeMs);
      expect(Math.abs(position.x - fromRect.x)).toBeLessThanOrEqual(fromRect.width / 2);
      expect(Math.abs(position.y - fromRect.y)).toBeLessThanOrEqual(fromRect.height / 2);
      expect(['left', 'right']).toContain(position.direction);
    }
  });

  test('is deterministic (no RNG) and differs between agents', () => {
    const first = residentOffset('agent-1', fromRect, 50_000);
    expect(residentOffset('agent-1', fromRect, 50_000)).toEqual(first);
    const other = residentOffset('agent-2', fromRect, 50_000);
    expect(first.x !== other.x || first.y !== other.y).toBe(true);
  });

  test('drifts over time instead of standing still', () => {
    const early = residentOffset('agent-1', fromRect, 10_000);
    const late = residentOffset('agent-1', fromRect, 12_500);
    expect(early.x !== late.x || early.y !== late.y).toBe(true);
  });
});

describe('transitPosition', () => {
  const transit = { departedAt: 1000, arrivesAt: 5000 };

  test('interpolates linearly between connection endpoints', () => {
    const midpoint = transitPosition(transit, fromRect, toRect, 3000);
    expect(midpoint.progress).toBeCloseTo(0.5);
    expect(midpoint.x).toBeCloseTo((fromRect.x + toRect.x) / 2);
    expect(midpoint.y).toBeCloseTo((fromRect.y + toRect.y) / 2);
    expect(midpoint.direction).toBe('right');
  });

  test('clamps at departure and arrival boundaries', () => {
    const before = transitPosition(transit, fromRect, toRect, 0);
    expect(before.progress).toBe(0);
    expect(before.x).toBeCloseTo(fromRect.x);
    const after = transitPosition(transit, fromRect, toRect, 99_000);
    expect(after.progress).toBe(1);
    expect(after.x).toBeCloseTo(toRect.x);
    expect(after.y).toBeCloseTo(toRect.y);
  });

  test('picks a vertical direction when the route is mostly vertical', () => {
    const north = { x: 0.5, y: 0.1, width: 0.1, height: 0.1 };
    const south = { x: 0.5, y: 0.9, width: 0.1, height: 0.1 };
    expect(transitPosition(transit, north, south, 3000).direction).toBe('down');
    expect(transitPosition(transit, south, north, 3000).direction).toBe('up');
  });
});

describe('resolveAgentPosition', () => {
  test('residents drift inside their location rect', () => {
    const position = resolveAgentPosition(
      { agentId: 'agent-1', locationId: 'school' },
      world,
      42_000,
    );
    expect(position.state).toBe('resident');
    expect(Math.abs(position.x - fromRect.x)).toBeLessThanOrEqual(fromRect.width / 2);
  });

  test('agents in transit interpolate along the route', () => {
    const transitWorld = {
      ...world,
      transitByAgent: {
        'agent-1': {
          agentId: 'agent-1',
          fromLocationId: 'school',
          toLocationId: 'market',
          departedAt: 1000,
          arrivesAt: 5000,
        },
      },
    };
    const position = resolveAgentPosition(
      { agentId: 'agent-1', locationId: 'school' },
      transitWorld,
      3000,
    );
    expect(position.state).toBe('transit');
    expect(position.x).toBeCloseTo(0.5);
  });

  test('arrival boundary: once arrivesAt passes the agent resides at the destination', () => {
    const transitWorld = {
      ...world,
      transitByAgent: {
        'agent-1': {
          agentId: 'agent-1',
          fromLocationId: 'school',
          toLocationId: 'market',
          departedAt: 1000,
          arrivesAt: 5000,
        },
      },
    };
    // Projection still lists the transit record but the clock has passed it.
    const position = resolveAgentPosition(
      { agentId: 'agent-1', locationId: 'school' },
      transitWorld,
      5000,
    );
    expect(position.state).toBe('resident');
    expect(Math.abs(position.x - toRect.x)).toBeLessThanOrEqual(toRect.width / 2);
    expect(Math.abs(position.y - toRect.y)).toBeLessThanOrEqual(toRect.height / 2);
  });

  test('returns null when there is no authoritative placement', () => {
    expect(
      resolveAgentPosition({ agentId: 'agent-1', locationId: 'no-rect' }, world, 1000),
    ).toBeNull();
    expect(resolveAgentPosition({ agentId: 'agent-1', locationId: null }, world, 1000)).toBeNull();
    expect(resolveAgentPosition(undefined, world, 1000)).toBeNull();
  });
});
