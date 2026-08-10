import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileEventStore,
  asAgentId,
  createEventEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { FileShortTermMemoryRepository, createShortTermMemoryRecord } from '@aivilization/memory';
import {
  deleteLocalRuntimeTownParticipantData,
  LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME,
} from './localRuntimeTownParticipantDataDeletion';
import { resolveLocalRuntimeTownParticipantDataDeletionCliConfig } from './localRuntimeTownParticipantDataDeletionCli';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('local runtime participant data deletion', () => {
  test('creates a replay-safe anonymized copy without mutating the source root', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'participant-data-deletion-'));
    roots.push(parent);
    const sourceRootDir = join(parent, 'source');
    const targetRootDir = join(parent, 'target');
    const partition = createSimulationPartition({
      simulationId: 'sim-participant-delete',
      partitionKey: 'world-main',
    });
    const eventRoot = join(
      sourceRootDir,
      'simulations',
      'sim-participant-delete',
      'partitions',
      'world-main',
      'events',
    );
    const event = createEventEnvelope({
      id: 'event-register-agent',
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      commandId: 'command-register-agent',
      type: 'AgentRegistered',
      payload: {
        agentId: 'agent-1',
        creatorId: 'participant-7',
        humanAttribution: {
          principalSubjectId: 'participant-7',
          principalRoles: ['participant'],
        },
      },
      occurredAt: 1_000,
      sequence: 1,
    });
    new FileEventStore({ rootDir: eventRoot }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'register-agent-1',
      events: [event],
    });
    const observabilityRoot = join(
      sourceRootDir,
      'simulations',
      'sim-participant-delete',
      'partitions',
      'world-main',
      'observability',
    );
    mkdirSync(observabilityRoot, { recursive: true });
    writeFileSync(
      join(observabilityRoot, 'steering-traces.jsonl'),
      `${JSON.stringify({ humanAttribution: { principalSubjectId: 'participant-7' } })}\n`,
    );
    const memoryRoot = join(
      sourceRootDir,
      'simulations',
      'sim-participant-delete',
      'partitions',
      'world-main',
      'memory',
    );
    await new FileShortTermMemoryRepository({ rootDir: memoryRoot }).append(
      createShortTermMemoryRecord({
        id: 'memory-participant-action',
        agentId: asAgentId('participant-7'),
        kind: 'action',
        status: 'succeeded',
        summary: 'Visited the town square.',
        occurredAt: 1_000,
        importanceScore: 0.5,
        source: { eventIds: [] },
      }),
    );
    writeFileSync(
      join(sourceRootDir, 'checkpoint.json'),
      `${JSON.stringify({ uri: `file://${sourceRootDir}/snapshot.json` })}\n`,
    );
    const sourceEventBefore = readFileSync(
      join(eventRoot, 'streams', `${encodeURIComponent(partition.eventStreamName)}.jsonl`),
      'utf8',
    );

    const artifact = deleteLocalRuntimeTownParticipantData({
      sourceRootDir,
      targetRootDir,
      participantSubjectId: 'participant-7',
      tombstoneSubjectId: 'deleted-participant:test',
      createdAt: 2_000,
    });

    expect(artifact).toMatchObject({
      schemaVersion: 'participant-data-deletion-v1',
      createdAt: 2_000,
      tombstoneSubjectId: 'deleted-participant:test',
      eventStoreCount: 1,
      eventReplacementCount: 2,
      otherReplacementCount: 2,
      verifiedResidualReferenceCount: 0,
      status: 'anonymized-copy-ready-for-explicit-activation',
    });
    expect(
      readFileSync(
        join(eventRoot, 'streams', `${encodeURIComponent(partition.eventStreamName)}.jsonl`),
        'utf8',
      ),
    ).toBe(sourceEventBefore);
    expect(readFileSync(join(targetRootDir, 'checkpoint.json'), 'utf8')).toContain(targetRootDir);
    expect(readFileSync(join(targetRootDir, 'checkpoint.json'), 'utf8')).not.toContain(
      sourceRootDir,
    );
    expect(
      readFileSync(
        join(targetRootDir, LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME),
        'utf8',
      ),
    ).not.toContain('participant-7');
    await expect(
      new FileShortTermMemoryRepository({
        rootDir: join(
          targetRootDir,
          'simulations',
          'sim-participant-delete',
          'partitions',
          'world-main',
          'memory',
        ),
      }).retrieve({ agentId: asAgentId('deleted-participant:test'), limit: 10 }),
    ).resolves.toMatchObject([{ id: 'memory-participant-action' }]);

    const redactedEvent = createEventEnvelope({
      ...event,
      payload: {
        ...event.payload,
        creatorId: 'deleted-participant:test',
        humanAttribution: {
          ...event.payload.humanAttribution,
          principalSubjectId: 'deleted-participant:test',
        },
      },
    });
    expect(
      new FileEventStore({
        rootDir: join(
          targetRootDir,
          'simulations',
          'sim-participant-delete',
          'partitions',
          'world-main',
          'events',
        ),
      }).appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'register-agent-1',
        events: [redactedEvent],
      }),
    ).toMatchObject({ idempotentReplay: true, streamVersion: 1 });
  });

  test('requires an offline confirmation and reads the subject from a file', () => {
    const parent = mkdtempSync(join(tmpdir(), 'participant-data-deletion-cli-'));
    roots.push(parent);
    const subjectIdFile = join(parent, 'subject-id.txt');
    writeFileSync(subjectIdFile, 'participant-9\n', 'utf8');

    expect(() =>
      resolveLocalRuntimeTownParticipantDataDeletionCliConfig({
        cwd: parent,
        argv: [
          '--source-root-dir',
          'source',
          '--target-root-dir',
          'target',
          '--subject-id-file',
          'subject-id.txt',
        ],
      }),
    ).toThrow('--confirm-source-stopped is required');
    expect(
      resolveLocalRuntimeTownParticipantDataDeletionCliConfig({
        cwd: parent,
        argv: [
          '--source-root-dir',
          'source',
          '--target-root-dir',
          'target',
          '--subject-id-file',
          'subject-id.txt',
          '--confirm-source-stopped',
        ],
      }),
    ).toEqual({
      sourceRootDir: join(parent, 'source'),
      targetRootDir: join(parent, 'target'),
      participantSubjectId: 'participant-9',
      sourceWriterConfirmedStopped: true,
    });
  });
});
