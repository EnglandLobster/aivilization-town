import type { SuccessionResourceKind } from './residentSuccessionModel';
/** Records actual finite execution, not ownership, cash, identity or a reusable power of attorney. */
export const SUCCESSION_CONTROL_EXECUTION_POLICY = {
  version: 'resident-succession-control-execution-v1',
  maxRecords: 256000,
  offerSourceVersion: 'resident-succession-control-offer-v1',
  attempts: 'one-committed-offer-per-original-binding',
} as const;
export type SuccessionControlKind = Exclude<
  SuccessionResourceKind,
  'personal-cash' | 'personal-backpack' | 'enterprise-capital'
>;
export type SuccessionControlOfferRecord = {
  readonly id: string;
  readonly arrangementId: string;
  readonly arrangementRevision: number;
  readonly termsRevision: number;
  readonly populationEventId: string;
  readonly ownerId: string;
  readonly executorId: string;
  readonly beneficiaryId: string;
  readonly kind: SuccessionControlKind;
  readonly resourceId: string;
  readonly controlVersion: number;
  readonly sourceRevision: number;
  readonly at: number;
  readonly expiresAt: number;
};
export type SuccessionControlExecutionsState = {
  readonly policy: typeof SUCCESSION_CONTROL_EXECUTION_POLICY;
  readonly records: Readonly<Record<string, SuccessionControlOfferRecord>>;
};
export type SuccessionControlExecutionEvent =
  | {
      readonly type: 'SuccessionControlExecutionsEnabled';
      readonly policy: typeof SUCCESSION_CONTROL_EXECUTION_POLICY;
    }
  | {
      readonly type: 'SuccessionControlOfferRecorded';
      readonly record: SuccessionControlOfferRecord;
    };
export type SuccessionControlOfferInput = {
  readonly id: string;
  readonly arrangementId: string;
  readonly expectedArrangementRevision: number;
  readonly termsRevision: number;
  readonly kind: SuccessionControlKind;
  readonly resourceId: string;
  readonly expiresAt: number;
};
