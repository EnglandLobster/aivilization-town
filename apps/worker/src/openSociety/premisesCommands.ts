import type { Controller } from '@aivilization/authority';
import type {
  PremisesBlueprint,
  PremisesCommand,
  CreateConstruction,
} from '@aivilization/premises';
import type { ResidentConstructionCommand } from '@aivilization/world';
import type { MaterialReservationOffer } from '@aivilization/materials';
import type { Inventory } from '@aivilization/economy';
import { ToolRefusal, stringArg, numberArg, stringArrayArg } from './arguments';
import { PREMISES_USES } from './premisesCatalog';
const blueprintKeys = [
  'primaryUse',
  'floorArea',
  'capacity',
  'workstations',
  'careStations',
  'teachingStations',
  'storageUnits',
];
export function exactPremisesArgs(
  a: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    required.some((k) => !Object.hasOwn(a, k)) ||
    Object.keys(a).some((k) => !required.includes(k) && !optional.includes(k))
  )
    throw new ToolRefusal('invalid-premises-command');
}
export function premisesBlueprint(a: Readonly<Record<string, unknown>>): PremisesBlueprint {
  const primaryUse = PREMISES_USES.find((v) => v === a.primaryUse);
  if (!primaryUse) throw new ToolRefusal('invalid-premises-use');
  return {
    primaryUse,
    floorArea: numberArg(a, 'floorArea'),
    capacity: numberArg(a, 'capacity'),
    fixtures: {
      workstations: numberArg(a, 'workstations'),
      careStations: numberArg(a, 'careStations'),
      teachingStations: numberArg(a, 'teachingStations'),
      storageUnits: numberArg(a, 'storageUnits'),
    },
  };
}
export function premisesController(
  a: Readonly<Record<string, unknown>>,
  prefix: string,
): Controller {
  const kind = a[`${prefix}Kind`];
  if (kind !== 'resident' && kind !== 'collective') throw new ToolRefusal('invalid-controller');
  return { kind, id: stringArg(a, `${prefix}Id`) };
}
export function constructionKind(a: Readonly<Record<string, unknown>>): CreateConstruction['kind'] {
  const k = a.kind;
  if (k !== 'build' && k !== 'modify' && k !== 'maintain' && k !== 'demolish')
    throw new ToolRefusal('invalid-construction-kind');
  return k;
}
export function parseConstructionCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): ResidentConstructionCommand {
  if (name === 'construction.create') {
    exactPremisesArgs(
      a,
      [
        'id',
        'kind',
        'buildingId',
        'siteId',
        'expectedSiteRevision',
        'controllerKind',
        'controllerId',
        'title',
        'description',
        'workers',
        'reservationRefs',
        ...blueprintKeys,
      ],
      ['expectedBuildingRevision'],
    );
    const reservations = stringArrayArg(a, 'reservationRefs').map((ref) => {
      const [id, version, ...extra] = ref.split('@');
      if (
        !id ||
        !version ||
        extra.length ||
        !/^\d+$/.test(version) ||
        !Number.isSafeInteger(Number(version))
      )
        throw new ToolRefusal('invalid-material-reservation-ref');
      return { id, revision: Number(version) };
    });
    return {
      type: 'create',
      construction: {
        id: stringArg(a, 'id'),
        kind: constructionKind(a),
        buildingId: stringArg(a, 'buildingId'),
        siteId: stringArg(a, 'siteId'),
        expectedSiteRevision: numberArg(a, 'expectedSiteRevision'),
        ...(a.expectedBuildingRevision === undefined
          ? {}
          : { expectedBuildingRevision: numberArg(a, 'expectedBuildingRevision') }),
        controller: premisesController(a, 'controller'),
        title: stringArg(a, 'title'),
        description: stringArg(a, 'description'),
        workers: stringArrayArg(a, 'workers'),
        reservations,
        blueprint: premisesBlueprint(a),
      },
    };
  }
  exactPremisesArgs(a, [
    'id',
    'expectedRevision',
    ...(name === 'construction.start' ? ['until'] : []),
  ]);
  const common = { id: stringArg(a, 'id'), revision: numberArg(a, 'expectedRevision') };
  if (name === 'construction.start')
    return { ...common, type: 'start', until: numberArg(a, 'until') };
  if (name === 'construction.leave') return { ...common, type: 'leave' };
  if (name === 'construction.cancel') return { ...common, type: 'cancel' };
  if (name === 'construction.finish') return { ...common, type: 'finish' };
  throw new ToolRefusal('invalid-construction-command');
}
export function premisesItems(a: Readonly<Record<string, unknown>>): Inventory {
  const v = a.items;
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new ToolRefusal('invalid-material-items');
  return Object.fromEntries(
    Object.entries(v).map(([k, n]: [string, unknown]) => {
      if (typeof n !== 'number' || !Number.isFinite(n))
        throw new ToolRefusal('invalid-material-items');
      return [k, n];
    }),
  );
}
export function parsePremisesCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): PremisesCommand {
  if (name === 'premises.configure') {
    exactPremisesArgs(a, [
      'id',
      'expectedRevision',
      'title',
      'entry',
      'visitors',
      'operators',
      'residents',
    ]);
    if (a.entry !== 'public' && a.entry !== 'listed')
      throw new ToolRefusal('invalid-premises-entry');
    return {
      type: 'configure',
      title: stringArg(a, 'title'),
      access: {
        entry: a.entry,
        visitors: stringArrayArg(a, 'visitors'),
        operators: stringArrayArg(a, 'operators'),
        residents: stringArrayArg(a, 'residents'),
      },
    };
  }
  if (name === 'premises.collect-salvage') {
    exactPremisesArgs(a, ['id', 'expectedRevision', 'recipientId', 'items']);
    return {
      type: 'collect-salvage',
      recipientId: stringArg(a, 'recipientId'),
      items: premisesItems(a),
    };
  }
  if (name === 'premises.close' || name === 'premises.reopen') {
    exactPremisesArgs(a, ['id', 'expectedRevision']);
    return { type: name === 'premises.close' ? 'close' : 'reopen' };
  }
  exactPremisesArgs(a, [
    'id',
    'expectedRevision',
    'expectedControlVersion',
    ...(name === 'premises.offer' ? ['targetKind', 'targetId', 'expiresAt', 'terms'] : []),
  ]);
  const expectedVersion = numberArg(a, 'expectedControlVersion');
  if (name === 'premises.offer')
    return {
      type: 'control',
      control: {
        type: 'offer',
        expectedVersion,
        target: premisesController(a, 'target'),
        expiresAt: numberArg(a, 'expiresAt'),
        terms: stringArg(a, 'terms'),
      },
    };
  if (name === 'premises.accept' || name === 'premises.cancel-offer')
    return {
      type: 'control',
      control: { type: name === 'premises.accept' ? 'accept' : 'cancel', expectedVersion },
    };
  throw new ToolRefusal('invalid-premises-command');
}
export function parseMaterialOffer(a: Readonly<Record<string, unknown>>): MaterialReservationOffer {
  exactPremisesArgs(a, [
    'id',
    'stockId',
    'expectedStockRevision',
    'beneficiaryKind',
    'beneficiaryId',
    'consumerDomain',
    'consumerId',
    'items',
    'terms',
    'expiresAt',
  ]);
  if (a.consumerDomain !== 'premises') throw new ToolRefusal('unsupported-material-consumer');
  return {
    id: stringArg(a, 'id'),
    stockId: stringArg(a, 'stockId'),
    expectedStockRevision: numberArg(a, 'expectedStockRevision'),
    beneficiary: premisesController(a, 'beneficiary'),
    consumer: { domain: a.consumerDomain, id: stringArg(a, 'consumerId') },
    items: premisesItems(a),
    terms: stringArg(a, 'terms'),
    expiresAt: numberArg(a, 'expiresAt'),
  };
}
