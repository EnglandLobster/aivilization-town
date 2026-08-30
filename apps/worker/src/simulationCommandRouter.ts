import type { CommandDraft } from '@aivilization/agent-runtime';
import {
  createCommandEnvelope,
  type AppendToEventStreamResult,
  type CommandEnvelope,
  type CoreCommandType,
  type EventStore,
  type EventStreamName,
  type PartitionKey,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type AgentMoveToPayload,
  type AgentPostBulletinPayload,
  type AgentStartConversationPayload,
  type AgentTradePayload,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  dispatchCommandDraftsToWorldEventStream,
  type DispatchCommandDraftsToEventStreamResult,
} from './commandDispatch';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';
import type {
  SimulationWideAuthorityLease,
  SimulationWideAuthorityService,
} from './simulationWideAuthority';
import { SimulationWideCommandRejectedError } from './simulationWideAuthority';
import type { AgentCognitiveSnapshot } from './agentCognitiveSnapshot';

/**
 * The command types the authority canonically owns. Trade and conversation are
 * settled against the global AMM / social graph because their meaning spans
 * partitions; movement is settled against the one simulation-wide spatial view
 * so capacity and route checks count every Agent in the town. Cross-owner
 * ownership flips additionally require the owner-transfer runtime handoff
 * (Agent storage migration and replay materialization); until that lands the
 * router settles moves as same-owner spatial changes.
 */
const GLOBAL_COMMAND_TYPES: ReadonlySet<CoreCommandType> = new Set<CoreCommandType>([
  'AgentTrade',
  'AgentStartConversation',
  'AgentMoveTo',
  // Bulletin posts are town-wide facts, so they settle against the one
  // authoritative board instead of a partition-local projection.
  'AgentPostBulletin',
  'AgentRaisePetition',
  'AgentSignPetition',
  // Social matters are likewise town-wide board state.
  'AgentRaiseMatter',
  'AgentRespondMatter',
  'AgentAssignMatter',
  'AgentCloseMatter',
  // Conflict commands settle against the one authoritative world state.
  'AgentConfront',
  'AgentAttack',
  'AgentIntervene',
  'SetTaxPolicy',
  'SetPublicBudget',
  'SetSubsidyPolicy',
]);

export type SimulationCommandRouter = {
  readonly routeCommandDrafts: (input: {
    readonly commandDrafts: readonly CommandDraft[];
    readonly projection: WorldProjection;
    readonly policies: WorldCommandPolicySource;
    readonly eventStore: EventStore<WorldEvent>;
    readonly streamName: EventStreamName;
    readonly appendIdempotencyKey: string;
    readonly commandIdPrefix: string;
    readonly expectedVersion?: number;
  }) => Promise<DispatchCommandDraftsToEventStreamResult>;
};

export function createSimulationCommandRouter(input: {
  readonly authority: SimulationWideAuthorityService;
  readonly lease: () => SimulationWideAuthorityLease;
  readonly partitionKey: PartitionKey;
  /**
   * Manifest-declared location affinity: which partition will own an Agent
   * standing at a location. Unaffiliated (or multiply-affiliated) locations
   * resolve to undefined and keep the mover's current owner.
   */
  readonly resolveLocationOwner?: (locationId: string) => PartitionKey | undefined;
  /**
   * Captures the moving Agent's durable cognitive state from this partition's
   * storage. Only invoked for moves whose affinity resolves to a different
   * owner partition.
   */
  readonly captureCognitiveSnapshot?: (input: {
    readonly agentId: string;
    readonly capturedAt: number;
  }) => Promise<AgentCognitiveSnapshot>;
}): SimulationCommandRouter {
  // Partition-local moves never settle through the authority, so its global
  // projection would otherwise keep bootstrap-era locations forever and
  // co-location checks would settle against stale facts. Before routing any
  // drafts we report this partition's current Agent locations; the fingerprint
  // skip keeps unchanged reports out of the authority journal entirely.
  // Runtime-registered Agents (participant registration settles
  // partition-locally in the command drain) are reported with their full
  // record so the authority admits them to the ledger before any global
  // settlement references them.
  let lastSyncedPartitionStateFingerprint: string | undefined;
  // Record ids already merged into the authority's memory cache: the delta
  // sent with each sync stays as small as the partition's own new memories,
  // and the authority skips known ids so replayed syncs stay idempotent.
  const syncedMemoryRecordIds = new Set<string>();
  // Agents this router has ever reported to the authority: a previously
  // reported resident missing from the current projection permanently left
  // the simulation (death or out-migration settled partition-locally), and
  // the authority must drop them from its ledger before any global
  // settlement references a ghost resident.
  let lastReportedAgentIds = new Set<string>();
  const syncPartitionLocations = (projection: WorldProjection): void => {
    const agentStates = Object.values(projection.agents).sort((left, right) =>
      left.agentId.localeCompare(right.agentId),
    );
    const agentLocations = agentStates
      .map((agent) => ({ agentId: agent.agentId, locationId: agent.locationId }))
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const partitionAccounts = {
      moneySupply: projection.moneySupply,
      ...(projection.treasury === undefined ? {} : { treasury: projection.treasury }),
      ...(projection.bank === undefined ? {} : { bank: projection.bank }),
    };
    const partitionRuntimeState = {
      activityTimeByAgent: projection.activityTimeByAgent,
      transitByAgent: projection.transitByAgent ?? {},
    };
    const fingerprint = JSON.stringify({ agentStates, partitionAccounts, partitionRuntimeState });
    const currentAgentIds = new Set<string>(agentLocations.map((entry) => entry.agentId as string));
    const departedAgentIds = [...lastReportedAgentIds]
      .filter((agentId) => !currentAgentIds.has(agentId))
      .sort();
    const newMemoryRecords = projection.memoryRecords
      .filter((record) => !syncedMemoryRecordIds.has(record.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      fingerprint === lastSyncedPartitionStateFingerprint &&
      newMemoryRecords.length === 0 &&
      departedAgentIds.length === 0
    ) {
      return;
    }
    lastReportedAgentIds = currentAgentIds;
    // The memory delta joins the operation id: without it, a memory-only
    // change (locations unchanged) would reuse the previous id and the
    // authority would replay the journaled no-memory operation instead of
    // merging the new records. Idempotent for identical re-issued deltas.
    const memoryMarker =
      newMemoryRecords.length === 0
        ? 'mem-none'
        : `mem-${newMemoryRecords.length}-${newMemoryRecords[newMemoryRecords.length - 1]?.id}`;
    const knownOwners = input.authority.getSnapshot().ownerPartitionKeyByAgentId;
    const newAgents = Object.values(projection.agents)
      .filter((agent) => knownOwners[agent.agentId] === undefined)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const lease = input.lease();
    input.authority.syncPartitionAgentLocations({
      operationId: `location-sync:${input.partitionKey}:${fingerprint}:${memoryMarker}`,
      workerId: lease.workerId,
      observedAt: lease.observedAt,
      durationMs: lease.durationMs,
      partitionKey: input.partitionKey,
      agentLocations,
      agentStates,
      partitionAccounts,
      partitionRuntimeState,
      ...(newAgents.length === 0 ? {} : { newAgents }),
      ...(newMemoryRecords.length === 0 ? {} : { newMemoryRecords }),
    });
    for (const record of newMemoryRecords) {
      syncedMemoryRecordIds.add(record.id);
    }
    lastSyncedPartitionStateFingerprint = fingerprint;
  };
  // The tick advances the partition clock before drafting agent commands, while
  // the pre-tick materializer only catches the authority up to the pre-tick
  // clock — so at settle time the authority lags one tick behind. Global
  // settlements embed the authority clock (e.g. AgentActivityTimeCommitted
  // startedAt from a move), and applying those events onto the partition
  // working projection fails its clock invariants when the two diverge. Catch
  // the authority up to this partition's current clock before settling; the
  // target-keyed operationId makes repeat calls (other partitions, recovery
  // replays) no-op replays, and the advance also settles due weather cadence
  // transitions and in-transit travel completions on the way.
  const syncAuthorityClock = (projection: WorldProjection): void => {
    const authorityClockNow = input.authority.getSnapshot().projection.clock.now;
    if (authorityClockNow >= projection.clock.now) {
      return;
    }
    const lease = input.lease();
    input.authority.advanceTime({
      operationId: `advance-time-to:${projection.clock.now}`,
      workerId: lease.workerId,
      observedAt: lease.observedAt,
      durationMs: lease.durationMs,
      deltaMs: projection.clock.now - authorityClockNow,
    });
  };
  return {
    routeCommandDrafts: async (routeInput) => {
      const globalDrafts = routeInput.commandDrafts.filter((draft) =>
        GLOBAL_COMMAND_TYPES.has(draft.type),
      );
      if (globalDrafts.length === 0) {
        syncPartitionLocations(routeInput.projection);
        return dispatchCommandDraftsToWorldEventStream(routeInput);
      }
      // Advancing the global clock can run town cadence reducers against the
      // authority's partial Agent copy. Refresh owner state afterwards so the
      // global decision always sees the partition's current durable truth.
      syncAuthorityClock(routeInput.projection);
      syncPartitionLocations(routeInput.projection);
      return routeMixedDrafts({
        routeInput,
        authority: input.authority,
        lease: input.lease(),
        syncPartitionState: syncPartitionLocations,
        ...(input.resolveLocationOwner === undefined
          ? {}
          : { resolveLocationOwner: input.resolveLocationOwner }),
        ...(input.captureCognitiveSnapshot === undefined
          ? {}
          : { captureCognitiveSnapshot: input.captureCognitiveSnapshot }),
      });
    },
  };
}

type RoutedSettlement = {
  readonly draft: CommandDraft;
  readonly events: readonly WorldEvent[];
};

async function routeMixedDrafts(input: {
  readonly routeInput: Parameters<SimulationCommandRouter['routeCommandDrafts']>[0];
  readonly authority: SimulationWideAuthorityService;
  readonly lease: SimulationWideAuthorityLease;
  readonly syncPartitionState: (projection: WorldProjection) => void;
  readonly resolveLocationOwner?: (locationId: string) => PartitionKey | undefined;
  readonly captureCognitiveSnapshot?: (input: {
    readonly agentId: string;
    readonly capturedAt: number;
  }) => Promise<AgentCognitiveSnapshot>;
}): Promise<DispatchCommandDraftsToEventStreamResult> {
  const { routeInput, authority, lease } = input;
  const expectedVersion =
    routeInput.expectedVersion ?? routeInput.eventStore.getStreamVersion(routeInput.streamName);

  // Phase 1: append partition-local drafts first. Authority events are delivered
  // by the materializer only after this append, so decision order must match the
  // durable replay order: local events, then global events. Applying global
  // events to the working projection before deciding local drafts would let a
  // local action spend a tax receipt or inventory change that does not yet exist
  // in the partition stream.
  const localDrafts = routeInput.commandDrafts.filter(
    (draft) => !GLOBAL_COMMAND_TYPES.has(draft.type),
  );
  let localAppend: DispatchCommandDraftsToEventStreamResult | undefined;
  let workingProjection = routeInput.projection;
  if (localDrafts.length > 0) {
    localAppend = dispatchCommandDraftsToWorldEventStream({
      commandDrafts: localDrafts,
      projection: workingProjection,
      policies: routeInput.policies,
      eventStore: routeInput.eventStore,
      streamName: routeInput.streamName,
      appendIdempotencyKey: `${routeInput.appendIdempotencyKey}:local`,
      commandIdPrefix: `${routeInput.commandIdPrefix}-local`,
      expectedVersion,
    });
    workingProjection = localAppend.projection;
    input.syncPartitionState(workingProjection);
  }

  // Phase 2: settle global drafts against the authority and apply their facts
  // after the local append in the in-tick working projection. The materializer
  // persists them in this same order.
  const settlements: RoutedSettlement[] = [];
  const persistedVersion = localAppend?.appendResult.streamVersion ?? expectedVersion;
  let nextSequence = persistedVersion + 1;
  let globalDraftIndex = 0;
  for (const draft of routeInput.commandDrafts) {
    if (!GLOBAL_COMMAND_TYPES.has(draft.type)) {
      continue;
    }
    globalDraftIndex += 1;
    const settlement = await settleGlobalDraft({
      draft,
      authority,
      lease,
      // The ordinal is part of the durable authority operation identity: one
      // synthesized batch may legitimately contain two commands of the same
      // type by the same actor at the same simulation instant.
      commandIdPrefix: `${routeInput.commandIdPrefix}-global-${globalDraftIndex}`,
      nextSequence,
      ...(input.resolveLocationOwner === undefined
        ? {}
        : { resolveLocationOwner: input.resolveLocationOwner }),
      ...(input.captureCognitiveSnapshot === undefined
        ? {}
        : { captureCognitiveSnapshot: input.captureCognitiveSnapshot }),
    });
    settlements.push(settlement);
    if (settlement.events.length > 0) {
      workingProjection = settlement.events.reduce(applyWorldEvent, workingProjection);
      nextSequence += settlement.events.length;
    }
  }

  const globalCommands = settlements.map((settlement, index) =>
    createCommandEnvelope({
      id: `${routeInput.commandIdPrefix}-global-${index + 1}`,
      simulationId: settlement.draft.simulationId,
      actorId: settlement.draft.actorId,
      source: settlement.draft.source,
      type: settlement.draft.type,
      payload: settlement.draft.payload,
      issuedAt: settlement.draft.issuedAt,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  );
  const globalEvents = settlements.flatMap((settlement) => settlement.events);

  const commands: CommandEnvelope<CoreCommandType, unknown>[] = [
    ...(localAppend?.commands ?? []),
    ...globalCommands,
  ];
  const events: WorldEvent[] = [...(localAppend?.events ?? []), ...globalEvents];

  const streamVersion = persistedVersion;
  const syntheticAppendResult: AppendToEventStreamResult<WorldEvent> = {
    appendedEvents: events,
    streamVersion,
    idempotentReplay: false,
  };

  return {
    commands,
    events,
    projection: workingProjection,
    appendResult: syntheticAppendResult,
    // Authority-settled events live only in this projection until the
    // materializer delivers them into the partition stream.
    ...(globalEvents.length > 0 ? { hasUnstreamedAuthorityEvents: true as const } : {}),
  };
}

async function settleGlobalDraft(input: {
  readonly draft: CommandDraft;
  readonly authority: SimulationWideAuthorityService;
  readonly lease: SimulationWideAuthorityLease;
  readonly commandIdPrefix: string;
  readonly nextSequence: number;
  readonly resolveLocationOwner?: (locationId: string) => PartitionKey | undefined;
  readonly captureCognitiveSnapshot?: (input: {
    readonly agentId: string;
    readonly capturedAt: number;
  }) => Promise<AgentCognitiveSnapshot>;
}): Promise<RoutedSettlement> {
  const { draft, authority, lease, commandIdPrefix, nextSequence } = input;
  const operationId = `${commandIdPrefix}:${draft.type}:${draft.actorId}:${draft.issuedAt}`;
  try {
    if (draft.type === 'AgentTrade') {
      const operation = authority.settleTrade({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        trade: draft.payload as AgentTradePayload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (draft.type === 'AgentStartConversation') {
      const payload = draft.payload as AgentStartConversationPayload;
      const operation = authority.settleConversation({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        initiatorAgentId: draft.actorId,
        targetAgentId: payload.targetAgentId,
        topic: payload.topic,
        turns: payload.turns,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (draft.type === 'AgentRaisePetition' || draft.type === 'AgentSignPetition') {
      const operation = authority.settlePetition({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        commandType: draft.type,
        payload: draft.payload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (
      draft.type === 'SetTaxPolicy' ||
      draft.type === 'SetPublicBudget' ||
      draft.type === 'SetSubsidyPolicy'
    ) {
      const operation = authority.settleGovernance({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        actorAgentId: draft.actorId,
        commandType: draft.type,
        payload: draft.payload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (draft.type === 'AgentPostBulletin') {
      const operation = authority.settleBulletin({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        authorAgentId: draft.actorId,
        bulletin: draft.payload as AgentPostBulletinPayload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (
      draft.type === 'AgentRaiseMatter' ||
      draft.type === 'AgentRespondMatter' ||
      draft.type === 'AgentAssignMatter' ||
      draft.type === 'AgentCloseMatter'
    ) {
      const operation = authority.settleMatter({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        commandType: draft.type,
        payload: draft.payload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (
      draft.type === 'AgentConfront' ||
      draft.type === 'AgentAttack' ||
      draft.type === 'AgentIntervene'
    ) {
      const operation = authority.settleConflict({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        commandType: draft.type,
        payload: draft.payload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (draft.type === 'AgentMoveTo') {
      const payload = draft.payload as AgentMoveToPayload;
      // Destination ownership comes from manifest-declared location affinity;
      // anything unaffiliated keeps the mover's current owner.
      const currentOwner = authority.getSnapshot().ownerPartitionKeyByAgentId[draft.actorId];
      const affinityOwner = input.resolveLocationOwner?.(payload.targetLocationId);
      const destinationPartitionKey =
        affinityOwner === undefined || affinityOwner === currentOwner ? undefined : affinityOwner;
      const cognitiveSnapshot =
        destinationPartitionKey === undefined || input.captureCognitiveSnapshot === undefined
          ? undefined
          : await input.captureCognitiveSnapshot({
              agentId: draft.actorId,
              capturedAt: lease.observedAt,
            });
      const operation = authority.settleMove({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        targetLocationId: payload.targetLocationId,
        ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        ...(destinationPartitionKey === undefined ? {} : { destinationPartitionKey }),
        ...(cognitiveSnapshot === undefined ? {} : { cognitiveSnapshot }),
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    // Unreachable: callers filter to GLOBAL_COMMAND_TYPES before settling. If a
    // future command type joins that set without a branch here, fail loudly.
    throw new Error(`simulation command router has no settlement branch for ${draft.type}`);
  } catch (error) {
    if (!(error instanceof SimulationWideCommandRejectedError)) {
      throw error;
    }
    const ownerPartitionKey = authority.getSnapshot().ownerPartitionKeyByAgentId[draft.actorId];
    if (ownerPartitionKey === undefined) {
      throw new Error(`cannot record rejection for unowned Agent ${draft.actorId}`);
    }
    // Rejections are authority decisions too. Journal and inbox-deliver the
    // exact domain events so a rejection after an accepted global command is
    // replayed in fencing-token order instead of being appended ahead of the
    // still-unmaterialized accepted event.
    const operation = authority.recordRejectedCommand({
      operationId: `${operationId}:rejection`,
      workerId: lease.workerId,
      observedAt: lease.observedAt,
      durationMs: lease.durationMs,
      partitionKey: ownerPartitionKey,
      commandType: draft.type,
      reason: error.reason,
      events: error.events,
    });
    return { draft, events: resequence(operation.events, nextSequence) };
  }
}

function resequence(
  events: readonly WorldEvent[],
  startingSequence: number,
): readonly WorldEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: startingSequence + index,
  }));
}
