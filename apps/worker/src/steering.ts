import {
  compileStrategicObjectiveToBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  runReactiveSteeringRoute,
  type BranchPlanRecord,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
  type CommandDraft,
  type ReactiveActionSimulator,
  type ReactiveLocalizedPlanner,
  type ReactiveRepairPolicy,
  type ReactiveSteeringResult,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import {
  createShortTermMemoryRecord,
  type AgentIntentionRepository,
  type AgentIntentionState,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileRepository,
  type LongHorizonObjective,
  type ShortTermMemoryRecord,
  type ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  AgentId,
  CommandEnvelope,
  CommandSource,
  CoreCommandType,
} from '@aivilization/sim-core';
import { publishPlanningSession } from './planningSessionPublication';

export type WorkerSteeringResult =
  | {
      readonly kind: 'agent-registration-dispatched';
      readonly agentId: AgentId;
      readonly registrationId: string;
      readonly status: 'registered' | 'rejected';
      readonly reason?: string;
      readonly commandDrafts: readonly [];
      readonly shortTermMemoryRecords: readonly [];
    }
  | {
      readonly kind: 'long-horizon-objective-set';
      readonly intentionState: AgentIntentionState;
      readonly planRecord?: BranchPlanRecord;
      readonly commandDrafts: readonly CommandDraft[];
      readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
      readonly longTermMemoryPatches: readonly LongTermMemoryPatch[];
      readonly longTermProfile?: LongTermAgentProfile;
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
  readonly longTermProfileRepository?: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository?: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly simulate: ReactiveActionSimulator;
  readonly repair?: ReactiveRepairPolicy;
  readonly persistShortTermMemoryRecords?: boolean;
}): Promise<WorkerSteeringResult> {
  const agentId = requireActorId(input.command);
  const persistShortTermMemoryRecords = input.persistShortTermMemoryRecords ?? true;

  switch (input.command.type) {
    case 'RegisterAgent':
      throw new Error('RegisterAgent requires the world-aware runtime command drain');
    case 'SetLongHorizonObjective': {
      const objective = parseSetLongHorizonObjectivePayload({
        payload: input.command.payload,
        commandId: input.command.id,
        agentId,
        source: input.command.source,
        issuedAt: input.command.issuedAt,
      });
      const strategicMemoryRecord = createStrategicSteeringMemoryRecord({
        command: input.command,
        objective,
      });
      if (persistShortTermMemoryRecords) {
        await input.shortTermMemoryRepository.append(strategicMemoryRecord);
      }
      const longTermProfileRepository = input.longTermProfileRepository;
      const longTermMemoryPatches =
        longTermProfileRepository === undefined
          ? []
          : [
              createStrategicSteeringLongTermMemoryPatch({
                objective,
                memoryRecord: strategicMemoryRecord,
              }),
            ];
      const longTermProfile =
        longTermProfileRepository === undefined
          ? undefined
          : await longTermProfileRepository.applyPatches(agentId, longTermMemoryPatches);
      const planRecord = await createStrategicPlanRecord({
        objective,
        issuedAt: input.command.issuedAt,
        ...(longTermProfile === undefined ? {} : { longTermProfile }),
        ...(input.planRepository === undefined ? {} : { planRepository: input.planRepository }),
        ...(input.strategicPlanCompiler === undefined
          ? {}
          : { strategicPlanCompiler: input.strategicPlanCompiler }),
      });
      const publication = await publishPlanningSession({
        objective,
        publishedAt: input.command.issuedAt,
        intentionRepository: input.intentionRepository,
        ...(planRecord === undefined || input.planRepository === undefined
          ? {}
          : { planRecord, planRepository: input.planRepository }),
        ...(planRecord === undefined || input.planProgressRepository === undefined
          ? {}
          : { planProgressRepository: input.planProgressRepository }),
      });
      return {
        kind: 'long-horizon-objective-set',
        intentionState: publication.intentionState,
        ...(planRecord === undefined ? {} : { planRecord }),
        commandDrafts: [],
        shortTermMemoryRecords: [strategicMemoryRecord],
        longTermMemoryPatches,
        ...(longTermProfile === undefined ? {} : { longTermProfile }),
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
      if (persistShortTermMemoryRecords) {
        await input.shortTermMemoryRepository.appendMany(routeResult.shortTermMemoryRecords);
      }
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

async function createStrategicPlanRecord(input: {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly planRepository?: BranchPlanRepository;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
}): Promise<BranchPlanRecord | undefined> {
  if (input.planRepository === undefined) {
    return undefined;
  }

  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;
  const compiled = normalizeStrategicPlanCompilerOutput(
    await compile({
      objective: input.objective,
      issuedAt: input.issuedAt,
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    }),
  );
  const planRecord = {
    planId: input.objective.id,
    agentId: input.objective.agentId,
    plan: compiled.plan,
    ...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };
  return planRecord;
}

function createStrategicSteeringMemoryRecord(input: {
  readonly command: WorkerSteeringCommand;
  readonly objective: LongHorizonObjective;
}): ShortTermMemoryRecord {
  return createShortTermMemoryRecord({
    id: `${input.command.id}:strategic-objective`,
    agentId: input.objective.agentId,
    kind: 'human-command',
    status: 'observed',
    summary: createStrategicSteeringSummary(input.objective),
    occurredAt: input.command.issuedAt,
    importanceScore: 0.9,
    source: {
      commandId: input.command.id,
      eventIds: [],
    },
    tags: dedupeTags([
      'steering',
      'strategic',
      'long-horizon-objective',
      ...input.objective.affinityTags,
    ]),
  });
}

function createStrategicSteeringLongTermMemoryPatch(input: {
  readonly objective: LongHorizonObjective;
  readonly memoryRecord: ShortTermMemoryRecord;
}): LongTermMemoryPatch {
  return {
    id: `ltm-patch-${input.objective.agentId}-steering-value-human-objective-${input.objective.id}-${input.objective.updatedAt}`,
    agentId: input.objective.agentId,
    section: 'values',
    key: `human-objective:${input.objective.id}`,
    statement: createStrategicSteeringSummary(input.objective),
    confidence: strategicObjectiveConfidence(input.objective),
    provenanceRecordIds: [input.memoryRecord.id],
    proposedAt: input.objective.updatedAt,
  };
}

function createStrategicSteeringSummary(objective: LongHorizonObjective): string {
  return `Human steering set long-horizon objective: ${objective.statement}`;
}

function strategicObjectiveConfidence(objective: LongHorizonObjective): number {
  switch (objective.source) {
    case 'human':
      return 0.95;
    case 'agent':
      return 0.85;
    case 'system':
      return 0.8;
  }
}

function dedupeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags)];
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
