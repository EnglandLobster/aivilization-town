import { createHash } from 'node:crypto';
import {
  assertEstateCashSourceReference,
  type AccountingTransaction,
  type EstateCashSourceReference,
} from '@aivilization/economy';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import {
  prepareResidentEstateCashEffects,
  applyResidentEstateCashEffects,
  type ResidentEstateCashEffects,
} from './residentEstateCashEffects';
export const ESTATE_GROSS_SETTLEMENT_VERSION = 'resident-estate-gross-settlement-v1' as const;
export type ResidentEstateCashBatch = {
  readonly version: typeof ESTATE_GROSS_SETTLEMENT_VERSION;
  readonly source: EstateCashSourceReference;
  readonly effects: readonly ResidentEstateCashEffects[];
};
function references(
  source: EstateCashSourceReference,
  transactions: readonly AccountingTransaction[],
) {
  assertEstateCashSourceReference(source);
  if (new Set(transactions.map((t) => t.transactionId)).size !== transactions.length)
    throw Error('estate-batch-duplicate-transaction');
  return transactions.map((t) => ({
    ...source,
    id: `gross-${createHash('sha256')
      .update(
        JSON.stringify([
          ESTATE_GROSS_SETTLEMENT_VERSION,
          source.context,
          source.id,
          t.transactionId,
        ]),
      )
      .digest('hex')}`,
  }));
}
/** Closed consumers must first prove every original transaction. Gross rows are retained in order, never netted. */
export function prepareResidentEstateCashBatch(
  w: WorldProjection,
  source: EstateCashSourceReference,
  transactions: readonly AccountingTransaction[],
  at = w.clock.now,
): ResidentEstateCashBatch {
  const refs = references(source, transactions),
    effects: ResidentEstateCashEffects[] = [];
  let current = w;
  for (const [i, t] of transactions.entries()) {
    const effect = prepareResidentEstateCashEffects(current, refs[i]!, [t], at);
    const residentExits = applyResidentEstateCashEffects(current, refs[i]!, [t], effect, at);
    if (!residentExits) throw Error('estate-batch-preservation-required');
    current = { ...current, residentExits };
    effects.push(effect);
  }
  if (!effects.some((e) => e.resolution.mappings.length))
    throw Error('estate-batch-actual-estate-required');
  return { version: ESTATE_GROSS_SETTLEMENT_VERSION, source: structuredClone(source), effects };
}
/** Cash-only replay result. The consumer commits its own state and all counterpart cash atomically. */
export function applyResidentEstateCashBatch(
  w: WorldProjection,
  source: EstateCashSourceReference,
  transactions: readonly AccountingTransaction[],
  batch: ResidentEstateCashBatch,
  at = w.clock.now,
) {
  const refs = references(source, transactions);
  if (
    batch.version !== ESTATE_GROSS_SETTLEMENT_VERSION ||
    !equal(batch.source, source) ||
    batch.effects.length !== transactions.length ||
    !batch.effects.some((e) => e.resolution.mappings.length)
  )
    throw Error('estate-batch-source-or-coverage-mismatch');
  let current = w;
  const physical: AccountingTransaction[] = [];
  for (const [i, t] of transactions.entries()) {
    const effect = batch.effects[i]!;
    const residentExits = applyResidentEstateCashEffects(current, refs[i]!, [t], effect, at);
    if (!residentExits) throw Error('estate-batch-preservation-required');
    current = { ...current, residentExits };
    physical.push(...effect.resolution.transactions);
  }
  return { residentExits: current.residentExits!, transactions: physical };
}
