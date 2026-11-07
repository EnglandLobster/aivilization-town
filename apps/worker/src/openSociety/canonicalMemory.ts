import type { OpenSocietyManifest, ResidentExperience } from './types';

/** Historical statements stay historical: no inferred consent, truth, goals or active cognition. */
export function canonicalMemoryExperiences(
  manifest: OpenSocietyManifest,
): Readonly<Record<string, readonly ResidentExperience[]>> {
  const source = manifest.canonicalMemoryContinuation;
  if (!source) return {};
  if (source.version !== 'canonical-memory-continuation-v1')
    throw new Error('canonical-memory-version-unsupported');
  const residents = new Set(manifest.residents.map((r) => r.id));
  const result: Record<string, ResidentExperience[]> = {};
  for (const [ownerId, entries] of Object.entries(source.recordsByResident)) {
    if (!residents.has(ownerId)) throw new Error('canonical-memory-owner-unknown');
    const seen = new Set<string>();
    result[ownerId] = entries.map((entry) => {
      const { record, partitionKey, appendSequence } = entry;
      const id = `canonical-memory:${encodeURIComponent(partitionKey)}:${appendSequence}`;
      if (
        record.agentId !== ownerId ||
        !partitionKey.trim() ||
        !Number.isSafeInteger(appendSequence) ||
        appendSequence < 1 ||
        seen.has(id)
      )
        throw new Error('canonical-memory-entry-invalid');
      seen.add(id);
      return {
        id,
        ownerId,
        at: record.occurredAt,
        occurredAt: record.occurredAt,
        kind: 'observation',
        summary: record.summary,
        sourceIds: [record.id, ...record.source.eventIds],
        people: [],
        provenance: 'legacy-record',
        canonicalSource: structuredClone(entry),
      };
    });
  }
  return result;
}
