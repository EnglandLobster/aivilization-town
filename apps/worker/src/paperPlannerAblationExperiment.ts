import { commodities } from '@aivilization/content';
import { calculateNetWorth } from '@aivilization/economy';
import {
  createPaperPlannerAblationRunArtifact,
  getPaperPlannerAblationTaskDefinition,
  type AgentCycleTrace,
  type PaperPlannerAblationAgentOutcome,
  type PaperPlannerAblationPlanningTurn,
  type PaperPlannerAblationRun,
  type PaperPlannerAblationRunArtifact,
  type PaperPlannerAblationTaskId,
} from '@aivilization/observability';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import type { AutonomousObjectiveProposer } from './objectiveRenewal';

export type WorkerPaperPlannerAblationAnalysisInput = {
  readonly run: PaperPlannerAblationRun;
  readonly finalProjection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly agentCycleTraces: readonly AgentCycleTrace[];
};

export function createPaperPlannerAblationObjectiveProposer(
  taskId: PaperPlannerAblationTaskId,
): AutonomousObjectiveProposer {
  const task = getPaperPlannerAblationTaskDefinition(taskId);
  return (input) => {
    const objectiveId = `paper-ablation:${task.taskId}:${input.agentId}`;
    return {
      objective: {
        id: objectiveId,
        agentId: input.agentId,
        statement: task.topLevelLongTermGoal,
        priority: 100,
        source: 'agent',
        affinityTags: [...task.affinityTags],
        createdAt: input.issuedAt,
        updatedAt: input.issuedAt,
      },
      decisionTrace: {
        agentId: input.agentId,
        objectiveId,
        selectedCandidateId: `paper-ablation-${task.taskId}`,
        rationale: `Section 5 controlled experiment injected ${task.taskId} as the top-level long-term goal.`,
        score: 100,
        shortTermMemoryContextIds: input.shortTermMemoryContext.map((record) => record.id),
        profileEntryKeys: [],
        profileEvidenceRecordIds: [],
        issuedAt: input.issuedAt,
      },
    };
  };
}

export function createWorkerPaperPlannerAblationRunArtifact(
  input: WorkerPaperPlannerAblationAnalysisInput,
): PaperPlannerAblationRunArtifact {
  if (input.finalProjection.clock.now !== input.run.experimentEndedAt) {
    throw new Error('finalProjection clock must match paper planner ablation experimentEndedAt');
  }
  const agentIds = new Set(Object.keys(input.finalProjection.agents));
  const events = normalizeEvents(input.events, input.run, agentIds);
  const traces = normalizeTraces(input.agentCycleTraces, input.run, agentIds);
  const production = createProductionOutcomes(events);
  const pools = Object.values(input.finalProjection.marketPools);
  const agentOutcomes = Object.values(input.finalProjection.agents)
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((agent): PaperPlannerAblationAgentOutcome => {
      const produced = production.get(agent.agentId) ?? {
        highTechItemsProduced: 0,
        chipsProduced: 0,
        productionEventIds: [],
      };
      const netWorth = calculateNetWorth({
        currencyBalance: agent.balance,
        inventory: agent.inventory,
        pools,
      });
      return {
        agentId: agent.agentId,
        currencyBalance: agent.balance,
        inventoryValue: netWorth - agent.balance,
        netWorth,
        educationScore: agent.educationScore,
        satiety: agent.physiology.satiety,
        energy: agent.physiology.energy,
        health: agent.physiology.health,
        highTechItemsProduced: produced.highTechItemsProduced,
        chipsProduced: produced.chipsProduced,
        productionEventIds: produced.productionEventIds,
      };
    });
  const planningTurns = traces.map(
    (trace): PaperPlannerAblationPlanningTurn => ({
      turnId: `${trace.agentId}:${trace.cycleStartedAt}:${trace.traceId}`,
      agentId: trace.agentId,
      simulatedAt: trace.cycleStartedAt,
      actionSignatures: trace.candidateActions,
      sourceTraceId: trace.traceId,
    }),
  );

  return createPaperPlannerAblationRunArtifact({
    run: input.run,
    agentOutcomes,
    planningTurns,
  });
}

type ProducedOutcome = {
  readonly highTechItemsProduced: number;
  readonly chipsProduced: number;
  readonly productionEventIds: readonly string[];
};

function createProductionOutcomes(events: readonly WorldEvent[]): Map<string, ProducedOutcome> {
  const highTechCommodities = new Set<string>(
    commodities
      .filter((commodity) => commodity.tier === 'TertiaryHighTech')
      .map((commodity) => commodity.name),
  );
  const mutable = new Map<
    string,
    {
      highTechItemsProduced: number;
      chipsProduced: number;
      productionEventIds: string[];
    }
  >();
  for (const event of events) {
    if (event.type !== 'CommodityProduced') {
      continue;
    }
    const current = mutable.get(event.payload.agentId) ?? {
      highTechItemsProduced: 0,
      chipsProduced: 0,
      productionEventIds: [],
    };
    let highTechItemsProduced = current.highTechItemsProduced;
    let chipsProduced = current.chipsProduced;
    for (const [commodityName, quantity] of Object.entries(event.payload.produced)) {
      if (highTechCommodities.has(commodityName)) {
        highTechItemsProduced += quantity;
      }
      if (commodityName === 'Chip') {
        chipsProduced += quantity;
      }
    }
    mutable.set(event.payload.agentId, {
      highTechItemsProduced,
      chipsProduced,
      productionEventIds: [...current.productionEventIds, event.id],
    });
  }
  return mutable;
}

function normalizeEvents(
  events: readonly WorldEvent[],
  run: PaperPlannerAblationRun,
  agentIds: ReadonlySet<string>,
): WorldEvent[] {
  return events
    .filter((event) => {
      if (event.simulationId !== run.simulationId) {
        throw new Error(`event ${event.id} simulationId must match paper planner ablation run`);
      }
      if (event.occurredAt < run.experimentStartedAt || event.occurredAt > run.experimentEndedAt) {
        return false;
      }
      if (event.type === 'CommodityProduced' && !agentIds.has(event.payload.agentId)) {
        throw new Error(`production event ${event.id} references unknown experiment agent`);
      }
      return true;
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function normalizeTraces(
  traces: readonly AgentCycleTrace[],
  run: PaperPlannerAblationRun,
  agentIds: ReadonlySet<string>,
): AgentCycleTrace[] {
  return traces
    .filter((trace) => {
      if (trace.simulationId !== run.simulationId) {
        throw new Error(`trace ${trace.traceId} simulationId must match paper planner ablation run`);
      }
      if (!agentIds.has(trace.agentId)) {
        throw new Error(`trace ${trace.traceId} references unknown experiment agent`);
      }
      return (
        trace.cycleStartedAt >= run.experimentStartedAt &&
        trace.cycleStartedAt <= run.experimentEndedAt
      );
    })
    .sort((left, right) => {
      if (left.cycleStartedAt !== right.cycleStartedAt) {
        return left.cycleStartedAt - right.cycleStartedAt;
      }
      return left.traceId.localeCompare(right.traceId);
    });
}
