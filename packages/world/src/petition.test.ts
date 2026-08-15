import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import type { CollectiveActionPolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const policy: CollectiveActionPolicy = {
  policyVersion: 'collective-action-v1',
  petitionSignatureThreshold: 3,
  petitionExpiryMs: 86_400_000,
};

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  collectiveAction: policy,
};

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

function createProjection(): WorldProjection {
  const agent = (agentId: string) => ({
    agentId: asAgentId(agentId),
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 0,
    balance: 0,
    residentialTier: 1,
    job: null,
    inventory: {},
  });
  return createWorldProjection({
    agents: [agent('agent-1'), agent('agent-2'), agent('agent-3')],
    clock: { now: 0, tickDurationMs: 1000 },
  });
}

function run(
  projection: WorldProjection,
  input: {
    readonly id: string;
    readonly agentId: string;
    readonly type: string;
    readonly payload: unknown;
  },
  activePolicies: WorldCommandPolicies = policies,
): WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: input.id,
      simulationId: 'sim-1',
      actorId: input.agentId,
      source: 'agent-runtime',
      type: input.type as 'AgentRaisePetition',
      payload: input.payload,
      issuedAt: 100,
    }),
    projection,
    policies: activePolicies,
    nextSequence: 1,
  });
}

function rejection(events: readonly WorldEvent[]): string | undefined {
  const first = events[0];
  return first?.type === 'ActionRejected' ? first.payload.reason : undefined;
}

describe('town petition collective action', () => {
  test('raise + signatures aggregate to the threshold exactly once, then replay holds', () => {
    const projection = createProjection();

    const raised = run(projection, {
      id: 'cmd-raise',
      agentId: 'agent-1',
      type: 'AgentRaisePetition',
      payload: { topic: 'street-lights', statement: 'The square is dark at night.' },
    });
    expect(raised.map((event) => event.type)).toEqual([
      'PetitionRaised',
      'ShortTermMemoryRecorded',
    ]);
    let settled = raised.reduce(applyWorldEvent, projection);
    expect(settled.petitions).toHaveLength(1);
    expect(settled.petitions?.[0]).toMatchObject({
      topic: 'street-lights',
      status: 'open',
      raisedByAgentId: 'agent-1',
      signatureAgentIds: ['agent-1'],
      expiresAt: 86_400_000,
    });

    const second = run(settled, {
      id: 'cmd-sign-2',
      agentId: 'agent-2',
      type: 'AgentSignPetition',
      payload: { petitionId: 'cmd-raise:petition' },
    });
    expect(second.map((event) => event.type)).toEqual([
      'PetitionSigned',
      'ShortTermMemoryRecorded',
    ]);
    settled = second.reduce(applyWorldEvent, settled);

    // Third signature crosses the threshold: the event fires exactly once,
    // immediately after the crossing signature.
    const third = run(settled, {
      id: 'cmd-sign-3',
      agentId: 'agent-3',
      type: 'AgentSignPetition',
      payload: { petitionId: 'cmd-raise:petition' },
    });
    expect(third.map((event) => event.type)).toEqual([
      'PetitionSigned',
      'ShortTermMemoryRecorded',
      'PetitionThresholdReached',
    ]);
    expect(third[2]).toMatchObject({
      type: 'PetitionThresholdReached',
      payload: {
        petitionId: 'cmd-raise:petition',
        topic: 'street-lights',
        signatureCount: 3,
        threshold: 3,
        policyVersion: 'collective-action-v1',
      },
    });
    settled = third.reduce(applyWorldEvent, settled);
    expect(settled.petitions?.[0]).toMatchObject({
      status: 'threshold-reached',
      signatureAgentIds: ['agent-1', 'agent-2', 'agent-3'],
    });

    // A threshold-reached petition accepts no further signatures.
    expect(
      rejection(
        run(settled, {
          id: 'cmd-sign-late',
          agentId: 'agent-3',
          type: 'AgentSignPetition',
          payload: { petitionId: 'cmd-raise:petition' },
        }),
      ),
    ).toContain('threshold-reached');

    // The full event stream replays from genesis onto the same state.
    const replayed = [...raised, ...second, ...third].reduce(applyWorldEvent, projection);
    expect(replayed.petitions).toEqual(settled.petitions);
  });

  test('rejections: flag off, duplicate raise, double signature, unknown petition', () => {
    const projection = createProjection();
    expect(
      rejection(
        run(
          projection,
          {
            id: 'cmd-off',
            agentId: 'agent-1',
            type: 'AgentRaisePetition',
            payload: { topic: 'x', statement: 'y' },
          },
          basePolicies,
        ),
      ),
    ).toBe('missing collective action policy');

    const raised = run(projection, {
      id: 'cmd-raise',
      agentId: 'agent-1',
      type: 'AgentRaisePetition',
      payload: { topic: 'x', statement: 'y' },
    });
    const settled = raised.reduce(applyWorldEvent, projection);
    expect(
      rejection(
        run(settled, {
          id: 'cmd-raise-dup',
          agentId: 'agent-1',
          type: 'AgentRaisePetition',
          payload: { topic: 'x', statement: 'y' },
        }),
      ),
    ).toContain('already exists');
    expect(
      rejection(
        run(settled, {
          id: 'cmd-sign-self',
          agentId: 'agent-1',
          type: 'AgentSignPetition',
          payload: { petitionId: 'cmd-raise:petition' },
        }),
      ),
    ).toContain('already signed');
    expect(
      rejection(
        run(settled, {
          id: 'cmd-sign-unknown',
          agentId: 'agent-2',
          type: 'AgentSignPetition',
          payload: { petitionId: 'missing' },
        }),
      ),
    ).toContain('does not exist');
  });

  test('open petitions expire on time advance and never reach threshold afterwards', () => {
    const projection = createProjection();
    const raised = run(projection, {
      id: 'cmd-raise',
      agentId: 'agent-1',
      type: 'AgentRaisePetition',
      payload: { topic: 'fountain', statement: 'We want a fountain.' },
    });
    const settled = raised.reduce(applyWorldEvent, projection);

    const advance = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'cmd-time-1',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 86_400_000 },
        issuedAt: 86_400_000,
      }),
      projection: settled,
      policies: basePolicies,
      nextSequence: 10,
    });
    const expired = advance.find((event) => event.type === 'PetitionExpired');
    expect(expired).toMatchObject({
      payload: { petitionId: 'cmd-raise:petition', expiredAt: 86_400_000 },
    });
    const after = advance.reduce(applyWorldEvent, settled);
    expect(after.petitions?.[0]).toMatchObject({ status: 'expired' });
    expect(
      rejection(
        run(after, {
          id: 'cmd-sign-expired',
          agentId: 'agent-2',
          type: 'AgentSignPetition',
          payload: { petitionId: 'cmd-raise:petition' },
        }),
      ),
    ).toContain('expired');
  });

  test('threshold 1 fires on the raise itself', () => {
    const instantPolicies: WorldCommandPolicies = {
      ...policies,
      collectiveAction: { ...policy, petitionSignatureThreshold: 1 },
    };
    const events = run(
      createProjection(),
      {
        id: 'cmd-instant',
        agentId: 'agent-1',
        type: 'AgentRaisePetition',
        payload: { topic: 't', statement: 's' },
      },
      instantPolicies,
    );
    expect(events.map((event) => event.type)).toEqual([
      'PetitionRaised',
      'ShortTermMemoryRecorded',
      'PetitionThresholdReached',
    ]);
  });
});
