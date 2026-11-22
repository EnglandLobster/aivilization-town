import { isDeepStrictEqual } from 'node:util';
import type { WorldProjection } from '@aivilization/world';
import {
  inspectCanonicalSocietyBarrier,
  type CanonicalSocietyPartitionBoundary,
} from './canonicalSocietyBarrier';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';

/** Exhaustive source ownership; adding a world field requires an explicit migration decision. */
export const CANONICAL_WORLD_FIELD_SOURCES = {
  residentExits: 'agreement',
  residentAdmissionPolicy: 'agreement',
  estateCredit: 'agreement',
  successionControlExecutions: 'agreement',
  publicHousing: 'agreement',
  physicalHousingRest: 'agreement',
  housingOccupancy: 'agreement',
  housingChoice: 'agreement',
  residentRest: 'agreement',
  residentStudy: 'agreement',
  publicLabor: 'agreement',
  residentLabor: 'agreement',
  productiveEmployment: 'agreement',
  educationAuthority: 'agreement',
  publicEmployment: 'agreement',
  publicGovernance: 'agreement',
  materials: 'agreement',
  premises: 'agreement',
  commonAccounts: 'agreement',
  residentCommerce: 'agreement',
  clock: 'agreement',
  agents: 'authority',
  enterprises: 'agreement',
  locations: 'authority',
  marketPools: 'authority',
  renewableResources: 'agreement',
  survivalOutcomes: 'agreement',
  resourceFlowMetrics: 'agreement',
  moneySupply: 'authority',
  marketPriceIndices: 'agreement',
  economicComposition: 'agreement',
  bankruptEnterpriseTotal: 'agreement',
  externalMarket: 'authority',
  externalTrade: 'authority',
  jobApplications: 'owner-rows',
  recruitmentCycles: 'agreement',
  educationExamApplications: 'owner-rows',
  educationExamCycles: 'agreement',
  physiologicalDistressByAgent: 'owner-map',
  locationObservations: 'agreement',
  conversationRecords: 'agreement',
  socialCommitments: 'agreement',
  activityTimeByAgent: 'owner-map',
  transitByAgent: 'authority',
  timeSettlementByAgent: 'owner-map',
  treasury: 'authority',
  regionalLandValues: 'authority',
  pendingRegionalLandValueUpdates: 'agreement',
  regionalServiceQualities: 'authority',
  bank: 'authority',
  publicBudget: 'authority',
  governance: 'authority',
  weather: 'authority',
  calendar: 'agreement',
  bulletins: 'authority',
  petitions: 'authority',
  socialMatters: 'authority',
  conflictRecords: 'authority',
  townPulse: 'agreement',
  socialRelations: 'agreement',
  memoryRecords: 'agreement',
  rejectedActions: 'agreement',
} as const satisfies Record<
  keyof WorldProjection,
  'authority' | 'agreement' | 'owner-map' | 'owner-rows'
>;

type MigrationIssue = { readonly field: string; readonly source: string; readonly reason: string };
/** Build a detached candidate, not an activated world or a substitute for cognitive/policy migration. */
export function composeCanonicalWorldBoundary(input: {
  readonly authority: SimulationWideAuthoritySnapshot;
  readonly partitions: readonly CanonicalSocietyPartitionBoundary[];
  readonly movementContinuity?: 'same-owner-v1';
}) {
  const barrier = inspectCanonicalSocietyBarrier(input);
  const issues: MigrationIssue[] = barrier.issues.map((i) => ({
    field: 'barrier',
    source: i.subject,
    reason: i.code,
  }));
  const world = input.authority.projection;
  const parts = [...input.partitions].sort((a, b) =>
    a.partitionKey < b.partitionKey ? -1 : a.partitionKey > b.partitionKey ? 1 : 0,
  );
  const snapshots = [
    { source: 'authority', projection: world },
    ...parts.map((p) => ({ source: p.partitionKey, projection: p.projection })),
  ];
  for (const p of parts) {
    const published = input.authority.partitionAccountsByKey?.[p.partitionKey];
    const actual = {
      moneySupply: p.projection.moneySupply,
      ...(p.projection.treasury === undefined ? {} : { treasury: p.projection.treasury }),
      ...(p.projection.publicBudget === undefined
        ? {}
        : { publicBudget: p.projection.publicBudget }),
    };
    if (!published || !isDeepStrictEqual(published, actual))
      issues.push({
        field: 'partitionAccounts',
        source: p.partitionKey,
        reason: 'fiscal-boundary-not-published',
      });
  }
  for (const { source, projection } of snapshots) {
    for (const key of Object.keys(projection))
      if (!Object.hasOwn(CANONICAL_WORLD_FIELD_SOURCES, key))
        issues.push({ field: key, source, reason: 'unmapped-world-field' });
  }
  for (const field of Object.keys(CANONICAL_WORLD_FIELD_SOURCES) as (keyof WorldProjection)[]) {
    if (CANONICAL_WORLD_FIELD_SOURCES[field] !== 'agreement') continue;
    for (const p of parts)
      if (!isDeepStrictEqual(world[field], p.projection[field]))
        issues.push({ field, source: p.partitionKey, reason: 'source-values-disagree' });
  }
  function records<T>(
    field: string,
    read: (p: WorldProjection) => Readonly<Record<string, T>> | undefined,
  ): Record<string, T> {
    const entries: [string, T][] = [];
    for (const p of parts)
      for (const [id, value] of Object.entries(read(p.projection) ?? {})) {
        if (input.authority.ownerPartitionKeyByAgentId[id] !== p.partitionKey)
          issues.push({
            field,
            source: p.partitionKey,
            reason: `record-without-current-owner:${id}`,
          });
        else entries.push([id, structuredClone(value)]);
      }
    // An authority fact cannot silently disappear merely because its owner omits it.
    for (const id of Object.keys(read(world) ?? {}))
      if (!entries.some(([key]) => key === id))
        issues.push({ field, source: 'authority', reason: `owner-record-missing:${id}` });
    return Object.fromEntries(entries);
  }
  function applications<T extends { readonly applicationId: string; readonly agentId: string }>(
    field: string,
    read: (p: WorldProjection) => readonly T[],
  ): T[] {
    const entries = new Map<string, T>();
    for (const p of parts)
      for (const value of read(p.projection)) {
        const owner = input.authority.ownerPartitionKeyByAgentId[value.agentId];
        if (owner !== undefined && owner !== p.partitionKey)
          issues.push({
            field,
            source: p.partitionKey,
            reason: `application-owner-conflict:${value.applicationId}`,
          });
        const prior = entries.get(value.applicationId);
        if (prior && !isDeepStrictEqual(prior, value))
          issues.push({
            field,
            source: p.partitionKey,
            reason: `application-id-conflict:${value.applicationId}`,
          });
        if (!prior) entries.set(value.applicationId, structuredClone(value));
      }
    for (const value of read(world))
      if (!entries.has(value.applicationId))
        issues.push({
          field,
          source: 'authority',
          reason: `application-missing:${value.applicationId}`,
        });
    return [...entries.values()];
  }
  const activityTimeByAgent = records('activityTimeByAgent', (p) => p.activityTimeByAgent);
  const physiologicalDistressByAgent = records(
    'physiologicalDistressByAgent',
    (p) => p.physiologicalDistressByAgent,
  );
  const timeSettlementByAgent = records('timeSettlementByAgent', (p) => p.timeSettlementByAgent);
  const jobApplications = applications('jobApplications', (p) => p.jobApplications);
  const educationExamApplications = applications(
    'educationExamApplications',
    (p) => p.educationExamApplications,
  );
  if (issues.length)
    return {
      version: 'canonical-world-source-composition-v1' as const,
      status: 'blocked' as const,
      barrier,
      issues,
    };
  const projection: WorldProjection = {
    ...structuredClone(world),
    activityTimeByAgent,
    physiologicalDistressByAgent,
    jobApplications,
    educationExamApplications,
    ...(snapshots.some((s) => s.projection.timeSettlementByAgent !== undefined)
      ? { timeSettlementByAgent }
      : {}),
  };
  return {
    version: 'canonical-world-source-composition-v1' as const,
    status: 'composed' as const,
    barrier,
    issues,
    projection,
  };
}
