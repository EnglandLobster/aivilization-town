import type { EarnedWageEstatePayment } from './earnedWageEstate';
import type { PhysiologicalState } from '@aivilization/society';
import type { EarnedPayrollEvent, ProductionEmploymentEvent } from '@aivilization/enterprise';
import type { ResidentLaborTerms } from './residentLaborModel';
import type { EarnedCompensationPayload } from './earnedCompensation';
export const PRODUCTIVE_EMPLOYMENT_VERSION = 'resident-productive-employment-v1';
/** Explicit initial clearing order, not a claim that one kind of labor deserves priority. */
export const PRODUCTIVE_CLEARING_ORDER = 'productive-then-timed-each-actor-id-ascending';
export type ProductiveEmploymentState = {
  readonly policyVersion: typeof PRODUCTIVE_EMPLOYMENT_VERSION;
  readonly clearingOrder: typeof PRODUCTIVE_CLEARING_ORDER;
  readonly claims: Readonly<Record<string, ProductiveClaimContext>>;
};
export type ProductiveClaimContext = {
  readonly id: string;
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly productionId: string;
  readonly startedAt: number;
  readonly until: number;
  readonly terms: ResidentLaborTerms;
  readonly lastReceiptId: string;
  readonly withheldMicros: number;
};
export type ProductiveMaterialEmployment =
  | {
      readonly operation: 'assign';
      readonly enterpriseId: string;
      readonly events: readonly (EarnedPayrollEvent | ProductionEmploymentEvent)[];
    }
  | {
      readonly operation: 'work';
      readonly record: ProductiveClaimContext;
      readonly compensation: EarnedCompensationPayload;
    };
export type ProductiveWagePaidPayload = {
  readonly estatePayment?: EarnedWageEstatePayment;
  readonly actorId: string;
  readonly claimId: string;
  readonly compensation: EarnedCompensationPayload;
};
export type ProductiveBodyFact = {
  readonly policyVersion: 'resident-productive-physiology-v1';
  readonly productionId: string;
  readonly actorId: string;
  readonly from: number;
  readonly until: number;
  readonly workedMs: number;
  readonly endedAt?: number;
  readonly lowEnergyMs: number;
  readonly previous: PhysiologicalState;
  readonly next: PhysiologicalState;
};
