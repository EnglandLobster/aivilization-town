import {
  createMemoryProvenance,
  createShortTermMemoryRecord,
  type ShortTermMemoryRecord,
  type ShortTermMemoryStatus,
} from '@aivilization/memory';
import { asCommandId, type AgentId, type SimulationId } from '@aivilization/sim-core';
import type {
  ActionSimulationResult,
  AtomicActionProposal,
  RepairPolicy,
  ActionWithRepairResult,
} from './actions';
import { simulateActionWithRepair } from './actions';
import type { CommandDraft } from './cycle';

export type ReactiveCommandInput = {
  readonly id: string;
  readonly summary: string;
  readonly tags?: readonly string[];
};

export type ReactiveLocalizedPlanner = {
  readonly domain: string;
  supports(command: ReactiveCommandInput): boolean;
  propose(input: { readonly command: ReactiveCommandInput }): readonly AtomicActionProposal[];
};

export type ReactiveActionSimulator = (input: {
  readonly action: AtomicActionProposal;
  readonly command: ReactiveCommandInput;
}) => ActionSimulationResult;

export type ReactiveRepairPolicy = (input: {
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
  readonly command: ReactiveCommandInput;
}) => AtomicActionProposal | undefined;

export type ReactiveSteeringResult = {
  readonly selectedPlannerDomain?: string;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly commandDrafts: readonly CommandDraft[];
  readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
  readonly needsReplan: boolean;
};

export function runReactiveSteeringRoute(input: {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly command: ReactiveCommandInput;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly simulate: ReactiveActionSimulator;
  readonly repair?: ReactiveRepairPolicy;
}): ReactiveSteeringResult {
  const command = normalizeCommand(input.command);
  const receiptRecord = createReceiptRecord({
    agentId: input.agentId,
    command,
    occurredAt: input.issuedAt,
  });

  const planner = input.localizedPlanners.find((candidate) => candidate.supports(command));
  if (planner === undefined) {
    return createFailureResult({
      input,
      command,
      receiptRecord,
      candidateActions: [],
      simulationResults: [],
      reason: 'no localized planner supports command',
    });
  }

  const candidateActions = [...planner.propose({ command })];
  if (candidateActions.length === 0) {
    return createFailureResult({
      input,
      command,
      receiptRecord,
      selectedPlannerDomain: planner.domain,
      candidateActions,
      simulationResults: [],
      reason: `localized planner ${planner.domain} produced no candidate actions`,
    });
  }

  const repair = adaptRepairPolicy(input.repair, command);
  const simulationResults = candidateActions.map((action) =>
    simulateActionWithRepair({
      action,
      simulate: (candidate) => input.simulate({ action: candidate, command }),
      ...(repair === undefined ? {} : { repair }),
    }),
  );
  const needsReplan = simulationResults.some((result) => result.status === 'needs-replan');
  const commandDrafts = simulationResults.flatMap((result) =>
    result.status === 'needs-replan'
      ? []
      : [createCommandDraft(input, actionFromSimulationResult(result))],
  );
  const outcomeRecord = createOutcomeRecord({
    agentId: input.agentId,
    command,
    occurredAt: input.issuedAt,
    simulationResults,
  });

  return {
    selectedPlannerDomain: planner.domain,
    candidateActions,
    simulationResults,
    commandDrafts,
    shortTermMemoryRecords: [receiptRecord, outcomeRecord],
    needsReplan,
  };
}

function createFailureResult(input: {
  readonly input: {
    readonly agentId: AgentId;
    readonly issuedAt: number;
  };
  readonly command: ReactiveCommandInput;
  readonly receiptRecord: ShortTermMemoryRecord;
  readonly selectedPlannerDomain?: string;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly reason: string;
}): ReactiveSteeringResult {
  return {
    ...(input.selectedPlannerDomain === undefined
      ? {}
      : { selectedPlannerDomain: input.selectedPlannerDomain }),
    candidateActions: input.candidateActions,
    simulationResults: input.simulationResults,
    commandDrafts: [],
    shortTermMemoryRecords: [
      input.receiptRecord,
      createShortTermMemoryRecord({
        id: `${input.command.id}:outcome`,
        agentId: input.input.agentId,
        kind: 'human-command',
        status: 'failed',
        summary: `Reactive command "${input.command.summary}" failed: ${input.reason}.`,
        occurredAt: input.input.issuedAt,
        importanceScore: 1,
        source: { commandId: asCommandId(input.command.id), eventIds: [] },
        tags: buildMemoryTags(input.command, input.candidateActions),
        provenance: createMemoryProvenance({ kind: 'implanted' }),
      }),
    ],
    needsReplan: true,
  };
}

function normalizeCommand(command: ReactiveCommandInput): ReactiveCommandInput {
  const id = command.id.trim();
  if (id.length === 0) {
    throw new Error('reactive command id must not be empty');
  }
  const summary = command.summary.trim();
  if (summary.length === 0) {
    throw new Error('reactive command summary must not be empty');
  }
  const tags = [...(command.tags ?? [])].map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  return {
    id,
    summary,
    ...(tags.length === 0 ? {} : { tags }),
  };
}

function createReceiptRecord(input: {
  readonly agentId: AgentId;
  readonly command: ReactiveCommandInput;
  readonly occurredAt: number;
}): ShortTermMemoryRecord {
  return createShortTermMemoryRecord({
    id: `${input.command.id}:received`,
    agentId: input.agentId,
    kind: 'human-command',
    status: 'observed',
    summary: `Received reactive command "${input.command.summary}".`,
    occurredAt: input.occurredAt,
    importanceScore: 0.6,
    source: { commandId: asCommandId(input.command.id), eventIds: [] },
    tags: buildMemoryTags(input.command, []),
    provenance: createMemoryProvenance({ kind: 'implanted' }),
  });
}

function createOutcomeRecord(input: {
  readonly agentId: AgentId;
  readonly command: ReactiveCommandInput;
  readonly occurredAt: number;
  readonly simulationResults: readonly ActionWithRepairResult[];
}): ShortTermMemoryRecord {
  const status = summarizeOutcomeStatus(input.simulationResults);
  const firstFailure = input.simulationResults.find((result) => result.status === 'needs-replan');

  return createShortTermMemoryRecord({
    id: `${input.command.id}:outcome`,
    agentId: input.agentId,
    kind: 'human-command',
    status,
    summary:
      firstFailure === undefined
        ? createSuccessfulOutcomeSummary(
            input.command,
            status === 'repaired' ? 'repaired' : 'succeeded',
            input.simulationResults.length,
          )
        : `Reactive command "${input.command.summary}" failed: ${firstFailure.reason}.`,
    occurredAt: input.occurredAt,
    importanceScore: status === 'failed' ? 1 : status === 'repaired' ? 0.85 : 0.7,
    source: { commandId: asCommandId(input.command.id), eventIds: [] },
    tags: buildMemoryTags(
      input.command,
      input.simulationResults.map((result) => actionFromAnySimulationResult(result)),
    ),
    provenance: createMemoryProvenance({ kind: 'implanted' }),
  });
}

function summarizeOutcomeStatus(
  results: readonly ActionWithRepairResult[],
): Extract<ShortTermMemoryStatus, 'succeeded' | 'failed' | 'repaired'> {
  if (results.some((result) => result.status === 'needs-replan')) {
    return 'failed';
  }
  if (results.some((result) => result.status === 'repaired')) {
    return 'repaired';
  }
  return 'succeeded';
}

function createSuccessfulOutcomeSummary(
  command: ReactiveCommandInput,
  status: Extract<ShortTermMemoryStatus, 'succeeded' | 'repaired'>,
  actionCount: number,
): string {
  if (status === 'repaired') {
    return `Reactive command "${command.summary}" was repaired and validated with ${actionCount} action(s).`;
  }
  return `Reactive command "${command.summary}" succeeded with ${actionCount} action(s).`;
}

function buildMemoryTags(
  command: ReactiveCommandInput,
  actions: readonly AtomicActionProposal[],
): readonly string[] {
  return [
    ...new Set([
      'human-command',
      'reactive',
      ...(command.tags ?? []),
      ...actions.map((action) => action.commandType),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function adaptRepairPolicy(
  repair: ReactiveRepairPolicy | undefined,
  command: ReactiveCommandInput,
): RepairPolicy | undefined {
  if (repair === undefined) {
    return undefined;
  }
  return ({ rejectedAction, reason }) => repair({ rejectedAction, reason, command });
}

function actionFromSimulationResult(result: ActionWithRepairResult): AtomicActionProposal {
  switch (result.status) {
    case 'accepted':
      return result.action;
    case 'repaired':
      return result.repairedAction;
    case 'needs-replan':
      throw new Error('cannot create a command draft from a failed reactive action');
  }
}

function actionFromAnySimulationResult(result: ActionWithRepairResult): AtomicActionProposal {
  switch (result.status) {
    case 'accepted':
      return result.action;
    case 'repaired':
      return result.repairedAction;
    case 'needs-replan':
      return result.attemptedRepair ?? result.action;
  }
}

function createCommandDraft(
  input: {
    readonly simulationId: SimulationId;
    readonly agentId: AgentId;
    readonly issuedAt: number;
  },
  action: AtomicActionProposal,
): CommandDraft {
  return {
    simulationId: input.simulationId,
    actorId: input.agentId,
    source: 'agent-runtime',
    type: action.commandType,
    payload: action.payload,
    issuedAt: input.issuedAt,
  };
}
