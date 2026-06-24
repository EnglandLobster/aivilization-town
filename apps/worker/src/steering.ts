import {
  compileStrategicObjectiveToBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  runReactiveSteeringRoute,
  type BranchPlanRecord,
  type BranchPlanRepository,
  type CommandDraft,
  type ReactiveActionSimulator,
  type ReactiveLocalizedPlanner,
  type ReactiveRepairPolicy,
  type ReactiveSteeringResult,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  AgentIntentionState,
  LongHorizonObjective,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  AgentId,
  CommandEnvelope,
  CommandSource,
  CoreCommandType,
} from '@aivilization/sim-core';

export type WorkerSteeringResult =
  | {
      readonly kind: 'long-horizon-objective-set';
      readonly intentionState: AgentIntentionState;
      readonly planRecord?: BranchPlanRecord;
      readonly commandDrafts: readonly CommandDraft[];
      readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
    }
  | {
      readonly kind: 'reactive-command-routed';
      readonly routeResult: ReactiveSteeringResult;
      readonly commandDrafts: readonly CommandDraft[];
      readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
    };

export type WorkerSteeringCommand = CommandEnvelope<CoreCommandType, unknown>;

export async function handleWorkerSteeringCommand(input: {
  readonly command: WorkerSteeringCommand;
  readonly intentionRepository: AgentIntentionRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository?: BranchPlanRepository;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly simulate: ReactiveActionSimulator;
  readonly repair?: ReactiveRepairPolicy;
}): Promise<WorkerSteeringResult> {
  const agentId = requireActorId(input.command);

  switch (input.command.type) {
    case 'SetLongHorizonObjective': {
      const objective = parseSetLongHorizonObjectivePayload({
        payload: input.command.payload,
        commandId: input.command.id,
        agentId,
        source: input.command.source,
        issuedAt: input.command.issuedAt,
      });
      const intentionState = await input.intentionRepository.setObjective(agentId, objective);
      const planRecord = await createAndSaveStrategicPlanRecord({
        objective,
        issuedAt: input.command.issuedAt,
        ...(input.planRepository === undefined ? {} : { planRepository: input.planRepository }),
        ...(input.strategicPlanCompiler === undefined
          ? {}
          : { strategicPlanCompiler: input.strategicPlanCompiler }),
      });
      return {
        kind: 'long-horizon-objective-set',
        intentionState,
        ...(planRecord === undefined ? {} : { planRecord }),
        commandDrafts: [],
        shortTermMemoryRecords: [],
      };
    }
    case 'IssueReactiveCommand': {
      const reactiveCommand = parseIssueReactiveCommandPayload({
        payload: input.command.payload,
        fallbackCommandId: input.command.id,
      });
      const routeResult = runReactiveSteeringRoute({
        simulationId: input.command.simulationId,
        agentId,
        issuedAt: input.command.issuedAt,
        command: reactiveCommand,
        localizedPlanners: input.localizedPlanners,
        simulate: input.simulate,
        ...(input.repair === undefined ? {} : { repair: input.repair }),
      });
      await input.shortTermMemoryRepository.appendMany(routeResult.shortTermMemoryRecords);
      return {
        kind: 'reactive-command-routed',
        routeResult,
        commandDrafts: routeResult.commandDrafts,
        shortTermMemoryRecords: routeResult.shortTermMemoryRecords,
      };
    }
    default:
      throw new Error(`unsupported steering command ${input.command.type}`);
  }
}

async function createAndSaveStrategicPlanRecord(input: {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly planRepository?: BranchPlanRepository;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
}): Promise<BranchPlanRecord | undefined> {
  if (input.planRepository === undefined) {
    return undefined;
  }

  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;
  const compiled = normalizeStrategicPlanCompilerOutput(
    await compile({ objective: input.objective, issuedAt: input.issuedAt }),
  );
  const planRecord = {
    planId: input.objective.id,
    agentId: input.objective.agentId,
    plan: compiled.plan,
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };
  await input.planRepository.save(planRecord);
  return planRecord;
}

function requireActorId(command: WorkerSteeringCommand): AgentId {
  if (command.actorId === undefined) {
    throw new Error(`${command.type} requires actorId`);
  }
  return command.actorId;
}

function parseSetLongHorizonObjectivePayload(input: {
  readonly payload: unknown;
  readonly commandId: string;
  readonly agentId: AgentId;
  readonly source: CommandSource;
  readonly issuedAt: number;
}): LongHorizonObjective {
  const payload = assertRecord(input.payload, 'SetLongHorizonObjective payload');
  const objectiveId = optionalString(payload['objectiveId'], 'SetLongHorizonObjective objectiveId');
  const statement = requiredString(payload['statement'], 'SetLongHorizonObjective statement');
  const priority =
    optionalFiniteNumber(payload['priority'], 'SetLongHorizonObjective priority') ?? 1;
  const affinityTags = requiredStringArray(
    payload['affinityTags'],
    'SetLongHorizonObjective affinityTags',
  );

  return {
    id: objectiveId ?? input.commandId,
    agentId: input.agentId,
    statement,
    priority,
    source: normalizeObjectiveSource(input.source),
    affinityTags,
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };
}

function parseIssueReactiveCommandPayload(input: {
  readonly payload: unknown;
  readonly fallbackCommandId: string;
}): {
  readonly id: string;
  readonly summary: string;
  readonly tags?: readonly string[];
} {
  const payload = assertRecord(input.payload, 'IssueReactiveCommand payload');
  const reactiveCommandId = optionalString(
    payload['reactiveCommandId'],
    'IssueReactiveCommand reactiveCommandId',
  );
  const summary = requiredString(payload['summary'], 'IssueReactiveCommand summary');
  const tags = optionalStringArray(payload['tags'], 'IssueReactiveCommand tags');

  return {
    id: reactiveCommandId ?? input.fallbackCommandId,
    summary,
    ...(tags === undefined ? {} : { tags }),
  };
}

function normalizeObjectiveSource(source: CommandSource): LongHorizonObjective['source'] {
  switch (source) {
    case 'human':
    case 'agent-runtime':
      return source === 'agent-runtime' ? 'agent' : 'human';
    case 'system':
    case 'experiment':
      return 'system';
  }
}

function assertRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, name);
}

function optionalFiniteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}

function requiredStringArray(value: unknown, name: string): readonly string[] {
  const result = optionalStringArray(value, name);
  if (result === undefined || result.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  return result;
}

function optionalStringArray(value: unknown, name: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  const result = value.map((item) => requiredString(item, name));
  if (result.length !== new Set(result).size) {
    throw new Error(`${name} must not contain duplicate values`);
  }
  return result;
}
