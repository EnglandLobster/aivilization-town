import type { PrincipalOperationRequest } from '@aivilization/authority';
import type {
  PrincipalPremisesCommand,
  PremisesBlueprint,
  PremisesUse,
} from '@aivilization/premises';
import type { PrincipalValue } from '@aivilization/authority';
const obj = (v: unknown): v is Readonly<Record<string, PrincipalValue>> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (
  v: Readonly<Record<string, PrincipalValue>>,
  required: readonly string[],
  optional: readonly string[] = [],
) =>
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const fail = (): never => {
  throw Error('invalid-principal-premises-command');
};
const str = (v: PrincipalValue | undefined): string => (typeof v === 'string' ? v : fail());
const num = (v: PrincipalValue | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail();
const strings = (v: PrincipalValue | undefined): readonly string[] =>
  Array.isArray(v) ? v.map(str) : fail();
const uses: readonly PremisesUse[] = [
  'residence',
  'production',
  'social',
  'education',
  'healthcare',
  'market',
  'food',
];
function blueprint(v: PrincipalValue | undefined): PremisesBlueprint {
  if (
    !obj(v) ||
    !exact(v, ['primaryUse', 'floorArea', 'capacity', 'fixtures']) ||
    !obj(v.fixtures) ||
    !exact(v.fixtures, ['workstations', 'careStations', 'teachingStations', 'storageUnits'])
  )
    return fail();
  const use = uses.find((u) => u === v.primaryUse);
  if (!use) return fail();
  return {
    primaryUse: use,
    floorArea: num(v.floorArea),
    capacity: num(v.capacity),
    fixtures: {
      workstations: num(v.fixtures.workstations),
      careStations: num(v.fixtures.careStations),
      teachingStations: num(v.fixtures.teachingStations),
      storageUnits: num(v.fixtures.storageUnits),
    },
  };
}
export function decodePrincipalPremisesOperation(
  r: PrincipalOperationRequest,
): PrincipalPremisesCommand {
  const c = r.operation.arguments;
  if (r.operation.capability !== `premises.${str(c.type)}`) return fail();
  if (c.type === 'create-construction') {
    const v = c.construction;
    if (
      !exact(c, ['type', 'construction']) ||
      !obj(v) ||
      !exact(
        v,
        [
          'id',
          'kind',
          'buildingId',
          'siteId',
          'expectedSiteRevision',
          'controller',
          'title',
          'description',
          'blueprint',
          'workers',
          'reservations',
        ],
        ['expectedBuildingRevision'],
      ) ||
      !obj(v.controller) ||
      !exact(v.controller, ['kind', 'id']) ||
      !['resident', 'collective', 'enterprise', 'public'].includes(str(v.controller.kind)) ||
      !Array.isArray(v.reservations)
    )
      return fail();
    const kind = v.kind;
    if (kind !== 'build' && kind !== 'modify' && kind !== 'maintain' && kind !== 'demolish')
      return fail();
    const k = v.controller.kind;
    if (k !== 'resident' && k !== 'collective' && k !== 'enterprise' && k !== 'public')
      return fail();
    const reservations = v.reservations.map((ref) => {
      if (!obj(ref) || !exact(ref, ['id', 'revision'])) return fail();
      return { id: str(ref.id), revision: num(ref.revision) };
    });
    return {
      type: 'create-construction',
      construction: {
        id: str(v.id),
        kind,
        buildingId: str(v.buildingId),
        siteId: str(v.siteId),
        expectedSiteRevision: num(v.expectedSiteRevision),
        ...(v.expectedBuildingRevision === undefined
          ? {}
          : { expectedBuildingRevision: num(v.expectedBuildingRevision) }),
        controller: { kind: k, id: str(v.controller.id) },
        title: str(v.title),
        description: str(v.description),
        blueprint: blueprint(v.blueprint),
        workers: strings(v.workers),
        reservations,
      },
    };
  }
  if (c.type === 'cancel-construction' && exact(c, ['type', 'id', 'expectedRevision']))
    return {
      type: 'cancel-construction',
      id: str(c.id),
      expectedRevision: num(c.expectedRevision),
    };
  if (
    c.type === 'manage-premises' &&
    exact(c, ['type', 'id', 'expectedRevision', 'command']) &&
    obj(c.command)
  ) {
    const v = c.command,
      id = str(c.id),
      expectedRevision = num(c.expectedRevision);
    if (
      v.type === 'configure' &&
      exact(v, ['type', 'title', 'access']) &&
      obj(v.access) &&
      exact(v.access, ['entry', 'visitors', 'operators', 'residents']) &&
      (v.access.entry === 'public' || v.access.entry === 'listed')
    )
      return {
        type: 'manage-premises',
        id,
        expectedRevision,
        command: {
          type: 'configure',
          title: str(v.title),
          access: {
            entry: v.access.entry,
            visitors: strings(v.access.visitors),
            operators: strings(v.access.operators),
            residents: strings(v.access.residents),
          },
        },
      };
    if ((v.type === 'close' || v.type === 'reopen') && exact(v, ['type']))
      return { type: 'manage-premises', id, expectedRevision, command: { type: v.type } };
    if (v.type === 'collect-salvage' && exact(v, ['type', 'recipientId', 'items']) && obj(v.items))
      return {
        type: 'manage-premises',
        id,
        expectedRevision,
        command: {
          type: 'collect-salvage',
          recipientId: str(v.recipientId),
          items: Object.fromEntries(Object.entries(v.items).map(([k, n]) => [k, num(n)])),
        },
      };
  }
  return fail();
}
