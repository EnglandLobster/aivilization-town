import type { LogisticsCommand } from '@aivilization/logistics';
import type { Inventory } from '@aivilization/economy';
import { stringArg, numberArg, ToolRefusal } from './arguments';
import { exactPremisesArgs, premisesController } from './premisesCommands';
export function parseLogisticsCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): LogisticsCommand {
  if (name === 'freight.offer') {
    exactPremisesArgs(a, [
      'id',
      'controllerKind',
      'controllerId',
      'recipientKind',
      'recipientId',
      'sourceStockId',
      'destinationStockId',
      'sourceLocationId',
      'destinationLocationId',
      'reservationId',
      'reservationRevision',
      'items',
      'carrierId',
      'payerSector',
      'payerId',
      'deliveryFee',
      'returnFee',
      'deadline',
      'title',
      'terms',
      ...(a.vehicleId !== undefined ? ['vehicleId'] : []),
    ]);
    if (
      (a.payerSector !== 'agent' && a.payerSector !== 'collective') ||
      !a.items ||
      typeof a.items !== 'object' ||
      Array.isArray(a.items)
    )
      throw new ToolRefusal('invalid-freight-arguments');
    const items: Record<string, number> = {};
    for (const [key, value] of Object.entries(a.items)) {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Object.hasOwn(Object.prototype, key)
      )
        throw new ToolRefusal('invalid-freight-items');
      items[key] = value;
    }
    return {
      type: 'offer',
      id: stringArg(a, 'id'),
      controller: premisesController(a, 'controller'),
      recipient: premisesController(a, 'recipient'),
      sourceStockId: stringArg(a, 'sourceStockId'),
      destinationStockId: stringArg(a, 'destinationStockId'),
      sourceLocationId: stringArg(a, 'sourceLocationId'),
      destinationLocationId: stringArg(a, 'destinationLocationId'),
      materialRef: {
        id: stringArg(a, 'reservationId'),
        revision: numberArg(a, 'reservationRevision'),
      },
      items: items satisfies Inventory,
      carrierId: stringArg(a, 'carrierId'),
      ...(a.vehicleId !== undefined ? { vehicleId: stringArg(a, 'vehicleId') } : {}),
      payer: { sector: a.payerSector, id: stringArg(a, 'payerId') },
      deliveryFee: numberArg(a, 'deliveryFee'),
      returnFee: numberArg(a, 'returnFee'),
      deadline: numberArg(a, 'deadline'),
      title: stringArg(a, 'title'),
      terms: stringArg(a, 'terms'),
    };
  }
  const type = name.slice('freight.'.length);
  if (
    type !== 'accept' &&
    type !== 'fund' &&
    type !== 'load' &&
    type !== 'deliver' &&
    type !== 'return' &&
    type !== 'cancel'
  )
    throw new ToolRefusal('unsupported-freight-command');
  exactPremisesArgs(a, ['id', 'expectedRevision']);
  return { type, id: stringArg(a, 'id'), expectedRevision: numberArg(a, 'expectedRevision') };
}
