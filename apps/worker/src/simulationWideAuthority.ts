import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
  type AgentId,
  type HumanCommandAttribution,
  type PartitionKey,
  type SimulationId,
} from '@aivilization/sim-core';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT,
  type AgentStartConversationTurnPayload,
  type AgentTradePayload,
  type AgentPostBulletinPayload,
  type TownWeatherPolicy,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import type { AgentCognitiveSnapshot } from './agentCognitiveSnapshot';

/**
 * A file-backed, simulation-wide authority used when one society is executed
 * by several partition workers.  It deliberately owns only facts whose
 * meaning is global (Agent ownership, locations, relations, and the AMM), so
 * a partition can never manufacture an incompatible second market.
 *
 * The backing directory must be on a filesystem shared by every coordinator.
 * A short-lived directory lease fences concurrent writers; a durable operation
 * table makes retries idempotent and lets a later writer finish a crash that
 * occurred after state publication but before the audit journal was completed.
 */
export const SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION = 'simulation-wide-authority-v1';

export type SimulationWideAuthorityAgentOwner = {
  readonly agentId: AgentId;
  readonly partitionKey: PartitionKey;
};

export type SimulationWideAuthoritySeed = {
  readonly manifestId: string;
  readonly simulationId: SimulationId | string;
  readonly projection: WorldProjection;
  readonly owners: readonly SimulationWideAuthorityAgentOwner[];
  readonly partitionKeys: readonly PartitionKey[];
};

export type SimulationWideAuthorityLease = {
  readonly workerId: string;
  readonly observedAt: number;
  readonly durationMs: number;
};

export type SimulationWideTradeRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly trade: AgentTradePayload;
};

export type SimulationWideConversationRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly initiatorAgentId: string;
  readonly targetAgentId: string;
  readonly topic: string;
  readonly turns: readonly AgentStartConversationTurnPayload[];
};

export type SimulationWideTransferRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly destinationPartitionKey: PartitionKey;
  readonly destinationLocationId: string;
  readonly reason: string;
};

export type SimulationWideMoveRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly targetLocationId: string;
  readonly reason?: string;
  /**
   * The partition that will own the Agent after the move commits. Resolved
   * from manifest-declared location affinity; omitted (or equal to the current
   * owner) keeps the move a same-owner spatial change.
   */
  readonly destinationPartitionKey?: PartitionKey;
  /**
   * Required exactly when the move crosses owners: the durable cognitive state
   * captured by the source partition. The authority holds it until the
   * destination partition hydrates it on arrival.
   */
  readonly cognitiveSnapshot?: AgentCognitiveSnapshot;
};

export type SimulationWideLocationSyncRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly partitionKey: PartitionKey;
  readonly agentLocations: readonly {
    readonly agentId: string;
    readonly locationId: string | null;
  }[];
  /**
   * Full records for Agents the authority has never seen (runtime participant
   * registration settles partition-locally first). The reporting partition
   * becomes their owner; from then on they settle like seed Agents. Kept out
   * of the request fingerprint so a crash/replay between the journaled sync
   * and the tick boundary re-issues an identical idempotent request.
   */
  readonly newAgents?: readonly WorldAgentState[];
  /**
   * Recent short-term memory records accumulated in the reporting partition,
   * merged into the authority projection's bounded memory cache by record id
   * (idempotent replays skip known ids). Kept out of the fingerprint for the
   * same crash-replay reason as newAgents. This is what keeps authority-settled
   * conversations (and their hearsay propagation) supplied with the speakers'
   * current memories instead of a stale or empty candidate set.
   */
  readonly newMemoryRecords?: readonly ShortTermMemoryRecord[];
};

/**
 * A bulletin posting settled against the single authoritative town board.
 * Agent posts carry `authorAgentId`; operator-issued town bulletins carry the
 * steering command's `humanAttribution` (the world handler enforces the
 * operator role). Exactly one of the two must be present.
 */
export type SimulationWideBulletinRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly bulletin: AgentPostBulletinPayload;
  readonly authorAgentId?: AgentId;
  readonly humanAttribution?: HumanCommandAttribution;
};

/**
 * A conflict command (confront/attack/intervene) settled against the
 * authoritative world state. Conflict facts are town-wide, so every partition
 * materializes the operation's events.
 */
export type SimulationWideConflictRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: AgentId;
  readonly commandType: 'AgentConfront' | 'AgentAttack' | 'AgentIntervene';
  readonly payload: unknown;
};

/** A social-matter lifecycle command settled against the authoritative board. */
export type SimulationWideMatterRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: AgentId;
  readonly commandType:
    | 'AgentRaiseMatter'
    | 'AgentRespondMatter'
    | 'AgentAssignMatter'
    | 'AgentCloseMatter';
  readonly payload: unknown;
};

export type SimulationWideAuthorityOperation =
  | {
      readonly kind: 'trade';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      readonly kind: 'conversation';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly sourcePartitionKey: PartitionKey;
      readonly targetPartitionKey: PartitionKey;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      readonly kind: 'transfer';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly sourcePartitionKey: PartitionKey;
      readonly destinationPartitionKey: PartitionKey;
      readonly agentId: AgentId;
      readonly status: 'in-transit' | 'completed';
      readonly events: readonly WorldEvent[];
    }
  | {
      /**
       * A canonical move settled against the ONE simulation-wide spatial view,
       * so capacity and route checks count every Agent in the town regardless
       * of partition ownership. While travel is in flight the operation stays
       * pending and completes on the next time advance; the arrival events are
       * delivered to the owning partition then.
       */
      readonly kind: 'move';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
      readonly destinationPartitionKey: PartitionKey;
      readonly agentId: AgentId;
      readonly status: 'in-transit' | 'completed';
      readonly events: readonly WorldEvent[];
      /**
       * Cross-owner moves deliver partition-specific event sets: the source
       * consumes its departure set, the destination its arrival set (empty
       * until travel commits). Same-owner moves leave both absent and deliver
       * `events` to the owner as before.
       */
      readonly departureEvents?: readonly WorldEvent[];
      readonly arrivalEvents?: readonly WorldEvent[];
      readonly cognitiveSnapshot?: AgentCognitiveSnapshot;
    }
  | {
      readonly kind: 'time-advanced';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly status: 'completed';
      readonly events: readonly WorldEvent[];
      readonly completedTransfers: readonly {
        readonly operationId: string;
        readonly agentId: AgentId;
        readonly sourcePartitionKey: PartitionKey;
        readonly destinationPartitionKey: PartitionKey;
      }[];
      readonly completedMoves: readonly {
        readonly operationId: string;
        readonly agentId: AgentId;
        readonly ownerPartitionKey: PartitionKey;
        readonly destinationPartitionKey: PartitionKey;
        readonly departureEvents: readonly WorldEvent[];
        readonly arrivalEvents: readonly WorldEvent[];
        readonly cognitiveSnapshot?: AgentCognitiveSnapshot;
      }[];
    }
  | {
      /**
       * An owner partition reporting the current locations of its own Agents.
       * Partition-local moves never flow through settlement, so without this
       * report the authority projection's locations would go stale and global
       * co-location checks (conversation, regional trade) would settle against
       * outdated facts. The sync produces no world events and no inbox
       * deliveries: it is projection upkeep, kept in the ledger for audit.
       */
      readonly kind: 'location-sync';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly partitionKey: PartitionKey;
      readonly updatedAgentIds: readonly AgentId[];
      /**
       * Runtime-registered Agents admitted to the ledger by this sync (their
       * first report carries their full record). Absent when the sync only
       * refreshed locations of already-known Agents.
       */
      readonly registeredAgentIds?: readonly AgentId[];
      /**
       * Memory record ids merged into the authority's bounded cache by this
       * sync (the partition-side delta of short-term memories). Absent when
       * the sync carried no new records.
       */
      readonly mergedMemoryRecordIds?: readonly string[];
      readonly status: 'completed';
      readonly events: readonly [];
    }
  | {
      /**
       * A durable acknowledgement that one partition materialized all of its
       * inbox deliveries through a fencing token. Keeping this in the same
       * ledger as the authoritative operation makes a replayed worker prove
       * which global boundary it has actually consumed.
       */
      readonly kind: 'inbox-materialized';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly partitionKey: PartitionKey;
      readonly consumerId: string;
      readonly throughFencingToken: number;
      readonly status: 'completed';
      readonly events: readonly [];
    }
  | {
      /**
       * A town-bulletin posting (agent post or operator-issued town bulletin)
       * settled against the single authoritative board. Emits BulletinPosted
       * (immediate) or BulletinScheduled (future effectiveAt); scheduled
       * bulletins activate during a later advanceTime.
       */
      readonly kind: 'bulletin';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly bulletinId: string;
      readonly status: 'posted' | 'scheduled';
      readonly events: readonly WorldEvent[];
    }
  | {
      /**
       * A social-matter lifecycle command (raise/respond/assign/close) settled
       * against the single authoritative board. Matters are town-wide facts,
       * so every partition materializes the operation's events.
       */
      readonly kind: 'matter';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly matterId: string;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /**
       * A conflict command (confront/attack/intervene) settled against the one
       * authoritative world state, with world-adjudicated grievance, damage,
       * and witness fallout.
       */
      readonly kind: 'conflict';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly conflictId: string;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    };

export type SimulationWideAuthorityInboxDelivery = {
  readonly operationId: string;
  readonly fencingToken: number;
  readonly partitionKey: PartitionKey;
  readonly operationKind: Exclude<
    SimulationWideAuthorityOperation['kind'],
    'inbox-materialized' | 'location-sync'
  >;
  readonly events: readonly WorldEvent[];
  /** Present only on arrival deliveries addressed to a transfer destination. */
  readonly cognitiveSnapshot?: AgentCognitiveSnapshot;
};

export type SimulationWideAuthorityInboxCursor = {
  readonly partitionKey: PartitionKey;
  readonly consumerId: string;
  readonly throughFencingToken: number;
  readonly materializedAt: number;
};

export type SimulationWideAuthoritySnapshot = {
  readonly schemaVersion: typeof SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION;
  readonly authorityId: string;
  readonly manifestId: string;
  readonly simulationId: SimulationId;
  readonly revision: number;
  readonly latestFencingToken: number;
  readonly projection: WorldProjection;
  readonly ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>;
  readonly partitionKeys: readonly PartitionKey[];
  readonly pendingTransfers: Readonly<
    Record<
      string,
      {
        readonly operationId: string;
        readonly sourcePartitionKey: PartitionKey;
        readonly destinationPartitionKey: PartitionKey;
        readonly destinationLocationId: string;
      }
    >
  >;
  readonly pendingMoves?: Readonly<
    Record<
      string,
      {
        readonly operationId: string;
        readonly ownerPartitionKey: PartitionKey;
        readonly destinationPartitionKey: PartitionKey;
        readonly cognitiveSnapshot?: AgentCognitiveSnapshot;
      }
    >
  >;
  readonly materializerCursors: Readonly<Record<string, SimulationWideAuthorityInboxCursor>>;
  readonly operations: Readonly<
    Record<
      string,
      {
        readonly requestFingerprint: string;
        readonly operation: SimulationWideAuthorityOperation;
      }
    >
  >;
};

export type SimulationWideAuthorityService = {
  readonly getSnapshot: () => SimulationWideAuthoritySnapshot;
  readonly settleTrade: (
    request: SimulationWideTradeRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'trade' };
  readonly settleConversation: (
    request: SimulationWideConversationRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'conversation' };
  readonly settleBulletin: (
    request: SimulationWideBulletinRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'bulletin' };
  readonly settleMatter: (
    request: SimulationWideMatterRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'matter' };
  readonly settleConflict: (
    request: SimulationWideConflictRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'conflict' };
  readonly transferAgent: (
    request: SimulationWideTransferRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'transfer' };
  readonly settleMove: (
    request: SimulationWideMoveRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'move' };
  readonly syncPartitionAgentLocations: (
    request: SimulationWideLocationSyncRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'location-sync' };
  readonly advanceTime: (
    input: SimulationWideAuthorityLease & {
      readonly operationId: string;
      readonly deltaMs: number;
    },
  ) => readonly SimulationWideAuthorityOperation[];
  /**
   * Read the per-partition inbox without moving its cursor. Consumers must
   * explicitly acknowledge a contiguous prefix after their local projection
   * and durable checkpoint have been written.
   */
  readonly readInbox: (input: {
    readonly partitionKey: PartitionKey;
    readonly consumerId: string;
    readonly limit?: number;
  }) => {
    readonly cursor: SimulationWideAuthorityInboxCursor | undefined;
    readonly deliveries: readonly SimulationWideAuthorityInboxDelivery[];
  };
  readonly acknowledgeInbox: (
    input: SimulationWideAuthorityLease & {
      readonly operationId: string;
      readonly partitionKey: PartitionKey;
      readonly consumerId: string;
      readonly throughFencingToken: number;
    },
  ) => Extract<SimulationWideAuthorityOperation, { readonly kind: 'inbox-materialized' }>;
  readonly recover: (lease: SimulationWideAuthorityLease) => readonly string[];
};

type AuthorityJournalRecordBody =
  | {
      readonly schemaVersion: typeof SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION;
      readonly recordType: 'intent';
      readonly operationId: string;
      readonly requestFingerprint: string;
      readonly fencingToken: number;
      readonly recordedAt: number;
    }
  | {
      readonly schemaVersion: typeof SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION;
      readonly recordType: 'completed';
      readonly operationId: string;
      readonly revision: number;
      readonly recordedAt: number;
    };

/**
 * Every journal record carries a hash chain anchored at a fixed genesis hash:
 * a record's chainHash is the SHA-256 of the previous record's chainHash and
 * the record's canonical body. Any truncation, rewrite, or insertion into the
 * audit journal breaks the chain from that point on, and authority bootstrap
 * verifies the chain fail-closed before accepting further operations.
 */
export const SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH = sha256Hex(
  `${SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION}:journal-genesis`,
);

type AuthorityJournalRecord = AuthorityJournalRecordBody & {
  readonly chainHash: string;
};

/**
 * A parsed journal row. `chainHash` stays optional at the parse boundary so a
 * pre-chain legacy journal is readable and fails VERIFICATION (not parsing).
 */
type ParsedAuthorityJournalRecord = AuthorityJournalRecordBody & {
  readonly chainHash?: string;
};

type MutationResult<TOperation extends SimulationWideAuthorityOperation> = {
  readonly state: SimulationWideAuthoritySnapshot;
  readonly operation: TOperation;
};

export function createSimulationWideAuthority(input: {
  readonly rootDir: string;
  readonly seed: SimulationWideAuthoritySeed;
  readonly policies: WorldCommandPolicySource;
  /**
   * When true, the authority settles trades against per-region AMM pools and the
   * AgentTrade handler enforces regional co-location. The flag is injected into
   * the world command policies used for every global dispatch so trade/conversation
   * settlement honors regional markets without touching every caller.
   */
  readonly regionalMarketsEnabled?: boolean;
  /**
   * Opt-in town-weather policy. When
   * present, the authority's AdvanceSimulationTime settlement evaluates the
   * Markov transition matrix once per cadence and emits WeatherChanged events
   * against the single simulation-wide projection. Omitted keeps settlement
   * free of any weather state or events.
   */
  readonly townWeather?: TownWeatherPolicy;
}): SimulationWideAuthorityService {
  const directory = authorityDirectory(input.rootDir, input.seed.simulationId);
  const statePath = join(directory, 'state.json');
  const journalPath = join(directory, 'operations.jsonl');
  const lockDirectory = join(directory, '.writer-lease');
  const expectedInitialSnapshot = createInitialSnapshot(input.seed);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(statePath)) {
    writeAtomically(statePath, `${JSON.stringify(expectedInitialSnapshot, null, 2)}\n`);
  }
  const persistedSnapshot = readSnapshot(statePath);
  if (persistedSnapshot.authorityId !== expectedInitialSnapshot.authorityId) {
    throw new Error(
      `simulation-wide authority seed does not match existing authority for ${input.seed.simulationId}`,
    );
  }

  // The audit journal is a hash chain. Before the first append this instance
  // makes, the existing chain is verified fail-closed: a tampered or truncated
  // history refuses further settlement instead of silently extending a broken
  // chain.
  let journalChainHash: string | undefined;
  const appendChainedJournal = (record: AuthorityJournalRecordBody): void => {
    if (journalChainHash === undefined) {
      const verification = verifyJournalChainRecords(readJournal(journalPath));
      if (!verification.valid) {
        throw new Error(
          `simulation-wide authority journal chain is broken at record ${verification.firstBrokenRecordIndex}`,
        );
      }
      journalChainHash = verification.latestChainHash;
    }
    const chainHash = computeJournalChainHash(journalChainHash, record);
    appendFileSync(journalPath, `${JSON.stringify({ ...record, chainHash })}\n`);
    journalChainHash = chainHash;
  };

  // Resolve the world command policies for a given projection, threading the
  // regional-markets flag through so the AgentTrade handler gates trades on
  // regional co-location when regional markets are enabled.
  //
  // Lifecycle is STRIPPED here on purpose: the authority's per-agent
  // physiology/balances are a partial view (per-agent settlement events are
  // not redelivered to it), and illness-death rolls embed the command id of
  // whichever side settles — if the authority also ran the lifecycle block,
  // it and the owner partition would derive TWO sets of life/death facts and
  // later global settlements/transfers would reference divergent truths.
  // Life-and-death authority stays with the owner partition streams; the
  // authority's copy simply does not age (wellbeing/calculator-style scalar
  // drift on its copy is benign and unsettled there).
  const resolvePolicies = (projection: WorldProjection): WorldCommandPolicies => {
    const { lifecycle: strippedLifecycle, ...commandPolicies } = resolveWorldCommandPolicies({
      policies: input.policies,
      projection,
    });
    void strippedLifecycle;
    return {
      ...commandPolicies,
      ...(input.regionalMarketsEnabled === true ? { regionalMarkets: { enabled: true } } : {}),
      ...(input.townWeather === undefined ? {} : { weather: input.townWeather }),
    };
  };

  const mutate = <TOperation extends SimulationWideAuthorityOperation>(inputMutation: {
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly lease: SimulationWideAuthorityLease;
    readonly create: (
      state: SimulationWideAuthoritySnapshot,
      fencingToken: number,
    ) => MutationResult<TOperation>;
  }): TOperation => {
    return withWriterLease({ directory: lockDirectory, lease: inputMutation.lease }, () => {
      const state = readSnapshot(statePath);
      const existing = state.operations[inputMutation.operationId];
      if (existing !== undefined) {
        if (existing.requestFingerprint !== inputMutation.requestFingerprint) {
          throw new Error(
            `simulation-wide operation ${inputMutation.operationId} was reused with different input`,
          );
        }
        return clone(existing.operation) as TOperation;
      }
      const fencingToken = state.latestFencingToken + 1;
      appendChainedJournal({
        schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
        recordType: 'intent',
        operationId: inputMutation.operationId,
        requestFingerprint: inputMutation.requestFingerprint,
        fencingToken,
        recordedAt: inputMutation.lease.observedAt,
      });
      const mutation = inputMutation.create(state, fencingToken);
      const nextState: SimulationWideAuthoritySnapshot = {
        ...mutation.state,
        revision: state.revision + 1,
        latestFencingToken: fencingToken,
        operations: {
          ...mutation.state.operations,
          [inputMutation.operationId]: {
            requestFingerprint: inputMutation.requestFingerprint,
            operation: mutation.operation,
          },
        },
      };
      writeAtomically(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
      appendChainedJournal({
        schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
        recordType: 'completed',
        operationId: inputMutation.operationId,
        revision: nextState.revision,
        recordedAt: inputMutation.lease.observedAt,
      });
      return clone(mutation.operation);
    });
  };

  const applyGlobalCommand = <TKind extends 'trade' | 'conversation'>(inputCommand: {
    readonly kind: TKind;
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly lease: SimulationWideAuthorityLease;
    readonly actorId: AgentId;
    readonly commandType: 'AgentTrade' | 'AgentStartConversation';
    readonly payload:
      | AgentTradePayload
      | {
          readonly targetAgentId: AgentId;
          readonly topic: string;
          readonly relationDelta: number;
          readonly attitudeDelta: number;
          readonly turns: readonly AgentStartConversationTurnPayload[];
        };
    readonly createOperation: (input: {
      readonly fencingToken: number;
      readonly events: readonly WorldEvent[];
      readonly state: SimulationWideAuthoritySnapshot;
    }) => Extract<SimulationWideAuthorityOperation, { readonly kind: TKind }>;
  }): Extract<SimulationWideAuthorityOperation, { readonly kind: TKind }> =>
    mutate({
      operationId: inputCommand.operationId,
      requestFingerprint: inputCommand.requestFingerprint,
      lease: inputCommand.lease,
      create: (state, fencingToken) => {
        const policies = resolvePolicies(state.projection);
        const events = dispatchWorldCommand({
          command: createCommandEnvelope({
            id: `simulation-wide-${inputCommand.kind}-${inputCommand.operationId}`,
            simulationId: state.simulationId,
            actorId: inputCommand.actorId,
            source: 'agent-runtime',
            type: inputCommand.commandType,
            payload: inputCommand.payload,
            issuedAt: inputCommand.lease.observedAt,
          }),
          projection: state.projection,
          policies,
          nextSequence: state.revision + 1,
        });
        const rejection = events.find((event) => event.type === 'ActionRejected');
        if (rejection?.type === 'ActionRejected') {
          throw new Error(
            `simulation-wide ${inputCommand.kind} rejected: ${rejection.payload.reason}`,
          );
        }
        const operation = inputCommand.createOperation({ fencingToken, events, state });
        return {
          state: {
            ...state,
            projection: events.reduce(applyWorldEvent, state.projection),
          },
          operation,
        };
      },
    });

  return {
    getSnapshot: () => clone(readSnapshot(statePath)),
    settleTrade(request) {
      const agentId = asAgentId(request.agentId);
      return applyGlobalCommand({
        kind: 'trade',
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'trade',
          agentId,
          trade: request.trade,
        }),
        lease: request,
        actorId: agentId,
        commandType: 'AgentTrade',
        payload: request.trade,
        createOperation: ({ fencingToken, events, state }) => ({
          kind: 'trade',
          operationId: request.operationId,
          fencingToken,
          ownerPartitionKey: requireOwner(state, agentId),
          events,
          status: 'completed',
        }),
      });
    },
    settleConversation(request) {
      const initiatorAgentId = asAgentId(request.initiatorAgentId);
      const targetAgentId = asAgentId(request.targetAgentId);
      return applyGlobalCommand({
        kind: 'conversation',
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'conversation',
          initiatorAgentId,
          targetAgentId,
          topic: request.topic,
          turns: request.turns,
        }),
        lease: request,
        actorId: initiatorAgentId,
        commandType: 'AgentStartConversation',
        payload: {
          targetAgentId,
          topic: request.topic,
          relationDelta: 0,
          attitudeDelta: 0,
          turns: request.turns,
        },
        createOperation: ({ fencingToken, events, state }) => ({
          kind: 'conversation',
          operationId: request.operationId,
          fencingToken,
          sourcePartitionKey: requireOwner(state, initiatorAgentId),
          targetPartitionKey: requireOwner(state, targetAgentId),
          events,
          status: 'completed',
        }),
      });
    },
    settleBulletin(request) {
      if ((request.authorAgentId === undefined) === (request.humanAttribution === undefined)) {
        throw new Error(
          'simulation-wide bulletin requires exactly one author (agentId or human attribution)',
        );
      }
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'bulletin',
          bulletin: request.bulletin,
          authorAgentId: request.authorAgentId,
          authorSubjectId: request.humanAttribution?.principalSubjectId,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const command =
            request.authorAgentId !== undefined
              ? createCommandEnvelope({
                  id: `simulation-wide-bulletin-${request.operationId}`,
                  simulationId: state.simulationId,
                  actorId: request.authorAgentId,
                  source: 'agent-runtime',
                  type: 'AgentPostBulletin',
                  payload: request.bulletin,
                  issuedAt: request.observedAt,
                })
              : createCommandEnvelope({
                  id: `simulation-wide-bulletin-${request.operationId}`,
                  simulationId: state.simulationId,
                  source: 'human',
                  ...(request.humanAttribution === undefined
                    ? {}
                    : { humanAttribution: request.humanAttribution }),
                  type: 'IssueTownBulletin',
                  payload: request.bulletin,
                  issuedAt: request.observedAt,
                });
          const events = dispatchWorldCommand({
            command,
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new Error(`simulation-wide bulletin rejected: ${rejection.payload.reason}`);
          }
          const bulletinEvent = events.find(
            (event) => event.type === 'BulletinPosted' || event.type === 'BulletinScheduled',
          );
          if (
            bulletinEvent === undefined ||
            (bulletinEvent.type !== 'BulletinPosted' && bulletinEvent.type !== 'BulletinScheduled')
          ) {
            throw new Error('simulation-wide bulletin settlement produced no bulletin event');
          }
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'bulletin' }
          > = {
            kind: 'bulletin',
            operationId: request.operationId,
            fencingToken,
            bulletinId: bulletinEvent.payload.bulletin.bulletinId,
            status: bulletinEvent.type === 'BulletinPosted' ? 'posted' : 'scheduled',
            events,
          };
          return {
            state: {
              ...state,
              projection: events.reduce(applyWorldEvent, state.projection),
            },
            operation,
          };
        },
      });
    },
    settleMatter(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'matter',
          agentId: request.agentId,
          commandType: request.commandType,
          payload: request.payload,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-matter-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: request.agentId,
              source: 'agent-runtime',
              type: request.commandType,
              payload: request.payload,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new Error(`simulation-wide matter rejected: ${rejection.payload.reason}`);
          }
          const matterEvent = events.find(
            (event) =>
              event.type === 'MatterRaised' ||
              event.type === 'MatterResponded' ||
              event.type === 'MatterAssigned' ||
              event.type === 'MatterClosed',
          );
          if (matterEvent === undefined) {
            throw new Error('simulation-wide matter settlement produced no matter event');
          }
          const matterId =
            matterEvent.type === 'MatterRaised'
              ? matterEvent.payload.matter.matterId
              : matterEvent.payload.matterId;
          const operation: Extract<SimulationWideAuthorityOperation, { readonly kind: 'matter' }> =
            {
              kind: 'matter',
              operationId: request.operationId,
              fencingToken,
              matterId,
              events,
              status: 'completed',
            };
          return {
            state: {
              ...state,
              projection: events.reduce(applyWorldEvent, state.projection),
            },
            operation,
          };
        },
      });
    },
    settleConflict(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'conflict',
          agentId: request.agentId,
          commandType: request.commandType,
          payload: request.payload,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-conflict-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: request.agentId,
              source: 'agent-runtime',
              type: request.commandType,
              payload: request.payload,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new Error(`simulation-wide conflict rejected: ${rejection.payload.reason}`);
          }
          const conflictEvent = events.find(
            (event) =>
              event.type === 'ConfrontationRecorded' ||
              event.type === 'AttackRecorded' ||
              event.type === 'InterventionRecorded',
          );
          if (conflictEvent === undefined) {
            throw new Error('simulation-wide conflict settlement produced no conflict event');
          }
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'conflict' }
          > = {
            kind: 'conflict',
            operationId: request.operationId,
            fencingToken,
            conflictId: conflictEvent.payload.conflictId,
            events,
            status: 'completed',
          };
          return {
            state: {
              ...state,
              projection: events.reduce(applyWorldEvent, state.projection),
            },
            operation,
          };
        },
      });
    },
    transferAgent(request) {
      const agentId = asAgentId(request.agentId);
      const destinationLocationId = asLocationId(request.destinationLocationId);
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'transfer',
          agentId,
          destinationPartitionKey: request.destinationPartitionKey,
          destinationLocationId,
          reason: request.reason,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const sourcePartitionKey = requireOwner(state, agentId);
          if (!state.partitionKeys.includes(request.destinationPartitionKey)) {
            throw new Error(`unknown destination partition ${request.destinationPartitionKey}`);
          }
          const policies = resolveWorldCommandPolicies({
            policies: input.policies,
            projection: state.projection,
          });
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-transfer-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: agentId,
              source: 'agent-runtime',
              type: 'AgentMoveTo',
              payload: { targetLocationId: destinationLocationId, reason: request.reason },
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new Error(`simulation-wide transfer rejected: ${rejection.payload.reason}`);
          }
          const projection = events.reduce(applyWorldEvent, state.projection);
          const arrived = events.some((event) => event.type === 'AgentLocationChanged');
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'transfer' }
          > = {
            kind: 'transfer',
            operationId: request.operationId,
            fencingToken,
            sourcePartitionKey,
            destinationPartitionKey: request.destinationPartitionKey,
            agentId,
            status: arrived ? 'completed' : 'in-transit',
            events,
          };
          return {
            state: {
              ...state,
              projection,
              ownerPartitionKeyByAgentId: arrived
                ? {
                    ...state.ownerPartitionKeyByAgentId,
                    [agentId]: request.destinationPartitionKey,
                  }
                : state.ownerPartitionKeyByAgentId,
              pendingTransfers: arrived
                ? state.pendingTransfers
                : {
                    ...state.pendingTransfers,
                    [agentId]: {
                      operationId: request.operationId,
                      sourcePartitionKey,
                      destinationPartitionKey: request.destinationPartitionKey,
                      destinationLocationId,
                    },
                  },
            },
            operation,
          };
        },
      });
    },
    settleMove(request) {
      const agentId = asAgentId(request.agentId);
      const targetLocationId = asLocationId(request.targetLocationId);
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'move',
          agentId,
          targetLocationId,
          reason: request.reason,
          destinationPartitionKey: request.destinationPartitionKey,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const ownerPartitionKey = requireOwner(state, agentId);
          const destinationPartitionKey = request.destinationPartitionKey ?? ownerPartitionKey;
          if (!state.partitionKeys.includes(destinationPartitionKey)) {
            throw new Error(`unknown destination partition ${destinationPartitionKey}`);
          }
          const policies = resolveWorldCommandPolicies({
            policies: input.policies,
            projection: state.projection,
          });
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-move-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: agentId,
              source: 'agent-runtime',
              type: 'AgentMoveTo',
              payload: {
                targetLocationId,
                ...(request.reason === undefined ? {} : { reason: request.reason }),
              },
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new Error(`simulation-wide move rejected: ${rejection.payload.reason}`);
          }
          const projection = events.reduce(applyWorldEvent, state.projection);
          const arrived = events.some((event) => event.type === 'AgentLocationChanged');
          const crossOwner = destinationPartitionKey !== ownerPartitionKey;
          if (crossOwner && request.cognitiveSnapshot === undefined) {
            throw new Error(`cross-owner move for ${agentId} requires a cognitive snapshot`);
          }
          if (!crossOwner && request.cognitiveSnapshot !== undefined) {
            throw new Error(`same-owner move for ${agentId} must not carry a cognitive snapshot`);
          }
          // Cross-owner completion emits paired ownership events: the source
          // stream stops tracking the Agent, the destination stream begins.
          const transferEvents = crossOwner
            ? createOwnershipTransferEvents({
                operationId: request.operationId,
                simulationId: state.simulationId,
                agentId,
                fromPartitionKey: ownerPartitionKey,
                toPartitionKey: destinationPartitionKey,
                agentState: projection.agents[agentId],
                occurredAt: request.observedAt,
              })
            : undefined;
          const operation: Extract<SimulationWideAuthorityOperation, { readonly kind: 'move' }> = {
            kind: 'move',
            operationId: request.operationId,
            fencingToken,
            ownerPartitionKey,
            destinationPartitionKey,
            agentId,
            status: arrived ? 'completed' : 'in-transit',
            // `events` is what the routing partition folds into its working
            // view: for a cross-owner move that is the source-side set
            // (settlement plus departure on immediate arrival) — the arrival
            // set belongs to the destination and never enters the source view.
            events: crossOwner
              ? arrived && transferEvents !== undefined
                ? [...events, transferEvents.departure]
                : events
              : events,
            ...(crossOwner && transferEvents !== undefined
              ? {
                  departureEvents: arrived ? [...events, transferEvents.departure] : events,
                  arrivalEvents: arrived ? [transferEvents.arrival] : [],
                }
              : {}),
            ...(request.cognitiveSnapshot === undefined
              ? {}
              : { cognitiveSnapshot: request.cognitiveSnapshot }),
          };
          return {
            state: {
              ...state,
              projection,
              // Owner only flips once travel commits; until then the source
              // partition keeps executing the Agent.
              ownerPartitionKeyByAgentId:
                arrived && crossOwner
                  ? { ...state.ownerPartitionKeyByAgentId, [agentId]: destinationPartitionKey }
                  : state.ownerPartitionKeyByAgentId,
              ...(arrived
                ? {}
                : {
                    pendingMoves: {
                      ...(state.pendingMoves ?? {}),
                      [agentId]: {
                        operationId: request.operationId,
                        ownerPartitionKey,
                        destinationPartitionKey,
                        ...(request.cognitiveSnapshot === undefined
                          ? {}
                          : { cognitiveSnapshot: request.cognitiveSnapshot }),
                      },
                    },
                  }),
            },
            operation,
          };
        },
      });
    },
    syncPartitionAgentLocations(request) {
      const partitionKey = request.partitionKey;
      const agentLocations = [...request.agentLocations].sort((left, right) =>
        left.agentId.localeCompare(right.agentId),
      );
      const newAgents = [...(request.newAgents ?? [])].sort((left, right) =>
        left.agentId.localeCompare(right.agentId),
      );
      return mutate({
        operationId: request.operationId,
        // newAgents stay out of the fingerprint: after a crash the replayed
        // sync finds the agents already registered and omits their records,
        // and must still match the journaled request.
        requestFingerprint: stableStringify({
          kind: 'location-sync',
          partitionKey,
          agentLocations,
        }),
        lease: request,
        create: (state, fencingToken) => {
          assertKnownPartition(state, partitionKey);
          const agents = { ...state.projection.agents };
          const owners = { ...state.ownerPartitionKeyByAgentId };
          const registeredAgentIds: AgentId[] = [];
          for (const record of newAgents) {
            const agentId = asAgentId(record.agentId);
            if (owners[agentId] !== undefined) {
              throw new Error(`simulation-wide Agent ${agentId} is already registered`);
            }
            if (
              record.locationId !== null &&
              state.projection.locations[record.locationId] === undefined
            ) {
              throw new Error(
                `simulation-wide Agent ${agentId} reports unknown location ${record.locationId}`,
              );
            }
            agents[agentId] = clone(record);
            owners[agentId] = partitionKey;
            registeredAgentIds.push(agentId);
          }
          const updatedAgentIds: AgentId[] = [];
          for (const entry of agentLocations) {
            const agentId = asAgentId(entry.agentId);
            const owner = owners[agentId];
            if (owner === undefined) {
              throw new Error(`unknown simulation-wide Agent ${agentId}`);
            }
            if (owner !== partitionKey) {
              throw new Error(
                `location sync for ${agentId} must come from owner partition ${owner}, not ${partitionKey}`,
              );
            }
            const agent = agents[agentId];
            if (agent === undefined) {
              throw new Error(`unknown simulation-wide Agent ${agentId}`);
            }
            const locationId = entry.locationId === null ? null : asLocationId(entry.locationId);
            if (agent.locationId === locationId) {
              continue;
            }
            agents[agentId] = { ...agent, locationId };
            updatedAgentIds.push(agentId);
          }
          // Merge the partition's memory delta into the bounded authority
          // cache: unknown record ids append (id-first idempotency — a
          // replayed sync after a crash skips records it already merged),
          // then the cache re-trims to its cap.
          const mergedMemoryRecords = [...(request.newMemoryRecords ?? [])]
            .filter(
              (record) =>
                !state.projection.memoryRecords.some((existing) => existing.id === record.id),
            )
            .sort((left, right) => left.id.localeCompare(right.id));
          const memoryRecords =
            mergedMemoryRecords.length === 0
              ? state.projection.memoryRecords
              : [
                  ...state.projection.memoryRecords,
                  ...mergedMemoryRecords.map((record) => ({ ...record })),
                ].slice(-WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT);
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'location-sync' }
          > = {
            kind: 'location-sync',
            operationId: request.operationId,
            fencingToken,
            partitionKey,
            updatedAgentIds,
            ...(registeredAgentIds.length === 0 ? {} : { registeredAgentIds }),
            ...(mergedMemoryRecords.length === 0
              ? {}
              : { mergedMemoryRecordIds: mergedMemoryRecords.map((record) => record.id) }),
            status: 'completed',
            events: [],
          };
          return {
            state: {
              ...state,
              projection: { ...state.projection, agents, memoryRecords },
              ownerPartitionKeyByAgentId: owners,
            },
            operation,
          };
        },
      });
    },
    advanceTime(request) {
      const operation = mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'advance-time',
          deltaMs: request.deltaMs,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-advance-${request.operationId}`,
              simulationId: state.simulationId,
              source: 'system',
              type: 'AdvanceSimulationTime',
              payload: { deltaMs: request.deltaMs },
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const projection = events.reduce(applyWorldEvent, state.projection);
          const movedAgentIds = events
            .filter((event) => event.type === 'AgentLocationChanged')
            .map((event) => event.payload.agentId);
          const owners = { ...state.ownerPartitionKeyByAgentId };
          const pendingTransfers = { ...state.pendingTransfers };
          const pendingMoves = { ...(state.pendingMoves ?? {}) };
          const completedTransfers: {
            operationId: string;
            agentId: AgentId;
            sourcePartitionKey: PartitionKey;
            destinationPartitionKey: PartitionKey;
          }[] = [];
          const completedMoves: {
            operationId: string;
            agentId: AgentId;
            ownerPartitionKey: PartitionKey;
            destinationPartitionKey: PartitionKey;
            departureEvents: readonly WorldEvent[];
            arrivalEvents: readonly WorldEvent[];
            cognitiveSnapshot?: AgentCognitiveSnapshot;
          }[] = [];
          for (const agentId of movedAgentIds) {
            const pending = pendingTransfers[agentId];
            if (pending !== undefined) {
              delete pendingTransfers[agentId];
              owners[agentId] = pending.destinationPartitionKey;
              completedTransfers.push({
                operationId: pending.operationId,
                agentId: asAgentId(agentId),
                sourcePartitionKey: pending.sourcePartitionKey,
                destinationPartitionKey: pending.destinationPartitionKey,
              });
              continue;
            }
            const pendingMove = pendingMoves[agentId];
            if (pendingMove === undefined) continue;
            delete pendingMoves[agentId];
            owners[agentId] = pendingMove.destinationPartitionKey;
            const moveCrossOwner =
              pendingMove.destinationPartitionKey !== pendingMove.ownerPartitionKey;
            // Cross-owner completion publishes the paired ownership events; a
            // same-owner move only delivers this agent's arrival event — never
            // the full advance set, whose clock/physiology effects the owner
            // partition has already applied through its own local advance.
            const completionEvents = moveCrossOwner
              ? createOwnershipTransferEvents({
                  operationId: pendingMove.operationId,
                  simulationId: state.simulationId,
                  agentId: asAgentId(agentId),
                  fromPartitionKey: pendingMove.ownerPartitionKey,
                  toPartitionKey: pendingMove.destinationPartitionKey,
                  agentState: projection.agents[agentId],
                  occurredAt: request.observedAt,
                })
              : undefined;
            completedMoves.push({
              operationId: pendingMove.operationId,
              agentId: asAgentId(agentId),
              ownerPartitionKey: pendingMove.ownerPartitionKey,
              destinationPartitionKey: pendingMove.destinationPartitionKey,
              departureEvents: completionEvents === undefined ? [] : [completionEvents.departure],
              arrivalEvents:
                completionEvents === undefined
                  ? events.filter(
                      (event) =>
                        event.type === 'AgentLocationChanged' && event.payload.agentId === agentId,
                    )
                  : [completionEvents.arrival],
              ...(pendingMove.cognitiveSnapshot === undefined
                ? {}
                : { cognitiveSnapshot: pendingMove.cognitiveSnapshot }),
            });
          }
          const primary: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'time-advanced' }
          > = {
            kind: 'time-advanced',
            operationId: request.operationId,
            fencingToken,
            status: 'completed',
            events,
            completedTransfers,
            completedMoves,
          };
          return {
            state: {
              ...state,
              projection,
              ownerPartitionKeyByAgentId: owners,
              pendingTransfers,
              pendingMoves,
            },
            operation: primary,
          };
        },
      });
      return [operation];
    },
    readInbox({ partitionKey, consumerId, limit = 100 }) {
      assertConsumerId(consumerId);
      assertInboxLimit(limit);
      const state = readSnapshot(statePath);
      assertKnownPartition(state, partitionKey);
      const cursor = state.materializerCursors[createCursorKey(partitionKey, consumerId)];
      const afterFencingToken = cursor?.throughFencingToken ?? 0;
      const deliveries = Object.values(state.operations)
        .map((entry) => entry.operation)
        .flatMap((operation) =>
          createInboxDeliveries(operation, state.partitionKeys, state.ownerPartitionKeyByAgentId),
        )
        .filter((delivery) => delivery.partitionKey === partitionKey)
        .filter((delivery) => delivery.fencingToken > afterFencingToken)
        .sort((left, right) => left.fencingToken - right.fencingToken)
        .slice(0, limit)
        .map(clone);
      return { cursor: cursor === undefined ? undefined : clone(cursor), deliveries };
    },
    acknowledgeInbox(request) {
      assertConsumerId(request.consumerId);
      if (!Number.isInteger(request.throughFencingToken) || request.throughFencingToken < 1) {
        throw new Error('throughFencingToken must be a positive integer');
      }
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'inbox-materialized',
          partitionKey: request.partitionKey,
          consumerId: request.consumerId,
          throughFencingToken: request.throughFencingToken,
        }),
        lease: request,
        create: (state, fencingToken) => {
          assertKnownPartition(state, request.partitionKey);
          const cursorKey = createCursorKey(request.partitionKey, request.consumerId);
          const current = state.materializerCursors[cursorKey];
          const currentToken = current?.throughFencingToken ?? 0;
          if (request.throughFencingToken < currentToken) {
            throw new Error('inbox cursor cannot move backwards');
          }
          if (request.throughFencingToken === currentToken) {
            throw new Error('inbox acknowledgement must advance its cursor');
          }
          assertContiguousInboxAcknowledgement({
            state,
            partitionKey: request.partitionKey,
            afterFencingToken: currentToken,
            throughFencingToken: request.throughFencingToken,
          });
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'inbox-materialized' }
          > = {
            kind: 'inbox-materialized',
            operationId: request.operationId,
            fencingToken,
            partitionKey: request.partitionKey,
            consumerId: request.consumerId,
            throughFencingToken: request.throughFencingToken,
            status: 'completed',
            events: [],
          };
          return {
            state: {
              ...state,
              materializerCursors: {
                ...state.materializerCursors,
                [cursorKey]: {
                  partitionKey: request.partitionKey,
                  consumerId: request.consumerId,
                  throughFencingToken: request.throughFencingToken,
                  materializedAt: request.observedAt,
                },
              },
            },
            operation,
          };
        },
      });
    },
    recover(lease) {
      return withWriterLease({ directory: lockDirectory, lease }, () => {
        const completed = new Set(
          readJournal(journalPath)
            .filter((record) => record.recordType === 'completed')
            .map((record) => record.operationId),
        );
        const state = readSnapshot(statePath);
        const repaired: string[] = [];
        for (const [operationId, value] of Object.entries(state.operations)) {
          if (completed.has(operationId)) continue;
          appendChainedJournal({
            schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
            recordType: 'completed',
            operationId,
            revision: state.revision,
            recordedAt: lease.observedAt,
          });
          repaired.push(value.operation.operationId);
        }
        return repaired.sort();
      });
    },
  };
}

function createInitialSnapshot(seed: SimulationWideAuthoritySeed): SimulationWideAuthoritySnapshot {
  const simulationId = seed.simulationId as SimulationId;
  if (seed.manifestId.trim().length === 0) throw new Error('manifestId must not be empty');
  const partitionKeys = [...new Set(seed.partitionKeys)].sort();
  if (partitionKeys.length === 0)
    throw new Error('simulation-wide authority requires partition keys');
  const owners: Record<string, PartitionKey> = {};
  for (const owner of seed.owners) {
    if (owners[owner.agentId] !== undefined) {
      throw new Error(`duplicate global Agent owner ${owner.agentId}`);
    }
    if (!partitionKeys.includes(owner.partitionKey)) {
      throw new Error(`Agent ${owner.agentId} has undeclared owner ${owner.partitionKey}`);
    }
    if (seed.projection.agents[owner.agentId] === undefined) {
      throw new Error(`global owner ${owner.agentId} is not in projection`);
    }
    owners[owner.agentId] = owner.partitionKey;
  }
  const agentIds = Object.keys(seed.projection.agents).sort();
  if (
    agentIds.length !== Object.keys(owners).length ||
    agentIds.some((agentId) => owners[agentId] === undefined)
  ) {
    throw new Error('every simulation-wide Agent must have exactly one owner');
  }
  const withoutId = {
    schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
    manifestId: seed.manifestId,
    simulationId,
    partitionKeys,
    projection: seed.projection,
    owners,
  };
  return {
    schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
    authorityId: `simulation-wide-authority:sha256:${sha256(stableStringify(withoutId))}`,
    manifestId: seed.manifestId,
    simulationId,
    revision: 0,
    latestFencingToken: 0,
    projection: clone(seed.projection),
    ownerPartitionKeyByAgentId: owners,
    partitionKeys,
    pendingTransfers: {},
    materializerCursors: {},
    operations: {},
  };
}

function requireOwner(state: SimulationWideAuthoritySnapshot, agentId: AgentId): PartitionKey {
  const owner = state.ownerPartitionKeyByAgentId[agentId];
  if (owner === undefined) throw new Error(`unknown simulation-wide Agent ${agentId}`);
  return owner;
}

function assertKnownPartition(
  state: SimulationWideAuthoritySnapshot,
  partitionKey: PartitionKey,
): void {
  if (!state.partitionKeys.includes(partitionKey)) {
    throw new Error(`unknown simulation-wide partition ${partitionKey}`);
  }
}

function createInboxDeliveries(
  operation: SimulationWideAuthorityOperation,
  partitionKeys: readonly PartitionKey[],
  ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>,
): readonly SimulationWideAuthorityInboxDelivery[] {
  switch (operation.kind) {
    case 'trade':
      return [
        {
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey: operation.ownerPartitionKey,
          operationKind: operation.kind,
          events: operation.events,
        },
      ];
    case 'conversation':
      return [operation.sourcePartitionKey, operation.targetPartitionKey].map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: operation.events,
      }));
    // Bulletins are town-wide: every partition materializes the board update
    // so its residents gain awareness.
    case 'bulletin':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: operation.events,
      }));
    // Social matters are town-wide too: every partition tracks the board.
    case 'matter':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: operation.events,
      }));
    // Conflict events reach the partitions owning the parties and witnesses.
    // Per-agent physiology updates are filtered to the owning partition so a
    // remote partition never applies another Agent's health change.
    case 'conflict': {
      const conflictEvent = operation.events.find(
        (event) =>
          event.type === 'ConfrontationRecorded' ||
          event.type === 'AttackRecorded' ||
          event.type === 'InterventionRecorded',
      );
      if (conflictEvent === undefined) {
        return [];
      }
      const payload = conflictEvent.payload;
      const involvedAgentIds = [
        ...('initiatorAgentId' in payload ? [payload.initiatorAgentId] : []),
        ...('attackerAgentId' in payload ? [payload.attackerAgentId] : []),
        ...('intervenerAgentId' in payload ? [payload.intervenerAgentId] : []),
        payload.targetAgentId,
        ...payload.witnessAgentIds,
      ];
      const involvedPartitions = [
        ...new Set(
          involvedAgentIds
            .map((agentId) => ownerPartitionKeyByAgentId[agentId])
            .filter((partitionKey): partitionKey is PartitionKey => partitionKey !== undefined),
        ),
      ].sort();
      return involvedPartitions.flatMap((partitionKey) => {
        const events = operation.events.filter(
          (event) =>
            event.type !== 'PhysiologyChanged' ||
            ownerPartitionKeyByAgentId[event.payload.agentId] === partitionKey,
        );
        if (events.length === 0) {
          return [];
        }
        return [
          {
            operationId: operation.operationId,
            fencingToken: operation.fencingToken,
            partitionKey,
            operationKind: operation.kind,
            events,
          },
        ];
      });
    }
    case 'transfer':
      return [operation.sourcePartitionKey, operation.destinationPartitionKey]
        .filter((partitionKey, index, values) => values.indexOf(partitionKey) === index)
        .map((partitionKey) => ({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey,
          operationKind: operation.kind,
          events: operation.events,
        }));
    case 'move': {
      if (operation.departureEvents === undefined || operation.arrivalEvents === undefined) {
        // Same-owner move: one delivery of the settlement events to the owner.
        return [
          {
            operationId: operation.operationId,
            fencingToken: operation.fencingToken,
            partitionKey: operation.ownerPartitionKey,
            operationKind: operation.kind,
            events: operation.events,
          },
        ];
      }
      const deliveries: SimulationWideAuthorityInboxDelivery[] = [];
      if (operation.departureEvents.length > 0) {
        deliveries.push({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey: operation.ownerPartitionKey,
          operationKind: operation.kind,
          events: operation.departureEvents,
        });
      }
      if (operation.arrivalEvents.length > 0) {
        deliveries.push({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey: operation.destinationPartitionKey,
          operationKind: operation.kind,
          events: operation.arrivalEvents,
          ...(operation.cognitiveSnapshot === undefined
            ? {}
            : { cognitiveSnapshot: operation.cognitiveSnapshot }),
        });
      }
      return deliveries;
    }
    case 'time-advanced': {
      // Transfers keep the legacy semantics: the full advance event set goes to
      // every involved partition. Completed moves instead deliver only their
      // per-move departure/arrival sets, so an owner partition never applies a
      // second clock advance for time it already advanced locally.
      const byPartition = new Map<
        PartitionKey,
        { events: WorldEvent[]; cognitiveSnapshot?: AgentCognitiveSnapshot }
      >();
      const addEvents = (
        partitionKey: PartitionKey,
        events: readonly WorldEvent[],
        cognitiveSnapshot?: AgentCognitiveSnapshot,
      ): void => {
        if (events.length === 0 && cognitiveSnapshot === undefined) return;
        const entry = byPartition.get(partitionKey) ?? { events: [] };
        entry.events.push(...events);
        if (cognitiveSnapshot !== undefined) {
          entry.cognitiveSnapshot = cognitiveSnapshot;
        }
        byPartition.set(partitionKey, entry);
      };
      for (const transfer of operation.completedTransfers) {
        addEvents(transfer.sourcePartitionKey, operation.events);
        addEvents(transfer.destinationPartitionKey, operation.events);
      }
      // Town-wide board updates during this advance (bulletin activations,
      // matter expiries and their breach outcomes): partitions that already
      // receive the full advance event set (transfer moves) have them inline;
      // everyone else gets just those events. WeatherChanged rides along too:
      // weather settles only on the authority, so without delivery no partition
      // stream ever records the transition. TownDayPhaseChanged rides along for
      // the same reason: phases are a pure clock function, so the town-wide
      // copy is always identical to what a local advance would have derived.
      const townWideEvents = operation.events.filter(
        (event) =>
          event.type === 'BulletinPosted' ||
          event.type === 'MatterClosed' ||
          event.type === 'SocialInteractionCompleted' ||
          event.type === 'WeatherChanged' ||
          event.type === 'TownDayPhaseChanged' ||
          // Matter-expiry closures carry the parties' memory records; they
          // must ride along so each owner partition materializes them.
          event.type === 'ShortTermMemoryRecorded',
      );
      if (townWideEvents.length > 0) {
        const fullRecipients = new Set<PartitionKey>();
        for (const transfer of operation.completedTransfers) {
          fullRecipients.add(transfer.sourcePartitionKey);
          fullRecipients.add(transfer.destinationPartitionKey);
        }
        for (const partitionKey of partitionKeys) {
          if (!fullRecipients.has(partitionKey)) {
            addEvents(partitionKey, townWideEvents);
          }
        }
      }
      for (const move of operation.completedMoves) {
        addEvents(move.ownerPartitionKey, move.departureEvents);
        addEvents(move.destinationPartitionKey, move.arrivalEvents, move.cognitiveSnapshot);
      }
      return [...byPartition.entries()].map(([partitionKey, entry]) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: entry.events,
        ...(entry.cognitiveSnapshot === undefined
          ? {}
          : { cognitiveSnapshot: entry.cognitiveSnapshot }),
      }));
    }
    case 'inbox-materialized':
      return [];
    case 'location-sync':
      return [];
  }
}

function createCursorKey(partitionKey: PartitionKey, consumerId: string): string {
  return `${partitionKey}:${consumerId}`;
}

/**
 * Build the paired ownership events for a cross-owner move completion. The
 * materializer interprets them per stream: the departure event ends the Agent's
 * presence in the source partition's projection, the arrival event begins it in
 * the destination with the authoritative world state captured at settlement.
 * Sequences are placeholders: each materializer resequences deliveries into its
 * own stream before appending.
 */
function createOwnershipTransferEvents(input: {
  readonly operationId: string;
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly fromPartitionKey: PartitionKey;
  readonly toPartitionKey: PartitionKey;
  readonly agentState: WorldProjection['agents'][string] | undefined;
  readonly occurredAt: number;
}): { readonly departure: WorldEvent; readonly arrival: WorldEvent } {
  if (input.agentState === undefined) {
    throw new Error(`cannot transfer unknown Agent ${input.agentId}`);
  }
  const state = input.agentState;
  const departure = createEventEnvelope({
    id: `simulation-wide-departure-${input.operationId}`,
    simulationId: input.simulationId,
    type: 'AgentOwnershipDeparted',
    payload: {
      agentId: input.agentId,
      toPartitionKey: input.toPartitionKey,
      transferOperationId: input.operationId,
    },
    occurredAt: input.occurredAt,
    sequence: 1,
  }) as WorldEvent;
  const arrival = createEventEnvelope({
    id: `simulation-wide-arrival-${input.operationId}`,
    simulationId: input.simulationId,
    type: 'AgentOwnershipArrived',
    payload: {
      agentId: input.agentId,
      fromPartitionKey: input.fromPartitionKey,
      transferOperationId: input.operationId,
      agentState: {
        locationId: state.locationId,
        physiology: { ...state.physiology },
        educationScore: state.educationScore,
        balance: state.balance,
        residentialTier: state.residentialTier,
        job: state.job,
        inventory: { ...state.inventory },
        // Optional durable wellbeing travels with the transfer so the receiving
        // partition does not silently reset it to the policy initialValue.
        ...(state.wellbeing === undefined ? {} : { wellbeing: state.wellbeing }),
        // Lifecycle facts travel too: a transferred retiree keeps the pension
        // accrual and stage; a transferred elderly agent re-retires on arrival
        // settlement if a job slipped through.
        ...(state.lifeStage === undefined ? {} : { lifeStage: state.lifeStage }),
        ...(state.retiredAtMs === undefined ? {} : { retiredAtMs: state.retiredAtMs }),
        // The registration anchor travels so the migrant keeps their true age
        // (the full registration record stays behind in the source stream).
        ...(state.registration === undefined
          ? {}
          : { registeredAtMs: state.registration.registeredAt }),
        // Education aggregate travels too: losing it on migration would reset
        // the vocational track, production/job multipliers, and exam-attempt
        // caps to the score-derived defaults.
        ...(state.educationLevel === undefined ? {} : { educationLevel: state.educationLevel }),
        ...(state.educationTrack === undefined ? {} : { educationTrack: state.educationTrack }),
        ...(state.examAttempts === undefined ? {} : { examAttempts: state.examAttempts }),
      },
    },
    occurredAt: input.occurredAt,
    sequence: 1,
  }) as WorldEvent;
  return { departure, arrival };
}

function assertConsumerId(consumerId: string): void {
  if (consumerId.trim().length === 0) throw new Error('consumerId must not be empty');
}

function assertInboxLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('inbox limit must be an integer between 1 and 1000');
  }
}

function assertContiguousInboxAcknowledgement(input: {
  readonly state: SimulationWideAuthoritySnapshot;
  readonly partitionKey: PartitionKey;
  readonly afterFencingToken: number;
  readonly throughFencingToken: number;
}): void {
  const deliveries = Object.values(input.state.operations)
    .map((entry) => entry.operation)
    .flatMap((operation) =>
      createInboxDeliveries(
        operation,
        input.state.partitionKeys,
        input.state.ownerPartitionKeyByAgentId,
      ),
    )
    .filter((delivery) => delivery.partitionKey === input.partitionKey)
    .filter((delivery) => delivery.fencingToken > input.afterFencingToken)
    .sort((left, right) => left.fencingToken - right.fencingToken);
  const expected = deliveries.find(
    (delivery) => delivery.fencingToken >= input.throughFencingToken,
  );
  if (expected === undefined || expected.fencingToken !== input.throughFencingToken) {
    throw new Error(
      `inbox acknowledgement must stop at a delivered fencing token for ${input.partitionKey}`,
    );
  }
}

function authorityDirectory(rootDir: string, simulationId: SimulationId | string): string {
  if (rootDir.trim().length === 0) throw new Error('rootDir must not be empty');
  return join(rootDir, 'simulation-wide-authority', encodeURIComponent(simulationId));
}

function readSnapshot(path: string): SimulationWideAuthoritySnapshot {
  if (!existsSync(path)) throw new Error('simulation-wide authority state is missing');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SimulationWideAuthoritySnapshot;
  if (parsed.schemaVersion !== SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION) {
    throw new Error('unsupported simulation-wide authority state schema');
  }
  if (parsed.authorityId.trim().length === 0 || parsed.manifestId.trim().length === 0) {
    throw new Error('simulation-wide authority identity is invalid');
  }
  return parsed;
}

function withWriterLease<TResult>(
  input: {
    readonly directory: string;
    readonly lease: SimulationWideAuthorityLease;
  },
  operation: () => TResult,
): TResult {
  validateLease(input.lease);
  acquireLease(input.directory, input.lease);
  try {
    return operation();
  } finally {
    rmSync(input.directory, { recursive: true, force: true });
  }
}

function acquireLease(directory: string, lease: SimulationWideAuthorityLease): void {
  mkdirSync(join(directory, '..'), { recursive: true });
  try {
    mkdirSync(directory);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const leasePath = join(directory, 'lease.json');
    const existing = existsSync(leasePath)
      ? (JSON.parse(readFileSync(leasePath, 'utf8')) as { readonly expiresAt?: unknown })
      : undefined;
    const expiresAt = existing?.expiresAt;
    if (
      typeof expiresAt === 'number' &&
      Number.isFinite(expiresAt) &&
      expiresAt < lease.observedAt
    ) {
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory);
    } else {
      throw new Error('simulation-wide authority is held by an unexpired writer lease');
    }
  }
  writeFileSync(
    join(directory, 'lease.json'),
    `${JSON.stringify({ workerId: lease.workerId, expiresAt: lease.observedAt + lease.durationMs })}\n`,
  );
}

function validateLease(lease: SimulationWideAuthorityLease): void {
  if (lease.workerId.trim().length === 0) throw new Error('workerId must not be empty');
  if (!Number.isFinite(lease.observedAt) || lease.observedAt < 0) {
    throw new Error('observedAt must be a non-negative finite number');
  }
  if (!Number.isFinite(lease.durationMs) || lease.durationMs <= 0) {
    throw new Error('durationMs must be positive finite');
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function computeJournalChainHash(
  previousChainHash: string,
  body: AuthorityJournalRecordBody,
): string {
  return sha256Hex(`${previousChainHash}:${stableStringify(body)}`);
}

function verifyJournalChainRecords(records: readonly ParsedAuthorityJournalRecord[]): {
  readonly valid: boolean;
  readonly firstBrokenRecordIndex?: number;
  readonly latestChainHash: string;
} {
  let expectedChainHash = SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const { chainHash, ...body } = record;
    const recomputed = computeJournalChainHash(expectedChainHash, body);
    if (chainHash === undefined || chainHash !== recomputed) {
      return {
        valid: false,
        firstBrokenRecordIndex: index,
        latestChainHash: expectedChainHash,
      };
    }
    expectedChainHash = chainHash;
  }
  return { valid: true, latestChainHash: expectedChainHash };
}

/**
 * Independently verify the authority's audit journal hash chain. Reads the
 * durable journal for the given authority and recomputes every chain link
 * from the genesis hash, so a caller can prove the operation history is
 * complete and untampered without trusting the live authority instance.
 */
export function verifySimulationWideAuthorityJournal(input: {
  readonly rootDir: string;
  readonly simulationId: SimulationId | string;
}): {
  readonly recordCount: number;
  readonly valid: boolean;
  readonly firstBrokenRecordIndex?: number;
  readonly latestChainHash: string;
  readonly reason?: string;
} {
  const path = join(authorityDirectory(input.rootDir, input.simulationId), 'operations.jsonl');
  let records: readonly ParsedAuthorityJournalRecord[];
  try {
    records = readJournal(path);
  } catch (error) {
    return {
      recordCount: 0,
      valid: false,
      latestChainHash: SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const verification = verifyJournalChainRecords(records);
  return {
    recordCount: records.length,
    valid: verification.valid,
    latestChainHash: verification.latestChainHash,
    ...(verification.firstBrokenRecordIndex === undefined
      ? {}
      : { firstBrokenRecordIndex: verification.firstBrokenRecordIndex }),
  };
}

function readJournal(path: string): readonly AuthorityJournalRecord[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  if (content.length > 0 && !content.endsWith('\n')) {
    throw new Error('simulation-wide authority journal has an incomplete trailing row');
  }
  return content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AuthorityJournalRecord)
    .map((record) => {
      if (record.schemaVersion !== SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION) {
        throw new Error('unsupported simulation-wide authority journal schema');
      }
      return record;
    });
}

function writeAtomically(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, path);
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'EEXIST'
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}
