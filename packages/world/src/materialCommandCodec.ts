import type { PrincipalOperationRequest } from '@aivilization/authority';
import { type MaterialCommand, type PrincipalMaterialReservationCommand } from '@aivilization/materials';
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const arr = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const exact = (a: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(a).length === keys.length && keys.every((k) => Object.hasOwn(a, k));
export function decodeMaterialCommand(name: string, a: Record<string, unknown>): MaterialCommand {
  const fail = () => {
    throw new Error('invalid-material-command');
  };
  if (!str(a.id)) return fail();
  const id = a.id;
  if (
    name === 'stocks.create' &&
    exact(a, ['id', 'title', 'locationId']) &&
    str(a.title) &&
    str(a.locationId)
  )
    return { type: 'create-stock', id, title: a.title, locationId: a.locationId };
  if (!num(a.expectedRevision)) return fail();
  const expectedRevision = a.expectedRevision;
  if (
    (name === 'stocks.deposit' || name === 'stocks.withdraw') &&
    exact(a, [
      'id',
      'expectedRevision',
      'items',
      ...(name === 'stocks.withdraw' ? ['recipientId'] : []),
    ]) &&
    obj(a.items) &&
    Object.values(a.items).every(num)
  ) {
    const items = Object.fromEntries(
      Object.entries(a.items).map(([k, v]) => {
        if (!num(v)) return fail();
        return [k, v];
      }),
    );
    if (name === 'stocks.withdraw') {
      if (!str(a.recipientId)) return fail();
      return { type: 'withdraw', id, expectedRevision, items, recipientId: a.recipientId };
    }
    return { type: 'deposit', id, expectedRevision, items };
  }
  if (
    name === 'stocks.configure' &&
    exact(a, ['id', 'expectedRevision', 'contributors', 'readers']) &&
    arr(a.contributors) &&
    arr(a.readers)
  )
    return {
      type: 'configure-stock',
      id,
      expectedRevision,
      contributors: a.contributors,
      readers: a.readers,
    };
  if ((name === 'stocks.settle' || name === 'stocks.close') && exact(a, ['id', 'expectedRevision']))
    return {
      type: name === 'stocks.settle' ? 'settle-stock' : 'close-stock',
      id,
      expectedRevision,
    };
  if (
    ['stocks.offer', 'stocks.accept', 'stocks.cancel-offer'].includes(name) &&
    num(a.expectedControlVersion)
  ) {
    if (
      name === 'stocks.offer' &&
      exact(a, [
        'id',
        'expectedRevision',
        'expectedControlVersion',
        'targetKind',
        'targetId',
        'expiresAt',
        'terms',
      ]) &&
      (a.targetKind === 'resident' || a.targetKind === 'collective') &&
      str(a.targetId) &&
      num(a.expiresAt) &&
      str(a.terms)
    )
      return {
        type: 'control-stock',
        id,
        expectedRevision,
        control: {
          type: 'offer',
          expectedVersion: a.expectedControlVersion,
          target: { kind: a.targetKind, id: a.targetId },
          expiresAt: a.expiresAt,
          terms: a.terms,
        },
      };
    if (exact(a, ['id', 'expectedRevision', 'expectedControlVersion']) && name !== 'stocks.offer')
      return {
        type: 'control-stock',
        id,
        expectedRevision,
        control: {
          type: name === 'stocks.accept' ? 'accept' : 'cancel',
          expectedVersion: a.expectedControlVersion,
        },
      };
  }
  if (
    name === 'production.create' &&
    exact(a, [
      'id',
      'stockId',
      'expectedRevision',
      'recipeId',
      'quantity',
      'productName',
      'description',
      'workers',
    ]) &&
    str(a.stockId) &&
    str(a.recipeId) &&
    num(a.quantity) &&
    str(a.productName) &&
    str(a.description) &&
    arr(a.workers)
  )
    return {
      type: 'create-production',
      id,
      stockId: a.stockId,
      expectedRevision,
      recipeId: a.recipeId,
      quantity: a.quantity,
      productName: a.productName,
      description: a.description,
      workers: a.workers,
    };
  if (
    name === 'production.gather' &&
    exact(a, [
      'id',
      'stockId',
      'expectedRevision',
      'sourceId',
      'sourceRevision',
      'quantity',
      'productName',
      'description',
      'workers',
    ]) &&
    str(a.stockId) &&
    str(a.sourceId) &&
    num(a.sourceRevision) &&
    num(a.quantity) &&
    str(a.productName) &&
    str(a.description) &&
    arr(a.workers)
  )
    return {
      type: 'create-extraction',
      id,
      stockId: a.stockId,
      expectedRevision,
      sourceId: a.sourceId,
      sourceRevision: a.sourceRevision,
      quantity: a.quantity,
      productName: a.productName,
      description: a.description,
      workers: a.workers,
    };
  if (name === 'production.start' && exact(a, ['id', 'expectedRevision', 'until']) && num(a.until))
    return { type: 'start-production', id, expectedRevision, until: a.until };
  if (
    (name === 'production.leave' || name === 'production.cancel') &&
    exact(a, ['id', 'expectedRevision'])
  )
    return {
      type: name === 'production.leave' ? 'leave-production' : 'cancel-production',
      id,
      expectedRevision,
    };
  return fail();
}

/** Deliberate resource operations only; public approval cannot start or leave another person's bodily activity. */
const operations: Readonly<Record<string, string>> = {
  withdraw: 'stocks.withdraw',
  'configure-stock': 'stocks.configure',
  'settle-stock': 'stocks.settle',
  'close-stock': 'stocks.close',
  'create-production': 'production.create',
  'create-extraction': 'production.gather',
  'cancel-production': 'production.cancel',
};

export function decodePrincipalMaterialOperation(r: PrincipalOperationRequest): MaterialCommand | PrincipalMaterialReservationCommand {
  if (r.resourceKind === 'stock') {
    const a = r.operation.arguments;
    if (r.operation.capability === 'materials.reserve-materials' && a.type === 'reserve-materials') {
      const o = a.offer;
      if (!exact(a, ['type', 'offer']) || !obj(o) ||
        !exact(o, ['id', 'stockId', 'expectedStockRevision', 'items', 'beneficiary', 'consumer', 'terms', 'expiresAt']) ||
        !str(o.id) || !str(o.stockId) || !num(o.expectedStockRevision) || !obj(o.items) ||
        !Object.values(o.items).every(num) || !obj(o.beneficiary) ||
        !exact(o.beneficiary, ['kind', 'id']) || !str(o.beneficiary.id) ||
        (o.beneficiary.kind !== 'resident' && o.beneficiary.kind !== 'collective' &&
          o.beneficiary.kind !== 'enterprise' && o.beneficiary.kind !== 'public') ||
        !obj(o.consumer) || !exact(o.consumer, ['domain', 'id']) || !str(o.consumer.id) ||
        o.consumer.domain !== 'premises' || !str(o.terms) || !num(o.expiresAt))
        throw Error('invalid-principal-reservation-command');
      const items = Object.fromEntries(Object.entries(o.items).map(([k,v]) => {
        if (!num(v)) throw Error('invalid-principal-reservation-items');
        return [k,v];
      }));
      return { type: 'reserve-materials', offer: {
        id: o.id, stockId: o.stockId, expectedStockRevision: o.expectedStockRevision, items,
        beneficiary: { kind: o.beneficiary.kind, id: o.beneficiary.id },
        consumer: { domain: 'premises', id: o.consumer.id }, terms: o.terms, expiresAt: o.expiresAt,
      } };
    }
    if (r.operation.capability === 'materials.reservation-withdrawn' && a.type === 'reservation-withdrawn') {
      if (!exact(a, ['type', 'id', 'expectedRevision']) || !str(a.id) || !num(a.expectedRevision))
        throw Error('invalid-principal-reservation-command');
      return { type: 'reservation-withdrawn', id: a.id, expectedRevision: a.expectedRevision };
    }
  }
  const { type, ...parameters } = r.operation.arguments;
  if (
    r.resourceKind !== 'stock' ||
    typeof type !== 'string' ||
    !Object.hasOwn(operations, type) ||
    r.operation.capability !== `materials.${type}`
  )
    throw Error('principal-material-operation-not-supported');
  return decodeMaterialCommand(operations[type]!, parameters);
}
