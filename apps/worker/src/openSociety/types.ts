import type { CanonicalRequestHistory } from '../canonicalRequestHistory';
import type {
  CanonicalCognitiveDocuments,
  CanonicalCognitiveDocument,
} from '../canonicalCognitiveDocuments';
import type {
  CanonicalMemoryContinuation,
  CanonicalMemoryEntry,
} from '../canonicalMemoryContinuation';
import type { CanonicalPolicyContinuation } from '../canonicalPolicyContinuation';
import type { ResourceControlPolicy } from '@aivilization/authority';
import type { SocietyEffectOrder } from './effectOrder';
import type { ProgramConditionsPolicy, ProgramActionsPolicy } from '@aivilization/collaboration';
import type {
  CollectivesPolicy,
  CollectivesState,
  CollectiveEvent,
} from '@aivilization/collaboration';
import type { ResidentRhythmPolicy } from '@aivilization/society';
import type { SocietyKernelPolicy } from './kernelPolicy';
import type { SharedRecordsState, SharedRecordsEvent } from '@aivilization/information';
import type { CoordinationState, CoordinationEvent } from '@aivilization/collaboration';
import type {
  CollaborationEvent,
  CollaborationPolicy,
  CollaborationState,
} from '@aivilization/collaboration';
import type {
  OpenAgentActionPlansPolicy,
  OpenAgentPolicy,
  OpenToolResult,
} from '@aivilization/agent-runtime';
import type {
  GroupControlPolicy,
  CommunicationEvent,
  CommunicationPolicy,
  CommunicationState,
  InformationEvent,
  InformationPolicy,
  InformationState,
} from '@aivilization/information';
import type { CognitiveEvent, CognitiveState } from '@aivilization/memory';
import type { WorldEvent, WorldProjection } from '@aivilization/world';

export const OPEN_SOCIETY_SCHEMA_VERSION = 'open-society-v1';
export type ResidentIdentity = {
  readonly id: string;
  readonly displayName: string;
  readonly background: string;
  readonly acquaintances?: readonly string[];
};
export type OpenSocietyManifest = {
  readonly canonicalRequestHistory?: CanonicalRequestHistory;
  readonly canonicalCognitiveDocuments?: CanonicalCognitiveDocuments;
  readonly canonicalMemoryContinuation?: CanonicalMemoryContinuation;
  readonly canonicalPolicyContinuation?: CanonicalPolicyContinuation;
  readonly groupControlPolicy?: GroupControlPolicy;
  readonly resourceControlPolicy?: ResourceControlPolicy;
  readonly programConditionsPolicy?: ProgramConditionsPolicy;
  readonly programActionsPolicy?: ProgramActionsPolicy;
  readonly collectivesPolicy?: CollectivesPolicy;
  readonly societyKernelPolicy?: SocietyKernelPolicy;
  readonly schemaVersion: typeof OPEN_SOCIETY_SCHEMA_VERSION;
  readonly simulationId: string;
  readonly seed: string;
  readonly policy: OpenAgentPolicy;
  readonly rhythm?: ResidentRhythmPolicy;
  readonly initialization?: 'settled' | 'newcomers';
  readonly informationPolicy: InformationPolicy;
  readonly collaborationPolicy?: CollaborationPolicy;
  readonly communicationPolicy?: CommunicationPolicy;
  readonly cognitionVersion: string;
  readonly worldPolicies: Readonly<Record<string, unknown>>;
  readonly initialWorld: WorldProjection;
  readonly residents: readonly ResidentIdentity[];
  readonly provenance: Readonly<Record<string, string>>;
};
export type ResidentExperience = {
  readonly id: string;
  readonly ownerId: string;
  readonly at: number;
  readonly kind: 'action' | 'observation' | 'message' | 'cognition';
  readonly summary: string;
  readonly sourceIds: readonly string[];
  readonly people: readonly string[];
  readonly provenance: 'firsthand' | 'message-claim' | 'self-belief' | 'legacy-record';
  readonly canonicalSource?: CanonicalMemoryEntry;
  readonly canonicalDocument?: CanonicalCognitiveDocument;
  readonly occurredAt?: number;
  readonly locationIds?: readonly string[];
};
export type ResidentReminder = {
  readonly id: string;
  readonly ownerId: string;
  readonly at: number;
  readonly text: string;
  readonly done: boolean;
};
export type ResidentTurn = {
  readonly id: string;
  readonly actorId: string;
  readonly startedAt: number;
  readonly reason: string;
  readonly calls: number;
  readonly status: 'running' | 'completed' | 'waiting' | 'provider-error' | 'budget-exhausted';
  readonly providerSummary?: string;
  readonly summary: string;
  readonly nextWakeAt: number;
  readonly sessionId?: string;
  /** The provider failed before any call and the opportunity was handed back for a retry. */
  readonly requeued?: true;
};
export type ResidentActionPlanStep = {
  /** The resident's own command text, kept verbatim for their context. */
  readonly command: string;
  readonly capability: string;
  /** Parsed arguments; may hold placeholders such as `current` resolved at execution time. */
  readonly arguments: Readonly<Record<string, unknown>>;
};
export type ResidentActionPlan = {
  readonly version: OpenAgentActionPlansPolicy['version'];
  readonly id: string;
  readonly note: string;
  readonly createdAt: number;
  /**
   * Journal revision the plan was created on. Unique per plan, so a plan re-queued under the same
   * ID at the same time gets its own step request IDs.
   */
  readonly createdRevision: number;
  readonly steps: readonly ResidentActionPlanStep[];
  /** Index of the next step to run. */
  readonly next: number;
  readonly status: 'active' | 'completed' | 'stopped' | 'cancelled';
  readonly lastResult?: {
    readonly step: number;
    readonly capability: string;
    readonly ok: boolean;
    readonly error?: string;
    readonly at: number;
  };
};
export type ResidentRuntimeState = {
  readonly plan?: ResidentActionPlan;
  readonly actorId: string;
  readonly lastTurnOrdinal: number;
  readonly nextWakeAt: number;
  readonly wakeReason: string;
  readonly unreadMessageIds: readonly string[];
  readonly freeActivityIntervalMs?: number;
  readonly activeTurnId?: string;
};
export type OpenSocietyState = {
  /** Copied from the manifest policy so capability availability can be read from state. */
  readonly actionPlans?: OpenAgentActionPlansPolicy;
  readonly resourceControlPolicy?: ResourceControlPolicy;
  readonly collectives?: CollectivesState;
  readonly sharedRecords?: SharedRecordsState;
  readonly coordination?: CoordinationState;
  readonly collaboration?: CollaborationState;
  readonly communication?: CommunicationState;
  readonly cityApps?: CityAppDirectory;
  readonly revision: number;
  readonly worldSequence: number;
  readonly world: WorldProjection;
  readonly information: InformationState;
  readonly cognition: Readonly<Record<string, CognitiveState>>;
  readonly experiences: Readonly<Record<string, readonly ResidentExperience[]>>;
  readonly residents: Readonly<Record<string, ResidentRuntimeState>>;
  readonly reminders: Readonly<Record<string, ResidentReminder>>;
  readonly turns: Readonly<Record<string, ResidentTurn>>;
};
export type OpenSocietyEffects = {
  readonly effectOrder?: SocietyEffectOrder;
  readonly collectiveEvents?: readonly CollectiveEvent[];
  readonly sharedRecordsEvents?: readonly SharedRecordsEvent[];
  readonly coordinationEvents?: readonly CoordinationEvent[];
  readonly collaborationEvents?: readonly CollaborationEvent[];
  readonly communicationEvents?: readonly CommunicationEvent[];
  readonly cityApps?: CityAppDirectory;
  readonly worldEvents?: readonly WorldEvent[];
  readonly informationEvents?: readonly InformationEvent[];
  readonly cognitiveEvents?: readonly CognitiveEvent[];
  readonly experiences?: readonly ResidentExperience[];
  readonly residents?: readonly ResidentRuntimeState[];
  readonly reminders?: readonly ResidentReminder[];
  readonly turns?: readonly ResidentTurn[];
};
export type CityAppDirectory = {
  readonly version: string;
  readonly index: { readonly spaceId: string; readonly path: string };
  readonly apps: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly channels: readonly {
      readonly spaceId: string;
      readonly title: string;
      readonly guidePath: string;
    }[];
  }[];
};
export type OpenSocietyCommit = OpenSocietyEffects & {
  readonly schemaVersion: typeof OPEN_SOCIETY_SCHEMA_VERSION;
  readonly sequence: number;
  readonly actorId: string;
  readonly requestId: string;
  readonly fingerprint: string;
  readonly at: number;
  readonly capability: string;
  readonly result: OpenToolResult;
  readonly previousHash: string;
  readonly hash: string;
};
