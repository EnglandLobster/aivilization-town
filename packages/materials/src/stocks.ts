import { materialAdministration, revisedMaterialControl } from './administration';
import { stockHasReservedMaterials } from './reservations';
import {
  initialResourceControl,
  personallyControls,
  decideResourceControl,
  effectiveController,
  sameController,
} from '@aivilization/authority';
import { containsInventory, fitsStock, moveInventory } from './inventoryFlow';
import {
  materialId,
  validInventory,
  no,
  type MaterialsState,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialPorts,
  type MaterialStock,
  type MaterialReceipt,
} from './model';
export function decideMaterialStock(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  c: Exclude<
    MaterialCommand,
    {
      type:
        | 'create-production'
        | 'create-extraction'
        | 'start-production'
        | 'leave-production'
        | 'cancel-production';
    }
  >,
  ports: MaterialPorts,
): MaterialDecision {
  if (
    !ports.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !materialId(receiptId) ||
    s.receipts[receiptId]
  )
    return no('invalid-material-actor-time-or-receipt');
  const receipt = (
    stock: MaterialStock,
    transfers: MaterialReceipt['transfers'] = [],
    decisionId?: string,
    principalAuthorization?: MaterialReceipt['principalAuthorization'],
  ): MaterialDecision => ({
    accepted: true,
    events: [
      { type: 'MaterialStockChanged', stock },
      {
        type: 'MaterialReceiptRecorded',
        receipt: {
          id: receiptId,
          actorId,
          at,
          operation: c.type,
          stockId: stock.id,
          transfers,
          conversions: [],
          efforts: [],
          ...(decisionId ? { decisionId } : {}),
          ...(principalAuthorization ? { principalAuthorization } : {}),
        },
      },
    ],
  });
  if (c.type === 'create-stock') {
    if (
      !materialId(c.id) ||
      s.stocks[c.id] ||
      !c.title.trim() ||
      c.title.length > 120 ||
      !ports.present(actorId, c.locationId) ||
      !ports.idle(actorId) ||
      !ports.mayStoreAt(actorId, c.locationId)
    )
      return no('invalid-stock-or-location');
    if (
      Object.keys(s.stocks).length >= s.policy.maxStocks ||
      Object.values(s.stocks).filter((v) => personallyControls(v, actorId) && v.status !== 'closed')
        .length >= s.policy.maxStocksPerController
    )
      return no('material-stock-limit');
    return receipt({
      id: c.id,
      ownerId: actorId,
      control: initialResourceControl(actorId, at, s.policy.control),
      title: c.title,
      locationId: c.locationId,
      contributors: [actorId],
      readers: [actorId],
      inventory: {},
      status: 'open',
      revision: 1,
      at,
    });
  }
  const v = s.stocks[c.id];
  if (!v || v.status === 'closed') return no('material-stock-unavailable');
  if (v.revision !== c.expectedRevision || v.revision >= Number.MAX_SAFE_INTEGER)
    return no('material-stock-revision-conflict');
  if (at < v.at) return no('invalid-material-time');
  if (c.type === 'control-stock') {
    const d = decideResourceControl({
      resource: v,
      actorId,
      at,
      command: c.control,
      policy: s.policy.control,
      authorize: ports.authorize,
      available: ports.controlAvailable,
    });
    if (!d.accepted) return d;
    if (
      c.control.type === 'accept' &&
      Object.values(s.stocks).filter(
        (x) =>
          x.status !== 'closed' && sameController(effectiveController(x), d.control.controller),
      ).length >= s.policy.maxStocksPerController
    )
      return no('material-stock-limit');
    return receipt(
      { ...v, control: d.control, revision: v.revision + 1, at },
      [],
      d.control.decisionId,
    );
  }
  const grant = materialAdministration(v, actorId, c, ports);
  if (c.type === 'deposit' || c.type === 'withdraw') {
    if (!validInventory(c.items, s.policy.maxKinds, s.policy.maxQuantity))
      return no('invalid-material-items');
    if (!ports.present(actorId, v.locationId) || !ports.idle(actorId))
      return no('material-presence-and-idle-required');
    if (c.type === 'withdraw' && c.recipientId !== actorId)
      return no('material-recipient-must-execute');
    if (c.type === 'deposit') {
      if (v.status !== 'open') return no('material-stock-settling');
      if (!personallyControls(v, actorId) && !v.contributors.includes(actorId))
        return no('material-contribution-not-authorized');
      if (!containsInventory(ports.inventory(actorId), c.items))
        return no('insufficient-personal-materials');
      const inventory = moveInventory(v.inventory, c.items, 'add');
      if (!fitsStock(s, v.id, inventory, ports.locationStorageCapacity?.(v.locationId)))
        return no('material-stock-capacity');
      return receipt({ ...v, inventory, revision: v.revision + 1, at }, [
        {
          from: { kind: 'resident', id: actorId },
          to: { kind: 'stock', id: v.id },
          items: c.items,
        },
      ]);
    }
    if (!grant) return no('resource-controller-authority-required');
    if (!containsInventory(v.inventory, c.items)) return no('insufficient-stock-materials');
    const incoming = moveInventory(ports.inventory(actorId), c.items, 'add');
    if (Object.values(incoming).some((q) => !Number.isFinite(q)))
      return no('material-inventory-overflow');
    return receipt(
      {
        ...v,
        inventory: moveInventory(v.inventory, c.items, 'remove'),
        revision: v.revision + 1,
        at,
      },
      [
        {
          from: { kind: 'stock', id: v.id },
          to: { kind: 'resident', id: actorId },
          items: c.items,
        },
      ],
      grant.decisionId,
      grant.principalAuthorization,
    );
  }
  if (!grant) return no('resource-controller-authority-required');
  if (c.type === 'configure-stock') {
    if (
      v.status !== 'open' ||
      [c.contributors, c.readers].some(
        (ids) =>
          ids.length > s.policy.maxWorkers ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !ports.exists(id)),
      )
    )
      return no('invalid-material-permissions');
    return receipt(
      {
        ...v,
        contributors: [...c.contributors],
        readers: [...c.readers],
        control: revisedMaterialControl(v, grant, at),
        revision: v.revision + 1,
        at,
      },
      [],
      grant.decisionId,
      grant.principalAuthorization,
    );
  }
  if (
    c.type === 'close-stock' &&
    (Object.keys(v.inventory).length > 0 ||
      Object.values(s.productions).some((p) => p.stockId === v.id && p.status === 'open') ||
      stockHasReservedMaterials(s, v.id) ||
      ports.hasExternalObligation(v.id))
  )
    return no('material-stock-unsettled');
  if (c.type === 'settle-stock' && v.status !== 'open')
    return no('material-stock-already-settling');
  return receipt(
    {
      ...v,
      status: c.type === 'close-stock' ? 'closed' : 'settling',
      control: revisedMaterialControl(v, grant, at),
      revision: v.revision + 1,
      at,
    },
    [],
    grant.decisionId,
    grant.principalAuthorization,
  );
}
