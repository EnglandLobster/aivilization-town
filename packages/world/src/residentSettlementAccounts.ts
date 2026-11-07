import {
  createAccountingTransaction,
  economicAccount,
  type AccountingTransaction,
  type EconomicAccount,
} from '@aivilization/economy';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import {
  RESIDENT_EXIT_PRESERVATION_POLICY,
  residentPhysicalFinancialAccount,
} from './residentExitPreservation';
/** The original contract's economic subject is unchanged. This proof resolves physical cash only; it is neither authority nor a settlement receipt. */
export type ResidentSettlementAccountResolution = {
  readonly policyVersion: typeof RESIDENT_EXIT_PRESERVATION_POLICY.accountResolution;
  readonly mappings: readonly {
    readonly residentId: string;
    readonly original: EconomicAccount;
    readonly physical: EconomicAccount;
    readonly populationEventId: string;
    readonly estateRevision: number;
  }[];
  readonly transactions: readonly AccountingTransaction[];
};
/** Closed consumer adapters must corroborate their original transactions first, and apply the resolved ledger together with owning-domain cash events. Never a resident withdrawal operation. */
export function resolveResidentSettlementAccounts(
  w: WorldProjection,
  original: readonly AccountingTransaction[],
): ResidentSettlementAccountResolution {
  const mappings = new Map<string, ResidentSettlementAccountResolution['mappings'][number]>();
  const ids = new Set<string>();
  const transactions = original.map((t) => {
    createAccountingTransaction(t);
    if (ids.has(t.transactionId)) throw Error('resident-settlement-duplicate-transaction');
    ids.add(t.transactionId);
    return createAccountingTransaction({
      ...t,
      entries: t.entries.map((entry) => {
        if (entry.account.sector === 'estate')
          throw Error('resident-estate-account-must-be-resolved');
        if (entry.account.sector !== 'agent') return structuredClone(entry);
        const id = entry.account.accountId.slice('agent:'.length);
        if (!equal(entry.account, economicAccount('agent', id)))
          throw Error('resident-settlement-original-account-mismatch');
        const a = residentPhysicalFinancialAccount(w, id);
        if (!a) throw Error('resident-settlement-original-subject-unavailable');
        if (a.kind === 'living-resident') return structuredClone(entry);
        if (a.sourceRevision === null || !a.populationEventId)
          throw Error('resident-settlement-estate-source-unavailable');
        mappings.set(id, {
          residentId: id,
          original: entry.account,
          physical: a.account,
          populationEventId: a.populationEventId,
          estateRevision: a.sourceRevision,
        });
        return { ...entry, account: a.account };
      }),
    });
  });
  return {
    policyVersion: RESIDENT_EXIT_PRESERVATION_POLICY.accountResolution,
    mappings: [...mappings.values()].sort((a, b) => a.residentId.localeCompare(b.residentId)),
    transactions,
  };
}
/** Deterministic read validation, not a re-execution of a business decision. A stale capture/settlement revision or substituted destination cannot stand in for current owning facts. */
export function assertResidentSettlementAccountResolution(
  w: WorldProjection,
  original: readonly AccountingTransaction[],
  recorded: ResidentSettlementAccountResolution,
): void {
  if (!equal(recorded, resolveResidentSettlementAccounts(w, original)))
    throw Error('resident-settlement-physical-account-proof-mismatch');
}
