import type { ResidentRhythmPolicy } from '@aivilization/society';
import type { ResidentLifeState, ResidentLifeEvents, RESIDENT_LIFE_POLICIES } from './lifeState';
import type { ServicesEvent, ServicesPolicy, ServicesState } from '@aivilization/services';
import type {
  CollaborationEvent,
  CollaborationPolicy,
  CollaborationState,
} from '@aivilization/collaboration';
import type { OpenAgentPolicy, OpenToolResult } from '@aivilization/agent-runtime';
import type {
  CommunicationEvent,
  CommunicationPolicy,
  CommunicationState,
  DistributionEvent,
  DistributionPolicy,
  DistributionState,
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
  readonly schemaVersion: typeof OPEN_SOCIETY_SCHEMA_VERSION;
  readonly simulationId: string;
  readonly seed: string;
  readonly policy: OpenAgentPolicy;
  readonly rhythm?: ResidentRhythmPolicy;
  readonly initialization?: 'settled' | 'newcomers';
  readonly informationPolicy: InformationPolicy;
  readonly collaborationPolicy?: CollaborationPolicy;
  readonly lifeVersion?: 'resident-life-v1';
  readonly lifePolicies?: typeof RESIDENT_LIFE_POLICIES;
  readonly servicesPolicy?: ServicesPolicy;
  readonly communicationPolicy?: CommunicationPolicy;
  readonly distributionPolicy?: DistributionPolicy;
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
  readonly provenance: 'firsthand' | 'message-claim' | 'self-belief';
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
  readonly summary: string;
  readonly nextWakeAt: number;
  readonly sessionId?: string;
};
export type ResidentRuntimeState = {
  readonly actorId: string;
  readonly lastTurnOrdinal: number;
  readonly nextWakeAt: number;
  readonly wakeReason: string;
  readonly unreadMessageIds: readonly string[];
  readonly freeActivityIntervalMs?: number;
  readonly activeTurnId?: string;
};
export type OpenSocietyState = {
  readonly collaboration?: CollaborationState;
  readonly life?: ResidentLifeState;
  readonly services?: ServicesState;
  readonly communication?: CommunicationState;
  readonly distribution?: DistributionState;
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
export type OpenSocietyEffects = ResidentLifeEvents & {
  readonly collaborationEvents?: readonly CollaborationEvent[];
  readonly servicesEvents?: readonly ServicesEvent[];
  readonly communicationEvents?: readonly CommunicationEvent[];
  readonly distributionEvents?: readonly DistributionEvent[];
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
