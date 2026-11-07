import type {
  BranchPlanRecord,
  BranchPlanProgress,
  BranchPlanRepository,
  BranchPlanProgressRepository,
} from '@aivilization/agent-runtime';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import type {
  AgentIntentionState,
  AgentIntentionLedgerRecord,
  LongTermAgentProfile,
} from '@aivilization/memory';
export const CANONICAL_COGNITIVE_LEDGERS = [
  'profile',
  'intentions',
  'branch-plan',
  'branch-progress',
] as const;
export type CanonicalCognitiveLedger = (typeof CANONICAL_COGNITIVE_LEDGERS)[number];
export type CanonicalCognitiveRevision = {
  readonly agentId: AgentId;
  readonly sourceOrdinal: number;
  readonly ledger: CanonicalCognitiveLedger;
  readonly record:
    | LongTermAgentProfile
    | AgentIntentionState
    | AgentIntentionLedgerRecord
    | BranchPlanRecord
    | BranchPlanProgress;
};
export function canonicalCognitiveRevisionOwner(
  record: CanonicalCognitiveRevision['record'],
): AgentId {
  return 'operation' in record && record.operation === 'replace-state'
    ? record.state.agentId
    : record.agentId;
}
export type CanonicalCognitiveDocument = { readonly partitionKey: string } & (
  | { readonly kind: 'profile'; readonly value: LongTermAgentProfile }
  | { readonly kind: 'intentions'; readonly value: AgentIntentionState }
  | { readonly kind: 'branch-plan'; readonly value: BranchPlanRecord }
  | { readonly kind: 'branch-progress'; readonly value: BranchPlanProgress }
  | { readonly kind: 'retained-revision'; readonly value: CanonicalCognitiveRevision }
);
export type CanonicalCognitiveDocuments = {
  readonly version:
    | 'canonical-cognitive-documents-v1'
    | 'canonical-cognitive-documents-v2'
    | 'canonical-cognitive-documents-v3';
  readonly capturedAt: number;
  readonly documentsByResident: Readonly<Record<string, readonly CanonicalCognitiveDocument[]>>;
};
/** Snapshot existing states only; old active intentions are never new execution permission. */
export async function readCanonicalCognitiveDocuments(input: {
  readonly residentIds: readonly string[];
  readonly capturedAt: number;
  readonly partitions: readonly {
    readonly partitionKey: string;
    readonly history?: Readonly<
      Record<
        CanonicalCognitiveLedger,
        { readHistory(id: AgentId): Promise<readonly Omit<CanonicalCognitiveRevision, 'ledger'>[]> }
      >
    >;
    readonly planning?: {
      readonly plans: Pick<BranchPlanRepository, 'query'>;
      readonly progress: Pick<BranchPlanProgressRepository, 'get'>;
    };
    readonly profiles: { find(id: AgentId): Promise<LongTermAgentProfile | undefined> };
    readonly intentions: { find(id: AgentId): Promise<AgentIntentionState | undefined> };
  }[];
}): Promise<CanonicalCognitiveDocuments> {
  if (
    !Number.isSafeInteger(input.capturedAt) ||
    input.capturedAt < 0 ||
    input.partitions.length === 0 ||
    new Set(input.residentIds).size !== input.residentIds.length ||
    new Set(input.partitions.map((p) => p.partitionKey)).size !== input.partitions.length
  )
    throw new Error('canonical-cognitive-source-invalid');
  const withPlanning = input.partitions.some((p) => p.planning !== undefined);
  if (withPlanning && input.partitions.some((p) => p.planning === undefined))
    throw new Error('canonical-planning-source-missing');
  const withHistory = input.partitions.some((p) => p.history !== undefined);
  if (withHistory && (!withPlanning || input.partitions.some((p) => p.history === undefined)))
    throw new Error('canonical-cognitive-history-source-missing');
  const documentsByResident: Record<string, CanonicalCognitiveDocument[]> = Object.fromEntries(
    input.residentIds.map((id) => [id, []]),
  );
  for (const part of [...input.partitions].sort((a, b) =>
    a.partitionKey.localeCompare(b.partitionKey, 'en'),
  )) {
    if (!part.partitionKey.trim()) throw new Error('canonical-cognitive-partition-invalid');
    for (const residentId of input.residentIds) {
      const id = asAgentId(residentId);
      const [profile, intentions] = await Promise.all([
        part.profiles.find(id),
        part.intentions.find(id),
      ]);
      if ((profile && profile.agentId !== id) || (intentions && intentions.agentId !== id))
        throw new Error('canonical-cognitive-owner-mismatch');
      if (part.planning) {
        const plans = await part.planning.plans.query({ agentId: id });
        const seen = new Set<string>();
        for (const plan of plans) {
          if (plan.agentId !== id || !plan.planId.trim() || seen.has(plan.planId))
            throw new Error('canonical-planning-record-invalid');
          seen.add(plan.planId);
          const progress = await part.planning.progress.get({ agentId: id, planId: plan.planId });
          if (progress && (progress.agentId !== id || progress.planId !== plan.planId))
            throw new Error('canonical-planning-progress-mismatch');
          documentsByResident[id]!.push(
            structuredClone({ partitionKey: part.partitionKey, kind: 'branch-plan', value: plan }),
          );
          if (progress)
            documentsByResident[id]!.push(
              structuredClone({
                partitionKey: part.partitionKey,
                kind: 'branch-progress',
                value: progress,
              }),
            );
        }
      }
      if (part.history) {
        for (const ledger of CANONICAL_COGNITIVE_LEDGERS) {
          const revisions = await part.history[ledger].readHistory(id);
          let ordinal = 0;
          for (const revision of revisions) {
            const raw = revision.record;
            const owner = canonicalCognitiveRevisionOwner(raw);
            if (
              revision.agentId !== id ||
              owner !== id ||
              !Number.isSafeInteger(revision.sourceOrdinal) ||
              revision.sourceOrdinal <= ordinal
            )
              throw new Error('canonical-cognitive-history-record-invalid');
            ordinal = revision.sourceOrdinal;
            documentsByResident[id]!.push(
              structuredClone({
                partitionKey: part.partitionKey,
                kind: 'retained-revision',
                value: { ...revision, ledger },
              }),
            );
          }
        }
      }
      if (profile)
        documentsByResident[id]!.push(
          structuredClone({ partitionKey: part.partitionKey, kind: 'profile', value: profile }),
        );
      if (intentions)
        documentsByResident[id]!.push(
          structuredClone({
            partitionKey: part.partitionKey,
            kind: 'intentions',
            value: intentions,
          }),
        );
    }
  }
  return {
    version: withHistory
      ? 'canonical-cognitive-documents-v3'
      : withPlanning
        ? 'canonical-cognitive-documents-v2'
        : 'canonical-cognitive-documents-v1',
    capturedAt: input.capturedAt,
    documentsByResident,
  };
}
