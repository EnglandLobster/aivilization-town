import type { ResidentDepartureActivitySource } from './residentDepartureActivitySource';
import type { AccountingTransaction } from '@aivilization/economy';
import type {
  EducationSystemPolicy,
  ElapsedStudyEvent,
  ElapsedStudyPolicy,
  ElapsedStudyState,
} from '@aivilization/society';

export const RESIDENT_STUDY_SOURCE = {
  version: 'scenario-education-course-v1',
  sourceId: 'scenario-education-system',
  educationRatePerSecond: 1 / 60,
  formalPromotionCadenceMs: 60_000,
  funding: 'initial-compulsory-education-grant',
  provider: 'scenario-or-external-not-a-resident-teacher',
} as const;
export type ResidentStudyConfiguration = {
  readonly policy: ElapsedStudyPolicy;
  readonly source: typeof RESIDENT_STUDY_SOURCE;
  readonly education: EducationSystemPolicy;
  readonly locationIds: readonly string[];
};
export type ResidentStudyState = {
  readonly configuration: ResidentStudyConfiguration;
  readonly process: ElapsedStudyState;
};
export type ResidentStudyPayload = {
  readonly departure?: ResidentDepartureActivitySource;
  readonly policyVersion: 'resident-elapsed-study-v1';
  readonly actorId: string;
  readonly event: ElapsedStudyEvent;
  readonly transactions: readonly AccountingTransaction[];
  readonly educationBefore: number;
  readonly educationAfter: number;
};
export function residentStudyEscrowBalance(state: ResidentStudyState | undefined): number {
  return Object.values(state?.process.sessions ?? {}).reduce(
    (sum, s) =>
      sum +
      (s.status === 'active'
        ? (s.terms.allocation.residentMicros +
            s.terms.allocation.treasuryMicros -
            s.applied.residentMicros -
            s.applied.treasuryMicros) /
          1_000_000
        : 0),
    0,
  );
}
