/** Personal instructions and separately accepted duties. No assets, balances or organizational authority live here. */
export const RESIDENT_SUCCESSION_POLICY = {
  version: 'resident-succession-arrangements-v1',
  maxArrangements: 2000,
  maxBindings: 128,
  maxTermsChars: 4000,
  maxHorizonMs: 365 * 86400000,
  maxExecutionMs: 30 * 86400000,
  maxAmountMicros: 1000000000000,
  moneyScale: 1000000,
  unknownSuccessor: 'retain-custody-without-automatic-substitution',
} as const;
export type SuccessionResourceKind =
  | 'personal-cash'
  | 'personal-backpack'
  | 'stock'
  | 'vehicle'
  | 'premises'
  | 'enterprise-capital'
  | 'space'
  | 'register'
  | 'view'
  | 'group'
  | 'service';
export type SuccessionDuty =
  | 'cash-settlement'
  | 'custody-recovery'
  | 'control-handover'
  | 'capital-rights';
/** Ownership/control version is defined by its owning port, never guessed from a title or global projection. */
export type SuccessionBinding = {
  readonly kind: SuccessionResourceKind;
  readonly id: string;
  readonly entitlementVersion: number;
  readonly duty: SuccessionDuty;
  readonly maximumAmountMicros?: number;
};
export type SuccessionResourceFact = {
  readonly kind: SuccessionResourceKind;
  readonly id: string;
  readonly sourceRevision: number;
  readonly entitlementVersion: number;
  readonly ownerId: string;
  readonly available: boolean;
};
export type SuccessionTerms = {
  readonly id: string;
  readonly ownerId: string;
  readonly executorId: string;
  readonly beneficiaryId: string;
  readonly text: string;
  readonly acceptBy: number;
  readonly expiresAt: number;
  readonly executionWindowMs: number;
  readonly bindings: readonly SuccessionBinding[];
};
export type SuccessionConsent = {
  readonly role: 'executor' | 'beneficiary';
  readonly actorId: string;
  readonly termsRevision: number;
  readonly accepted: boolean;
  readonly at: number;
};
/** Only a real owning population event may supply this fact; world independently verifies its event reference. */
export type SuccessionTriggerFact = {
  readonly eventId: string;
  readonly residentId: string;
  readonly kind: 'death' | 'emigration';
  readonly at: number;
  readonly policyVersion: string;
};
export type SuccessionAvailability = {
  readonly binding: SuccessionBinding;
  readonly fact: SuccessionResourceFact | null;
  readonly eligible: boolean;
  readonly reason?: 'source-unavailable' | 'entitlement-changed';
};
export type SuccessionArrangement = SuccessionTerms & {
  readonly revision: number;
  readonly termsRevision: number;
  readonly createdAt: number;
  readonly termsAt: number;
  readonly at: number;
  readonly status: 'offered' | 'ready' | 'declined' | 'withdrawn' | 'expired' | 'triggered';
  readonly ownershipAtConsent: readonly SuccessionResourceFact[];
  readonly consents: Readonly<Partial<Record<'executor' | 'beneficiary', SuccessionConsent>>>;
  readonly trigger?: {
    readonly fact: SuccessionTriggerFact;
    readonly executorAvailable: boolean;
    readonly beneficiaryAvailable: boolean;
    readonly executeBefore: number;
    readonly resources: readonly SuccessionAvailability[];
  };
};
export type SuccessionArrangementsState = {
  readonly policy: typeof RESIDENT_SUCCESSION_POLICY;
  readonly arrangements: Readonly<Record<string, SuccessionArrangement>>;
};
export type SuccessionCommand =
  | { readonly type: 'create'; readonly terms: SuccessionTerms }
  | { readonly type: 'revise'; readonly terms: SuccessionTerms; readonly expectedRevision: number }
  | {
      readonly type: 'respond';
      readonly id: string;
      readonly expectedRevision: number;
      readonly termsRevision: number;
      readonly role: 'executor' | 'beneficiary';
      readonly accept: boolean;
    }
  | { readonly type: 'withdraw'; readonly id: string; readonly expectedRevision: number };
export type SuccessionEvent =
  | {
      readonly type: 'SuccessionArrangementsEnabled';
      readonly policy: typeof RESIDENT_SUCCESSION_POLICY;
    }
  | { readonly type: 'SuccessionArrangementCreated'; readonly arrangement: SuccessionArrangement }
  | {
      readonly type: 'SuccessionArrangementRevised';
      readonly id: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
      readonly terms: SuccessionTerms;
      readonly ownership: readonly SuccessionResourceFact[];
    }
  | {
      readonly type: 'SuccessionConsentRecorded';
      readonly id: string;
      readonly previousRevision: number;
      readonly consent: SuccessionConsent;
    }
  | {
      readonly type: 'SuccessionArrangementWithdrawn';
      readonly id: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
    }
  | {
      readonly type: 'SuccessionArrangementExpired';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
    }
  | {
      readonly type: 'SuccessionArrangementTriggered';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly trigger: NonNullable<SuccessionArrangement['trigger']>;
    };
export type SuccessionPorts = {
  readonly residentAvailable: (id: string) => boolean;
  readonly resource: (binding: SuccessionBinding) => SuccessionResourceFact | undefined;
};
export type SuccessionDecision =
  | { readonly accepted: true; readonly events: readonly SuccessionEvent[] }
  | { readonly accepted: false; readonly reason: string };
