import { describe, expect, test } from 'vitest';
import {
  CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
  createCanonicalMemoryConsolidationPolicyManifest,
  createCanonicalMemoryConsolidationSchedule,
} from './index';

describe('canonical memory consolidation policy', () => {
  test('provides a bounded importance-triggered dual-process memory schedule', () => {
    expect(CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID).toBe('dual-process-memory-consolidation-v4');
    expect(createCanonicalMemoryConsolidationSchedule()).toEqual({
      retrievalLimit: 32,
      minPatternCount: 3,
      reflectionTrigger: { minimumImportanceScore: 1.8 },
    });
  });

  test('records the immediate and cross-cycle identity-evidence semantics', () => {
    expect(createCanonicalMemoryConsolidationPolicyManifest()).toEqual({
      policyId: 'dual-process-memory-consolidation-v4',
      policyVersion: 'dual-process-memory-consolidation-v4',
      retrievalLimit: 32,
      recentBufferLimitPerAgent: 64,
      sparseCheckpointInterval: 1024,
      maxSparseCheckpointCount: 4096,
      minPatternCount: 3,
      reflectionTrigger: { minimumImportanceScore: 1.8 },
      immediateSocialReflectionRule: 'every-successful-social-interaction-bypasses-importance-gate',
      longTermIdentityEvidenceRule:
        'current-social-event-plus-positive-social-record-provenance-already-consolidated-in-ltm',
      durableLedgerRule:
        'append-only-jsonl-complete-ledger-with-bounded-recent-record-and-sparse-checkpoint-projections',
      ledgerLookupRule:
        'serve-complete-recent-window-else-scan-once-from-newest-checkpoint-not-after-oldest-required-append-sequence',
      cursorRule: 'advance-append-sequence-only-after-successful-consolidation',
      legacyCursorUpgradeRule: 'replay-inclusive-boundary-timestamp-then-persist-append-sequence',
    });
  });

  test('returns fresh nested policy state', () => {
    const first = createCanonicalMemoryConsolidationSchedule();
    const second = createCanonicalMemoryConsolidationSchedule();

    expect(first).not.toBe(second);
    expect(first.reflectionTrigger).not.toBe(second.reflectionTrigger);
  });
});
