import type { AccountingTransaction } from '@aivilization/economy';
import type {
  LaborPayPolicy,
  PublicLaborState,
  PublicLaborEvent,
  PublicLaborBody,
  PublicLaborBodyPolicy,
  PUBLIC_LABOR_POLICY,
} from '@aivilization/society';
export type PublicLaborConfiguration = {
  readonly policy: typeof PUBLIC_LABOR_POLICY;
  readonly sourceId: 'initial-public-employment-v1';
  readonly pay: LaborPayPolicy;
  readonly body: PublicLaborBodyPolicy;
  readonly effort: { readonly energyCostPerHour: number; readonly satietyCostPerHour: number };
  readonly locationIds: readonly string[];
  readonly occupationWages: Readonly<Record<string, number>>;
};
export type PublicLaborWorldState = {
  readonly configuration: PublicLaborConfiguration;
  readonly process: PublicLaborState;
};
export type PublicLaborCommittedPayload = {
  readonly policyVersion: 'resident-public-labor-v1';
  readonly actorId: string;
  readonly events: readonly PublicLaborEvent[];
  readonly body?: PublicLaborBody;
  readonly transactions: readonly AccountingTransaction[];
};
