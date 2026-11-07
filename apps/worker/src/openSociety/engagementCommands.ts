import { residentServiceEffect } from '@aivilization/society';
import type {
  ServiceEngagementCommand,
  ServiceAccount,
  ServicePayer,
} from '@aivilization/services';
import { stringArg, numberArg, stringArrayArg, ToolRefusal } from './arguments';
import { exactPremisesArgs, premisesController } from './premisesCommands';
const account = (a: Readonly<Record<string, unknown>>, prefix: string): ServiceAccount => {
  const sector = a[`${prefix}Sector`];
  if (sector !== 'agent' && sector !== 'collective' && sector !== 'enterprise')
    throw new ToolRefusal('invalid-service-account');
  return { sector, id: stringArg(a, `${prefix}Id`) };
};
const payer = (a: Readonly<Record<string, unknown>>): ServicePayer => {
  if (a.payerSector !== 'treasury') return account(a, 'payer');
  if (a.payerId !== 'public-treasury') throw new ToolRefusal('invalid-public-service-payer');
  return { sector: 'treasury', id: 'public-treasury' };
};
export function parseEngagementCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): ServiceEngagementCommand {
  if (name === 'engagements.offer') {
    exactPremisesArgs(a, [
      'id',
      'controllerKind',
      'controllerId',
      'title',
      'terms',
      'locationId',
      'providerId',
      'recipientId',
      'payerSector',
      'payerId',
      'revenueSector',
      'revenueId',
      'providerShareBps',
      'pricePerHour',
      'modelId',
      'maxDurationMs',
      'startAt',
      'endAt',
      'reservationRefs',
    ]);
    const model = residentServiceEffect(stringArg(a, 'modelId'));
    if (!model) throw new ToolRefusal('unsupported-service-effect');
    const materials = stringArrayArg(a, 'reservationRefs').map((ref) => {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,95})@([1-9]\d*)$/.exec(ref);
      if (!match || !Number.isSafeInteger(Number(match[2])))
        throw new ToolRefusal('invalid-service-material-reference');
      return { id: match[1]!, revision: Number(match[2]) };
    });
    return {
      type: 'offer',
      id: stringArg(a, 'id'),
      controller: premisesController(a, 'controller'),
      title: stringArg(a, 'title'),
      terms: stringArg(a, 'terms'),
      locationId: stringArg(a, 'locationId'),
      providerId: stringArg(a, 'providerId'),
      recipientId: stringArg(a, 'recipientId'),
      payer: payer(a),
      revenue: account(a, 'revenue'),
      providerShareBps: numberArg(a, 'providerShareBps'),
      pricePerHour: numberArg(a, 'pricePerHour'),
      modelId: model.id,
      maxDurationMs: numberArg(a, 'maxDurationMs'),
      startAt: numberArg(a, 'startAt'),
      endAt: numberArg(a, 'endAt'),
      materials,
    };
  }
  const type = name.slice('engagements.'.length);
  if (
    type !== 'accept' &&
    type !== 'fund' &&
    type !== 'cancel' &&
    type !== 'leave' &&
    type !== 'start'
  )
    throw new ToolRefusal('unsupported-service-engagement-command');
  exactPremisesArgs(
    a,
    type === 'start' ? ['id', 'expectedRevision', 'until'] : ['id', 'expectedRevision'],
    type === 'start' ? ['expectedEmploymentRevision'] : [],
  );
  const base = { id: stringArg(a, 'id'), expectedRevision: numberArg(a, 'expectedRevision') };
  return type === 'start'
    ? {
        type,
        ...base,
        until: numberArg(a, 'until'),
        ...(a.expectedEmploymentRevision === undefined
          ? {}
          : { expectedEmploymentRevision: numberArg(a, 'expectedEmploymentRevision') }),
      }
    : { type, ...base };
}
