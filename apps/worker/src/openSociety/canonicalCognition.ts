import {
  CANONICAL_COGNITIVE_LEDGERS,
  canonicalCognitiveRevisionOwner,
} from '../canonicalCognitiveDocuments';
import type { OpenSocietyManifest, ResidentExperience } from './types';
export function canonicalCognitiveExperiences(
  manifest: OpenSocietyManifest,
): Readonly<Record<string, readonly ResidentExperience[]>> {
  const source = manifest.canonicalCognitiveDocuments;
  if (!source) return {};
  if (
    ![
      'canonical-cognitive-documents-v1',
      'canonical-cognitive-documents-v2',
      'canonical-cognitive-documents-v3',
    ].includes(source.version) ||
    !Number.isSafeInteger(source.capturedAt) ||
    source.capturedAt < 0
  )
    throw new Error('canonical-cognitive-source-invalid');
  const residents = new Set(manifest.residents.map((r) => r.id));
  const result: Record<string, ResidentExperience[]> = {};
  for (const [ownerId, documents] of Object.entries(source.documentsByResident)) {
    if (!residents.has(ownerId)) throw new Error('canonical-cognitive-owner-unknown');
    const ids = new Set<string>();
    result[ownerId] = documents.map((doc) => {
      const planning = doc.kind === 'branch-plan' || doc.kind === 'branch-progress';
      if (
        planning &&
        (source.version === 'canonical-cognitive-documents-v1' || !doc.value.planId.trim())
      )
        throw new Error('canonical-planning-version-or-id-invalid');
      const revision = doc.kind === 'retained-revision';
      if (
        revision &&
        (source.version !== 'canonical-cognitive-documents-v3' ||
          !CANONICAL_COGNITIVE_LEDGERS.includes(doc.value.ledger) ||
          canonicalCognitiveRevisionOwner(doc.value.record) !== ownerId ||
          !Number.isSafeInteger(doc.value.sourceOrdinal) ||
          doc.value.sourceOrdinal < 1)
      )
        throw new Error('canonical-cognitive-revision-invalid');
      const suffix = planning
        ? `:${encodeURIComponent(doc.value.planId)}`
        : revision
          ? `:${doc.value.ledger}:${doc.value.sourceOrdinal}`
          : '';
      const id = `canonical-cognition:${encodeURIComponent(doc.partitionKey)}:${doc.kind}${suffix}`;
      if (
        !doc.partitionKey.trim() ||
        !['profile', 'intentions', 'branch-plan', 'branch-progress', 'retained-revision'].includes(
          doc.kind,
        ) ||
        doc.value.agentId !== ownerId ||
        ids.has(id)
      )
        throw new Error('canonical-cognitive-document-invalid');
      ids.add(id);
      return {
        id,
        ownerId,
        at: source.capturedAt,
        kind: 'cognition',
        summary:
          doc.kind === 'profile'
            ? 'Historical long-term profile (original source snapshot)'
            : doc.kind === 'intentions'
              ? 'Historical planner intentions (not execution authorization)'
              : doc.kind === 'retained-revision'
                ? `Historical ${doc.value.ledger} revision ${doc.value.sourceOrdinal} (original retained record)`
                : `Historical ${doc.kind} ${doc.value.planId} (not execution authorization)`,
        sourceIds: [],
        people: [],
        provenance: 'legacy-record',
        canonicalDocument: structuredClone(doc),
      };
    });
  }
  return result;
}
