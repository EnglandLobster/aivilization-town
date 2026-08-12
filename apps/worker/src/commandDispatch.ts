import type { CommandDraft } from '@aivilization/agent-runtime';
import {
  createCommandEnvelope,
  type AppendToEventStreamResult,
  type CommandEnvelope,
  type CoreCommandType,
  type EventStore,
  type EventStreamName,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';

export type DispatchCommandDraftsResult = {
  readonly commands: readonly CommandEnvelope<CoreCommandType, unknown>[];
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
};

export type DispatchCommandDraftsToEventStreamResult = DispatchCommandDraftsResult & {
  readonly appendResult: AppendToEventStreamResult<WorldEvent>;
  /**
   * Set by the simulation command router when authority-settled events were
   * applied to the returned projection WITHOUT a partition stream append —
   * they reach the stream later through the materializer inbox delivery. A
   * projection carrying such events must not be checkpointed against the
   * current stream version: hydration would replay the delivered events onto
   * a snapshot that already contains them.
   */
  readonly hasUnstreamedAuthorityEvents?: true;
};

export type DispatchWorldCommandToEventStreamResult = {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly appendResult: AppendToEventStreamResult<WorldEvent>;
};

export function createCommandEnvelopeFromDraft(input: {
  readonly draft: CommandDraft;
  readonly commandId: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
}): CommandEnvelope<CoreCommandType, unknown> {
  return createCommandEnvelope({
    id: input.commandId,
    simulationId: input.draft.simulationId,
    idempotencyKey: input.idempotencyKey ?? input.commandId,
    actorId: input.draft.actorId,
    source: input.draft.source,
    type: input.draft.type,
    payload: input.draft.payload,
    issuedAt: input.draft.issuedAt,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  });
}

export function dispatchCommandDraftsToWorld(input: {
  readonly commandDrafts: readonly CommandDraft[];
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly startingSequence: number;
  readonly commandIdPrefix: string;
  readonly expectedVersion?: number;
}): DispatchCommandDraftsResult {
  assertPositiveInteger(input.startingSequence, 'startingSequence');
  assertNonEmpty(input.commandIdPrefix, 'commandIdPrefix');

  let nextSequence = input.startingSequence;
  let projection = input.projection;
  const commands: CommandEnvelope<CoreCommandType, unknown>[] = [];
  const events: WorldEvent[] = [];

  input.commandDrafts.forEach((draft, index) => {
    const command = createCommandEnvelopeFromDraft({
      draft,
      commandId: `${input.commandIdPrefix}-${index + 1}`,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });
    const policies = resolveWorldCommandPolicies({
      policies: input.policies,
      projection,
    });
    const commandEvents = dispatchWorldCommand({
      command,
      projection,
      policies,
      nextSequence,
    });

    commands.push(command);
    events.push(...commandEvents);
    projection = commandEvents.reduce(applyWorldEvent, projection);
    nextSequence += commandEvents.length;
  });

  return { commands, events, projection };
}

export function dispatchCommandDraftsToWorldEventStream(input: {
  readonly commandDrafts: readonly CommandDraft[];
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly appendIdempotencyKey: string;
  readonly commandIdPrefix: string;
  readonly expectedVersion?: number;
}): DispatchCommandDraftsToEventStreamResult {
  assertNonEmpty(input.appendIdempotencyKey, 'appendIdempotencyKey');

  const expectedVersion =
    input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
  const dispatched = dispatchCommandDraftsToWorld({
    commandDrafts: input.commandDrafts,
    projection: input.projection,
    policies: input.policies,
    startingSequence: expectedVersion + 1,
    commandIdPrefix: input.commandIdPrefix,
    expectedVersion,
  });
  const appendResult = input.eventStore.appendToStream({
    streamName: input.streamName,
    expectedVersion,
    idempotencyKey: input.appendIdempotencyKey,
    events: dispatched.events,
  });
  const projection = appendResult.appendedEvents.reduce(applyWorldEvent, input.projection);

  return {
    commands: dispatched.commands,
    events: appendResult.appendedEvents,
    projection,
    appendResult,
  };
}

export function dispatchWorldCommandToEventStream(input: {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly appendIdempotencyKey: string;
  readonly expectedVersion?: number;
}): DispatchWorldCommandToEventStreamResult {
  assertNonEmpty(input.appendIdempotencyKey, 'appendIdempotencyKey');

  const expectedVersion =
    input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
  const policies = resolveWorldCommandPolicies({
    policies: input.policies,
    projection: input.projection,
  });
  const events = dispatchWorldCommand({
    command: input.command,
    projection: input.projection,
    policies,
    nextSequence: expectedVersion + 1,
  });
  const appendResult = input.eventStore.appendToStream({
    streamName: input.streamName,
    expectedVersion,
    idempotencyKey: input.appendIdempotencyKey,
    events,
  });
  const projection = appendResult.appendedEvents.reduce(applyWorldEvent, input.projection);

  return {
    command: input.command,
    events: appendResult.appendedEvents,
    projection,
    appendResult,
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
