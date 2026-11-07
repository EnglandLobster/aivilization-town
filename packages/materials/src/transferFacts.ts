import type { MaterialsState } from './model';
/** The stock remains the only material truth. This is a versioned read, not inventory or title created by commerce. */
export function stockTransferFacts(s: MaterialsState, id: string) {
  const stock = s.stocks[id],
    control = stock?.control;
  if (
    !s.resourcePrincipals ||
    !stock ||
    !control ||
    control.policyVersion !== 'resource-principals-v2' ||
    !control.offer
  )
    return undefined;
  return {
    version: 'stock-sale-source-v1' as const,
    kind: 'stock' as const,
    id: stock.id,
    revision: stock.revision,
    controlVersion: control.version,
    seller: structuredClone(control.controller),
    offer: structuredClone(control.offer),
    authorId: stock.ownerId,
    locationId: stock.locationId,
    stockStatus: stock.status,
    inventory: structuredClone(stock.inventory),
    contributors: [...stock.contributors],
    readers: [...stock.readers],
    encumbrances: [
      ...Object.values(s.productions)
        .filter((p) => p.stockId === id && p.status === 'open')
        .map((p) => ({ kind: 'production', id: p.id, revision: p.revision })),
      ...Object.values(s.reservations?.records ?? {})
        .filter((r) => r.stockId === id && r.status !== 'settled')
        .map((r) => ({ kind: 'material-reservation', id: r.id, revision: r.revision })),
    ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}
