import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileSocialReflectionObservationRepository,
  InMemorySocialReflectionObservationRepository,
  type SocialReflectionObservation,
} from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('social reflection observation repositories', () => {
  test('records observations idempotently and queries chronological cloned rows', async () => {
    const repository = new InMemorySocialReflectionObservationRepository();

    await repository.record([
      createObservation({
        observationId: 'observation-2',
        reflectionId: 'reflection-2',
        generatedAt: 20,
        statement: 'Second reflection.',
      }),
      createObservation({
        observationId: 'observation-1',
        reflectionId: 'reflection-1',
        generatedAt: 10,
        statement: 'First reflection.',
      }),
      createObservation({
        observationId: 'other-target',
        reflectionId: 'reflection-other-target',
        targetAgentId: 'agent-3',
        generatedAt: 15,
        statement: 'Different target.',
      }),
      createObservation({
        observationId: 'observation-2',
        reflectionId: 'reflection-2',
        generatedAt: 20,
        statement: 'Duplicate should not replace the original.',
      }),
    ]);

    await expect(repository.get('observation-1')).resolves.toMatchObject({
      observationId: 'observation-1',
      statement: 'First reflection.',
    });
    await expect(repository.get('missing-observation')).resolves.toBeUndefined();
    const rows = await repository.query({
      simulationId: 'sim-social',
      partitionKey: 'world-main',
      agentId: 'agent-1',
      targetAgentId: 'agent-2',
      fromGeneratedAt: 0,
      toGeneratedAt: 30,
    });

    expect(rows.map((row) => [row.observationId, row.generatedAt, row.statement])).toEqual([
      ['observation-1', 10, 'First reflection.'],
      ['observation-2', 20, 'Second reflection.'],
    ]);

    (rows[0] as { statement: string }).statement = 'mutated';
    await expect(
      repository.query({
        simulationId: 'sim-social',
        observationId: 'observation-2',
      }),
    ).resolves.toMatchObject([{ observationId: 'observation-2', statement: 'Second reflection.' }]);
    await expect(
      repository.query({
        simulationId: 'sim-social',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        limit: 1,
      }),
    ).resolves.toMatchObject([{ observationId: 'observation-1', statement: 'First reflection.' }]);
  });

  test('persists observations in JSONL files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-social-reflections-'));
    tempDirs.push(rootDir);
    const repository = new FileSocialReflectionObservationRepository({ rootDir });

    await repository.record([createObservation({ observationId: 'file-observation' })]);

    const reopened = new FileSocialReflectionObservationRepository({ rootDir });

    await expect(reopened.get('file-observation')).resolves.toMatchObject({
      observationId: 'file-observation',
      reflectionId: 'reflection-file-observation',
    });
    await expect(reopened.query({ simulationId: 'sim-social' })).resolves.toMatchObject([
      { observationId: 'file-observation', reflectionId: 'reflection-file-observation' },
    ]);
  });

  test('rejects invalid observations and query limits', async () => {
    const repository = new InMemorySocialReflectionObservationRepository();

    await expect(
      repository.record([
        createObservation({
          observationId: '',
        }),
      ]),
    ).rejects.toThrow('observationId must not be empty');
    await expect(repository.query({ simulationId: 'sim-social', limit: 0 })).rejects.toThrow(
      'limit must be a positive integer',
    );
  });
});

function createObservation(
  overrides: Partial<SocialReflectionObservation> &
    Pick<SocialReflectionObservation, 'observationId'>,
): SocialReflectionObservation {
  return {
    observationId: overrides.observationId,
    simulationId: overrides.simulationId ?? 'sim-social',
    partitionKey: overrides.partitionKey ?? 'world-main',
    reflectionId: overrides.reflectionId ?? `reflection-${overrides.observationId}`,
    agentId: overrides.agentId ?? 'agent-1',
    targetAgentId: overrides.targetAgentId ?? 'agent-2',
    statement: overrides.statement ?? 'Interaction with agent-2 changed relation by 1.',
    relationDelta: overrides.relationDelta ?? 1,
    attitudeDelta: overrides.attitudeDelta ?? 1,
    confidence: overrides.confidence ?? 0.8,
    evidenceRecordIds: overrides.evidenceRecordIds ?? ['social-memory-1'],
    generatedAt: overrides.generatedAt ?? 100,
    tags: overrides.tags ?? ['social', 'post-interaction-reflection'],
    source: overrides.source ?? 'memory-consolidation',
  };
}
