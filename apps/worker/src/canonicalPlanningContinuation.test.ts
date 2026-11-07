import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  FileBranchPlanRepository,
  FileBranchPlanProgressRepository,
  createBranchPlan,
  createBranchPlanProgress,
} from '@aivilization/agent-runtime';
import { readCanonicalCognitiveDocuments } from './canonicalCognitiveDocuments';
import { createOpenSocietyManifest } from './openSociety/manifest';
import { OpenSocietyRuntime } from './openSociety/runtime';
import { executeCognitionTool } from './openSociety/cognitionTools';

test('all stored plans and available progress stay historical, privately readable and stable on replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-planning-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    const manifest = createOpenSocietyManifest({ count: 2 });
    const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
    const agentId = asAgentId(a);
    const plans = new FileBranchPlanRepository({ rootDir: join(root, 'planning') });
    const progress = new FileBranchPlanProgressRepository({ rootDir: join(root, 'planning') });
    for (let i = 0; i < 65; i++) {
      const planId = `old-${i}`;
      await plans.save({
        planId,
        agentId,
        createdAt: i,
        updatedAt: i,
        plan: createBranchPlan({
          objective: 'Historical study',
          branches: [
            {
              id: 'study',
              objective: 'Learn',
              subtasks: [{ id: 'read', description: 'Read later', basePriority: 1 }],
            },
          ],
        }),
      });
      if (i < 64)
        await progress.save({
          ...createBranchPlanProgress({ planId, agentId, createdAt: i }),
          blockedSubtasks: [{ subtaskId: 'read', reason: 'old obstacle', blockedAt: i }],
        });
    }
    const files = ['branch-plans.jsonl', 'branch-plan-progress.jsonl'].map((f) =>
      join(root, 'planning', f),
    );
    const before = files.map((p) => readFileSync(p));
    const part = {
      partitionKey: 'p',
      profiles: { find: () => Promise.resolve(undefined) },
      intentions: { find: () => Promise.resolve(undefined) },
      planning: { plans, progress },
    };
    const source = await readCanonicalCognitiveDocuments({
      residentIds: [a, b],
      capturedAt: 0,
      partitions: [part],
    });
    expect(source.version).toBe('canonical-cognitive-documents-v2');
    expect(source.documentsByResident[a]!.filter((d) => d.kind === 'branch-plan')).toHaveLength(65);
    expect(source.documentsByResident[a]!.filter((d) => d.kind === 'branch-progress')).toHaveLength(
      64,
    );
    expect(source.documentsByResident[b]).toEqual([]);
    expect(files.map((p) => readFileSync(p))).toEqual(before);
    runtime = new OpenSocietyRuntime(join(root, 'target'), {
      ...manifest,
      canonicalCognitiveDocuments: source,
    });
    const docs = runtime.state.experiences[a]!;
    expect(new Set(docs.map((d) => d.id)).size).toBe(129);
    const doc = docs.find((d) => d.canonicalDocument?.kind === 'branch-progress')!;
    expect(
      executeCognitionTool(runtime.state, a, 'memory.read', { id: doc.id }).data,
    ).toMatchObject({
      canonicalDocument: { value: { blockedSubtasks: [{ reason: 'old obstacle' }] } },
    });
    expect(() => executeCognitionTool(runtime!.state, b, 'memory.read', { id: doc.id })).toThrow(
      'not-found',
    );
    expect(runtime.state.world).toEqual(manifest.initialWorld);
    expect(runtime.state.cognition).toEqual({});
    expect(runtime.state.reminders).toEqual({});
    const state = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(join(root, 'target'));
    expect(runtime.state).toEqual(state);
    await expect(
      readCanonicalCognitiveDocuments({
        residentIds: [a],
        capturedAt: 0,
        partitions: [
          part,
          { partitionKey: 'other', profiles: part.profiles, intentions: part.intentions },
        ],
      }),
    ).rejects.toThrow('planning-source-missing');
    const bad = {
      ...part,
      planning: {
        plans,
        progress: {
          get: () =>
            Promise.resolve(createBranchPlanProgress({ planId: 'wrong', agentId, createdAt: 0 })),
        },
      },
    };
    await expect(
      readCanonicalCognitiveDocuments({ residentIds: [a], capturedAt: 0, partitions: [bad] }),
    ).rejects.toThrow('progress-mismatch');
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
