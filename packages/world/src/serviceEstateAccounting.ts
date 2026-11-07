import type { ServiceEngagementEvent } from '@aivilization/services';
import type { AccountingTransaction } from '@aivilization/economy';
import type { WorldProjection } from './projection';
export function serviceEstateCashSource(
  w: WorldProjection,
  events: readonly ServiceEngagementEvent[],
  transactions: readonly AccountingTransaction[],
) {
  const entries = transactions
    .flatMap((t) => t.entries)
    .filter(
      (e) => e.account.sector === 'agent' && w.residentExits?.records[e.account.accountId.slice(6)],
    );
  if (!entries.length) return undefined;
  const changed = events.flatMap((e) =>
    e.type === 'ServiceEngagementChanged' ? [e.engagement] : [],
  );
  if (
    changed.length !== 1 ||
    w.serviceEngagements?.engagements[changed[0]!.id]?.status !== 'funded' ||
    entries.some((e) => e.amount < 0)
  )
    throw Error('service-estate-original-funded-income-required');
  return {
    context: 'services' as const,
    id: changed[0]!.id,
    revision: changed[0]!.revision,
    policyVersion: 'resident-service-engagements-v1',
  };
}
