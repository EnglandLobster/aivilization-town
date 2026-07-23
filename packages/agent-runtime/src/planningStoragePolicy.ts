export const PLANNING_STORAGE_POLICY_VERSION = 'planning-storage-v3';
export const BRANCH_PLAN_HOT_RECORDS_PER_AGENT = 4;
export const BRANCH_PLAN_PROGRESS_HOT_RECORDS_PER_AGENT = 4;
export const PLANNING_JOURNAL_COMPACTION_BYTES = 4 * 1_024 * 1_024;

export function createPlanningStoragePolicyManifest() {
  return {
    policyVersion: PLANNING_STORAGE_POLICY_VERSION,
    provenance: 'repository-design',
    durableLayout: 'jsonl-current-state-journal-v3',
    branchPlans: {
      hotProjection: 'latest-unique-plan-keys-per-agent',
      hotRecordsPerAgent: BRANCH_PLAN_HOT_RECORDS_PER_AGENT,
      coldLookup: 'exact-complete-ledger-scan-on-hot-miss',
      latestStateQuery: 'transient-latest-per-key-complete-ledger-scan',
    },
    branchPlanProgress: {
      hotProjection: 'latest-unique-plan-keys-per-agent',
      hotRecordsPerAgent: BRANCH_PLAN_PROGRESS_HOT_RECORDS_PER_AGENT,
      coldLookup: 'exact-complete-ledger-scan-on-hot-miss',
    },
    crossInstanceVisibility: 'incremental-complete-row-refresh-before-access',
    unchangedSave: 'semantic-no-op-with-suppressed-write-diagnostics',
    singleWriterCompaction: {
      enabledByLocalRuntime: true,
      maximumJournalBytes: PLANNING_JOURNAL_COMPACTION_BYTES,
      retainedRows: 'latest-record-per-agent-and-plan-key',
      replacement: 'atomic-rename',
    },
    recovery: 'rebuild-bounded-projection-after-replacement-truncation-or-rewrite',
    incompleteTail: 'hidden-from-reads-and-rejected-before-local-append',
  } as const;
}
