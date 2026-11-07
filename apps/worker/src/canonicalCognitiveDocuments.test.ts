import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { FileAgentIntentionRepository, FileLongTermProfileRepository } from '@aivilization/memory';
import { readCanonicalCognitiveDocuments } from './canonicalCognitiveDocuments';
import { createOpenSocietyManifest, openWorldPolicies } from './openSociety/manifest';
import { OpenSocietyRuntime } from './openSociety/runtime';
import { executeCognitionTool } from './openSociety/cognitionTools';
import { buildOpenResidentContext } from './openSociety/context';

test('existing profile and intention are readable privately without creating missing states or executing old goals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-cognition-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    const manifest = createOpenSocietyManifest({ count: 2 });
    const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
    const profiles = new FileLongTermProfileRepository({ rootDir: join(root, 'source') });
    const intentions = new FileAgentIntentionRepository({ rootDir: join(root, 'source') });
    const files = ['long-term-profiles.jsonl', 'agent-intentions.jsonl'].map((f) =>
      join(root, 'source', f),
    );
    const empty = files.map((p) => readFileSync(p));
    expect(await profiles.find(asAgentId(a))).toBeUndefined();
    expect(await intentions.find(asAgentId(a))).toBeUndefined();
    expect(files.map((p) => readFileSync(p))).toEqual(empty);
    const profile = {
      ...(await profiles.getOrCreate(asAgentId(a))),
      beliefs: [
        {
          key: 'old-belief',
          statement: 'Historical opinion, not a verified fact',
          confidence: 0.4,
          updatedAt: 90,
          provenanceRecordIds: [],
        },
      ],
    };
    await profiles.save(profile);
    const old = await intentions.getOrCreate(asAgentId(a));
    const intended = {
      ...old,
      activeObjective: {
        id: 'old-plan',
        agentId: asAgentId(a),
        statement: 'Unexecuted historical purchase',
        priority: 1,
        source: 'human' as const,
        affinityTags: ['trade'],
        createdAt: 100,
        updatedAt: 100,
      },
    };
    await intentions.save(intended);
    const before = files.map((p) => readFileSync(p));
    const source = await readCanonicalCognitiveDocuments({
      residentIds: [a, b],
      capturedAt: manifest.initialWorld.clock.now,
      partitions: [{ partitionKey: 'old', profiles, intentions }],
    });
    expect(source.documentsByResident[a]).toEqual([
      { partitionKey: 'old', kind: 'profile', value: profile },
      { partitionKey: 'old', kind: 'intentions', value: intended },
    ]);
    expect(source.documentsByResident[b]).toEqual([]);
    expect(files.map((p) => readFileSync(p))).toEqual(before);
    expect(await intentions.find(asAgentId(a))).toEqual(intended);
    runtime = new OpenSocietyRuntime(join(root, 'target'), {
      ...manifest,
      canonicalCognitiveDocuments: source,
    });
    expect(runtime.state.world).toEqual(manifest.initialWorld);
    expect(runtime.state.cognition).toEqual({});
    expect(runtime.state.reminders).toEqual({});
    const docs = runtime.state.experiences[a]!;
    expect(docs).toHaveLength(2);
    expect(
      executeCognitionTool(runtime.state, a, 'memory.read', { id: docs[1]!.id }).data,
    ).toMatchObject({ canonicalDocument: { kind: 'intentions', value: intended } });
    expect(() =>
      executeCognitionTool(runtime!.state, b, 'memory.read', { id: docs[1]!.id }),
    ).toThrow('not-found');
    expect(
      JSON.stringify(executeCognitionTool(runtime.state, a, 'memory.search', {}).data),
    ).not.toContain('Unexecuted historical purchase');
    const context = buildOpenResidentContext(
      runtime.state,
      runtime.manifest,
      a,
      openWorldPolicies(manifest.seed, runtime.state.world),
    );
    expect(context.memories.items).toEqual([]);
    expect(context.memories.historicalRecords).toBe(2);
    const state = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(join(root, 'target'));
    expect(runtime.state).toEqual(state);
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('cross-resident source and duplicate partition metadata reject instead of adopting another profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-cognition-reject-'));
  try {
    const profiles = new FileLongTermProfileRepository({ rootDir: root });
    const intentions = new FileAgentIntentionRepository({ rootDir: root });
    const wrong = await profiles.getOrCreate(asAgentId('other'));
    const part = {
      partitionKey: 'p',
      profiles: { find: () => Promise.resolve(wrong) },
      intentions,
    };
    await expect(
      readCanonicalCognitiveDocuments({ residentIds: ['a'], capturedAt: 0, partitions: [part] }),
    ).rejects.toThrow('owner-mismatch');
    await expect(
      readCanonicalCognitiveDocuments({
        residentIds: ['a'],
        capturedAt: 0,
        partitions: [part, part],
      }),
    ).rejects.toThrow('source-invalid');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
