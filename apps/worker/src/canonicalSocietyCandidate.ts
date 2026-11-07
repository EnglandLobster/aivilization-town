import { isDeepStrictEqual } from 'node:util';
import {
  createCanonicalRequestHistory,
  type CanonicalRequestHistory,
} from './canonicalRequestHistory';
import { DEFAULT_OPEN_AGENT_POLICY } from '@aivilization/agent-runtime';
import { DEFAULT_INFORMATION_POLICY } from '@aivilization/information';
import { COGNITION_POLICY_VERSION } from '@aivilization/memory';
import type { CanonicalMemoryContinuation } from './canonicalMemoryContinuation';
import type { CanonicalCognitiveDocuments } from './canonicalCognitiveDocuments';
import type { CanonicalPolicyContinuation } from './canonicalPolicyContinuation';
import type { CanonicalSocietyPartitionBoundary } from './canonicalSocietyBarrier';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';
import { composeCanonicalWorldBoundary } from './canonicalWorldComposition';
import { serializableWorldPolicy } from './openSociety/manifest';
import { initialOpenSocietyState } from './openSociety/state';
import {
  OPEN_SOCIETY_SCHEMA_VERSION,
  type OpenSocietyManifest,
  type ResidentIdentity,
} from './openSociety/types';

/** Compose captured sources without seeding a replacement world or activating a writer. */
export function createCanonicalSocietyCandidate(input: {
  readonly authority: SimulationWideAuthoritySnapshot;
  readonly partitions: readonly CanonicalSocietyPartitionBoundary[];
  readonly policies: CanonicalPolicyContinuation;
  readonly memories: CanonicalMemoryContinuation;
  readonly documents: CanonicalCognitiveDocuments;
  readonly residents: readonly ResidentIdentity[];
  readonly requestHistory?: CanonicalRequestHistory;
}) {
  const world = composeCanonicalWorldBoundary({
    authority: input.authority,
    partitions: input.partitions,
    movementContinuity: 'same-owner-v1',
  });
  if (world.status === 'blocked') return world;
  const ids = Object.keys(world.projection.agents).sort();
  const sameIds = (actual: readonly string[]) =>
    actual.length === ids.length && [...actual].sort().every((id, i) => id === ids[i]);
  if (
    !sameIds(input.residents.map((r) => r.id)) ||
    !sameIds(Object.keys(input.memories.recordsByResident)) ||
    !sameIds(Object.keys(input.documents.documentsByResident))
  )
    throw new Error('canonical-candidate-resident-set-mismatch');
  if (
    !['canonical-cognitive-documents-v2', 'canonical-cognitive-documents-v3'].includes(
      input.documents.version,
    ) ||
    input.documents.capturedAt !== world.projection.clock.now
  )
    throw new Error('canonical-candidate-cognition-boundary-mismatch');
  const partitions = new Set(input.authority.partitionKeys);
  for (const entries of Object.values(input.memories.recordsByResident))
    for (const entry of entries)
      if (!partitions.has(entry.partitionKey))
        throw new Error('canonical-candidate-memory-partition-mismatch');
  for (const docs of Object.values(input.documents.documentsByResident))
    for (const doc of docs)
      if (!partitions.has(doc.partitionKey))
        throw new Error('canonical-candidate-cognition-partition-mismatch');
  if (
    input.requestHistory &&
    !isDeepStrictEqual(
      input.requestHistory,
      createCanonicalRequestHistory({
        authority: input.authority,
        partitions: input.requestHistory.partitions,
      }),
    )
  )
    throw new Error('canonical-candidate-request-history-boundary-mismatch');
  const manifest: OpenSocietyManifest = structuredClone({
    schemaVersion: OPEN_SOCIETY_SCHEMA_VERSION,
    simulationId: input.authority.simulationId,
    seed: input.policies.seed,
    policy: DEFAULT_OPEN_AGENT_POLICY,
    informationPolicy: DEFAULT_INFORMATION_POLICY,
    cognitionVersion: COGNITION_POLICY_VERSION,
    initialWorld: world.projection,
    residents: input.residents,
    canonicalPolicyContinuation: input.policies,
    canonicalMemoryContinuation: input.memories,
    canonicalCognitiveDocuments: input.documents,
    ...(input.requestHistory ? { canonicalRequestHistory: input.requestHistory } : {}),
    worldPolicies: serializableWorldPolicy(
      input.policies.seed,
      world.projection,
      undefined,
      input.policies,
    ),
    provenance: {
      mode: 'canonical-migration-candidate',
      worldPolicyAdapter: input.policies.version,
      information: DEFAULT_INFORMATION_POLICY.version,
      cognition: COGNITION_POLICY_VERSION,
    },
  });
  // Validate initial adapters now, before a target directory or writer is involved.
  initialOpenSocietyState(manifest);
  return {
    version: 'canonical-society-candidate-v1' as const,
    status: 'candidate' as const,
    manifest,
    sourceBarrier: world.barrier,
    activation: 'not-authorized-by-candidate' as const,
  };
}
