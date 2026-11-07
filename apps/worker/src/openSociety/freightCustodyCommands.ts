import type { FreightCustodyCommand } from '@aivilization/logistics';
import { exactPremisesArgs } from './premisesCommands';
import { numberArg, stringArg, ToolRefusal } from './arguments';
export function parseFreightCustodyCommand(
  a: Readonly<Record<string, unknown>>,
): FreightCustodyCommand {
  const type = stringArg(a, 'action'),
    id = stringArg(a, 'handoffId');
  if (type === 'propose') {
    exactPremisesArgs(a, [
      'id',
      'action',
      'handoffId',
      'nextCarrierId',
      'expiresAt',
      ...(a.vehicleId === undefined ? [] : ['vehicleId']),
    ]);
    return {
      type,
      id,
      nextCarrierId: stringArg(a, 'nextCarrierId'),
      expiresAt: numberArg(a, 'expiresAt'),
      ...(a.vehicleId === undefined ? {} : { vehicleId: stringArg(a, 'vehicleId') }),
    };
  }
  if (type !== 'consent' && type !== 'accept' && type !== 'withdraw')
    throw new ToolRefusal('unsupported-freight-handoff-action');
  exactPremisesArgs(a, [
    'id',
    'action',
    'handoffId',
    'expectedRevision',
    ...(type === 'consent' ? ['role'] : []),
  ]);
  const expectedRevision = numberArg(a, 'expectedRevision');
  if (type !== 'consent') return { type, id, expectedRevision };
  const role = stringArg(a, 'role');
  if (role !== 'source' && role !== 'recipient' && role !== 'payer' && role !== 'previous-carrier')
    throw new ToolRefusal('invalid-freight-handoff-role');
  return { type, id, expectedRevision, role };
}
export function freightCustodyArguments(command: FreightCustodyCommand) {
  const { type, id, ...args } = command;
  return { action: type, handoffId: id, ...args };
}
