import { createHash } from 'node:crypto';
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
  type AgentMoveToPayload,
  type AgentBuildHousingPayload,
  type AgentGiveResourcePayload,
  type AgentDepositPayload,
  type AgentRequestLoanPayload,
  type AgentWithdrawPayload,
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
  SimulationWideAuthorityOperation,
  SimulationWideAuthorityService,
} from './simulationWideAuthority';
import { SimulationWideCommandRejectedError } from './simulationWideAuthority';
import type { AgentCognitiveSnapshot } from './agentCognitiveSnapshot';

/**
 * The command types the authority canonically owns. Trade and conversation are
 * settled against the global AMM / social graph because their meaning spans
 * partitions; movement is settled against the one simulation-wide spatial view
 * so capacity and route checks count every Agent in the town. Cross-owner
 * ownership flips additionally use the owner-transfer runtime handoff (world
 * state, owner-scoped cadence facts, cognition, and replay materialization).
 * Enterprise-affiliated Agents fail closed at that boundary until an atomic
 * cross-partition enterprise/payroll handoff exists.
 */
const GLOBAL_COMMAND_TYPES: ReadonlySet<CoreCommandType> = new Set<CoreCommandType>([
  'AgentTrade',
  'AgentDeposit',
  'AgentWithdraw',
  'AgentRequestLoan',
  'AgentStartConversation',
  'AgentGiveResource',
  'AgentMoveTo',
  'AgentBuildHousing',
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
  readonly syncPartitionState: (
    projection: WorldProjection,
    options?: { readonly publishClockBoundary?: boolean },
  ) => void;
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
   * Runtime-host optimization: local-only cycles may defer their full-state
   * sync to the host's guaranteed final materialization boundary. Direct
   * router users keep immediate synchronization by default.
   */
  readonly deferLocalStateSync?: boolean;
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
  // Start from the authority's seed/rehydrated ownership ledger, not an empty
  // process-local cache: population turnover can settle before this router's
  // first sync after startup. A missing resident is a true departure only
  // while the authority still assigns it to this partition; cross-owner moves
  // have already changed that owner and must merely disappear from this
  // router's local cache.
  let lastReportedAgentIds = new Set<string>(
    Object.entries(input.authority.getSnapshot().ownerPartitionKeyByAgentId)
      .filter(([, ownerPartitionKey]) => ownerPartitionKey === input.partitionKey)
      .map(([agentId]) => agentId),
  );
  const syncPartitionLocations = (
    projection: WorldProjection,
    options: { readonly publishClockBoundary?: boolean } = {},
  ): void => {
    const knownOwners = input.authority.getSnapshot().ownerPartitionKeyByAgentId;
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
      ...(projection.timeSettlementByAgent === undefined
        ? {}
        : { timeSettlementByAgent: projection.timeSettlementByAgent }),
      physiologicalDistressByAgent: projection.physiologicalDistressByAgent,
    };
    const enterpriseStates = Object.values(projection.enterprises)
      .filter(
        (enterprise) =>
          projection.agents[enterprise.ownerAgentId] !== undefined ||
          knownOwners[enterprise.ownerAgentId] === input.partitionKey,
      )
      .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId));
    const synchronizedState = JSON.stringify({
      publishClockBoundary: options.publishClockBoundary === true,
      ...(options.publishClockBoundary === true ? { partitionClockNow: projection.clock.now } : {}),
      agentStates,
      partitionAccounts,
      partitionRuntimeState,
      enterpriseStates,
    });
    const currentAgentIds = new Set<string>(agentLocations.map((entry) => entry.agentId as string));
    const departedAgentIds = [...lastReportedAgentIds]
      .filter(
        (agentId) => !currentAgentIds.has(agentId) && knownOwners[agentId] === input.partitionKey,
      )
      .sort();
    const newMemoryRecords = projection.memoryRecords
      .filter((record) => !syncedMemoryRecordIds.has(record.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      synchronizedState === lastSyncedPartitionStateFingerprint &&
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
    // A raw full-state JSON key made every authority state/journal row repeat
    // the complete Agent population in its object key. Hash the deterministic
    // content instead: the request fingerprint still verifies collisions and
    // the fixed-size operation id keeps long-running town state tractable.
    const contentDigest = createHash('sha256')
      .update(
        JSON.stringify({
          synchronizedState,
          memoryRecordIds: newMemoryRecords.map((record) => record.id),
          departedAgentIds,
        }),
      )
      .digest('hex');
    const newAgents = Object.values(projection.agents)
      .filter((agent) => knownOwners[agent.agentId] === undefined)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const lease = input.lease();
    input.authority.syncPartitionAgentLocations({
      operationId: `location-sync:${input.partitionKey}:sha256:${contentDigest}`,
      workerId: lease.workerId,
      observedAt: lease.observedAt,
      durationMs: lease.durationMs,
      partitionKey: input.partitionKey,
      ...(options.publishClockBoundary === true ? { partitionClockNow: projection.clock.now } : {}),
      agentLocations,
      agentStates,
      enterpriseStates,
      partitionAccounts,
      partitionRuntimeState,
      ...(newAgents.length === 0 ? {} : { newAgents }),
      ...(newMemoryRecords.length === 0 ? {} : { newMemoryRecords }),
      ...(departedAgentIds.length === 0 ? {} : { departedAgentIds }),
    });
    for (const record of newMemoryRecords) {
      syncedMemoryRecordIds.add(record.id);
    }
    lastSyncedPartitionStateFingerprint = synchronizedState;
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
    syncPartitionState: syncPartitionLocations,
    routeCommandDrafts: async (routeInput) => {
      const globalDrafts = routeInput.commandDrafts.filter((draft) =>
        GLOBAL_COMMAND_TYPES.has(draft.type),
      );
      if (globalDrafts.length === 0) {
        // Local-only Agent cycles do not need an authority write. The next
        // global cycle synchronizes the complete working projection first,
        // and the runtime's final materialization hook publishes the tick's
        // remaining local changes in one batch. Avoiding one full-state JSON
        // journal mutation per local Agent keeps large populations O(N)
        // instead of turning a tick into O(N²) serialization work.
        if (input.deferLocalStateSync !== true) {
          syncPartitionLocations(routeInput.projection);
        }
        return dispatchCommandDraftsToWorldEventStream(routeInput);
      }
      // Publish local truth before any authority cadence or global decision.
      // This includes every earlier local-only Agent in the same tick.
      syncPartitionLocations(routeInput.projection);
      syncAuthorityClock(routeInput.projection);
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
  const existingOperation = resolveExistingSettlementOperation({ authority, operationId, draft });
  if (existingOperation !== undefined) {
    return { draft, events: resequence(existingOperation.events, nextSequence) };
  }
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
    if (
      draft.type === 'AgentDeposit' ||
      draft.type === 'AgentWithdraw' ||
      draft.type === 'AgentRequestLoan'
    ) {
      const operation = authority.settleCredit({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        agentId: draft.actorId,
        commandType: draft.type,
        payload: draft.payload as
          | AgentDepositPayload
          | AgentWithdrawPayload
          | AgentRequestLoanPayload,
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
    if (draft.type === 'AgentGiveResource') {
      const operation = authority.settleResourceTransfer({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        sourceAgentId: draft.actorId,
        transfer: draft.payload as AgentGiveResourcePayload,
      });
      return { draft, events: resequence(operation.events, nextSequence) };
    }
    if (draft.type === 'AgentBuildHousing') {
      const operation = authority.settleConstruction({
        operationId,
        workerId: lease.workerId,
        observedAt: lease.observedAt,
        durationMs: lease.durationMs,
        builderAgentId: draft.actorId,
        housing: draft.payload as AgentBuildHousingPayload,
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

function resolveExistingSettlementOperation(input: {
  readonly authority: SimulationWideAuthorityService;
  readonly operationId: string;
  readonly draft: CommandDraft;
}): SimulationWideAuthorityOperation | undefined {
  const operations = input.authority.getSnapshot().operations;
  const operation =
    operations[input.operationId]?.operation ??
    operations[`${input.operationId}:rejection`]?.operation;
  if (operation === undefined) {
    return undefined;
  }
  if (operation.kind === 'command-rejected') {
    if (operation.commandType !== input.draft.type) {
      throw new Error(
        `authority rejection receipt ${operation.operationId} does not match ${input.draft.type}`,
      );
    }
    return operation;
  }
  const expectedKind = resolveSettlementOperationKind(input.draft.type);
  if (operation.kind !== expectedKind) {
    throw new Error(
      `authority receipt ${operation.operationId} has kind ${operation.kind}, expected ${expectedKind}`,
    );
  }
  return operation;
}

function resolveSettlementOperationKind(
  commandType: CommandDraft['type'],
): Exclude<
  SimulationWideAuthorityOperation['kind'],
  'command-rejected' | 'time-advanced' | 'inbox-materialized' | 'location-sync' | 'transfer'
> {
  switch (commandType) {
    case 'AgentTrade':
      return 'trade';
    case 'AgentDeposit':
    case 'AgentWithdraw':
    case 'AgentRequestLoan':
      return 'credit';
    case 'AgentStartConversation':
      return 'conversation';
    case 'AgentGiveResource':
      return 'resource-transfer';
    case 'AgentBuildHousing':
      return 'construction';
    case 'AgentPostBulletin':
      return 'bulletin';
    case 'AgentRaisePetition':
    case 'AgentSignPetition':
      return 'petition';
    case 'SetTaxPolicy':
    case 'SetPublicBudget':
    case 'SetSubsidyPolicy':
      return 'governance';
    case 'AgentRaiseMatter':
    case 'AgentRespondMatter':
    case 'AgentAssignMatter':
    case 'AgentCloseMatter':
      return 'matter';
    case 'AgentConfront':
    case 'AgentAttack':
    case 'AgentIntervene':
      return 'conflict';
    case 'AgentMoveTo':
      return 'move';
    default:
      throw new Error(`command ${commandType} has no simulation-wide settlement kind`);
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
