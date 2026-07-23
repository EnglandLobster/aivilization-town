import { asAgentId } from '@aivilization/sim-core';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileAgentIntentionRepository,
  FileLongTermProfileRepository,
  FileShortTermMemoryRepository,
  FILE_SHORT_TERM_MEMORY_COMPACT_PATH,
  SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
  asMemoryRecordId,
  createFileShortTermMemoryStoragePolicyManifest,
  createShortTermMemoryRecord,
  type LongHorizonObjective,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-memory-repository-'));
  tmpRoots.push(root);
  return root;
}

describe('file short-term memory repository', () => {
  test('persists appended records across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const firstRepository = new FileShortTermMemoryRepository({ rootDir });

    await firstRepository.append(
      createShortTermMemoryRecord({
        id: 'memory-1',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Studied before work.',
        occurredAt: 100,
        importanceScore: 0.8,
        source: { eventIds: [] },
        tags: ['study'],
      }),
    );
    const restartedRepository = new FileShortTermMemoryRepository({ rootDir });

    await expect(
      restartedRepository.retrieve({
        agentId,
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toMatchObject([
      {
        id: 'memory-1',
        agentId: 'agent-1',
        summary: 'Studied before work.',
      },
    ]);
  });

  test('retrieves multiple agent windows through one ordered batch contract', async () => {
    const rootDir = createRootDir();
    const firstAgentId = asAgentId('agent-1');
    const secondAgentId = asAgentId('agent-2');
    const repository = new FileShortTermMemoryRepository({ rootDir });
    await repository.appendMany([
      createShortTermMemoryRecord({
        id: 'agent-1-old',
        agentId: firstAgentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'First agent studied.',
        occurredAt: 100,
        importanceScore: 0.6,
        source: { eventIds: [] },
      }),
      createShortTermMemoryRecord({
        id: 'agent-2-new',
        agentId: secondAgentId,
        kind: 'action',
        status: 'failed',
        summary: 'Second agent failed to work.',
        occurredAt: 200,
        importanceScore: 0.8,
        source: { eventIds: [] },
      }),
    ]);

    await expect(
      repository.retrieveMany([
        { agentId: firstAgentId, limit: 10, orderBy: 'oldest-first' },
        { agentId: secondAgentId, limit: 10, orderBy: 'oldest-first' },
      ]),
    ).resolves.toEqual([
      [expect.objectContaining({ id: 'agent-1-old', agentId: firstAgentId })],
      [expect.objectContaining({ id: 'agent-2-new', agentId: secondAgentId })],
    ]);
  });

  test('refreshes an indexed reader after another repository appends', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const reader = new FileShortTermMemoryRepository({ rootDir });
    const writer = new FileShortTermMemoryRepository({ rootDir });

    await expect(reader.retrieve({ agentId, limit: 10 })).resolves.toEqual([]);
    await writer.append(
      createShortTermMemoryRecord({
        id: 'external-memory',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'Observed through another repository instance.',
        occurredAt: 300,
        importanceScore: 0.5,
        source: { eventIds: [] },
      }),
    );

    await expect(reader.retrieve({ agentId, limit: 10 })).resolves.toMatchObject([
      { id: 'external-memory', agentId },
    ]);
  });

  test('reads one ordered ledger across a legacy JSONL prefix and compact tail', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const legacyWriter = new FileShortTermMemoryRepository({
      rootDir,
      writerFormat: 'legacy-jsonl-v1',
    });
    await legacyWriter.appendMany([createFileMemory(1, agentId), createFileMemory(2, agentId)]);

    const compactWriter = new FileShortTermMemoryRepository({ rootDir });
    await compactWriter.appendMany([createFileMemory(3, agentId), createFileMemory(4, agentId)]);
    const restarted = new FileShortTermMemoryRepository({ rootDir });
    const [window] = await restarted.retrieveLedgerMany([{ agentId, limit: 10 }]);

    expect(window?.entries.map((entry) => [entry.appendSequence, entry.record.id])).toEqual([
      [1, 'file-memory-1'],
      [2, 'file-memory-2'],
      [3, 'file-memory-3'],
      [4, 'file-memory-4'],
    ]);
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      recordCount: 4,
      legacyRecordCount: 2,
      compactRecordCount: 2,
      compactFrameCount: 1,
      writerFormat: 'compact-deflate-frames-v1',
    });
    expect(() => legacyWriter.append(createFileMemory(5, agentId))).toThrow(
      'legacy short-term memory writer cannot append after compact frames',
    );
  });

  test('compresses repetitive batches and fails closed on an incomplete compact frame', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const repository = new FileShortTermMemoryRepository({ rootDir });
    const records = Array.from({ length: 64 }, (_, index) => createFileMemory(index + 1, agentId));
    await repository.appendMany(records);
    const compactPath = join(rootDir, FILE_SHORT_TERM_MEMORY_COMPACT_PATH);
    const rawByteLength = Buffer.byteLength(
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );

    expect(statSync(compactPath).size).toBeLessThan(rawByteLength);
    appendFileSync(compactPath, Buffer.from([0, 1]));
    expect(() => repository.getStorageDiagnostics()).toThrow('incomplete frame header');
  });

  test('publishes the compact storage compatibility and corruption contract', () => {
    expect(createFileShortTermMemoryStoragePolicyManifest()).toEqual({
      policyVersion: 'file-short-term-memory-storage-v2',
      writerFormat: 'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1',
      compatibilityRule: 'ordered-union-read-of-legacy-jsonl-prefix-and-compact-frame-tail',
      appendRule: 'legacy-jsonl-must-not-grow-after-first-compact-frame',
      hotIndexRule: 'bounded-recent-records-per-agent-plus-bounded-sparse-checkpoints',
      coldReadRule: 'exact-ledger-scan-from-nearest-retained-cross-format-checkpoint',
      corruptionRule: 'fail-closed-on-incomplete-or-invalid-jsonl-or-deflate-frame',
    });
  });

  test('bounds hot records and reads the complete sequenced ledger across restart', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const recordCount = SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT + 6;
    const repository = new FileShortTermMemoryRepository({ rootDir });
    await repository.appendMany(
      Array.from({ length: recordCount }, (_, index) => createFileMemory(index + 1, agentId)),
    );

    const recent = await repository.retrieve({
      agentId,
      limit: recordCount,
      orderBy: 'oldest-first',
    });
    const restarted = new FileShortTermMemoryRepository({ rootDir });
    const [coldWindow, tailWindow] = await restarted.retrieveLedgerMany([
      { agentId, limit: 3 },
      {
        agentId,
        appendedAfterSequence: SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
        limit: recordCount,
      },
    ]);

    expect(recent).toHaveLength(SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT);
    expect(recent[0]?.id).toBe('file-memory-7');
    expect(recent.at(-1)?.id).toBe(`file-memory-${recordCount}`);
    expect(coldWindow?.entries).toMatchObject([
      { appendSequence: 1, record: { id: 'file-memory-1' } },
      { appendSequence: 2, record: { id: 'file-memory-2' } },
      { appendSequence: 3, record: { id: 'file-memory-3' } },
    ]);
    expect(tailWindow?.entries.map((entry) => entry.record.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `file-memory-${index + 65}`),
    );
  });

  test('bounds sparse ledger checkpoints and falls back to a complete cold scan', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const repository = new FileShortTermMemoryRepository({
      rootDir,
      recentBufferLimitPerAgent: 2,
      sparseCheckpointInterval: 2,
      maxSparseCheckpointCount: 3,
    });
    await repository.appendMany(
      Array.from({ length: 10 }, (_, index) => createFileMemory(index + 1, agentId)),
    );

    const diagnostics = repository.getStorageDiagnostics();
    expect(diagnostics.committedBytes).toBeGreaterThan(0);
    expect(diagnostics).toMatchObject({
      recordCount: 10,
      indexedAgentCount: 1,
      recentRecordCount: 2,
      recentBufferLimitPerAgent: 2,
      sparseCheckpointCount: 3,
      sparseCheckpointInterval: 2,
      maxSparseCheckpointCount: 3,
      earliestRetainedCheckpointAppendSequence: 5,
      latestRetainedCheckpointAppendSequence: 9,
    });

    const restarted = new FileShortTermMemoryRepository({
      rootDir,
      recentBufferLimitPerAgent: 2,
      sparseCheckpointInterval: 2,
      maxSparseCheckpointCount: 3,
    });
    const [evictedCheckpointWindow, retainedCheckpointWindow] = await restarted.retrieveLedgerMany([
      { agentId, appendedAfterSequence: 1, limit: 3 },
      { agentId, appendedAfterSequence: 6, limit: 10 },
    ]);

    expect(evictedCheckpointWindow?.entries).toMatchObject([
      { appendSequence: 2, record: { id: 'file-memory-2' } },
      { appendSequence: 3, record: { id: 'file-memory-3' } },
      { appendSequence: 4, record: { id: 'file-memory-4' } },
    ]);
    expect(retainedCheckpointWindow?.entries.map((entry) => entry.appendSequence)).toEqual([
      7, 8, 9, 10,
    ]);
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      recordCount: 10,
      indexedAgentCount: 1,
      recentRecordCount: 2,
      sparseCheckpointCount: 3,
      earliestRetainedCheckpointAppendSequence: 5,
      latestRetainedCheckpointAppendSequence: 9,
    });
  });

  test('drops a partial projection after malformed JSONL and rebuilds after repair', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const repository = new FileShortTermMemoryRepository({
      rootDir,
      writerFormat: 'legacy-jsonl-v1',
    });
    const first = createFileMemory(1, agentId);
    const second = createFileMemory(2, agentId);
    await repository.append(first);
    const recordsPath = join(rootDir, 'short-term-memory.jsonl');
    appendFileSync(recordsPath, '{not-json}\n');

    expect(() => repository.retrieve({ agentId, limit: 10 })).toThrow();

    writeFileSync(recordsPath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    await expect(
      repository.retrieve({ agentId, limit: 10, orderBy: 'oldest-first' }),
    ).resolves.toMatchObject([{ id: 'file-memory-1' }, { id: 'file-memory-2' }]);
  });
});

describe('file agent intention repository', () => {
  test('persists objective and scheduled intentions across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study enough to qualify for better jobs.',
      priority: 3,
      source: 'agent',
      affinityTags: ['study'],
      createdAt: 100,
      updatedAt: 100,
    };
    const firstRepository = new FileAgentIntentionRepository({ rootDir });

    await firstRepository.setObjective(agentId, objective);
    await firstRepository.upsertScheduledIntentions(agentId, [
      {
        id: 'study-block',
        agentId,
        objectiveId: objective.id,
        description: 'Study at the library.',
        priority: 2,
        startsAt: 200,
        endsAt: 300,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 150,
        updatedAt: 150,
      },
    ]);
    await firstRepository.completeObjective(agentId, {
      objectiveId: objective.id,
      completedAt: 400,
      reason: 'plan-completed',
      planId: objective.id,
    });
    const restartedRepository = new FileAgentIntentionRepository({ rootDir });

    await expect(restartedRepository.getOrCreate(agentId)).resolves.toMatchObject({
      completedObjectives: [
        {
          objective,
          completedAt: 400,
          reason: 'plan-completed',
          planId: objective.id,
        },
      ],
      scheduledIntentions: [
        { id: 'study-block', description: 'Study at the library.', status: 'completed' },
      ],
      updatedAt: 400,
    });
    expect((await restartedRepository.getOrCreate(agentId)).activeObjective).toBeUndefined();
  });

  test('replays legacy snapshots followed by incremental ledger operations', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const legacyObjective = createObjective(agentId, 1);
    const nextObjective = createObjective(agentId, 2);
    writeFileSync(
      join(rootDir, 'agent-intentions.jsonl'),
      `${JSON.stringify({
        agentId,
        completedObjectives: [
          {
            objective: legacyObjective,
            completedAt: 20,
            reason: 'plan-completed',
            planId: legacyObjective.id,
          },
        ],
        scheduledIntentions: [],
        updatedAt: 20,
      })}\n`,
    );
    const repository = new FileAgentIntentionRepository({ rootDir });

    await repository.setObjective(agentId, nextObjective);
    await repository.completeObjective(agentId, {
      objectiveId: nextObjective.id,
      completedAt: 30,
      reason: 'plan-completed',
      planId: nextObjective.id,
    });
    const restarted = new FileAgentIntentionRepository({ rootDir });

    await expect(restarted.getOrCreate(agentId)).resolves.toMatchObject({
      completedObjectives: [
        { objective: { id: legacyObjective.id } },
        { objective: { id: nextObjective.id } },
      ],
      updatedAt: 30,
    });
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      recordCount: 3,
      legacySnapshotRecordCount: 1,
      incrementalRecordCount: 2,
      indexedAgentCount: 1,
    });
  });

  test('refreshes a projected reader after another repository appends an operation', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const reader = new FileAgentIntentionRepository({ rootDir });
    const writer = new FileAgentIntentionRepository({ rootDir });
    await reader.getOrCreate(agentId);

    await writer.setObjective(agentId, createObjective(agentId, 1));

    await expect(reader.getOrCreate(agentId)).resolves.toMatchObject({
      activeObjective: { id: 'objective-0001' },
    });
  });

  test('keeps standard objective lifecycle persistence linear without cumulative snapshots', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const repository = new FileAgentIntentionRepository({ rootDir });
    const ledgerPath = join(rootDir, 'agent-intentions.jsonl');
    let firstHalfBytes = 0;

    for (let index = 1; index <= 120; index += 1) {
      const objective = createObjective(agentId, index);
      await repository.setObjective(agentId, objective);
      await repository.completeObjective(agentId, {
        objectiveId: objective.id,
        completedAt: index * 10 + 1,
        reason: 'plan-completed',
        planId: objective.id,
      });
      if (index === 60) {
        firstHalfBytes = statSync(ledgerPath).size;
      }
    }

    const totalBytes = statSync(ledgerPath).size;
    const secondHalfBytes = totalBytes - firstHalfBytes;
    const rows = readFileSync(ledgerPath, 'utf8').trim().split('\n');
    const restarted = new FileAgentIntentionRepository({ rootDir });
    const state = await restarted.getOrCreate(agentId);

    expect(state.completedObjectives).toHaveLength(32);
    expect(state.completedObjectives[0]?.objective.id).toBe('objective-0089');
    expect(state.completedObjectives.at(-1)?.objective.id).toBe('objective-0120');
    expect(state.completedObjectiveCount).toBe(120);
    expect(rows).toHaveLength(241);
    expect(secondHalfBytes).toBeLessThan(firstHalfBytes * 1.05);
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      committedBytes: totalBytes,
      recordCount: 241,
      legacySnapshotRecordCount: 0,
      incrementalRecordCount: 241,
      indexedAgentCount: 1,
      totalCompletedObjectiveCount: 120,
      retainedCompletedObjectiveCount: 32,
      completedObjectiveRetentionLimit: 32,
    });
    expect(restarted.getStorageDiagnostics().maximumRecordBytes).toBeLessThan(1_024);
  });

  test('union-replays v2 operations and writes v3 rows without losing the completion ordinal', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const objective = createObjective(agentId, 1);
    const ledgerPath = join(rootDir, 'agent-intentions.jsonl');
    writeFileSync(
      ledgerPath,
      [
        {
          schemaVersion: 'agent-intention-ledger-v2',
          operation: 'set-objective',
          agentId,
          objective,
        },
        {
          schemaVersion: 'agent-intention-ledger-v2',
          operation: 'complete-objective',
          agentId,
          request: {
            objectiveId: objective.id,
            completedAt: 20,
            reason: 'plan-completed',
            planId: objective.id,
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n',
    );
    const repository = new FileAgentIntentionRepository({ rootDir });

    await expect(repository.getOrCreate(agentId)).resolves.toMatchObject({
      completedObjectives: [{ objective: { id: objective.id } }],
    });
    const nextObjective = createObjective(agentId, 2);
    await repository.setObjective(agentId, nextObjective);
    const rows = readFileSync(ledgerPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(rows.at(-1)).toMatchObject({
      schemaVersion: 'agent-intention-ledger-v3',
      operation: 'set-objective',
    });
    expect(repository.getStorageDiagnostics()).toMatchObject({
      totalCompletedObjectiveCount: 1,
      retainedCompletedObjectiveCount: 1,
    });
  });

  test('rejects unknown future ledger versions instead of guessing their semantics', async () => {
    const rootDir = createRootDir();
    writeFileSync(
      join(rootDir, 'agent-intentions.jsonl'),
      `${JSON.stringify({ schemaVersion: 'agent-intention-ledger-v99', operation: 'noop' })}\n`,
    );
    const repository = new FileAgentIntentionRepository({ rootDir });

    await expect(repository.getOrCreate(asAgentId('agent-1'))).rejects.toThrow(
      'unsupported agent intention ledger version agent-intention-ledger-v99',
    );
  });
});

describe('file long-term profile repository', () => {
  test('persists applied profile patches across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const firstRepository = new FileLongTermProfileRepository({ rootDir });

    await firstRepository.applyPatches(agentId, [
      {
        id: 'patch-habit',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.7,
        provenanceRecordIds: [asMemoryRecordId('memory-1')],
        proposedAt: 200,
      },
      {
        id: 'patch-mood',
        agentId,
        section: 'mood',
        key: 'cooperative-composure',
        statement: 'Maintains cooperative composure.',
        confidence: 0.75,
        provenanceRecordIds: [asMemoryRecordId('mood-memory-1')],
        proposedAt: 250,
      },
    ]);
    const restartedRepository = new FileLongTermProfileRepository({ rootDir });

    await expect(restartedRepository.getOrCreate(agentId)).resolves.toMatchObject({
      agentId: 'agent-1',
      habits: [
        {
          key: 'study-before-work',
          statement: 'Studies before starting work.',
          confidence: 0.7,
          provenanceRecordIds: ['memory-1'],
          updatedAt: 200,
        },
      ],
      mood: [
        {
          key: 'cooperative-composure',
          statement: 'Maintains cooperative composure.',
          confidence: 0.75,
          provenanceRecordIds: ['mood-memory-1'],
          updatedAt: 250,
        },
      ],
    });
  });

  test('suppresses unchanged profiles and compacts latest state in single-writer mode', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const repository = new FileLongTermProfileRepository({
      rootDir,
      singleWriterCompactionMaximumBytes: 1,
    });
    const created = await repository.getOrCreate(agentId);

    await repository.save(structuredClone(created));
    await repository.applyPatches(agentId, [
      {
        id: 'patch-value',
        agentId,
        section: 'values',
        key: 'learning',
        statement: 'Values learning.',
        confidence: 0.8,
        provenanceRecordIds: [asMemoryRecordId('memory-1')],
        proposedAt: 200,
      },
    ]);

    expect(repository.getStorageDiagnostics()).toMatchObject({
      completeRecordCount: 1,
      indexedAgentCount: 1,
      suppressedDuplicateSaveCount: 1,
      compactionCount: 2,
    });
    expect(repository.getStorageDiagnostics().compactionReclaimedBytes).toBeGreaterThan(0);
    await expect(repository.getOrCreate(agentId)).resolves.toMatchObject({
      values: [{ key: 'learning', statement: 'Values learning.' }],
    });
  });
});

function createFileMemory(index: number, agentId: ReturnType<typeof asAgentId>) {
  return createShortTermMemoryRecord({
    id: `file-memory-${index}`,
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: `Completed file-backed memory action ${index}.`,
    occurredAt: index,
    importanceScore: 0.6,
    source: { eventIds: [] },
    tags: ['study'],
  });
}

function createObjective(
  agentId: ReturnType<typeof asAgentId>,
  index: number,
): LongHorizonObjective {
  const objectiveId = `objective-${String(index).padStart(4, '0')}`;
  return {
    id: objectiveId,
    agentId,
    statement: 'Complete one bounded market objective.',
    priority: 1,
    source: 'agent',
    affinityTags: ['trade', 'market'],
    createdAt: index * 10,
    updatedAt: index * 10,
  };
}
