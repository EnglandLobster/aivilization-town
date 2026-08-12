import { asAgentId, createCommandEnvelope, type HumanCommandAttribution } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createTownBulletin,
  createWorldProjection,
  dispatchWorldCommand,
  TOWN_BULLETIN_POLICY_VERSION,
  type TownBulletinPolicy,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const bulletinPolicy: TownBulletinPolicy = {
  policyVersion: TOWN_BULLETIN_POLICY_VERSION,
  highPriorityIntentionPriority: 90,
  highPriorityReactionWindowMs: 3_600_000,
};

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  bulletin: bulletinPolicy,
};

const operatorAttribution: HumanCommandAttribution = {
  principalSubjectId: 'operator-1',
  principalRoles: ['operator'],
  accessPolicyVersion: 'town-access-v1',
  consentPolicyVersion: 'town-consent-v1',
};

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-1'),
        locationId: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    clock: { now: 1_000, tickDurationMs: 1_000 },
  });
}

function postBulletin(
  projection: WorldProjection,
  payload: unknown,
  policies: WorldCommandPolicies = basePolicies,
): WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: 'command-post-1',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      type: 'AgentPostBulletin',
      payload,
      issuedAt: 500,
    }),
    projection,
    policies,
    nextSequence: 1,
  });
}

function issueBulletin(
  projection: WorldProjection,
  input: {
    readonly payload: unknown;
    readonly source?: 'human' | 'system';
    readonly attribution?: HumanCommandAttribution;
  },
): WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: 'command-issue-1',
      simulationId: 'sim-1',
      source: input.source ?? 'human',
      ...(input.attribution === undefined ? {} : { humanAttribution: input.attribution }),
      type: 'IssueTownBulletin',
      payload: input.payload,
      issuedAt: 500,
    }),
    projection,
    policies: basePolicies,
    nextSequence: 1,
  });
}

describe('town bulletin commands', () => {
  test('agent post settles an immediate bulletin as BulletinPosted', () => {
    const events = postBulletin(createProjection(), {
      title: ' Market  closed ',
      body: 'The market closes early today.',
      priority: 'high',
    });
    expect(events.map((event) => event.type)).toEqual(['BulletinPosted']);
    expect(events[0]?.payload).toMatchObject({
      bulletin: {
        bulletinId: 'bulletin-command-post-1',
        title: 'Market  closed',
        body: 'The market closes early today.',
        priority: 'high',
        authorAgentId: 'agent-1',
        postedAt: 500,
        effectiveAt: 1_000,
      },
    });
    const updated = events.reduce(applyWorldEvent, createProjection());
    expect(updated.bulletins).toHaveLength(1);
    expect(updated.bulletins?.[0]?.status).toBe('effective');
  });

  test('agent post with a future effectiveAt schedules instead of posting', () => {
    const events = postBulletin(createProjection(), {
      title: 'Festival',
      body: 'The harvest festival starts soon.',
      effectiveAt: 5_000,
    });
    expect(events.map((event) => event.type)).toEqual(['BulletinScheduled']);
    const updated = events.reduce(applyWorldEvent, createProjection());
    expect(updated.bulletins?.[0]).toMatchObject({ status: 'scheduled', effectiveAt: 5_000 });
  });

  test('rejects posts without the bulletin policy and invalid payloads', () => {
    const legacyPolicies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
      criticalThresholds: { energy: 0, health: 0 },
    };
    const rejected = postBulletin(
      createProjection(),
      { title: 'Hi', body: 'There' },
      legacyPolicies,
    );
    expect(rejected[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { commandType: 'AgentPostBulletin', reason: 'missing bulletin policy' },
    });
    expect(
      postBulletin(createProjection(), { title: ' ', body: 'There' })[0],
    ).toMatchObject({ type: 'ActionRejected' });
    expect(
      postBulletin(createProjection(), { title: 'T', body: 'B', priority: 'urgent' })[0],
    ).toMatchObject({ type: 'ActionRejected' });
    expect(
      postBulletin(createProjection(), { title: 'T', body: 'B', effectiveAt: 500 })[0],
    ).toMatchObject({ type: 'ActionRejected' });
  });

  test('operator issues a town bulletin with attribution; participants and agent sources cannot', () => {
    const issued = issueBulletin(createProjection(), {
      payload: { title: 'Curfew', body: 'Night curfew tonight.' },
      attribution: operatorAttribution,
    });
    expect(issued.map((event) => event.type)).toEqual(['BulletinPosted']);
    expect(issued[0]?.payload).toMatchObject({
      bulletin: { authorSubjectId: 'operator-1', priority: 'normal' },
      humanAttribution: { principalSubjectId: 'operator-1' },
    });

    expect(() =>
      issueBulletin(createProjection(), {
        payload: { title: 'T', body: 'B' },
        attribution: { ...operatorAttribution, principalRoles: ['participant'] },
      }),
    ).toThrow(/operator role/);
    expect(() =>
      issueBulletin(createProjection(), { payload: { title: 'T', body: 'B' } }),
    ).toThrow(/attribution/);
    expect(() =>
      issueBulletin(createProjection(), {
        payload: { title: 'T', body: 'B' },
        source: 'system',
      }),
    ).toThrow(/attribution/);
  });

  test('scheduled bulletins activate exactly when advancing past effectiveAt', () => {
    let projection = createProjection();
    projection = postBulletin(projection, {
      title: 'Festival',
      body: 'The harvest festival starts soon.',
      effectiveAt: 5_000,
    }).reduce(applyWorldEvent, projection);

    const advance = (deltaMs: number, id: string, sequence: number) =>
      dispatchWorldCommand({
        command: createCommandEnvelope({
          id,
          simulationId: 'sim-1',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs },
          issuedAt: 600,
        }),
        projection,
        policies: basePolicies,
        nextSequence: sequence,
      });

    const early = advance(3_000, 'advance-early', 2);
    expect(early.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    projection = early.reduce(applyWorldEvent, projection);
    expect(projection.bulletins?.[0]?.status).toBe('scheduled');

    const crossing = advance(1_500, 'advance-crossing', 3);
    expect(crossing.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'BulletinPosted',
    ]);
    const activated = crossing.reduce(applyWorldEvent, projection);
    expect(activated.bulletins?.[0]?.status).toBe('effective');

    // Snapshot round-trip + replay from scratch reproduce the state exactly.
    const hydrated = JSON.parse(JSON.stringify(activated)) as WorldProjection;
    expect(hydrated).toEqual(activated);
  });

  test('rejects duplicate scheduled bulletin ids on replay', () => {
    const events = postBulletin(createProjection(), {
      title: 'T',
      body: 'B',
      effectiveAt: 5_000,
    });
    const projection = events.reduce(applyWorldEvent, createProjection());
    expect(() => events.reduce(applyWorldEvent, projection)).toThrow(/duplicate bulletin/);
    // Re-applying an activation of an already-effective bulletin is a
    // no-op state transition (idempotent replay), not an error.
    const immediate = postBulletin(createProjection(), { title: 'T', body: 'B' });
    const posted = immediate.reduce(applyWorldEvent, createProjection());
    expect(immediate.reduce(applyWorldEvent, posted).bulletins).toEqual(posted.bulletins);
  });
});

describe('town bulletin validation', () => {
  test('requires exactly one author and non-empty content', () => {
    expect(() =>
      createTownBulletin({
        bulletinId: 'b-1',
        title: 'T',
        body: 'B',
        postedAt: 1,
        currentSimulationTime: 1,
      }),
    ).toThrow(/exactly one author/);
    expect(() =>
      createTownBulletin({
        bulletinId: 'b-1',
        title: ' ',
        body: 'B',
        authorSubjectId: 'operator-1',
        postedAt: 1,
        currentSimulationTime: 1,
      }),
    ).toThrow(/title/);
    expect(() =>
      createTownBulletin({
        bulletinId: 'b-1',
        title: 'T',
        body: 'B',
        authorSubjectId: 'operator-1',
        postedAt: 1,
        effectiveAt: Number.NaN,
        currentSimulationTime: 1,
      }),
    ).toThrow(/effectiveAt/);
  });
});
