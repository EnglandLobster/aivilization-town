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
  type CoreCommandType,
  type HumanCommandAttribution,
  type PartitionKey,
  type SimulationId,
} from '@aivilization/sim-core';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import { decideLiquidateDeceasedCustomer, type CreditDomainEvent } from '@aivilization/credit';
import {
  calculateCompletedRecruitmentCycleNumbers,
  settlePublicBudget,
  type OutMigrationPolicy,
  type PublicBudgetPolicy,
  type ServiceQualityPolicy,
  type TownPublicService,
} from '@aivilization/society';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  normalizeLegacyWorldProjectionSnapshot,
  WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT,
  type AgentStartConversationTurnPayload,
  type AgentGiveResourcePayload,
  type AgentExportCommodityPayload,
  type AgentImportCommodityPayload,
  type AgentTradePayload,
  type AgentPostBulletinPayload,
  type AgentDepositPayload,
  type AgentBuildHousingPayload,
  type AgentChooseResidencePayload,
  type AgentRequestLoanPayload,
  type AgentWithdrawPayload,
  type TownWeatherPolicy,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldEnterpriseState,
  type WorldProjection,
} from '@aivilization/world';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import {
  assertValidAgentCognitiveSnapshot,
  type AgentCognitiveSnapshot,
} from './agentCognitiveSnapshot';
import { settleDemandDrivenArrivals } from './simulationWideMigration';

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

export class SimulationWideAuthorityPartitionBarrierError extends Error {
  readonly requiredClockNow: number;
  readonly laggingPartitions: readonly {
    readonly partitionKey: PartitionKey;
    readonly publishedClockNow?: number;
  }[];

  constructor(input: {
    readonly requiredClockNow: number;
    readonly laggingPartitions: readonly {
      readonly partitionKey: PartitionKey;
      readonly publishedClockNow?: number;
    }[];
  }) {
    super(
      `simulation-wide authority cannot advance from ${input.requiredClockNow}; lagging partition state: ${input.laggingPartitions
        .map(
          ({ partitionKey, publishedClockNow }) =>
            `${partitionKey}@${publishedClockNow ?? 'missing'}`,
        )
        .join(', ')}`,
    );
    this.name = 'SimulationWideAuthorityPartitionBarrierError';
    this.requiredClockNow = input.requiredClockNow;
    this.laggingPartitions = input.laggingPartitions.map((partition) => ({ ...partition }));
  }
}

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
  /** Initial owner-partition fiscal contributions for barrier aggregation. */
  readonly partitionAccountsByKey?: Readonly<
    Record<string, Pick<WorldProjection, 'moneySupply' | 'treasury'>>
  >;
};

export type SimulationWideAuthorityLease = {
  readonly workerId: string;
  readonly observedAt: number;
  readonly durationMs: number;
};

/**
 * A domain-level refusal produced by the authoritative world dispatcher.
 * Infrastructure, lease, journal, and programming failures deliberately use
 * ordinary errors so callers cannot accidentally turn them into a harmless
 * Agent rejection and continue after a corrupted settlement.
 */
export class SimulationWideCommandRejectedError extends Error {
  readonly reason: string;
  readonly events: readonly WorldEvent[];

  constructor(scope: string, reason: string, events: readonly WorldEvent[]) {
    super(`simulation-wide ${scope} rejected: ${reason}`);
    this.name = 'SimulationWideCommandRejectedError';
    this.reason = reason;
    this.events = events.map((event) => clone(event));
  }
}

export type SimulationWideTradeRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly trade: AgentTradePayload;
};

export type SimulationWideCreditRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly commandType: 'AgentDeposit' | 'AgentWithdraw' | 'AgentRequestLoan';
  readonly payload: AgentDepositPayload | AgentWithdrawPayload | AgentRequestLoanPayload;
};

export type SimulationWideConversationRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly initiatorAgentId: string;
  readonly targetAgentId: string;
  readonly topic: string;
  readonly turns: readonly AgentStartConversationTurnPayload[];
};

export type SimulationWideResourceTransferRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly sourceAgentId: string;
  readonly transfer: AgentGiveResourcePayload;
};

export type SimulationWideExternalTradeRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: string;
  readonly commandType: 'AgentExportCommodity' | 'AgentImportCommodity';
  readonly payload: AgentExportCommodityPayload | AgentImportCommodityPayload;
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
  /** Simulation clock of the owner state carried by this report. */
  readonly partitionClockNow?: number;
  readonly agentLocations: readonly {
    readonly agentId: string;
    readonly locationId: string | null;
  }[];
  /**
   * Current owner-partition records for already-known Agents. Global trade,
   * movement, conflict, and conversation decisions must not use bootstrap-era
   * balances, inventories, physiology, jobs, or education after local actions
   * have changed them. Optional for compatibility with older direct callers;
   * the canonical router always supplies it.
   */
  readonly agentStates?: readonly WorldAgentState[];
  /**
   * Enterprise aggregates owned by Agents in this partition. Global AMM
   * settlement needs the same cash/inventory truth as the owner projection;
   * the authority never decides lifecycle changes from this mirror.
   */
  readonly enterpriseStates?: readonly WorldEnterpriseState[];
  /**
   * The partition's current fiscal contribution. Single-partition authorities
   * synchronize it directly. Multi-partition authorities retain one value per
   * partition and publish the sum only at an equal-clock barrier. The bank is
   * excluded from multi-partition summation because it is authority-owned and
   * replicated to partitions as a snapshot.
   */
  readonly partitionAccounts?: Pick<WorldProjection, 'moneySupply' | 'treasury' | 'bank'>;
  /**
   * Owner-scoped runtime state required by global authorization and exact
   * cross-owner handoff. The authority mirrors these facts but never decides
   * their household cadence.
   */
  readonly partitionRuntimeState?: Pick<
    WorldProjection,
    | 'activityTimeByAgent'
    | 'transitByAgent'
    | 'timeSettlementByAgent'
    | 'physiologicalDistressByAgent'
  >;
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
  /**
   * Agents this partition no longer holds because they permanently left the
   * simulation (death or out-migration settled partition-locally — the
   * authority never settles population turnover by design). The authority
   * removes them from its projection, the ownership ledger, and any pending
   * transfer/move so no global settlement can ever reference a ghost
   * resident. Idempotent on replay (unknown ids are skipped) and kept out of
   * the fingerprint like newAgents.
   */
  readonly departedAgentIds?: readonly string[];
};

export type SimulationWideRejectedCommandRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly partitionKey: PartitionKey;
  readonly commandType: CoreCommandType;
  readonly reason: string;
  readonly events: readonly WorldEvent[];
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

export type SimulationWideGovernanceRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly commandType: 'SetTaxPolicy' | 'SetPublicBudget' | 'SetSubsidyPolicy';
  readonly payload: unknown;
  readonly actorAgentId?: AgentId;
  readonly humanAttribution?: HumanCommandAttribution;
};

export type SimulationWideConstructionRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly builderAgentId: AgentId;
  readonly housing: AgentBuildHousingPayload;
};

export type SimulationWideResidenceRequest = SimulationWideAuthorityLease & {
  readonly operationId: string;
  readonly agentId: AgentId;
  readonly residence: AgentChooseResidencePayload;
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
      readonly kind: 'credit';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /** A rejected global command, durably delivered to its owner partition. */
      readonly kind: 'command-rejected';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly partitionKey: PartitionKey;
      readonly commandType: CoreCommandType;
      readonly reason: string;
      readonly events: readonly WorldEvent[];
      readonly status: 'rejected';
    }
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
      /** A material gift atomically settled against both Agents' current inventories. */
      readonly kind: 'resource-transfer';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly sourcePartitionKey: PartitionKey;
      readonly targetPartitionKey: PartitionKey;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /** One town-wide external-sector trade; trader accounts remain owner-scoped. */
      readonly kind: 'external-trade';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
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
      /** Demand-driven residents admitted at migration cadence boundaries. */
      readonly registeredAgents?: readonly {
        readonly agentId: AgentId;
        readonly ownerPartitionKey: PartitionKey;
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
      readonly updatedEnterpriseIds?: readonly string[];
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
      /**
       * Agents removed from the authority's ledger by this sync (permanent
       * departure reported by the owner partition). Absent when none.
       */
      readonly removedAgentIds?: readonly AgentId[];
      readonly status: 'completed';
      /** Credit liquidation facts plus the authoritative bank snapshot. */
      readonly events: readonly WorldEvent[];
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
       * A petition command (raise/sign) settled against the one authoritative
       * world state. Petition state is town-wide shared truth, so every
       * partition materializes the operation's events.
       */
      readonly kind: 'petition';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly petitionId: string;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /** One accepted town policy change, broadcast to every partition. */
      readonly kind: 'governance';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly governanceRevision: number;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /** Material-backed housing expansion; capacity is global, inventory is owner-scoped. */
      readonly kind: 'construction';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
      readonly locationId: string;
      readonly events: readonly WorldEvent[];
      readonly status: 'completed';
    }
  | {
      /** One Agent's durable home assignment, validated against global occupancy. */
      readonly kind: 'residence';
      readonly operationId: string;
      readonly fencingToken: number;
      readonly ownerPartitionKey: PartitionKey;
      readonly locationId: string;
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
  readonly operationKind: Exclude<SimulationWideAuthorityOperation['kind'], 'inbox-materialized'>;
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
  /**
   * Latest owner-state boundary published by each partition. Optional only for
   * hydration compatibility with pre-barrier authority snapshots.
   */
  readonly partitionClockNowByKey?: Readonly<Record<string, number>>;
  /** Latest fiscal contribution reported by each owner partition. */
  readonly partitionAccountsByKey?: Readonly<
    Record<string, Pick<WorldProjection, 'moneySupply' | 'treasury'>>
  >;
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
  readonly settleCredit: (
    request: SimulationWideCreditRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'credit' };
  readonly settleConversation: (
    request: SimulationWideConversationRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'conversation' };
  readonly settleResourceTransfer: (
    request: SimulationWideResourceTransferRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'resource-transfer' };
  readonly settleExternalTrade: (
    request: SimulationWideExternalTradeRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'external-trade' };
  readonly settleBulletin: (
    request: SimulationWideBulletinRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'bulletin' };
  readonly settlePetition: (
    request: SimulationWideAuthorityLease & {
      readonly operationId: string;
      readonly agentId: AgentId;
      readonly commandType: 'AgentRaisePetition' | 'AgentSignPetition';
      readonly payload: unknown;
    },
  ) => SimulationWideAuthorityOperation & { readonly kind: 'petition' };
  readonly settleGovernance: (
    request: SimulationWideGovernanceRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'governance' };
  readonly settleConstruction: (
    request: SimulationWideConstructionRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'construction' };
  readonly settleResidence: (
    request: SimulationWideResidenceRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'residence' };
  readonly settleMatter: (
    request: SimulationWideMatterRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'matter' };
  readonly settleConflict: (
    request: SimulationWideConflictRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'conflict' };
  readonly settleMove: (
    request: SimulationWideMoveRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'move' };
  readonly syncPartitionAgentLocations: (
    request: SimulationWideLocationSyncRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'location-sync' };
  readonly recordRejectedCommand: (
    request: SimulationWideRejectedCommandRequest,
  ) => SimulationWideAuthorityOperation & { readonly kind: 'command-rejected' };
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
   * Refuse to create a new authority ledger when partition history already
   * exists. The authority's completed-operation journal is intentionally not a
   * second event store, so neither it nor partial partition projections can
   * reconstruct a lost global aggregate without inventing history.
   */
  readonly requireExistingState?: boolean;
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
  /** Authority-scoped regional service quality policy. */
  readonly townServiceQuality?: ServiceQualityPolicy;
}): SimulationWideAuthorityService {
  const directory = authorityDirectory(input.rootDir, input.seed.simulationId);
  const statePath = join(directory, 'state.json');
  const journalPath = join(directory, 'operations.jsonl');
  const lockDirectory = join(directory, '.writer-lease');
  const expectedInitialSnapshot = createInitialSnapshot(input.seed);
  mkdirSync(directory, { recursive: true });
  const stateExists = existsSync(statePath);
  if (!stateExists && existsSync(journalPath)) {
    throw new Error(
      `simulation-wide authority state is missing while its audit journal exists for ${input.seed.simulationId}; restore the state from backup`,
    );
  }
  if (!stateExists && input.requireExistingState === true) {
    throw new Error(
      `simulation-wide authority state is missing for non-pristine simulation ${input.seed.simulationId}; restore the authority state instead of reseeding`,
    );
  }
  if (!stateExists) {
    writeAtomically(statePath, `${JSON.stringify(expectedInitialSnapshot, null, 2)}\n`);
  }
  const persistedSnapshot = readSnapshot(statePath);
  if (persistedSnapshot.authorityId !== expectedInitialSnapshot.authorityId) {
    throw new Error(
      `simulation-wide authority seed does not match existing authority for ${input.seed.simulationId}`,
    );
  }
  assertAuthoritySnapshotJournalCoherence(persistedSnapshot, readVerifiedJournal(journalPath));

  // Reload and verify the chain for EVERY append while the caller holds the
  // writer lease. Authority service instances can outlive one another, so a
  // process-local cached tail would become stale after another writer commits.
  const appendChainedJournal = (record: AuthorityJournalRecordBody): void => {
    const records = readVerifiedJournal(journalPath);
    const previousChainHash =
      records.at(-1)?.chainHash ?? SIMULATION_WIDE_AUTHORITY_JOURNAL_GENESIS_CHAIN_HASH;
    const chainHash = computeJournalChainHash(previousChainHash, record);
    appendFileSync(journalPath, `${JSON.stringify({ ...record, chainHash })}\n`);
  };

  // Resolve the world command policies for a given projection, threading the
  // regional-markets flag through so the AgentTrade handler gates trades on
  // regional co-location when regional markets are enabled.
  //
  // Lifecycle and starvation are STRIPPED here on purpose: the authority's per-agent
  // physiology/balances are a partial view (per-agent settlement events are
  // not redelivered to it), and illness-death rolls embed the command id of
  // whichever side settles — if the authority also ran the lifecycle block,
  // it and the owner partition would derive TWO sets of life/death facts and
  // later global settlements/transfers would reference divergent truths.
  // Life-and-death authority stays with the owner partition streams; the
  // authority's copy simply does not age (wellbeing/calculator-style scalar
  // drift on its copy is benign and unsettled there).
  const resolvePolicies = (projection: WorldProjection): WorldCommandPolicies => {
    const {
      lifecycle: strippedLifecycle,
      migration: strippedMigration,
      starvation: strippedStarvation,
      ...commandPolicies
    } = resolveWorldCommandPolicies({
      policies: input.policies,
      projection,
    });
    void strippedLifecycle;
    void strippedMigration;
    void strippedStarvation;
    return {
      ...commandPolicies,
      ...(input.regionalMarketsEnabled === true ? { regionalMarkets: { enabled: true } } : {}),
      ...(input.townWeather === undefined ? {} : { weather: input.townWeather }),
      ...(input.townServiceQuality === undefined
        ? {}
        : { serviceQuality: input.townServiceQuality }),
    };
  };

  const resolveMigrationPolicy = (projection: WorldProjection): OutMigrationPolicy | undefined =>
    resolveWorldCommandPolicies({ policies: input.policies, projection }).migration;

  // Authority clock advancement owns global cadences and the single bank, but
  // never re-runs owner-partition household/enterprise/resource settlement.
  // Partition state is synchronized after its local time phase; charging those
  // effects here again would make credit collection observe double rent,
  // welfare, illness, or production effects.
  const resolveTimePolicies = (resolvedPolicies: WorldCommandPolicies): WorldCommandPolicies => {
    const {
      educationSystem: strippedEducationSystem,
      sleepDeprivation: strippedSleepDeprivation,
      starvation: strippedStarvation,
      stochasticIllness: strippedStochasticIllness,
      renewableResources: strippedRenewableResources,
      lifecycle: strippedLifecycle,
      migration: strippedMigration,
      residentialUpkeep: strippedResidentialUpkeep,
      safetyNetSubsidy: strippedSafetyNetSubsidy,
      physiologicalSafetyNet: strippedPhysiologicalSafetyNet,
      wellbeing: strippedWellbeing,
      publicBudget: strippedPublicBudget,
      calendar: strippedCalendar,
      enterprise: strippedEnterprise,
      timeSettlementAmortization: strippedTimeSettlementAmortization,
      ...authorityTimePolicies
    } = resolvedPolicies;
    void strippedEducationSystem;
    void strippedSleepDeprivation;
    void strippedStarvation;
    void strippedStochasticIllness;
    void strippedRenewableResources;
    void strippedLifecycle;
    void strippedMigration;
    void strippedResidentialUpkeep;
    void strippedSafetyNetSubsidy;
    void strippedPhysiologicalSafetyNet;
    void strippedWellbeing;
    void strippedPublicBudget;
    void strippedCalendar;
    void strippedEnterprise;
    void strippedTimeSettlementAmortization;
    return authorityTimePolicies;
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
      assertAuthoritySnapshotJournalCoherence(state, readVerifiedJournal(journalPath));
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
      // Build the pure domain decision before publishing an intent. A rejected
      // command or validation error must not leave an orphan intent that looks
      // like a crash halfway through a successful mutation.
      const mutation = inputMutation.create(state, fencingToken);
      appendChainedJournal({
        schemaVersion: SIMULATION_WIDE_AUTHORITY_SCHEMA_VERSION,
        recordType: 'intent',
        operationId: inputMutation.operationId,
        requestFingerprint: inputMutation.requestFingerprint,
        fencingToken,
        recordedAt: inputMutation.lease.observedAt,
      });
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

  const applyGlobalCommand = <
    TKind extends 'trade' | 'conversation' | 'resource-transfer' | 'external-trade',
  >(inputCommand: {
    readonly kind: TKind;
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly lease: SimulationWideAuthorityLease;
    readonly actorId: AgentId;
    readonly commandType:
      | 'AgentTrade'
      | 'AgentStartConversation'
      | 'AgentGiveResource'
      | 'AgentExportCommodity'
      | 'AgentImportCommodity';
    readonly payload:
      | AgentTradePayload
      | AgentGiveResourcePayload
      | AgentExportCommodityPayload
      | AgentImportCommodityPayload
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
          throw new SimulationWideCommandRejectedError(
            inputCommand.kind,
            rejection.payload.reason,
            events,
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
    settleCredit(request) {
      const agentId = asAgentId(request.agentId);
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'credit',
          agentId,
          commandType: request.commandType,
          payload: request.payload,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const commandId = `simulation-wide-credit-${request.operationId}`;
          const creditEvents = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: commandId,
              simulationId: state.simulationId,
              actorId: agentId,
              source: 'agent-runtime',
              type: request.commandType,
              payload: request.payload,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = creditEvents.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new SimulationWideCommandRejectedError(
              'credit',
              rejection.payload.reason,
              creditEvents,
            );
          }
          const creditProjection = creditEvents.reduce(applyWorldEvent, state.projection);
          if (creditProjection.bank === undefined || policies.credit === undefined) {
            throw new Error('simulation-wide credit settlement produced no town bank state');
          }
          const bankSnapshot = createEventEnvelope({
            id: `${commandId}:event:bank-snapshot`,
            simulationId: state.simulationId,
            commandId,
            type: 'TownBankSnapshotRecorded',
            payload: {
              bank: creditProjection.bank,
              recordedAt: request.observedAt,
              reason: 'credit-command' as const,
              policyVersion: policies.credit.policyVersion,
            },
            occurredAt: request.observedAt,
            sequence: state.revision + creditEvents.length + 1,
          });
          const events = [...creditEvents, bankSnapshot];
          const operation: Extract<SimulationWideAuthorityOperation, { readonly kind: 'credit' }> =
            {
              kind: 'credit',
              operationId: request.operationId,
              fencingToken,
              ownerPartitionKey: requireOwner(state, agentId),
              events,
              status: 'completed',
            };
          return {
            state: {
              ...state,
              projection: applyWorldEvent(creditProjection, bankSnapshot),
            },
            operation,
          };
        },
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
    settleResourceTransfer(request) {
      const sourceAgentId = asAgentId(request.sourceAgentId);
      const targetAgentId = asAgentId(request.transfer.targetAgentId);
      return applyGlobalCommand({
        kind: 'resource-transfer',
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'resource-transfer',
          sourceAgentId,
          transfer: request.transfer,
        }),
        lease: request,
        actorId: sourceAgentId,
        commandType: 'AgentGiveResource',
        payload: request.transfer,
        createOperation: ({ fencingToken, events, state }) => ({
          kind: 'resource-transfer',
          operationId: request.operationId,
          fencingToken,
          sourcePartitionKey: requireOwner(state, sourceAgentId),
          targetPartitionKey: requireOwner(state, targetAgentId),
          events,
          status: 'completed',
        }),
      });
    },
    settleExternalTrade(request) {
      const agentId = asAgentId(request.agentId);
      return applyGlobalCommand({
        kind: 'external-trade',
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'external-trade',
          agentId,
          commandType: request.commandType,
          payload: request.payload,
        }),
        lease: request,
        actorId: agentId,
        commandType: request.commandType,
        payload: request.payload,
        createOperation: ({ fencingToken, events, state }) => ({
          kind: 'external-trade',
          operationId: request.operationId,
          fencingToken,
          ownerPartitionKey: requireOwner(state, agentId),
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
            throw new SimulationWideCommandRejectedError(
              'bulletin',
              rejection.payload.reason,
              events,
            );
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
    settlePetition(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'petition',
          agentId: request.agentId,
          commandType: request.commandType,
          payload: request.payload,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-petition-${request.operationId}`,
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
            throw new SimulationWideCommandRejectedError(
              'petition',
              rejection.payload.reason,
              events,
            );
          }
          const petitionEvent = events.find(
            (event) =>
              event.type === 'PetitionRaised' ||
              event.type === 'PetitionSigned' ||
              event.type === 'PetitionThresholdReached',
          );
          if (petitionEvent === undefined) {
            throw new Error('simulation-wide petition settlement produced no petition event');
          }
          const petitionId =
            petitionEvent.type === 'PetitionRaised'
              ? petitionEvent.payload.petition.petitionId
              : petitionEvent.payload.petitionId;
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'petition' }
          > = {
            kind: 'petition',
            operationId: request.operationId,
            fencingToken,
            petitionId,
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
    settleGovernance(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'governance',
          commandType: request.commandType,
          payload: request.payload,
          actorAgentId: request.actorAgentId,
          principalSubjectId: request.humanAttribution?.principalSubjectId,
          principalRoles: request.humanAttribution?.principalRoles,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const policies = resolvePolicies(state.projection);
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-governance-${request.operationId}`,
              simulationId: state.simulationId,
              ...(request.actorAgentId === undefined ? {} : { actorId: request.actorAgentId }),
              source: request.humanAttribution === undefined ? 'agent-runtime' : 'human',
              ...(request.humanAttribution === undefined
                ? {}
                : { humanAttribution: request.humanAttribution }),
              type: request.commandType,
              payload: request.payload,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'GovernanceChangeRejected');
          if (rejection?.type === 'GovernanceChangeRejected') {
            throw new SimulationWideCommandRejectedError(
              'governance',
              rejection.payload.detail,
              events,
            );
          }
          const changed = events.find((event) => event.type === 'GovernancePolicyChanged');
          if (changed?.type !== 'GovernancePolicyChanged') {
            throw new Error('simulation-wide governance settlement produced no policy event');
          }
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'governance' }
          > = {
            kind: 'governance',
            operationId: request.operationId,
            fencingToken,
            governanceRevision: changed.payload.governanceRevision,
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
    settleConstruction(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'construction',
          builderAgentId: request.builderAgentId,
          housing: request.housing,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const ownerPartitionKey = state.ownerPartitionKeyByAgentId[request.builderAgentId];
          if (ownerPartitionKey === undefined) {
            throw new Error(`cannot build housing for unowned Agent ${request.builderAgentId}`);
          }
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-construction-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: request.builderAgentId,
              source: 'agent-runtime',
              type: 'AgentBuildHousing',
              payload: request.housing,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies: resolvePolicies(state.projection),
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new SimulationWideCommandRejectedError(
              'construction',
              rejection.payload.reason,
              events,
            );
          }
          const expanded = events.find((event) => event.type === 'HousingCapacityExpanded');
          if (expanded?.type !== 'HousingCapacityExpanded') {
            throw new Error('simulation-wide construction settlement produced no capacity event');
          }
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'construction' }
          > = {
            kind: 'construction',
            operationId: request.operationId,
            fencingToken,
            ownerPartitionKey,
            locationId: expanded.payload.locationId,
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
    settleResidence(request) {
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'residence',
          agentId: request.agentId,
          residence: request.residence,
        }),
        lease: request,
        create: (state, fencingToken) => {
          const ownerPartitionKey = state.ownerPartitionKeyByAgentId[request.agentId];
          if (ownerPartitionKey === undefined) {
            throw new Error(`cannot choose residence for unowned Agent ${request.agentId}`);
          }
          const events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: `simulation-wide-residence-${request.operationId}`,
              simulationId: state.simulationId,
              actorId: request.agentId,
              source: 'agent-runtime',
              type: 'AgentChooseResidence',
              payload: request.residence,
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies: resolvePolicies(state.projection),
            nextSequence: state.revision + 1,
          });
          const rejection = events.find((event) => event.type === 'ActionRejected');
          if (rejection?.type === 'ActionRejected') {
            throw new SimulationWideCommandRejectedError(
              'residence',
              rejection.payload.reason,
              events,
            );
          }
          const changed = events.find((event) => event.type === 'AgentResidenceChanged');
          if (changed?.type !== 'AgentResidenceChanged') {
            throw new Error('simulation-wide residence settlement produced no residence event');
          }
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'residence' }
          > = {
            kind: 'residence',
            operationId: request.operationId,
            fencingToken,
            ownerPartitionKey,
            locationId: changed.payload.nextResidenceLocationId,
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
            throw new SimulationWideCommandRejectedError(
              'matter',
              rejection.payload.reason,
              events,
            );
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
            throw new SimulationWideCommandRejectedError(
              'conflict',
              rejection.payload.reason,
              events,
            );
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
          const crossOwner = destinationPartitionKey !== ownerPartitionKey;
          if (crossOwner) {
            rejectCrossOwnerMoveWithEnterpriseAffiliation({
              state,
              agentId,
              operationId: request.operationId,
              observedAt: request.observedAt,
            });
          }
          if (crossOwner && request.cognitiveSnapshot === undefined) {
            throw new Error(`cross-owner move for ${agentId} requires a cognitive snapshot`);
          }
          if (crossOwner && request.cognitiveSnapshot !== undefined) {
            assertValidAgentCognitiveSnapshot(request.cognitiveSnapshot, {
              agentId,
              sourcePartitionKey: ownerPartitionKey,
            });
          }
          if (!crossOwner && request.cognitiveSnapshot !== undefined) {
            throw new Error(`same-owner move for ${agentId} must not carry a cognitive snapshot`);
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
            throw new SimulationWideCommandRejectedError('move', rejection.payload.reason, events);
          }
          const projection = events.reduce(applyWorldEvent, state.projection);
          const arrived = events.some((event) => event.type === 'AgentLocationChanged');
          // Cross-owner completion emits paired ownership events: the source
          // stream stops tracking the Agent, the destination stream begins.
          const transferEvents = crossOwner
            ? createOwnershipTransferEvents({
                operationId: request.operationId,
                simulationId: state.simulationId,
                agentId,
                fromPartitionKey: ownerPartitionKey,
                toPartitionKey: destinationPartitionKey,
                projection,
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
      const agentStates = [...(request.agentStates ?? [])].sort((left, right) =>
        left.agentId.localeCompare(right.agentId),
      );
      const enterpriseStates = [...(request.enterpriseStates ?? [])].sort((left, right) =>
        left.enterpriseId.localeCompare(right.enterpriseId),
      );
      const departedAgentIds = [...(request.departedAgentIds ?? [])].sort();
      return mutate({
        operationId: request.operationId,
        // newAgents stay out of the fingerprint: after a crash the replayed
        // sync finds the agents already registered and omits their records,
        // and must still match the journaled request.
        // This receipt lives in authority state for every synchronization.
        // Store a fixed-size content digest instead of duplicating the full
        // population snapshot in the operations index. The operation id is
        // independently derived by the router and SHA-256 collision checking
        // retains the same deterministic idempotency contract.
        requestFingerprint: sha256Hex(
          stableStringify({
            kind: 'location-sync',
            partitionKey,
            agentLocations,
            agentStates,
            enterpriseStates,
            ...(departedAgentIds.length === 0 ? {} : { departedAgentIds }),
            ...(request.partitionAccounts === undefined
              ? {}
              : { partitionAccounts: request.partitionAccounts }),
            ...(request.partitionRuntimeState === undefined
              ? {}
              : { partitionRuntimeState: request.partitionRuntimeState }),
            ...(request.partitionClockNow === undefined
              ? {}
              : { partitionClockNow: request.partitionClockNow }),
          }),
        ),
        lease: request,
        create: (state, fencingToken) => {
          assertKnownPartition(state, partitionKey);
          const partitionClockNowByKey = resolvePartitionClockNowByKey(state);
          const previousPartitionClockNow =
            partitionClockNowByKey[partitionKey] ?? state.projection.clock.now;
          const partitionClockNow = request.partitionClockNow ?? previousPartitionClockNow;
          if (!Number.isFinite(partitionClockNow) || partitionClockNow < 0) {
            throw new Error('partitionClockNow must be a non-negative finite timestamp');
          }
          if (partitionClockNow < previousPartitionClockNow) {
            throw new Error(
              `partition clock for ${partitionKey} cannot move backwards from ${previousPartitionClockNow} to ${partitionClockNow}`,
            );
          }
          if (
            request.partitionAccounts !== undefined &&
            (!Number.isFinite(request.partitionAccounts.moneySupply) ||
              request.partitionAccounts.moneySupply < 0 ||
              (request.partitionAccounts.treasury !== undefined &&
                (!Number.isFinite(request.partitionAccounts.treasury) ||
                  request.partitionAccounts.treasury < 0)))
          ) {
            throw new Error('partition fiscal accounts must be non-negative finite');
          }
          const agents = { ...state.projection.agents };
          const enterprises = { ...state.projection.enterprises };
          const owners = { ...state.ownerPartitionKeyByAgentId };
          const registeredAgentIds: AgentId[] = [];
          const removedAgentIds: AgentId[] = [];
          for (const rawDepartedId of departedAgentIds) {
            const departedId = asAgentId(rawDepartedId);
            const owner = owners[departedId];
            const known = agents[departedId] !== undefined;
            if (!known && owner === undefined) {
              // Idempotent replay: the departure was already journaled.
              continue;
            }
            if (owner !== undefined && owner !== partitionKey) {
              throw new Error(
                `departure report for ${departedId} must come from owner partition ${owner}, not ${partitionKey}`,
              );
            }
            if (known && owner === undefined) {
              throw new Error(`departure report for unowned Agent ${departedId}`);
            }
            delete agents[departedId];
            delete owners[departedId];
            removedAgentIds.push(departedId);
          }
          const removedAgentIdSet = new Set<AgentId>(removedAgentIds);
          let creditProjection = state.projection;
          const departureCreditEvents: WorldEvent[] = [];
          if (state.projection.bank !== undefined) {
            for (const departedAgentId of removedAgentIds) {
              const decision = decideLiquidateDeceasedCustomer({
                bank: creditProjection.bank,
                agentId: departedAgentId,
                settledAt: partitionClockNow,
              });
              if (decision.status === 'rejected') {
                throw new Error(
                  `authority departure credit liquidation rejected for ${departedAgentId}: ${decision.reason}`,
                );
              }
              for (const domainEvent of decision.events) {
                const worldEvent = createDepartureCreditWorldEvent({
                  state,
                  operationId: request.operationId,
                  domainEvent,
                  occurredAt: request.observedAt,
                  sequence: state.revision + departureCreditEvents.length + 1,
                });
                departureCreditEvents.push(worldEvent);
                creditProjection = applyWorldEvent(creditProjection, worldEvent);
              }
            }
          }
          let departureProjection = creditProjection;
          const departureMatterEvents: WorldEvent[] = [];
          for (const matter of Object.values(state.projection.socialMatters ?? {})
            .filter((candidate) => candidate.status !== 'closed')
            .filter(
              (candidate) =>
                removedAgentIdSet.has(candidate.initiatorAgentId) ||
                (candidate.assigneeAgentId !== undefined &&
                  removedAgentIdSet.has(candidate.assigneeAgentId)),
            )
            .sort((left, right) => left.matterId.localeCompare(right.matterId))) {
            const event = createEventEnvelope({
              id: `simulation-wide-location-sync-${request.operationId}:event:matter-closed:${matter.matterId}`,
              simulationId: state.simulationId,
              commandId: `simulation-wide-location-sync-${request.operationId}`,
              type: 'MatterClosed',
              payload: {
                matterId: matter.matterId,
                closure: 'expired' as const,
                closedAt: partitionClockNow,
              },
              occurredAt: request.observedAt,
              sequence:
                state.revision + departureCreditEvents.length + departureMatterEvents.length + 1,
            }) as WorldEvent;
            departureMatterEvents.push(event);
            departureProjection = applyWorldEvent(departureProjection, event);
          }
          const departureBankSnapshot =
            departureCreditEvents.length === 0 || departureProjection.bank === undefined
              ? undefined
              : (createEventEnvelope({
                  id: `simulation-wide-location-sync-${request.operationId}:event:bank-snapshot`,
                  simulationId: state.simulationId,
                  commandId: `simulation-wide-location-sync-${request.operationId}`,
                  type: 'TownBankSnapshotRecorded',
                  payload: {
                    bank: departureProjection.bank,
                    recordedAt: partitionClockNow,
                    reason: 'customer-departure' as const,
                    policyVersion: 'town-bank-customer-departure-v1',
                  },
                  occurredAt: request.observedAt,
                  sequence:
                    state.revision +
                    departureCreditEvents.length +
                    departureMatterEvents.length +
                    1,
                }) as WorldEvent);
          const departureIntegrationEvents =
            departureBankSnapshot === undefined
              ? [...departureCreditEvents, ...departureMatterEvents]
              : [...departureCreditEvents, ...departureMatterEvents, departureBankSnapshot];
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
          for (const record of agentStates) {
            const agentId = asAgentId(record.agentId);
            const owner = owners[agentId];
            if (owner === undefined) {
              throw new Error(`unknown simulation-wide Agent ${agentId}`);
            }
            if (owner !== partitionKey) {
              throw new Error(
                `state sync for ${agentId} must come from owner partition ${owner}, not ${partitionKey}`,
              );
            }
            if (
              record.locationId !== null &&
              state.projection.locations[record.locationId] === undefined
            ) {
              throw new Error(
                `simulation-wide Agent ${agentId} reports unknown location ${record.locationId}`,
              );
            }
            if (stableStringify(agents[agentId]) !== stableStringify(record)) {
              agents[agentId] = clone(record);
              updatedAgentIds.push(agentId);
            }
          }
          const updatedEnterpriseIds: string[] = [];
          for (const enterprise of Object.values(enterprises)) {
            if (!removedAgentIdSet.has(enterprise.ownerAgentId)) {
              continue;
            }
            const reported = enterpriseStates.find(
              (candidate) => candidate.enterpriseId === enterprise.enterpriseId,
            );
            if ((reported ?? enterprise).status !== 'closed') {
              throw new Error(
                `departure sync for ${enterprise.ownerAgentId} requires closed enterprise ${enterprise.enterpriseId}`,
              );
            }
          }
          for (const record of enterpriseStates) {
            const ownerPartitionKey =
              owners[record.ownerAgentId] ?? state.ownerPartitionKeyByAgentId[record.ownerAgentId];
            if (ownerPartitionKey === undefined) {
              throw new Error(
                `enterprise ${record.enterpriseId} has unknown owner ${record.ownerAgentId}`,
              );
            }
            if (ownerPartitionKey !== partitionKey) {
              throw new Error(
                `enterprise ${record.enterpriseId} state sync must come from owner partition ${ownerPartitionKey}, not ${partitionKey}`,
              );
            }
            if (removedAgentIdSet.has(record.ownerAgentId) && record.status !== 'closed') {
              throw new Error(
                `departure sync for ${record.ownerAgentId} requires closed enterprise ${record.enterpriseId}`,
              );
            }
            if (stableStringify(enterprises[record.enterpriseId]) !== stableStringify(record)) {
              enterprises[record.enterpriseId] = clone(record);
              updatedEnterpriseIds.push(record.enterpriseId);
            }
          }
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
            if (!updatedAgentIds.includes(agentId)) {
              updatedAgentIds.push(agentId);
            }
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
          const activityTimeByAgent = withoutRecordKeys(
            mergeOwnerScopedRecord({
              current: state.projection.activityTimeByAgent,
              reported: request.partitionRuntimeState?.activityTimeByAgent,
              owners,
              partitionKey,
              valueName: 'activity-time',
            }),
            removedAgentIds,
          );
          const transitByAgent = withoutRecordKeys(
            mergeOwnerScopedRecord({
              current: state.projection.transitByAgent ?? {},
              reported: request.partitionRuntimeState?.transitByAgent,
              owners,
              partitionKey,
              valueName: 'transit',
            }),
            removedAgentIds,
          );
          const timeSettlementByAgent = withoutRecordKeys(
            mergeOwnerScopedRecord({
              current: state.projection.timeSettlementByAgent ?? {},
              reported: request.partitionRuntimeState?.timeSettlementByAgent,
              owners,
              partitionKey,
              valueName: 'time-settlement',
            }),
            removedAgentIds,
          );
          const physiologicalDistressByAgent = withoutRecordKeys(
            mergeOwnerScopedRecord({
              current: state.projection.physiologicalDistressByAgent,
              reported: request.partitionRuntimeState?.physiologicalDistressByAgent,
              owners,
              partitionKey,
              valueName: 'physiological-distress',
            }),
            removedAgentIds,
          );
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'location-sync' }
          > = {
            kind: 'location-sync',
            operationId: request.operationId,
            fencingToken,
            partitionKey,
            updatedAgentIds,
            ...(updatedEnterpriseIds.length === 0 ? {} : { updatedEnterpriseIds }),
            ...(registeredAgentIds.length === 0 ? {} : { registeredAgentIds }),
            ...(mergedMemoryRecords.length === 0
              ? {}
              : { mergedMemoryRecordIds: mergedMemoryRecords.map((record) => record.id) }),
            ...(removedAgentIds.length === 0 ? {} : { removedAgentIds }),
            status: 'completed',
            events: departureIntegrationEvents,
          };
          const cleanedPendingTransfers =
            removedAgentIds.length === 0
              ? undefined
              : (() => {
                  const pendingTransfers = { ...(state.pendingTransfers ?? {}) };
                  for (const removedId of removedAgentIds) {
                    delete pendingTransfers[removedId];
                  }
                  return pendingTransfers;
                })();
          const cleanedPendingMoves =
            removedAgentIds.length === 0
              ? undefined
              : (() => {
                  const pendingMoves = { ...(state.pendingMoves ?? {}) };
                  for (const removedId of removedAgentIds) {
                    delete pendingMoves[removedId];
                  }
                  return pendingMoves;
                })();
          const nextPartitionClockNowByKey = {
            ...partitionClockNowByKey,
            [partitionKey]: partitionClockNow,
          };
          const nextPartitionAccountsByKey =
            request.partitionAccounts === undefined
              ? state.partitionAccountsByKey
              : {
                  ...(state.partitionAccountsByKey ?? {}),
                  [partitionKey]: {
                    moneySupply: request.partitionAccounts.moneySupply,
                    ...(request.partitionAccounts.treasury === undefined
                      ? {}
                      : { treasury: request.partitionAccounts.treasury }),
                  },
                };
          let synchronizedProjection: WorldProjection = {
            ...state.projection,
            agents,
            enterprises,
            memoryRecords,
            activityTimeByAgent,
            transitByAgent,
            timeSettlementByAgent,
            physiologicalDistressByAgent,
            ...(departureProjection.bank === undefined ? {} : { bank: departureProjection.bank }),
            ...(departureProjection.socialMatters === undefined
              ? {}
              : { socialMatters: departureProjection.socialMatters }),
          };
          if (state.partitionKeys.length === 1 && request.partitionAccounts !== undefined) {
            synchronizedProjection = {
              ...synchronizedProjection,
              moneySupply: request.partitionAccounts.moneySupply,
              ...(request.partitionAccounts.treasury === undefined
                ? {}
                : { treasury: request.partitionAccounts.treasury }),
              ...(request.partitionAccounts.bank === undefined
                ? {}
                : { bank: clone(request.partitionAccounts.bank) }),
            };
          } else if (
            nextPartitionAccountsByKey !== undefined &&
            state.partitionKeys.every(
              (key) =>
                nextPartitionAccountsByKey[key] !== undefined &&
                nextPartitionClockNowByKey[key] === partitionClockNow,
            )
          ) {
            const contributions = state.partitionKeys.map(
              (key) => nextPartitionAccountsByKey[key]!,
            );
            const moneySupply = contributions.reduce(
              (total, accounts) => total + accounts.moneySupply,
              0,
            );
            const hasTreasury = contributions.some((accounts) => accounts.treasury !== undefined);
            if (hasTreasury) {
              synchronizedProjection = {
                ...synchronizedProjection,
                moneySupply,
                treasury: contributions.reduce(
                  (total, accounts) => total + (accounts.treasury ?? 0),
                  0,
                ),
              };
            } else {
              const { treasury: previousTreasury, ...withoutTreasury } = synchronizedProjection;
              void previousTreasury;
              synchronizedProjection = { ...withoutTreasury, moneySupply };
            }
          }
          return {
            state: {
              ...state,
              projection: synchronizedProjection,
              ownerPartitionKeyByAgentId: owners,
              partitionClockNowByKey: nextPartitionClockNowByKey,
              ...(nextPartitionAccountsByKey === undefined
                ? {}
                : { partitionAccountsByKey: nextPartitionAccountsByKey }),
              ...(cleanedPendingTransfers === undefined
                ? {}
                : { pendingTransfers: cleanedPendingTransfers }),
              ...(cleanedPendingMoves === undefined ? {} : { pendingMoves: cleanedPendingMoves }),
            },
            operation,
          };
        },
      });
    },
    recordRejectedCommand(request) {
      if (request.reason.trim().length === 0) {
        throw new Error('simulation-wide rejection reason must not be empty');
      }
      if (request.events.length === 0) {
        throw new Error('simulation-wide rejection must contain at least one event');
      }
      return mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'command-rejected',
          partitionKey: request.partitionKey,
          commandType: request.commandType,
          reason: request.reason,
          events: request.events,
        }),
        lease: request,
        create: (state, fencingToken) => {
          assertKnownPartition(state, request.partitionKey);
          const events = request.events.map((event, index) => ({
            ...clone(event),
            sequence: state.revision + index + 1,
          })) as readonly WorldEvent[];
          const operation: Extract<
            SimulationWideAuthorityOperation,
            { readonly kind: 'command-rejected' }
          > = {
            kind: 'command-rejected',
            operationId: request.operationId,
            fencingToken,
            partitionKey: request.partitionKey,
            commandType: request.commandType,
            reason: request.reason,
            events,
            status: 'rejected',
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
    advanceTime(request) {
      const operation = mutate({
        operationId: request.operationId,
        requestFingerprint: stableStringify({
          kind: 'advance-time',
          deltaMs: request.deltaMs,
        }),
        lease: request,
        create: (state, fencingToken) => {
          assertEveryPartitionPublishedThrough(state, state.projection.clock.now);
          const resolvedPolicies = resolvePolicies(state.projection);
          const policies = resolveTimePolicies(resolvedPolicies);
          const serviceQualityFundingBySettledAt =
            policies.serviceQuality === undefined || resolvedPolicies.publicBudget === undefined
              ? undefined
              : createSimulationWideServiceQualityFunding({
                  previousSimulationTime: state.projection.clock.now,
                  nextSimulationTime: state.projection.clock.now + request.deltaMs,
                  partitionKeys: state.partitionKeys,
                  partitionAccountsByKey: state.partitionAccountsByKey,
                  publicBudget: resolvedPolicies.publicBudget,
                });
          const commandId = `simulation-wide-advance-${request.operationId}`;
          let events = dispatchWorldCommand({
            command: createCommandEnvelope({
              id: commandId,
              simulationId: state.simulationId,
              source: 'system',
              type: 'AdvanceSimulationTime',
              payload: { deltaMs: request.deltaMs },
              issuedAt: request.observedAt,
            }),
            projection: state.projection,
            policies,
            ...(serviceQualityFundingBySettledAt === undefined
              ? {}
              : { serviceQualityFundingBySettledAt }),
            nextSequence: state.revision + 1,
          });
          let projection = events.reduce(applyWorldEvent, state.projection);
          const creditAccrued = events.some(
            (event) =>
              event.type === 'LoanRepaid' ||
              event.type === 'LoanDefaulted' ||
              event.type === 'DepositInterestPaid' ||
              event.type === 'LoanWrittenOff' ||
              event.type === 'DepositForfeited',
          );
          if (creditAccrued) {
            if (projection.bank === undefined || policies.credit === undefined) {
              throw new Error('credit accrual produced no authoritative town bank state');
            }
            const bankSnapshot = createEventEnvelope({
              id: `${commandId}:event:bank-snapshot`,
              simulationId: state.simulationId,
              commandId,
              type: 'TownBankSnapshotRecorded',
              payload: {
                bank: projection.bank,
                recordedAt: state.projection.clock.now + request.deltaMs,
                reason: 'credit-accrual' as const,
                policyVersion: policies.credit.policyVersion,
              },
              occurredAt: request.observedAt,
              sequence: state.revision + events.length + 1,
            });
            events = [...events, bankSnapshot];
            projection = applyWorldEvent(projection, bankSnapshot);
          }
          const migrationPolicy = resolveMigrationPolicy(state.projection);
          const arrivalSettlement = settleDemandDrivenArrivals({
            simulationId: state.simulationId,
            previousSimulationTime: state.projection.clock.now,
            nextSimulationTime: state.projection.clock.now + request.deltaMs,
            revision: state.revision,
            projection,
            existingEvents: events,
            ownerPartitionKeyByAgentId: state.ownerPartitionKeyByAgentId,
            partitionKeys: state.partitionKeys,
            ...(state.partitionAccountsByKey === undefined
              ? {}
              : { partitionAccountsByKey: state.partitionAccountsByKey }),
            commandPolicies: resolveWorldCommandPolicies({
              policies: input.policies,
              projection: state.projection,
            }),
            ...(migrationPolicy?.inMigration === undefined
              ? {}
              : {
                  migrationPolicyVersion: migrationPolicy.policyVersion,
                  fallbackWellbeing: migrationPolicy.fallbackWellbeing,
                  policy: migrationPolicy.inMigration,
                }),
          });
          events = [...arrivalSettlement.events];
          projection = arrivalSettlement.projection;
          const movedAgentIds = events
            .filter((event) => event.type === 'AgentLocationChanged')
            .map((event) => event.payload.agentId);
          const owners = { ...arrivalSettlement.ownerPartitionKeyByAgentId };
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
                  projection,
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
              ...(arrivalSettlement.partitionAccountsByKey === undefined
                ? {}
                : { partitionAccountsByKey: arrivalSettlement.partitionAccountsByKey }),
            },
            operation: {
              ...primary,
              ...(arrivalSettlement.registeredAgents.length === 0
                ? {}
                : { registeredAgents: arrivalSettlement.registeredAgents }),
            },
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
        const state = readSnapshot(statePath);
        const journal = readVerifiedJournal(journalPath);
        assertAuthoritySnapshotJournalCoherence(state, journal);
        const completed = new Set(
          journal
            .filter((record) => record.recordType === 'completed')
            .map((record) => record.operationId),
        );
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

function mergeOwnerScopedRecord<TValue>(input: {
  readonly current: Readonly<Record<string, TValue>>;
  readonly reported: Readonly<Record<string, TValue>> | undefined;
  readonly owners: Readonly<Record<string, PartitionKey>>;
  readonly partitionKey: PartitionKey;
  readonly valueName: string;
}): Readonly<Record<string, TValue>> {
  if (input.reported === undefined) {
    return input.current;
  }
  const merged = Object.fromEntries(
    Object.entries(input.current).filter(
      ([agentId]) => input.owners[agentId] !== input.partitionKey,
    ),
  );
  for (const [agentId, value] of Object.entries(input.reported).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const owner = input.owners[agentId];
    if (owner !== input.partitionKey) {
      throw new Error(
        `${input.valueName} sync for ${agentId} must come from owner partition ${String(owner)}, not ${input.partitionKey}`,
      );
    }
    merged[agentId] = clone(value);
  }
  return merged;
}

function withoutRecordKeys<TValue>(
  record: Readonly<Record<string, TValue>>,
  removedAgentIds: readonly AgentId[],
): Readonly<Record<string, TValue>> {
  if (removedAgentIds.length === 0) {
    return record;
  }
  const next = { ...record };
  for (const agentId of removedAgentIds) {
    delete next[agentId];
  }
  return next;
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
  if (
    seed.partitionAccountsByKey !== undefined &&
    partitionKeys.some((partitionKey) => seed.partitionAccountsByKey?.[partitionKey] === undefined)
  ) {
    throw new Error('every simulation-wide partition must have an initial fiscal contribution');
  }
  if (seed.partitionAccountsByKey !== undefined) {
    const contributions = partitionKeys.map(
      (partitionKey) => seed.partitionAccountsByKey![partitionKey]!,
    );
    const moneySupply = contributions.reduce((total, accounts) => total + accounts.moneySupply, 0);
    const treasury = contributions.reduce((total, accounts) => total + (accounts.treasury ?? 0), 0);
    if (
      moneySupply !== seed.projection.moneySupply ||
      treasury !== (seed.projection.treasury ?? 0)
    ) {
      throw new Error('partition fiscal contributions must sum to the authority seed accounts');
    }
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
    partitionClockNowByKey: Object.fromEntries(
      partitionKeys.map((partitionKey) => [partitionKey, seed.projection.clock.now]),
    ),
    ...(seed.partitionAccountsByKey === undefined
      ? {}
      : { partitionAccountsByKey: clone(seed.partitionAccountsByKey) }),
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

function resolvePartitionClockNowByKey(
  state: SimulationWideAuthoritySnapshot,
): Readonly<Record<string, number>> {
  // Legacy snapshots predate the barrier. Treat their clocks as unpublished
  // rather than guessing they match the authority: every owner must report a
  // fresh boundary before the next global advance.
  return state.partitionClockNowByKey ?? {};
}

/**
 * Replays each owner partition's real public-budget aggregate in memory and
 * combines only the education/healthcare funding facts needed by the
 * simulation-wide service-quality decision. Cash remains partition-owned and
 * is persisted by the local PublicBudgetSpent events, so this calculation must
 * never mutate the authority treasury or emit a second transfer.
 */
function createSimulationWideServiceQualityFunding(input: {
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly partitionKeys: readonly PartitionKey[];
  readonly partitionAccountsByKey:
    | Readonly<Record<string, Pick<WorldProjection, 'moneySupply' | 'treasury'>>>
    | undefined;
  readonly publicBudget: PublicBudgetPolicy;
}): Readonly<Record<number, Partial<Record<TownPublicService, number>>>> {
  const missingPartition = input.partitionKeys.find(
    (partitionKey) => input.partitionAccountsByKey?.[partitionKey] === undefined,
  );
  if (missingPartition !== undefined) {
    throw new Error(
      `simulation-wide service quality requires fiscal state from partition ${missingPartition}`,
    );
  }
  const treasuryByPartition = Object.fromEntries(
    input.partitionKeys.map((partitionKey) => [
      partitionKey,
      input.partitionAccountsByKey![partitionKey]!.treasury ?? 0,
    ]),
  );
  const fundingBySettledAt: Record<number, Partial<Record<TownPublicService, number>>> = {};
  const cycles = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: input.publicBudget.cadenceMs,
  });
  for (const cycle of cycles) {
    const settledAt = (cycle + 1) * input.publicBudget.cadenceMs;
    const funding: Partial<Record<TownPublicService, number>> = {};
    for (const partitionKey of input.partitionKeys) {
      let treasury = treasuryByPartition[partitionKey]!;
      for (const decision of settlePublicBudget({ treasury, policy: input.publicBudget })) {
        treasury = decision.nextTreasury;
        if (decision.service !== 'education' && decision.service !== 'healthcare') continue;
        funding[decision.service] = (funding[decision.service] ?? 0) + decision.amount;
      }
      treasuryByPartition[partitionKey] = treasury;
    }
    fundingBySettledAt[settledAt] = funding;
  }
  return fundingBySettledAt;
}

function assertEveryPartitionPublishedThrough(
  state: SimulationWideAuthoritySnapshot,
  requiredClockNow: number,
): void {
  const publishedClockNowByKey = resolvePartitionClockNowByKey(state);
  const laggingPartitions = state.partitionKeys.flatMap((partitionKey) => {
    const publishedClockNow = publishedClockNowByKey[partitionKey];
    return (publishedClockNow ?? -1) < requiredClockNow
      ? [{ partitionKey, ...(publishedClockNow === undefined ? {} : { publishedClockNow }) }]
      : [];
  });
  if (laggingPartitions.length > 0) {
    throw new SimulationWideAuthorityPartitionBarrierError({
      requiredClockNow,
      laggingPartitions,
    });
  }
}

function createInboxDeliveries(
  operation: SimulationWideAuthorityOperation,
  partitionKeys: readonly PartitionKey[],
  ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>,
): readonly SimulationWideAuthorityInboxDelivery[] {
  switch (operation.kind) {
    case 'command-rejected':
      return [
        {
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey: operation.partitionKey,
          operationKind: operation.kind,
          events: operation.events,
        },
      ];
    case 'credit': {
      const bankSnapshotEvents = operation.events.filter(
        (event) => event.type === 'TownBankSnapshotRecorded',
      );
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events:
          partitionKey === operation.ownerPartitionKey ? operation.events : bankSnapshotEvents,
      }));
    }
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
    case 'resource-transfer': {
      const participantPartitions = new Set([
        operation.sourcePartitionKey,
        operation.targetPartitionKey,
      ]);
      return partitionKeys.flatMap((partitionKey) => {
        const events = participantPartitions.has(partitionKey)
          ? operation.events
          : operation.events.filter(
              (event) => event.type === 'MatterProgressed' || event.type === 'MatterClosed',
            );
        return events.length === 0
          ? []
          : [
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
    case 'external-trade':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events:
          partitionKey === operation.ownerPartitionKey
            ? operation.events
            : operation.events.filter((event) => event.type === 'ExternalTradeExecuted'),
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
    case 'petition':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: operation.events,
      }));
    case 'governance':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: operation.events,
      }));
    case 'construction':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events:
          partitionKey === operation.ownerPartitionKey
            ? operation.events
            : operation.events.filter((event) => event.type === 'HousingCapacityExpanded'),
      }));
    case 'residence':
      return partitionKeys.map((partitionKey) => ({
        operationId: operation.operationId,
        fencingToken: operation.fencingToken,
        partitionKey,
        operationKind: operation.kind,
        events: partitionKey === operation.ownerPartitionKey ? operation.events : [],
      }));
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
      const fullRecipients = new Set<PartitionKey>();
      for (const transfer of operation.completedTransfers) {
        fullRecipients.add(transfer.sourcePartitionKey);
        fullRecipients.add(transfer.destinationPartitionKey);
      }
      for (const partitionKey of fullRecipients) {
        // A completed legacy transfer receives the full time-advance payload,
        // but credit cash movements are owner-scoped. Convert the aggregate
        // deposit-interest event into one per-Agent event and discard remote
        // borrowers' repayment/default events. The final bank snapshot remains
        // town-wide and replaces the aggregate exactly once.
        addEvents(
          partitionKey,
          createPartitionCreditTimeEvents(
            operation.events,
            partitionKey,
            ownerPartitionKeyByAgentId,
          ),
        );
      }
      for (const event of operation.events) {
        if (event.type === 'LoanRepaid' || event.type === 'LoanDefaulted') {
          const owner = ownerPartitionKeyByAgentId[event.payload.borrowerAgentId];
          if (owner !== undefined && !fullRecipients.has(owner)) addEvents(owner, [event]);
          continue;
        }
        if (event.type === 'DepositInterestPaid') {
          for (const payment of event.payload.payments) {
            const owner = ownerPartitionKeyByAgentId[payment.agentId];
            if (owner === undefined || fullRecipients.has(owner)) continue;
            addEvents(owner, [createBankInterestCreditedEvent(event, payment)]);
          }
        }
      }
      for (const registration of operation.registeredAgents ?? []) {
        const registrationEvent = operation.events.find(
          (event) =>
            event.type === 'AgentRegistered' && event.payload.agentId === registration.agentId,
        );
        if (registrationEvent === undefined) {
          throw new Error(
            `time advance ${operation.operationId} is missing registration event for ${registration.agentId}`,
          );
        }
        if (!fullRecipients.has(registration.ownerPartitionKey)) {
          addEvents(registration.ownerPartitionKey, [registrationEvent]);
        }
      }
      // Town-wide cadence facts during this advance (board lifecycle, weather,
      // service quality, land value, external liquidity/trade balance):
      // partitions that already receive the full advance event set have them
      // inline; everyone else gets just these facts. Calendar phases remain
      // partition-local pure clock derivations and are stripped from authority
      // advancement, preventing duplicate phase facts in partition streams.
      const townWideEvents = operation.events.filter(
        (event) =>
          event.type === 'BulletinPosted' ||
          event.type === 'PetitionExpired' ||
          event.type === 'PetitionThresholdReached' ||
          event.type === 'MatterClosed' ||
          event.type === 'SocialInteractionCompleted' ||
          event.type === 'WeatherChanged' ||
          event.type === 'RegionalServiceQualityUpdated' ||
          event.type === 'RegionalLandValueUpdated' ||
          event.type === 'ExternalMarketRebalanced' ||
          event.type === 'ExternalTradeBalancesDecayed' ||
          event.type === 'TownBankSnapshotRecorded' ||
          // Matter-expiry closures carry the parties' memory records; they
          // must ride along so each owner partition materializes them.
          event.type === 'ShortTermMemoryRecorded',
      );
      if (townWideEvents.length > 0) {
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
      if (operation.events.length === 0) {
        return [];
      }
      return partitionKeys
        .map((partitionKey) => ({
          operationId: operation.operationId,
          fencingToken: operation.fencingToken,
          partitionKey,
          operationKind: operation.kind,
          // The owner already replayed detailed departure facts locally.
          // Every partition replaces its bank replica; only remote partitions
          // receive matter closures, preventing a duplicate close at source.
          events: operation.events.filter(
            (event) =>
              event.type === 'TownBankSnapshotRecorded' ||
              (partitionKey !== operation.partitionKey && event.type === 'MatterClosed'),
          ),
        }))
        .filter((delivery) => delivery.events.length > 0);
  }
}

function createDepartureCreditWorldEvent(input: {
  readonly state: SimulationWideAuthoritySnapshot;
  readonly operationId: string;
  readonly domainEvent: CreditDomainEvent;
  readonly occurredAt: number;
  readonly sequence: number;
}): WorldEvent {
  const common = {
    simulationId: input.state.simulationId,
    commandId: `simulation-wide-location-sync-${input.operationId}`,
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  } as const;
  if (input.domainEvent.type === 'LoanWrittenOff') {
    return createEventEnvelope({
      ...common,
      id: `simulation-wide-location-sync-${input.operationId}:event:loan-writeoff:${input.domainEvent.loanId}`,
      type: 'LoanWrittenOff',
      payload: {
        loanId: input.domainEvent.loanId,
        borrowerAgentId: input.domainEvent.borrowerAgentId,
        writtenOffAt: input.domainEvent.writtenOffAt,
        outstandingPrincipal: input.domainEvent.outstandingPrincipal,
        outstandingInterest: input.domainEvent.outstandingInterest,
        reason: 'borrower-deceased',
      },
    }) as WorldEvent;
  }
  if (input.domainEvent.type === 'DepositForfeited') {
    return createEventEnvelope({
      ...common,
      id: `simulation-wide-location-sync-${input.operationId}:event:deposit-forfeiture:${input.domainEvent.agentId}`,
      type: 'DepositForfeited',
      payload: {
        agentId: input.domainEvent.agentId,
        forfeitedAmount: input.domainEvent.forfeitedAmount,
        forfeitedAt: input.domainEvent.forfeitedAt,
        reason: 'depositor-deceased',
      },
    }) as WorldEvent;
  }
  throw new Error(
    `departure credit liquidation produced unexpected event ${input.domainEvent.type}`,
  );
}

function createPartitionCreditTimeEvents(
  events: readonly WorldEvent[],
  partitionKey: PartitionKey,
  ownerPartitionKeyByAgentId: Readonly<Record<string, PartitionKey>>,
): readonly WorldEvent[] {
  return events.flatMap((event) => {
    if (event.type === 'DepositInterestPaid') {
      return event.payload.payments
        .filter((payment) => ownerPartitionKeyByAgentId[payment.agentId] === partitionKey)
        .map((payment) => createBankInterestCreditedEvent(event, payment));
    }
    if (event.type === 'LoanRepaid' || event.type === 'LoanDefaulted') {
      return ownerPartitionKeyByAgentId[event.payload.borrowerAgentId] === partitionKey
        ? [event]
        : [];
    }
    if (event.type === 'AgentRegistered') {
      return ownerPartitionKeyByAgentId[event.payload.agentId] === partitionKey ? [event] : [];
    }
    // These lifecycle events only mutate the bank aggregate. The following
    // TownBankSnapshotRecorded event carries the authoritative result without
    // exposing a deceased Agent owned by another partition.
    if (event.type === 'LoanWrittenOff' || event.type === 'DepositForfeited') {
      return [];
    }
    return [event];
  });
}

function createBankInterestCreditedEvent(
  event: Extract<WorldEvent, { readonly type: 'DepositInterestPaid' }>,
  payment: (typeof event.payload.payments)[number],
): WorldEvent {
  return createEventEnvelope({
    id: `${event.id}:credit:${payment.agentId}`,
    simulationId: event.simulationId,
    ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
    type: 'BankInterestCredited',
    payload: {
      ...payment,
      paidAt: event.payload.paidAt,
      policyVersion: event.payload.policyVersion,
    },
    occurredAt: event.occurredAt,
    sequence: event.sequence,
  });
}

function createCursorKey(partitionKey: PartitionKey, consumerId: string): string {
  return `${partitionKey}:${consumerId}`;
}

/**
 * Enterprise aggregates and their payroll currently settle on the partition
 * that owns all participating Agents. Moving an owner or employee to another
 * execution partition without an enterprise handoff would leave an active
 * aggregate in one projection and a missing participant in the other. Refuse
 * that transition as an auditable Agent rejection instead of creating a
 * replay-valid but unusable split aggregate.
 */
function rejectCrossOwnerMoveWithEnterpriseAffiliation(input: {
  readonly state: SimulationWideAuthoritySnapshot;
  readonly agentId: AgentId;
  readonly operationId: string;
  readonly observedAt: number;
}): void {
  const affiliations = Object.values(input.state.projection.enterprises)
    .filter((enterprise) => enterprise.status !== 'closed')
    .filter(
      (enterprise) =>
        enterprise.ownerAgentId === input.agentId ||
        enterprise.employeeAgentIds.includes(input.agentId),
    )
    .map((enterprise) => enterprise.enterpriseId)
    .sort();
  if (affiliations.length === 0) {
    return;
  }
  const reason = `cross-partition movement requires leaving or closing enterprise affiliation first: ${affiliations.join(', ')}`;
  const event = createEventEnvelope({
    id: `simulation-wide-move-enterprise-rejected-${input.operationId}`,
    simulationId: input.state.simulationId,
    commandId: `simulation-wide-move-${input.operationId}`,
    type: 'ActionRejected',
    payload: {
      agentId: input.agentId,
      commandType: 'AgentMoveTo',
      reason,
    },
    occurredAt: input.observedAt,
    sequence: input.state.revision + 1,
  }) as WorldEvent;
  throw new SimulationWideCommandRejectedError('move', reason, [event]);
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
  readonly projection: WorldProjection;
  readonly occurredAt: number;
}): { readonly departure: WorldEvent; readonly arrival: WorldEvent } {
  const state = input.projection.agents[input.agentId];
  if (state === undefined) {
    throw new Error(`cannot transfer unknown Agent ${input.agentId}`);
  }
  const departure = createEventEnvelope({
    id: `simulation-wide-departure-${input.operationId}`,
    simulationId: input.simulationId,
    type: 'AgentOwnershipDeparted',
    payload: {
      agentId: input.agentId,
      toPartitionKey: input.toPartitionKey,
      transferOperationId: input.operationId,
      circulatingBalanceTransferred: state.balance,
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
      circulatingBalanceTransferred: state.balance,
      agentState: {
        locationId: state.locationId,
        ...(state.residenceLocationId === undefined
          ? {}
          : { residenceLocationId: state.residenceLocationId }),
        physiology: { ...state.physiology },
        educationScore: state.educationScore,
        balance: state.balance,
        residentialTier: state.residentialTier,
        job: state.job,
        inventory: { ...state.inventory },
        // Durable goods and arrears are economic state, not disposable read
        // context. Omitting either would destroy assets or forgive debt when
        // the source projection removes the migrant.
        ...(state.durableGoods === undefined
          ? {}
          : { durableGoods: state.durableGoods.map((lot) => ({ ...lot })) }),
        ...(state.upkeepArrears === undefined ? {} : { upkeepArrears: state.upkeepArrears }),
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
        ...(state.registeredAtMs === undefined && state.registration === undefined
          ? {}
          : { registeredAtMs: state.registeredAtMs ?? state.registration!.registeredAt }),
        // Education aggregate travels too: losing it on migration would reset
        // the vocational track, production/job multipliers, and exam-attempt
        // caps to the score-derived defaults.
        ...(state.educationLevel === undefined ? {} : { educationLevel: state.educationLevel }),
        ...(state.educationTrack === undefined ? {} : { educationTrack: state.educationTrack }),
        ...(state.examAttempts === undefined ? {} : { examAttempts: state.examAttempts }),
        // Runtime registration is also authorization state: creator quotas,
        // participant access, and the public display name all depend on it.
        ...(state.registration === undefined
          ? {}
          : {
              registration: {
                ...state.registration,
                ...(state.registration.humanAttribution === undefined
                  ? {}
                  : {
                      humanAttribution: {
                        ...state.registration.humanAttribution,
                        principalRoles: [...state.registration.humanAttribution.principalRoles],
                      },
                    }),
              },
            }),
      },
      ...(input.projection.activityTimeByAgent[input.agentId] === undefined
        ? {}
        : { activityTime: { ...input.projection.activityTimeByAgent[input.agentId] } }),
      ...(input.projection.timeSettlementByAgent?.[input.agentId] === undefined
        ? {}
        : { lastTimeSettledAt: input.projection.timeSettlementByAgent[input.agentId] }),
      ...(input.projection.physiologicalDistressByAgent[input.agentId] === undefined
        ? {}
        : {
            physiologicalDistress: {
              ...input.projection.physiologicalDistressByAgent[input.agentId],
              lowAxes: [...input.projection.physiologicalDistressByAgent[input.agentId]!.lowAxes],
            },
          }),
      socialRelations: Object.values(input.projection.socialRelations)
        .filter(
          (relation) =>
            relation.sourceAgentId === input.agentId || relation.targetAgentId === input.agentId,
        )
        .sort((left, right) =>
          `${left.sourceAgentId}:${left.targetAgentId}`.localeCompare(
            `${right.sourceAgentId}:${right.targetAgentId}`,
          ),
        )
        .map((relation) => ({ ...relation })),
      socialCommitments: Object.values(input.projection.socialCommitments)
        .filter(
          (commitment) =>
            commitment.promisorAgentId === input.agentId ||
            commitment.beneficiaryAgentId === input.agentId,
        )
        .sort((left, right) => left.commitmentId.localeCompare(right.commitmentId))
        .map((commitment) => ({ ...commitment })),
      ...(input.projection.conflictRecords === undefined
        ? {}
        : {
            conflictRecords: input.projection.conflictRecords
              .filter(
                (record) =>
                  record.actorAgentId === input.agentId ||
                  record.targetAgentId === input.agentId ||
                  record.counterpartyAgentId === input.agentId,
              )
              .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
              .map((record) => ({ ...record })),
          }),
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
  if (
    typeof parsed.authorityId !== 'string' ||
    parsed.authorityId.trim().length === 0 ||
    typeof parsed.manifestId !== 'string' ||
    parsed.manifestId.trim().length === 0
  ) {
    throw new Error('simulation-wide authority identity is invalid');
  }
  if (
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 0 ||
    !Number.isInteger(parsed.latestFencingToken) ||
    parsed.latestFencingToken < 0
  ) {
    throw new Error('simulation-wide authority revision is invalid');
  }
  return {
    ...parsed,
    projection: normalizeLegacyWorldProjectionSnapshot(parsed.projection),
  };
}

function readVerifiedJournal(path: string): readonly AuthorityJournalRecord[] {
  const records = readJournal(path);
  const verification = verifyJournalChainRecords(records);
  if (!verification.valid) {
    throw new Error(
      `simulation-wide authority journal chain is broken at record ${verification.firstBrokenRecordIndex}`,
    );
  }
  return records;
}

/**
 * The state file is the recoverable write model; the journal proves how every
 * committed operation entered it. A missing completion is the one supported
 * crash window (state rename succeeded, completion append did not). Missing
 * intents or completions for absent state operations indicate truncation or a
 * stale state restore and must never be repaired by guessing.
 */
function assertAuthoritySnapshotJournalCoherence(
  state: SimulationWideAuthoritySnapshot,
  journal: readonly AuthorityJournalRecord[],
): void {
  const operations = Object.entries(state.operations);
  if (state.revision !== operations.length || state.latestFencingToken !== state.revision) {
    throw new Error(
      'simulation-wide authority state revision does not match its durable operation table',
    );
  }
  const intentsByOperationId = new Map<string, AuthorityJournalRecord[]>();
  const completedOperationIds = new Set<string>();
  for (const record of journal) {
    if (record.recordType === 'intent') {
      const intents = intentsByOperationId.get(record.operationId) ?? [];
      intents.push(record);
      intentsByOperationId.set(record.operationId, intents);
      continue;
    }
    if (completedOperationIds.has(record.operationId)) {
      throw new Error(
        `simulation-wide authority journal has duplicate completion for ${record.operationId}`,
      );
    }
    if (state.operations[record.operationId] === undefined) {
      throw new Error(
        `simulation-wide authority journal completion ${record.operationId} is absent from state`,
      );
    }
    if (record.revision > state.revision) {
      throw new Error(
        `simulation-wide authority journal completion ${record.operationId} is newer than state`,
      );
    }
    completedOperationIds.add(record.operationId);
  }
  const fencingTokens = new Set<number>();
  for (const [operationId, entry] of operations) {
    if (entry.operation.operationId !== operationId) {
      throw new Error(`simulation-wide authority operation key ${operationId} is inconsistent`);
    }
    const fencingToken = entry.operation.fencingToken;
    if (
      !Number.isInteger(fencingToken) ||
      fencingToken < 1 ||
      fencingToken > state.latestFencingToken ||
      fencingTokens.has(fencingToken)
    ) {
      throw new Error(`simulation-wide authority operation ${operationId} has invalid fencing`);
    }
    fencingTokens.add(fencingToken);
    const matchingIntent = (intentsByOperationId.get(operationId) ?? []).some(
      (intent) =>
        intent.recordType === 'intent' &&
        intent.fencingToken === fencingToken &&
        intent.requestFingerprint === entry.requestFingerprint,
    );
    if (!matchingIntent) {
      throw new Error(
        `simulation-wide authority state operation ${operationId} has no matching audit intent`,
      );
    }
  }
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
