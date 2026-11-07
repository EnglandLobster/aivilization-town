import { assertPrincipalReservationReceipt } from './principalReservations';
import { assertPrincipalAuthorization, principalOperationKey } from '@aivilization/authority';
import type { MaterialsState, MaterialReceipt } from './model';

const administrative = new Set([
  'withdraw',
  'reserve-materials',
  'reservation-withdrawn',
  'configure-stock',
  'settle-stock',
  'close-stock',
  'create-production',
  'create-extraction',
  'cancel-production',
]);
/** Recorded consent and its effect must stay together. Physical conservation is checked by the enclosing commit. */
export function assertMaterialPrincipalReceipt(
  before: MaterialsState | undefined,
  after: MaterialsState,
  r: MaterialReceipt,
) {
  const old = before?.stocks[r.stockId],
    next = after.stocks[r.stockId],
    proof = r.principalAuthorization;
  if (old?.control.policyVersion !== 'resource-principals-v2') {
    if (proof) throw Error('unexpected-material-principal-proof');
    return;
  }
  const expiredSource =
    r.operation === 'cancel-production' &&
    r.productionId &&
    before?.productions[r.productionId]?.sourceExpiresAt !== undefined &&
    before.productions[r.productionId]!.sourceExpiresAt! <= r.at;
  if (!administrative.has(r.operation) || (expiredSource && !proof)) {
    if (proof) throw Error('unexpected-material-principal-proof');
    return;
  }
  if (!proof || !next || old.control.offer) throw Error('material-principal-proof-required');
  const request = proof.request,
    c = request.operation.arguments;
  assertPrincipalAuthorization(proof, old.control.controller, request, r.actorId);
  if (
    request.resourceKind !== 'stock' ||
    request.resourceId !== old.id ||
    request.resourceRevision !== old.revision ||
    request.controlVersion !== old.control.version ||
    request.operation.capability !== `materials.${r.operation}` ||
    c.type !== r.operation
  )
    throw Error('material-principal-operation-mismatch');
  if (r.operation === 'reserve-materials' || r.operation === 'reservation-withdrawn') {
    assertPrincipalReservationReceipt(before, after, r);
    return;
  }
  if (
    r.operation === 'create-production' ||
    r.operation === 'create-extraction' ||
    r.operation === 'cancel-production'
  ) {
    const job = r.productionId && after.productions[r.productionId];
    if (!job || c.id !== job.id || job.stockId !== old.id)
      throw Error('material-principal-production-mismatch');
    if (r.operation === 'cancel-production') {
      if (
        c.expectedRevision !== before?.productions[job.id]?.revision ||
        job.status !== 'cancelled'
      )
        throw Error('material-principal-cancellation-mismatch');
    } else if (
      c.expectedRevision !== old.revision ||
      c.stockId !== old.id ||
      c.quantity !== job.quantity ||
      c.productName !== job.productName ||
      c.description !== job.description ||
      principalOperationKey(c.workers!) !== principalOperationKey(job.workers) ||
      (r.operation === 'create-production'
        ? c.recipeId !== job.recipe.id
        : c.sourceId !== job.sourceId)
    )
      throw Error('material-principal-production-mismatch');
    return;
  }
  if (c.id !== old.id || c.expectedRevision !== old.revision)
    throw Error('material-principal-stock-mismatch');
  if (r.operation === 'withdraw') {
    if (
      c.recipientId !== r.actorId ||
      r.transfers.length !== 1 ||
      principalOperationKey(r.transfers[0]!) !==
        principalOperationKey({
          from: { kind: 'stock', id: old.id },
          to: { kind: 'resident', id: r.actorId },
          items: c.items!,
        })
    )
      throw Error('material-principal-withdrawal-mismatch');
    return;
  }
  if (r.transfers.length || r.conversions.length || r.efforts.length)
    throw Error('material-principal-unexpected-physical-effect');
  if (
    r.operation === 'configure-stock' &&
    (principalOperationKey(next.contributors) !== principalOperationKey(c.contributors!) ||
      principalOperationKey(next.readers) !== principalOperationKey(c.readers!))
  )
    throw Error('material-principal-configuration-mismatch');
  if (
    (r.operation === 'settle-stock' && next.status !== 'settling') ||
    (r.operation === 'close-stock' && next.status !== 'closed')
  )
    throw Error('material-principal-status-mismatch');
}
