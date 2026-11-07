import type { LogisticsEvent } from '@aivilization/logistics';
import type { AccountingTransaction } from '@aivilization/economy';
import type { WorldProjection } from './projection';
/** Only original escrow income; never authority to debit a departed party. */
export function logisticsEstateCashSource(
  w: WorldProjection,
  events: readonly LogisticsEvent[],
  transactions: readonly AccountingTransaction[],
) {
  const entries = transactions
    .flatMap((t) => t.entries)
    .filter(
      (e) => e.account.sector === 'agent' && w.residentExits?.records[e.account.accountId.slice(6)],
    );
  if (!entries.length) return undefined;
  const changed = events.flatMap((e) => (e.type === 'FreightChanged' ? [e.freight] : []));
  const old = changed.length === 1 ? w.logistics?.freight[changed[0]!.id] : undefined;
  if (
    !old ||
    !['funded', 'loaded', 'return-required'].includes(old.status) ||
    old.escrow <= 0 ||
    entries.some((e) => e.amount < 0)
  )
    throw Error('logistics-estate-original-funded-income-required');
  return {
    context: 'logistics' as const,
    id: old.id,
    revision: changed[0]!.revision,
    policyVersion: 'resident-logistics-v1',
  };
}
