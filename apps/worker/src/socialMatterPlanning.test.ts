import {
  createBranchPlan,
  type PrioritizedSubtask,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type { LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import type { WorkerDomainRuntimeFactoryInput } from './domainRuntimeRegistry';
import {
  assertValidSocialMatterActionProposerPolicy,
  DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY,
  resolveSocialMatterActionProposal,
} from './socialMatterPlanning';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('social matter planning', () => {
  test('assigns the first visible accepted responder and accepts a request within capability', () => {
    const initiator = createAgent(agentA, { Book: 2 });
    const assign = resolveSocialMatterActionProposal({
      actionId: 'action-assign',
      context: createContext(initiator, [
        matter({
          matterId: 'matter-assign',
          role: 'initiator',
          status: 'collecting',
          initiatorAgentId: agentA,
          responses: [{ responderAgentId: agentB, decision: 'accept', respondedAt: 10 }],
        }),
      ]),
      selectedSubtask: socialSubtask('Assign the accepted responder.'),
    });
    expect(assign).toMatchObject({
      commandType: 'AgentAssignMatter',
      payload: { matterId: 'matter-assign', assigneeAgentId: agentB },
    });

    const responder = createAgent(agentA, { Book: 2 });
    const respond = resolveSocialMatterActionProposal({
      actionId: 'action-respond',
      context: createContext(responder, [
        matter({
          matterId: 'matter-respond',
          role: 'available',
          status: 'open',
          initiatorAgentId: agentB,
          requiredCommodity: { commodityName: 'Book', quantity: 2 },
        }),
      ]),
      selectedSubtask: socialSubtask('Review open help requests.'),
    });
    expect(respond).toMatchObject({
      commandType: 'AgentRespondMatter',
      payload: { matterId: 'matter-respond', decision: 'accept' },
    });
  });

  test('raises a commodity-backed request and only withdraws on explicit intent', () => {
    const agent = createAgent(agentA, {});
    const raised = resolveSocialMatterActionProposal({
      actionId: 'action-raise',
      context: createContext(agent, []),
      selectedSubtask: socialSubtask('Request help finding one Apple.'),
    });
    expect(raised).toMatchObject({
      commandType: 'AgentRaiseMatter',
      payload: {
        topic: 'help-Apple',
        requiredCommodity: { commodityName: 'Apple', quantity: 1 },
      },
    });

    const owned = matter({
      matterId: 'matter-owned',
      role: 'initiator',
      status: 'open',
      initiatorAgentId: agentA,
      topic: 'cancel-me',
    });
    expect(
      resolveSocialMatterActionProposal({
        actionId: 'action-observe',
        context: createContext(agent, [owned]),
        selectedSubtask: socialSubtask('Review matter matter-owned.'),
      }),
    ).toBeUndefined();
    expect(
      resolveSocialMatterActionProposal({
        actionId: 'action-close',
        context: createContext(agent, [owned]),
        selectedSubtask: socialSubtask('Withdraw matter matter-owned.'),
      }),
    ).toMatchObject({
      commandType: 'AgentCloseMatter',
      payload: { matterId: 'matter-owned', outcome: 'withdrawn' },
    });
  });

  test('fails closed when a commodity request exceeds current inventory', () => {
    const agent = createAgent(agentA, { Book: 1 });
    expect(
      resolveSocialMatterActionProposal({
        actionId: 'action-no-capability',
        context: createContext(agent, [
          matter({
            matterId: 'matter-too-large',
            role: 'available',
            status: 'open',
            initiatorAgentId: agentB,
            requiredCommodity: { commodityName: 'Book', quantity: 2 },
          }),
        ]),
        selectedSubtask: socialSubtask('Review open help requests.'),
      }),
    ).toBeUndefined();
  });

  test('validates the versioned request quantity boundary', () => {
    expect(() =>
      assertValidSocialMatterActionProposerPolicy({
        ...DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY,
        defaultRequestQuantity: 0,
      }),
    ).toThrow('defaultRequestQuantity must be positive finite');
  });
});

function createContext(
  agent: WorldAgentState,
  matters: NonNullable<WorldDecisionContext['matters']>,
): WorkerDomainRuntimeFactoryInput {
  const other = createAgent(agent.agentId === agentA ? agentB : agentA, {});
  const projection = createWorldProjection({
    agents: [agent, other],
    locations: [
      {
        locationId: asLocationId('town-square'),
        name: 'Town Square',
        kind: 'social',
        activityAffinities: ['socialize'],
        capacity: null,
      },
    ],
  });
  const objective: LongHorizonObjective = {
    id: 'objective-social-matter',
    agentId: agent.agentId,
    statement: 'Handle a social matter.',
    priority: 3,
    source: 'agent',
    affinityTags: ['social', 'matter'],
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    agentId: agent.agentId,
    agent,
    projection,
    activeObjective: objective,
    planRecord: {
      planId: objective.id,
      agentId: agent.agentId,
      plan: createBranchPlan({
        objective: objective.statement,
        branches: [
          {
            id: 'social',
            objective: 'Handle the matter.',
            subtasks: [{ id: 'matter', description: 'Handle the matter.', basePriority: 10 }],
          },
        ],
      }),
      createdAt: 0,
      updatedAt: 0,
    },
    worldDecisionContext: {
      agent: {
        agentId: agent.agentId,
        locationId: agent.locationId,
        physiology: { ...agent.physiology },
        educationScore: agent.educationScore,
        balance: agent.balance,
        residentialTier: agent.residentialTier,
        job: agent.job,
        inventory: { ...agent.inventory },
      },
      market: { spotPrices: [] },
      matters,
    },
  };
}

function createAgent(
  agentId: AgentId,
  inventory: Readonly<Record<string, number>>,
): WorldAgentState {
  return {
    agentId,
    locationId: asLocationId('town-square'),
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: 100,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory,
  };
}

function matter(
  input: Pick<
    NonNullable<WorldDecisionContext['matters']>[number],
    'matterId' | 'role' | 'status' | 'initiatorAgentId'
  > &
    Partial<
      Pick<
        NonNullable<WorldDecisionContext['matters']>[number],
        'topic' | 'requiredCommodity' | 'responses'
      >
    >,
): NonNullable<WorldDecisionContext['matters']>[number] {
  return {
    matterId: input.matterId,
    kind: 'help-request',
    status: input.status,
    role: input.role,
    initiatorAgentId: input.initiatorAgentId,
    topic: input.topic ?? `topic-${input.matterId}`,
    statement: `statement-${input.matterId}`,
    ...(input.requiredCommodity === undefined
      ? {}
      : { requiredCommodity: input.requiredCommodity }),
    responses: input.responses ?? [],
    createdAt: 0,
    expiresAt: 1_000,
  };
}

function socialSubtask(description: string): PrioritizedSubtask {
  return { branchId: 'social', subtaskId: 'matter', description, score: 10 };
}
