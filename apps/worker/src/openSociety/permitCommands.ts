import { PREMISES_USE_SCOPES, type PremisesRightsCommand } from '@aivilization/premises';
import { exactPremisesArgs, premisesController } from './premisesCommands';
import { numberArg, stringArg, stringArrayArg, ToolRefusal } from './arguments';
export function parsePermitCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): PremisesRightsCommand {
  if (name === 'permits.offer') {
    exactPremisesArgs(a, [
      'id',
      'buildingId',
      'buildingRevision',
      'granteeKind',
      'granteeId',
      'users',
      'scopes',
      'mode',
      'title',
      'terms',
      'startAt',
      'endAt',
      'acceptBy',
    ]);
    const rawScopes = stringArrayArg(a, 'scopes'),
      scopes = rawScopes.map((s) => PREMISES_USE_SCOPES.find((v) => v === s));
    if (scopes.some((s) => !s) || (a.mode !== 'shared' && a.mode !== 'exclusive'))
      throw new ToolRefusal('invalid-permit-scope-or-mode');
    return {
      type: 'offer',
      buildingRevision: numberArg(a, 'buildingRevision'),
      terms: {
        id: stringArg(a, 'id'),
        buildingId: stringArg(a, 'buildingId'),
        grantee: premisesController(a, 'grantee'),
        users: stringArrayArg(a, 'users'),
        scopes: scopes.filter((s) => s !== undefined),
        mode: a.mode,
        title: stringArg(a, 'title'),
        terms: stringArg(a, 'terms'),
        startAt: numberArg(a, 'startAt'),
        endAt: numberArg(a, 'endAt'),
        acceptBy: numberArg(a, 'acceptBy'),
      },
    };
  }
  exactPremisesArgs(a, ['id', 'expectedRevision']);
  const type =
    name === 'permits.accept'
      ? 'accept'
      : name === 'permits.withdraw'
        ? 'withdraw'
        : name === 'permits.release'
          ? 'release'
          : undefined;
  if (!type) throw new ToolRefusal('unsupported-permit-command');
  return { type, id: stringArg(a, 'id'), revision: numberArg(a, 'expectedRevision') };
}
