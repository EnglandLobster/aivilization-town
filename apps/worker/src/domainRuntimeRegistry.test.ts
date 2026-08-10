import {
  createBranchPlan,
  type AtomicActionProposal,
  type BranchPlanRecord,
  type CycleActionSimulator,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type { LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createDomainRuntimeResolver,
  type WorkerAgentRuntimeResolver,
  type WorkerDomainRuntimeRegistration,
} from './index';

const agentId = asAgentId('agent-domain-registry');

describe('domain runtime registry', () => {
  test('resolves matching domain micro-planners in registration order', async () => {
    const studyPlanner = createPlanner('study');
    const tradePlanner = createPlanner('trade');
    const sleepPlanner = createPlanner('sleep');
    const simulate: CycleActionSimulator = ({ action }) => ({ status: 'accepted', action });
    const repair: CycleRepairPolicy = () => undefined;
    const resolver = createDomainRuntimeResolver({
      registrations: [
        { domain: 'trade', microPlanners: [tradePlanner] },
        { domain: 'sleep', microPlanners: [sleepPlanner] },
        { domain: 'study', microPlanners: [studyPlanner] },
      ],
      simulate,
      repair,
    });
    const projection = createProjection();

    const binding = await resolver({
      agentId,
      agent: requireAgent(projection, agentId),
      projection,
      activeObjective: createObjective(),
      planRecord: createStudyTradePlanRecord(),
    });

    expect(binding?.microPlanners).toEqual([tradePlanner, studyPlanner]);
    expect(binding?.simulate).toBe(simulate);
    expect(binding?.repair).toBe(repair);
  });

  test('returns undefined when no registered domain matches the plan', async () => {
    const resolver = createDomainRuntimeResolver({
      registrations: [{ domain: 'study', microPlanners: [createPlanner('study')] }],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });
    const projection = createProjection();

    const binding = await resolver({
      agentId,
      agent: requireAgent(projection, agentId),
      projection,
      activeObjective: createObjective(),
      planRecord: createRestPlanRecord(),
    });

    expect(binding).toBeUndefined();
  });

  test('uses contextual factories for matching domains', async () => {
    const tradePlanner = createPlanner('trade');
    const studyPlanner = createPlanner('study-contextual');
    const sleepPlanner = createPlanner('sleep');
    const simulate: CycleActionSimulator = ({ action }) => ({ status: 'accepted', action });
    const projection = createProjection();
    const agent = requireAgent(projection, agentId);
    const activeObjective = createObjective();
    const planRecord = createStudyTradePlanRecord();
    let capturedContext: Parameters<WorkerAgentRuntimeResolver>[0] | undefined;
    let nonMatchingFactoryCalls = 0;
    const resolver = createDomainRuntimeResolver({
      registrations: [
        { domain: 'trade', microPlanners: [tradePlanner] },
        {
          domain: 'sleep',
          createMicroPlanners: () => {
            nonMatchingFactoryCalls += 1;
            return [sleepPlanner];
          },
        },
        {
          domain: 'study',
          createMicroPlanners: (context) => {
            capturedContext = context;
            return [studyPlanner];
          },
        },
      ],
      simulate,
    });

    const binding = await resolver({ agentId, agent, projection, activeObjective, planRecord });

    expect(binding?.microPlanners).toEqual([tradePlanner, studyPlanner]);
    expect(capturedContext?.agentId).toBe(agentId);
    expect(capturedContext?.agent).toBe(agent);
    expect(capturedContext?.projection).toBe(projection);
    expect(capturedContext?.activeObjective).toBe(activeObjective);
    expect(capturedContext?.planRecord).toBe(planRecord);
    expect(nonMatchingFactoryCalls).toBe(0);
  });

  test('rejects invalid registrations with deterministic errors', () => {
    const planner = createPlanner('study');
    const simulate: CycleActionSimulator = ({ action }) => ({ status: 'accepted', action });

    expect(() =>
      createDomainRuntimeResolver({
        registrations: [{ domain: ' ', microPlanners: [planner] }],
        simulate,
      }),
    ).toThrow('domain runtime registration domain must not be empty');
    expect(() =>
      createDomainRuntimeResolver({
        registrations: [
          { domain: 'study', microPlanners: [planner] },
          { domain: ' Study ', microPlanners: [planner] },
        ],
        simulate,
      }),
    ).toThrow('duplicate domain runtime registration study');
    expect(() =>
      createDomainRuntimeResolver({
        registrations: [{ domain: 'study', microPlanners: [] }],
        simulate,
      }),
    ).toThrow('domain runtime registration study requires at least one micro-planner');
    expect(() =>
      createDomainRuntimeResolver({
        registrations: [
          {
            domain: 'study',
            microPlanners: [planner],
            createMicroPlanners: () => [planner],
          } as unknown as WorkerDomainRuntimeRegistration,
        ],
        simulate,
      }),
    ).toThrow(
      'domain runtime registration study cannot define both microPlanners and createMicroPlanners',
    );
  });

  test('rejects matching factories that return empty micro-planner lists', async () => {
    const resolver = createDomainRuntimeResolver({
      registrations: [{ domain: 'study', createMicroPlanners: () => [] }],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });
    const projection = createProjection();

    await expect(
      resolver({
        agentId,
        agent: requireAgent(projection, agentId),
        projection,
        activeObjective: createObjective(),
        planRecord: createStudyTradePlanRecord(),
      }),
    ).rejects.toThrow('domain runtime registration study requires at least one micro-planner');
  });
});

function createPlanner(domain: string): DomainMicroPlanner {
  return {
    domain,
    supports: () => true,
    propose: () => [createAction(domain)],
  };
}

function createAction(domain: string): AtomicActionProposal {
  return {
    id: `${domain}-action`,
    description: `${domain} action`,
    commandType: 'AgentStudy',
    payload: { durationSeconds: 60, educationRatePerSecond: 1 },
  };
}

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId,
        physiology: { energy: 50, satiety: 50, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function requireAgent(projection: WorldProjection, id: AgentId): WorldAgentState {
  const agent = projection.agents[id];
  if (agent === undefined) {
    throw new Error(`missing projected agent ${id}`);
  }
  return agent;
}

function createObjective(): LongHorizonObjective {
  return {
    id: 'objective-domain-registry',
    agentId,
    statement: 'Coordinate a durable plan.',
    priority: 3,
    source: 'human',
    affinityTags: ['strategy'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStudyTradePlanRecord(): BranchPlanRecord {
  return {
    planId: 'objective-domain-registry',
    agentId,
    plan: createBranchPlan({
      objective: 'Improve education and prepare market routines.',
      branches: [
        {
          id: 'learning-lane',
          objective: 'Study the local economy before earning.',
          subtasks: [
            {
              id: 'library-research',
              description: 'Read planning notes.',
              basePriority: 5,
              intentionAffinityTags: ['education'],
            },
          ],
        },
        {
          id: 'market-lane',
          objective: 'Prepare supplies.',
          subtasks: [
            {
              id: 'cashflow-check',
              description: 'Check inventory before exchange.',
              basePriority: 4,
              memoryAffinityTags: ['trade'],
              profileAffinityTags: ['merchant'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createRestPlanRecord(): BranchPlanRecord {
  return {
    planId: 'objective-domain-registry',
    agentId,
    plan: createBranchPlan({
      objective: 'Recover at home.',
      branches: [
        {
          id: 'recovery-lane',
          objective: 'Restore personal condition.',
          subtasks: [
            {
              id: 'quiet-break',
              description: 'Take a calm pause.',
              basePriority: 5,
              intentionAffinityTags: ['rest'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}
