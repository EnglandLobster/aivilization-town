import { describe, expect, test } from 'vitest';
import { readTown, emptyTown } from '../client/model';
import { project, unproject, populationGroups } from '../client/map/geometry';

describe('city presentation boundary', () => {
  test('hydrates old partition snapshots without fabricating optional mechanisms', () => {
    const town = readTown(
      {
        projection: {
          agents: { a: { agentId: 'a', locationId: 'home', balance: 12 } },
          locations: {
            home: { locationId: 'home', mapPosition: { x: 0.3, y: 0.4, width: 0.1, height: 0.2 } },
          },
          clock: { now: 250 },
        },
        lastAppliedSequence: 7,
      },
      {},
      {},
      'p1',
    );
    expect(town.population).toBe(1);
    expect(town.agents.a?.detail.balance).toBe(12);
    expect(town.agents.a?.ownerPartitionKey).toBe('p1');
    expect(town.clock).toBe(250);
    expect(town.sequence).toBe(7);
    expect(town.calendar).toEqual({});
    expect(town.weather).toEqual({});
    expect(town.townPulse).toEqual([]);
  });
  test('city directory wins for position and does not leak another partition’s details', () => {
    const envelope = {
      projection: {
        agents: {
          a: { agentId: 'a', locationId: 'stale', balance: 99 },
          b: { agentId: 'b', balance: 999 },
        },
        transitByAgent: { a: { toLocationId: 'stale' } },
      },
    };
    const directory = {
      agents: [
        { agentId: 'a', ownerPartitionKey: 'p1', publicState: { locationId: 'fresh' } },
        { agentId: 'b', ownerPartitionKey: 'p2', publicState: { locationId: 'home' } },
      ],
    };
    const before = JSON.stringify({ envelope, directory });
    const town = readTown(envelope, {}, directory, 'p1');
    expect(town.agents.a?.locationId).toBe('fresh');
    expect(town.agents.a?.detail.balance).toBe(99);
    expect(town.agents.b?.detail.balance).toBeUndefined();
    expect(town.transitByAgent).toEqual({});
    expect(JSON.stringify({ envelope, directory })).toBe(before);
  });
  test('orthogonal picking inverts the presentation transform at map edges', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0.24, y: 0.83 },
    ]) {
      const result = unproject(project(point));
      expect(result.x).toBeCloseTo(point.x, 12);
      expect(result.y).toBeCloseTo(point.y, 12);
    }
  });
  test('large-city aggregation counts every citizen once, including travelers', () => {
    const directory = {
      agents: Array.from({ length: 30000 }, (_, index) => ({
        agentId: `agent-${index}`,
        ownerPartitionKey: 'p1',
        publicState: {
          locationId: `place-${index % 20}`,
          ...(index % 3 === 0 ? { transit: { toLocationId: 'place-1' } } : {}),
        },
      })),
    };
    const town = readTown({}, {}, directory, 'p1');
    const groups = populationGroups(town);
    expect(town.population).toBe(30000);
    expect(groups.get('@transit')).toHaveLength(10000);
    expect([...groups.values()].reduce((total, group) => total + group.length, 0)).toBe(30000);
    expect(populationGroups(emptyTown()).size).toBe(0);
  });
});
