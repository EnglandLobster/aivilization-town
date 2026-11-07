import {
  settleEstateCash,
  assertEstateCashSourceReference,
  applyEstateCashEvent,
  type EstateCashEvent,
  type EstateCashSourceReference,
  type AccountingTransaction,
} from '@aivilization/economy';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import {
  resolveResidentSettlementAccounts,
  assertResidentSettlementAccountResolution,
  type ResidentSettlementAccountResolution,
} from './residentSettlementAccounts';
function assertSettlementAt(w: WorldProjection, at: number) {
  if (!Number.isSafeInteger(at) || at < 0 || at > w.clock.now)
    throw Error('resident-estate-invalid-settlement-time');
}
export type ResidentEstateCashEffects = {
  readonly source: EstateCashSourceReference;
  readonly resolution: ResidentSettlementAccountResolution;
  readonly events: readonly EstateCashEvent[];
};
/** Internal closed-consumer preparation. The consumer must prove the actual original obligation and its exact ledger before calling this; this supplies no power to withdraw or create a new commitment. */
export function prepareResidentEstateCashEffects(
  w: WorldProjection,
  source: EstateCashSourceReference,
  original: readonly AccountingTransaction[],
  at = w.clock.now,
): ResidentEstateCashEffects {
  assertSettlementAt(w, at);
  assertEstateCashSourceReference(source);
  const resolution = resolveResidentSettlementAccounts(w, original);
  let cash = w.residentExits?.cash;
  const events: EstateCashEvent[] = [];
  for (const t of resolution.transactions)
    for (const entry of t.entries.filter((x) => x.account.sector === 'estate')) {
      const id = entry.account.accountId.slice('estate:'.length),
        a = cash?.accounts[id];
      if (!cash || !a) throw Error('resident-estate-owning-cash-unavailable');
      const d = settleEstateCash(cash, {
        id,
        previousRevision: a.revision,
        at,
        source,
        transaction: t,
      });
      if (!d.accepted) throw Error(d.reason);
      for (const e of d.events) cash = applyEstateCashEvent(cash, e);
      events.push(...d.events);
    }
  return { source: structuredClone(source), resolution, events };
}
/** Applies owning cash facts only. The outer application must atomically apply the consumer and all other counterpart effects in this same journal commit. Replay never reruns the cash decision. */
export function applyResidentEstateCashEffects(
  w: WorldProjection,
  source: EstateCashSourceReference,
  original: readonly AccountingTransaction[],
  recorded: ResidentEstateCashEffects,
  at = w.clock.now,
) {
  assertSettlementAt(w, at);
  assertEstateCashSourceReference(source);
  if (
    !equal(Object.keys(recorded).sort(), ['source', 'resolution', 'events'].sort()) ||
    !equal(source, recorded.source)
  )
    throw Error('resident-estate-consumer-source-mismatch');
  assertResidentSettlementAccountResolution(w, original, recorded.resolution);
  const expected = recorded.resolution.transactions.flatMap((t) =>
    t.entries
      .filter((x) => x.account.sector === 'estate')
      .map((x) => ({ id: x.account.accountId.slice('estate:'.length), transaction: t })),
  );
  if (expected.length !== recorded.events.length)
    throw Error('resident-estate-cash-receipt-coverage-mismatch');
  let cash = w.residentExits?.cash;
  for (const [index, e] of recorded.events.entries()) {
    const x = expected[index]!;
    if (
      !cash ||
      e.type !== 'EstateCashSettled' ||
      e.id !== x.id ||
      e.at !== at ||
      !equal(e.source, source) ||
      !equal(e.transaction, x.transaction)
    )
      throw Error('resident-estate-owning-cash-receipt-mismatch');
    cash = applyEstateCashEvent(cash, e);
  }
  return w.residentExits && cash ? { ...w.residentExits, cash } : undefined;
}
