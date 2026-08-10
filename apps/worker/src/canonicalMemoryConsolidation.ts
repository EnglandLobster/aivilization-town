import {
  SHORT_TERM_MEMORY_MAX_SPARSE_CHECKPOINT_COUNT,
  SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
  SHORT_TERM_MEMORY_SPARSE_CHECKPOINT_INTERVAL,
} from '@aivilization/memory';
import type { LocalSimulationLifecycleMemoryConsolidationSchedule } from './localSimulationLifecycle';

export const CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID = 'dual-process-memory-consolidation-v4';

const CANONICAL_MEMORY_RETRIEVAL_LIMIT = 32;
const CANONICAL_MEMORY_MIN_PATTERN_COUNT = 3;
const CANONICAL_MEMORY_MINIMUM_IMPORTANCE_SCORE = 1.8;

/**
 * Returns a fresh canonical schedule so callers cannot mutate shared nested policy state.
 *
 * The paper specifies periodic, importance-triggered consolidation without publishing concrete
 * normalized thresholds. The repository uses importance scores in [0, 1], so 1.8 lets three normal
 * successful action traces (0.6 each) form a repeated pattern while social interactions bypass the
 * importance gate and reflect immediately in the scheduler. The repository additionally keeps two
 * 32-record pages in the fast STM buffer and advances consolidation by durable append sequence;
 * neither storage bound nor cursor encoding is specified by the paper.
 */
export function createCanonicalMemoryConsolidationSchedule(): LocalSimulationLifecycleMemoryConsolidationSchedule {
  return {
    retrievalLimit: CANONICAL_MEMORY_RETRIEVAL_LIMIT,
    minPatternCount: CANONICAL_MEMORY_MIN_PATTERN_COUNT,
    reflectionTrigger: {
      minimumImportanceScore: CANONICAL_MEMORY_MINIMUM_IMPORTANCE_SCORE,
    },
  };
}

export function createCanonicalMemoryConsolidationPolicyManifest() {
  const schedule = createCanonicalMemoryConsolidationSchedule();
  return {
    policyId: CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
    policyVersion: CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
    retrievalLimit: schedule.retrievalLimit,
    recentBufferLimitPerAgent: SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
    sparseCheckpointInterval: SHORT_TERM_MEMORY_SPARSE_CHECKPOINT_INTERVAL,
    maxSparseCheckpointCount: SHORT_TERM_MEMORY_MAX_SPARSE_CHECKPOINT_COUNT,
    minPatternCount: schedule.minPatternCount,
    reflectionTrigger: { minimumImportanceScore: CANONICAL_MEMORY_MINIMUM_IMPORTANCE_SCORE },
    immediateSocialReflectionRule: 'every-successful-social-interaction-bypasses-importance-gate',
    longTermIdentityEvidenceRule:
      'current-social-event-plus-positive-social-record-provenance-already-consolidated-in-ltm',
    durableLedgerRule:
      'append-only-jsonl-complete-ledger-with-bounded-recent-record-and-sparse-checkpoint-projections',
    ledgerLookupRule:
      'serve-complete-recent-window-else-scan-once-from-newest-checkpoint-not-after-oldest-required-append-sequence',
    cursorRule: 'advance-append-sequence-only-after-successful-consolidation',
    legacyCursorUpgradeRule: 'replay-inclusive-boundary-timestamp-then-persist-append-sequence',
  } as const;
}
