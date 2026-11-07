import type { AccountingTransaction } from '@aivilization/economy';
import type { EarnedWageEstatePayment } from './earnedWageEstate';
import type { EarnedPayrollEvent } from '@aivilization/enterprise';
import type {
  EarnedLaborCompensation,
  LaborPayPolicy,
  ResidentLaborEvent,
  ResidentLaborPolicy,
  ResidentLaborState,
} from '@aivilization/society';

export type ResidentLaborConfiguration = {
  readonly policy: ResidentLaborPolicy;
  readonly effort: { readonly energyCostPerHour: number; readonly satietyCostPerHour: number };
  readonly critical: { readonly energy: number; readonly health: number };
  readonly locationIds: readonly string[];
} & (
  | { readonly pay: LaborPayPolicy; readonly compensationSource?: never }
  | { readonly pay?: never; readonly compensationSource: 'accepted-enterprise-labor-terms-v1' }
);
export type ResidentLaborTerms = EarnedLaborCompensation & {
  readonly wageSource: 'recorded-employment-offer' | 'initial-wage-regime' | 'accepted-labor-terms';
  readonly agreement?: {
    readonly id: string;
    readonly revision: number;
    readonly membershipGeneration: number;
    readonly wageMicros: number;
    readonly referenceMs: number;
  };
};
export type ResidentLaborWorldState = {
  readonly configuration: ResidentLaborConfiguration;
  readonly process: ResidentLaborState;
  readonly termsBySession: Readonly<Record<string, ResidentLaborTerms>>;
  readonly withheldMicrosBySession: Readonly<Record<string, number>>;
};
export type ResidentLaborEnabledPayload = {
  readonly configuration: ResidentLaborConfiguration;
  readonly enterprises: readonly {
    readonly enterpriseId: string;
    readonly event: EarnedPayrollEvent;
  }[];
};
export type ResidentLaborPayload = {
  readonly estatePayment?: EarnedWageEstatePayment;
  readonly policyVersion: 'resident-enterprise-labor-v1';
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly sessionId: string;
  readonly labor?: ResidentLaborEvent;
  readonly terms?: ResidentLaborTerms;
  readonly payroll: readonly EarnedPayrollEvent[];
  readonly withheldMicros: number;
  readonly transactions: readonly AccountingTransaction[];
};
