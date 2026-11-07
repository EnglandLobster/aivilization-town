import { applyMaterialEvent } from './events';
import { materialCustodyFlow } from './custodyFlow';
import type { MaterialCustodyProof } from './custodyModel';
import type { MaterialEvent, MaterialsState } from './model';

function factsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => factsEqual(v, b[i]))
    );
  const x = a as Readonly<Record<string, unknown>>,
    y = b as Readonly<Record<string, unknown>>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && factsEqual(x[k], y[k]))
  );
}
/** Exact v1 physical packets must be backed by distinct, independently reconstructed logistics facts. */
export function validateMaterialCustodyEvidence(
  before: MaterialsState | undefined,
  events: readonly MaterialEvent[],
  proofs: readonly MaterialCustodyProof[],
) {
  const snapshots: (MaterialsState | undefined)[] = [],
    covered = new Set<number>(),
    used = new Set<number>();
  let state = before;
  events.forEach((e, i) => {
    snapshots.push(state);
    state = applyMaterialEvent(state, e);
    if (e.type !== 'MaterialReceiptRecorded' || !e.receipt.custodyProof) return;
    const p = e.receipt.custodyProof,
      index = proofs.findIndex((v, j) => !used.has(j) && factsEqual(v, p));
    if (index < 0) throw Error('material-custody-evidence-required');
    const count = p.operation === 'reserve' || p.operation === 'cancel' ? 4 : 3,
      start = i - count + 1,
      initial = snapshots[start];
    if (!initial || start < 0) throw Error('invalid-material-custody-packet');
    const expected = materialCustodyFlow(initial, e.receipt.actorId, e.receipt.at, e.receipt.id, p);
    if (!expected.accepted || !factsEqual(expected.events, events.slice(start, i + 1)))
      throw Error('material-custody-flow-mismatch');
    for (let j = start; j <= i; j++) {
      if (covered.has(j)) throw Error('overlapping-material-custody-packets');
      covered.add(j);
    }
    used.add(index);
  });
  events.forEach((e, i) => {
    if (
      (e.type === 'MaterialCustodyChanged' ||
        (e.type === 'MaterialReceiptRecorded' &&
          e.receipt.transfers.some((t) => t.from.kind === 'custody' || t.to.kind === 'custody'))) &&
      !covered.has(i)
    )
      throw Error('material-custody-evidence-required');
  });
  if (used.size !== proofs.length) throw Error('unused-material-custody-evidence');
}
