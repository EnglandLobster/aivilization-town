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
  type AgentId,
  type PartitionKey,
  type SimulationId,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type AgentStartConversationTurnPayload,
  type AgentTradePayload,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';

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
   * The partition that will own the Agent after the move commits. Layer 1 of
   * the move handoff keeps this equal to the current owner (pure spatial
   * settlement); the cross-owner handoff resolves it from manifest-declared
   * location affinity.
   */
  readonly destinationPartitionKey?: PartitionKey;
};

export type SimulationWideLocationSyncRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly partitionKey: PartitionKey;
  readonly agentLocations: readonly {
    readonly agentId: string;
    readonly locationId: string | null;
  }[];
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
  readonly transferAgent: (
    request: SimulationWideTransferRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'transfer' };
  readonly settleMove: (
    request: SimulationWideMoveRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'move' };
  readonly syncPartitionAgentLocations: (
    request: SimulationWideLocationSyncRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'location-sync' };
  readonly advanceTime: (input: SimulationWideAuthorityLease & { readonly operationId: string; readonly deltaMs: number }) => readonly SimulationWideAuthorityOperation[];
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
  readonly acknowledgeInbox: (input: SimulationWideAuthorityLease & {
    readonly operationId: string;
    readonly partitionKey: PartitionKey;
    readonly consumerId: string;
    readonly throughFencingToken: number;
  }) => Extract<SimulationWideAuthorityOperation, { readonly kind: 'inbox-materialized' }>;
  readonly recover: (lease: SimulationWideAuthorityLease) => readonly string[];
};

type AuthorityJournalRecord =
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

  // Resolve the world command policies for a given projection, threading the
  // regional-markets flag through so the AgentTrade handler gates trades on
  // regional co-location when regional markets are enabled.
  const resolvePolicies = (projection: WorldProjection): WorldCommandPolicies => ({
    ...resolveWorldCommandPolicies({ policies: input.policies, projection }),
    ...(input.regionalMarketsEnabled === true
      ? { regionalMarkets: { enabled: true } }
      : {}),
  });

  const mutate = <TOperation extends SimulationWideAuthorityOperation>(inputMutation: {
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly lease: SimulationWideAuthorityLease;
    readonly create: (state: SimulationWideAuthoritySnapshot, fencingToken: number) => MutationResult<TOperation>;
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
      appendJournal(journalPath, {
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
      appendJournal(journalPath, {
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
    readonly payload: AgentTradePayload | {
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
          throw new Error(`simulation-wide ${inputCommand.kind} rejected: ${rejection.payload.reason}`);
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
          const operation: Extract<SimulationWideAuthorityOperation, { readonly kind: 'transfer' }> = {
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
          const destinationPartitionKey =
            request.destinationPartitionKey ?? ownerPartitionKey;
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
          const operation: Extract<SimulationWideAuthorityOperation, { readonly kind: 'move' }> = {
            kind: 'move',
            operationId: request.operationId,
            fencingToken,
            ownerPartitionKey,
            destinationPartitionKey,
            agentId,
            status: arrived ? 'completed' : 'in-transit',
            events,
          };
          return {
            state: {
              ...state,
              projection,
              // Owner only flips once travel commits; until then the source
              // partition keeps executing the Agent.
              ownerPartitionKeyByAgentId:
                arrived && destinationPartitionKey !== ownerPartitionKey
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
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'location-sync',
          partitionKey,
          agentLocations,
        }),
        lease: request,
        create: (state, fencingToken) => {
          assertKnownPartition(state, partitionKey);
          const agents = { ...state.projection.agents };
          const updatedAgentIds: AgentId[] = [];
          for (const entry of agentLocations) {
            const agentId = asAgentId(entry.agentId);
            const owner = state.ownerPartitionKeyByAgentId[agentId];
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
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'location-sync' }
          > = {
            kind: 'location-sync',
            operationId: request.operationId,
            fencingToken,
            partitionKey,
            updatedAgentIds,
            status: 'completed',
            events: [],
          };
          return {
            state: {
              ...state,
              projection: { ...state.projection, agents },
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
          const policies = resolveWorldCommandPolicies({
            policies: input.policies,
            projection: state.projection,
          });
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
            completedMoves.push({
              operationId: pendingMove.operationId,
              agentId: asAgentId(agentId),
              ownerPartitionKey: pendingMove.ownerPartitionKey,
              destinationPartitionKey: pendingMove.destinationPartitionKey,
            });
          }
          const primary: Extract<SimulationWideAuthorityOperation, { readonly kind: 'time-advanced' }> = {
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
        .flatMap((operation) => createInboxDeliveries(operation))
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
          appendJournal(journalPath, {
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
  if (partitionKeys.length === 0) throw new Error('simulation-wide authority requires partition keys');
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
  if (agentIds.length !== Object.keys(owners).length || agentIds.some((agentId) => owners[agentId] === undefined)) {
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

function assertKnownPartition(state: SimulationWideAuthoritySnapshot, partitionKey: PartitionKey): void {
  if (!state.partitionKeys.includes(partitionKey)) {
    throw new Error(`unknown simulation-wide partition ${partitionKey}`);
  }
}

function createInboxDeliveries(
  operation: SimulationWideAuthorityOperation,
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
    case 'move':
      return [operation.ownerPartitionKey, operation.destinationPartitionKey]
        .filter((partitionKey, index, values) => values.indexOf(partitionKey) === index)
        .map((partitionKey) => ({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey,
          operationKind: operation.kind,
          events: operation.events,
        }));
    case 'time-advanced': {
      const transferPartitions = operation.completedTransfers.flatMap((transfer) => [
        transfer.sourcePartitionKey,
        transfer.destinationPartitionKey,
      ]);
      const movePartitions = operation.completedMoves.flatMap((move) => [
        move.ownerPartitionKey,
        move.destinationPartitionKey,
      ]);
      return [...transferPartitions, ...movePartitions]
        .filter((partitionKey, index, values) => values.indexOf(partitionKey) === index)
        .map((partitionKey) => ({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey,
          operationKind: operation.kind,
          events: operation.events,
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
    .flatMap(createInboxDeliveries)
    .filter((delivery) => delivery.partitionKey === input.partitionKey)
    .filter((delivery) => delivery.fencingToken > input.afterFencingToken)
    .sort((left, right) => left.fencingToken - right.fencingToken);
  const expected = deliveries.find((delivery) => delivery.fencingToken >= input.throughFencingToken);
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

function withWriterLease<TResult>(input: {
  readonly directory: string;
  readonly lease: SimulationWideAuthorityLease;
}, operation: () => TResult): TResult {
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
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt < lease.observedAt) {
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

function appendJournal(path: string, record: AuthorityJournalRecord): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`);
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
  return typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === 'EEXIST';
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
