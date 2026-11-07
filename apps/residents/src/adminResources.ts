import type { URLSearchParams } from 'node:url';
import type { OpenSocietyRuntime } from '@aivilization/worker';
type State = OpenSocietyRuntime['state'];
type Section = {
  readonly title: string;
  readonly statePath: string;
  readonly records: Readonly<Record<string, unknown>> | undefined;
};
/** Explicit administrator read adapters. No arbitrary projection paths and no derived domain effects. */
function sections(s: State): Readonly<Record<string, Section>> {
  const w = s.world;
  return {
    sources: {
      title: '有限原料源',
      statePath: 'materials.extraction',
      records: w.materials?.extraction?.sources,
    },
    stocks: { title: '材料库存', statePath: 'materials', records: w.materials?.stocks },
    production: { title: '实际生产', statePath: 'materials', records: w.materials?.productions },
    sites: { title: '建设用地', statePath: 'premises', records: w.premises?.sites },
    construction: { title: '建设工程', statePath: 'premises', records: w.premises?.projects },
    buildings: { title: '实体建筑', statePath: 'premises', records: w.premises?.buildings },
    study: {
      title: '实际学习',
      statePath: 'residentStudy.process',
      records: w.residentStudy?.process.sessions,
    },
    rest: { title: '实际休息', statePath: 'residentRest', records: w.residentRest?.sessions },
    transit: { title: '在途居民', statePath: 'world.transitByAgent', records: w.transitByAgent },
    enterprises: { title: '企业', statePath: 'enterprise', records: w.enterprises },
  };
}
export class AdminResourceQueryError extends Error {
  constructor(
    readonly status: 400 | 404,
    reason: string,
  ) {
    super(reason);
  }
}
const invalid = () => new AdminResourceQueryError(400, 'invalid-admin-resource-query');
function integer(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw invalid();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > maximum) throw invalid();
  return n;
}
const previewFields = new Set([
  'title',
  'name',
  'status',
  'revision',
  'at',
  'locationId',
  'sourceId',
  'stockId',
  'buildingId',
  'progressMs',
  'completed',
  'quantity',
]);
function preview(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, v]) =>
        previewFields.has(key) &&
        (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
    ),
  );
}
/** Caller must authenticate as administrator before invoking. Snapshot stamps describe each read, not a frozen browsing session. */
export function readAdminResources(runtime: OpenSocietyRuntime, query: URLSearchParams) {
  for (const key of query.keys())
    if (!['section', 'id', 'offset', 'limit'].includes(key) || query.getAll(key).length !== 1)
      throw invalid();
  const state = runtime.state,
    catalog = sections(state);
  const stamp = {
    version: 'admin-resource-read-v1',
    revision: state.revision,
    simulationTime: state.world.clock.now,
  };
  const name = query.get('section');
  if (name === null) {
    if (query.size) throw invalid();
    return {
      ...stamp,
      sections: Object.entries(catalog).map(([id, s]) => ({
        id,
        title: s.title,
        statePath: s.statePath,
        present: s.records !== undefined,
        total: Object.keys(s.records ?? {}).length,
      })),
      note: 'Source presence is not action authority. Record counts include all statuses, not success or satisfaction scores.',
    };
  }
  if (!Object.hasOwn(catalog, name))
    throw new AdminResourceQueryError(404, 'admin-resource-section-not-found');
  const section = catalog[name]!;
  const base = {
    ...stamp,
    section: name,
    title: section.title,
    statePath: section.statePath,
    present: section.records !== undefined,
  };
  const id = query.get('id');
  if (id !== null) {
    if (!id || query.has('offset') || query.has('limit')) throw invalid();
    if (!section.records || !Object.hasOwn(section.records, id))
      throw new AdminResourceQueryError(404, 'admin-resource-not-found');
    return { ...base, id, record: structuredClone(section.records[id]) };
  }
  const offset = integer(query.get('offset'), 0, Number.MAX_SAFE_INTEGER),
    limit = integer(query.get('limit'), 10, 30);
  if (limit === 0) throw invalid();
  const ids = Object.keys(section.records ?? {}).sort();
  return {
    ...base,
    offset,
    limit,
    total: ids.length,
    nextOffset: offset + limit < ids.length ? offset + limit : null,
    items: ids
      .slice(offset, offset + limit)
      .map((id) => ({ id, ...preview(section.records![id]) })),
  };
}
