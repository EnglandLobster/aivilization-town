import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type SocialMattersPolicy,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const mattersPolicy: SocialMattersPolicy = {
  policyVersion: 'social-matters-v1',
  defaultExpiryMs: 10_000,
};

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  socialMatters: mattersPolicy,
};

const legacyPolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-1'),
        locationId: asLocationId('square'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: asAgentId('agent-2'),
        locationId: asLocationId('square'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: { Apple: 5 },
      },
    ],
    locations: [
      {
        locationId: asLocationId('square'),
        name: 'Square',
        kind: 'social',
        activityAffinities: ['socialize'],
        capacity: null,
      },
    ],
    clock: { now: 0, tickDurationMs: 1_000 },
  });
}

function dispatch(
  projection: WorldProjection,
  input: {
    readonly id: string;
    readonly agentId?: string;
    readonly type: string;
    readonly payload: unknown;
    readonly issuedAt?: number;
  },
  activePolicies: WorldCommandPolicies = policies,
): WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: input.id,
      simulationId: 'sim-1',
      ...(input.agentId === undefined ? {} : { actorId: input.agentId }),
      source: input.agentId === undefined ? 'system' : 'agent-runtime',
      type: input.type as 'AgentRaiseMatter',
      payload: input.payload,
      issuedAt: input.issuedAt ?? 100,
    }),
    projection,
    policies: activePolicies,
    nextSequence: 1,
  });
}

function apply(projection: WorldProjection, events: readonly WorldEvent[]): WorldProjection {
  return events.reduce(applyWorldEvent, projection);
}

function raiseMatter(projection: WorldProjection): WorldProjection {
  return apply(
    projection,
    dispatch(projection, {
      id: 'cmd-raise',
      agentId: 'agent-1',
      type: 'AgentRaiseMatter',
      payload: {
        topic: 'apples',
        statement: 'I need 2 apples for the festival.',
        requiredCommodity: { commodityName: 'Apple', quantity: 2 },
      },
    }),
  );
}

describe('social matters lifecycle', () => {
  test('walks open → collecting → assigned → executing → closed(fulfilled) with world-verified delivery', () => {
    let projection = raiseMatter(createProjection());
    expect(projection.socialMatters?.['matter-cmd-raise']).toMatchObject({
      kind: 'help-request',
      status: 'open',
      initiatorAgentId: 'agent-1',
      expiresAt: 10_000,
    });

    // Unknown/non-candidate/capability rejections.
    const earlyAssign = dispatch(projection, {
      id: 'cmd-assign-early',
      agentId: 'agent-1',
      type: 'AgentAssignMatter',
      payload: { matterId: 'matter-cmd-raise', assigneeAgentId: 'agent-2' },
    })[0];
    expect(earlyAssign?.type).toBe('ActionRejected');
    expect(
      earlyAssign?.type === 'ActionRejected' ? earlyAssign.payload.reason : '',
    ).toContain('accepted');

    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-respond',
        agentId: 'agent-2',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise', decision: 'accept' },
      }),
    );
    expect(projection.socialMatters?.['matter-cmd-raise']?.status).toBe('collecting');

    // Initiator cannot respond to their own matter.
    expect(
      dispatch(projection, {
        id: 'cmd-self-respond',
        agentId: 'agent-1',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise', decision: 'accept' },
      })[0],
    ).toMatchObject({ type: 'ActionRejected' });

    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-assign',
        agentId: 'agent-1',
        type: 'AgentAssignMatter',
        payload: { matterId: 'matter-cmd-raise', assigneeAgentId: 'agent-2' },
      }),
    );
    expect(projection.socialMatters?.['matter-cmd-raise']).toMatchObject({
      status: 'assigned',
      assigneeAgentId: 'agent-2',
    });

    // Self-reported fulfillment is not accepted for commodity-backed matters.
    const selfReport = dispatch(projection, {
      id: 'cmd-self-report',
      agentId: 'agent-1',
      type: 'AgentCloseMatter',
      payload: { matterId: 'matter-cmd-raise', outcome: 'fulfilled' },
    })[0];
    expect(selfReport?.type).toBe('ActionRejected');
    expect(
      selfReport?.type === 'ActionRejected' ? selfReport.payload.reason : '',
    ).toContain('world-verified delivery');

    // Partial delivery: executing. Full delivery: closed fulfilled with the
    // canonical fulfilled-commitment social outcome.
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-deliver-1',
        agentId: 'agent-2',
        type: 'AgentGiveResource',
        payload: { targetAgentId: 'agent-1', commodityName: 'Apple', quantity: 1 },
      }),
    );
    expect(projection.socialMatters?.['matter-cmd-raise']).toMatchObject({
      status: 'executing',
      deliveredQuantity: 1,
    });

    const finalEvents = dispatch(projection, {
      id: 'cmd-deliver-2',
      agentId: 'agent-2',
      type: 'AgentGiveResource',
      payload: { targetAgentId: 'agent-1', commodityName: 'Apple', quantity: 1 },
    });
    const finalTypes = finalEvents.map((event) => event.type);
    expect(finalTypes).toContain('MatterProgressed');
    expect(finalTypes).toContain('SocialInteractionCompleted');
    expect(finalTypes).toContain('MatterClosed');
    const closure = finalEvents.find((event) => event.type === 'MatterClosed');
    expect(closure?.payload).toMatchObject({
      matterId: 'matter-cmd-raise',
      closure: 'fulfilled',
      fulfillmentEventId: 'cmd-deliver-2:event:0',
    });
    const social = finalEvents.filter((event) => event.type === 'SocialInteractionCompleted').at(-1);
    expect(social?.payload).toMatchObject({
      sourceAgentId: 'agent-2',
      targetAgentId: 'agent-1',
      outcomeSignals: ['fulfilled-commitment'],
      relationDelta: 0.12,
    });

    projection = apply(projection, finalEvents);
    expect(projection.socialMatters?.['matter-cmd-raise']).toMatchObject({
      status: 'closed',
      closure: 'fulfilled',
      deliveredQuantity: 2,
    });

    // Snapshot round-trip + replay equivalence.
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  test('capability check rejects assignees without the required commodity', () => {
    let projection = raiseMatter(createProjection());
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-respond',
        agentId: 'agent-2',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise', decision: 'accept' },
      }),
    );
    // Drain the assignee's apples below the requirement.
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-drain',
        agentId: 'agent-2',
        type: 'AgentGiveResource',
        payload: { targetAgentId: 'agent-1', commodityName: 'Apple', quantity: 4 },
      }),
    );
    const incapable = dispatch(projection, {
      id: 'cmd-assign',
      agentId: 'agent-1',
      type: 'AgentAssignMatter',
      payload: { matterId: 'matter-cmd-raise', assigneeAgentId: 'agent-2' },
    })[0];
    expect(incapable?.type).toBe('ActionRejected');
    expect(
      incapable?.type === 'ActionRejected' ? incapable.payload.reason : '',
    ).toContain('lacks capability');
  });

  test('withdraw and reject/defer response handling', () => {
    let projection = raiseMatter(createProjection());
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-defer',
        agentId: 'agent-2',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise', decision: 'defer' },
      }),
    );
    // Defer does not open collection.
    expect(projection.socialMatters?.['matter-cmd-raise']?.status).toBe('open');
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-close',
        agentId: 'agent-1',
        type: 'AgentCloseMatter',
        payload: { matterId: 'matter-cmd-raise', outcome: 'withdrawn' },
      }),
    );
    expect(projection.socialMatters?.['matter-cmd-raise']).toMatchObject({
      status: 'closed',
      closure: 'withdrawn',
    });
    // Closed matters reject further responses.
    expect(
      dispatch(projection, {
        id: 'cmd-late',
        agentId: 'agent-2',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise', decision: 'accept' },
      })[0],
    ).toMatchObject({ type: 'ActionRejected' });
  });

  test('expiry: unassigned matters expire, assigned matters breach with betrayal outcome', () => {
    let projection = raiseMatter(createProjection());
    // A second matter that gets assigned before expiry.
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-raise-2',
        agentId: 'agent-1',
        type: 'AgentRaiseMatter',
        payload: { topic: 'wood', statement: 'Need wood.' },
      }),
    );
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-respond-2',
        agentId: 'agent-2',
        type: 'AgentRespondMatter',
        payload: { matterId: 'matter-cmd-raise-2', decision: 'accept' },
      }),
    );
    projection = apply(
      projection,
      dispatch(projection, {
        id: 'cmd-assign-2',
        agentId: 'agent-1',
        type: 'AgentAssignMatter',
        payload: { matterId: 'matter-cmd-raise-2', assigneeAgentId: 'agent-2' },
      }),
    );

    const advance = dispatch(
      projection,
      { id: 'cmd-advance', type: 'AdvanceSimulationTime', payload: { deltaMs: 10_001 } },
    );
    const types = advance.map((event) => event.type);
    expect(types.filter((type) => type === 'MatterClosed')).toHaveLength(2);
    const closures = advance
      .filter((event) => event.type === 'MatterClosed')
      .map((event) => {
        const payload = event.payload as { matterId: string; closure: string };
        return { matterId: payload.matterId, closure: payload.closure };
      });
    expect(closures).toEqual([
      { matterId: 'matter-cmd-raise', closure: 'expired' },
      { matterId: 'matter-cmd-raise-2', closure: 'breached' },
    ]);
    const betrayal = advance.find(
      (event) =>
        event.type === 'SocialInteractionCompleted' &&
        (event.payload as unknown as { outcomeSignals?: string[] }).outcomeSignals?.includes(
          'betrayal',
        ),
    );
    expect(betrayal?.payload).toMatchObject({
      sourceAgentId: 'agent-2',
      targetAgentId: 'agent-1',
      relationDelta: -0.3,
    });

    projection = apply(projection, advance);
    expect(projection.socialMatters?.['matter-cmd-raise']?.closure).toBe('expired');
    expect(projection.socialMatters?.['matter-cmd-raise-2']?.closure).toBe('breached');
  });

  test('conversation commitments escalate to latent matters and close on adjudicated fulfill/breach', () => {
    let projection = createProjection();
    const first = dispatch(projection, {
      id: 'cmd-convo-1',
      agentId: 'agent-1',
      type: 'AgentStartConversation',
      payload: {
        targetAgentId: 'agent-2',
        topic: 'festival help',
        relationDelta: 0,
        attitudeDelta: 0,
        turns: [
          { speakerAgentId: 'agent-1', utterance: 'Will you help me?', intent: 'cooperate' },
          {
            speakerAgentId: 'agent-2',
            utterance: 'Yes, I promise to bring apples.',
            intent: 'make-commitment',
          },
        ],
      },
    });
    expect(first.map((event) => event.type)).toContain('MatterRaised');
    projection = apply(projection, first);
    const matter = projection.socialMatters?.['matter-commitment-conversation-cmd-convo-1-1'];
    expect(matter).toMatchObject({
      kind: 'commitment',
      status: 'latent',
      initiatorAgentId: 'agent-1',
      assigneeAgentId: 'agent-2',
      sourceCommitmentId: 'conversation-cmd-convo-1:1',
    });

    const second = dispatch(projection, {
      id: 'cmd-convo-2',
      agentId: 'agent-2',
      type: 'AgentStartConversation',
      payload: {
        targetAgentId: 'agent-1',
        topic: 'festival help',
        relationDelta: 0,
        attitudeDelta: 0,
        turns: [
          {
            speakerAgentId: 'agent-2',
            utterance: 'I brought the apples as promised.',
            intent: 'fulfill-commitment',
          },
          { speakerAgentId: 'agent-1', utterance: 'Thank you!', intent: 'cooperate' },
        ],
      },
    });
    expect(second.map((event) => event.type)).toContain('MatterClosed');
    projection = apply(projection, second);
    expect(
      projection.socialMatters?.['matter-commitment-conversation-cmd-convo-1-1'],
    ).toMatchObject({ status: 'closed', closure: 'fulfilled' });
    // The linked conversation commitment resolved through the existing path too.
    expect(projection.socialCommitments['conversation-cmd-convo-1:1']?.status).toBe('fulfilled');
  });

  test('flag off: matter commands rejected and conversations create no matters', () => {
    const rejected = dispatch(
      createProjection(),
      {
        id: 'cmd-raise-off',
        agentId: 'agent-1',
        type: 'AgentRaiseMatter',
        payload: { topic: 'x', statement: 'y' },
      },
      legacyPolicies,
    );
    expect(rejected[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'missing social matters policy' },
    });

    const conversation = dispatch(
      createProjection(),
      {
        id: 'cmd-convo-off',
        agentId: 'agent-1',
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: 'agent-2',
          topic: 'help',
          relationDelta: 0,
          attitudeDelta: 0,
          turns: [
            { speakerAgentId: 'agent-1', utterance: 'Help?', intent: 'cooperate' },
            { speakerAgentId: 'agent-2', utterance: 'I promise.', intent: 'make-commitment' },
          ],
        },
      },
      legacyPolicies,
    );
    expect(conversation.map((event) => event.type)).not.toContain('MatterRaised');
    const projection = apply(createProjection(), conversation);
    expect(projection.socialMatters).toBeUndefined();
    // The legacy commitment still works exactly as before.
    expect(projection.socialCommitments['conversation-cmd-convo-off:1']?.status).toBe('open');
  });
});
