import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { FileLongTermProfileRepository, FileAgentIntentionRepository } from '@aivilization/memory';
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

test('retained revisions include superseded profile, original intention operation and orphan progress without re-execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-history-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    const manifest = createOpenSocietyManifest({ count: 2 });
    const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
    const id = asAgentId(a);
    const profiles = new FileLongTermProfileRepository({ rootDir: root });
    const intentions = new FileAgentIntentionRepository({ rootDir: root });
    const plans = new FileBranchPlanRepository({ rootDir: root });
    const progress = new FileBranchPlanProgressRepository({ rootDir: root });
    const first = await profiles.getOrCreate(id);
    await profiles.save({
      ...first,
      beliefs: [
        {
          key: 'changed',
          statement: 'New opinion',
          confidence: 0.7,
          updatedAt: 1,
          provenanceRecordIds: [],
        },
      ],
    });
    const initial = await intentions.getOrCreate(id);
    await intentions.setObjective(id, {
      id: 'objective',
      agentId: id,
      statement: 'Past instruction',
      source: 'human',
      priority: 1,
      affinityTags: ['study'],
      createdAt: 1,
      updatedAt: 1,
    });
    appendFileSync(join(root, 'agent-intentions.jsonl'), JSON.stringify(initial) + '\n');
    const plan = {
      planId: 'p',
      agentId: id,
      plan: createBranchPlan({
        objective: 'Past',
        branches: [
          {
            id: 'b',
            objective: 'Past branch',
            subtasks: [{ id: 's', description: 'Past step', basePriority: 1 }],
          },
        ],
      }),
      createdAt: 0,
      updatedAt: 0,
    };
    await plans.save(plan);
    await plans.save({ ...plan, updatedAt: 2 });
    await progress.save(createBranchPlanProgress({ planId: 'orphan', agentId: id, createdAt: 2 }));
    const files = [
      'long-term-profiles.jsonl',
      'agent-intentions.jsonl',
      'branch-plans.jsonl',
      'branch-plan-progress.jsonl',
    ].map((f) => join(root, f));
    const before = files.map((f) => readFileSync(f));
    const source = await readCanonicalCognitiveDocuments({
      residentIds: [a, b],
      capturedAt: 0,
      partitions: [
        {
          partitionKey: 'old',
          profiles,
          intentions,
          planning: { plans, progress },
          history: {
            profile: profiles,
            intentions,
            'branch-plan': plans,
            'branch-progress': progress,
          },
        },
      ],
    });
    expect(source.version).toBe('canonical-cognitive-documents-v3');
    const revisions = source.documentsByResident[a]!.filter((d) => d.kind === 'retained-revision');
    expect(revisions).toHaveLength(8);
    expect(
      revisions.filter((d) => d.value.ledger === 'intentions').map((d) => d.value.record),
    ).toEqual(
      before[1]!
        .toString()
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s) as unknown),
    );
    expect(revisions.find((d) => d.value.ledger === 'branch-progress')!.value.record).toMatchObject(
      { planId: 'orphan' },
    );
    expect(source.documentsByResident[b]).toEqual([]);
    expect(files.map((f) => readFileSync(f))).toEqual(before);
    runtime = new OpenSocietyRuntime(join(root, 'target'), {
      ...manifest,
      canonicalCognitiveDocuments: source,
    });
    expect(runtime.state.world).toEqual(manifest.initialWorld);
    expect(runtime.state.cognition).toEqual({});
    expect(runtime.state.reminders).toEqual({});
    const experience = runtime.state.experiences[a]!.find(
      (e) => e.canonicalDocument?.kind === 'retained-revision',
    )!;
    expect(
      executeCognitionTool(runtime.state, a, 'memory.read', { id: experience.id }).data,
    ).toEqual(experience);
    expect(() =>
      executeCognitionTool(runtime!.state, b, 'memory.read', { id: experience.id }),
    ).toThrow('not-found');
    const state = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(join(root, 'target'));
    expect(runtime.state).toEqual(state);
    for (const [index, repository] of [profiles, intentions, plans, progress].entries()) {
      appendFileSync(files[index]!, '{');
      expect(() => repository.readHistory(id)).toThrow('incomplete-tail');
    }
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
