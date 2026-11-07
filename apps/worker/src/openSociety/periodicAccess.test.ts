import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';

test('independent activation preserves world facts and private queries across reopen without a public grant', () => {
  const root = mkdtempSync(join(tmpdir(), 'periodic-access-'));
  const manifest = createOpenSocietyManifest({
    count: 2,
    societyKernel: true,
    publicGovernance: false,
  });
  let runtime = new OpenSocietyRuntime(root, manifest);
  try {
    const actor = manifest.residents[0]!.id;
    const originalManifest = readFileSync(join(root, 'manifest.json'));
    runtime.beginTurn(actor);
    const activeBytes = readFileSync(join(root, 'journal.jsonl'));
    expect(runtime.enablePeriodicAccess().error).toBe('resident-turn-active');
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(activeBytes);
    runtime.finishTurn(actor, { summary: 'Engineering activation guard' });
    const before = structuredClone(runtime.state.world);
    const activation = runtime.enablePeriodicAccess();
    expect(activation.ok).toBe(true);
    const { periodicAccess, periodicObligations, ...rest } = runtime.state.world;
    expect(rest).toEqual(before);
    expect(periodicAccess?.version).toBe('independent-periodic-access-v1');
    expect(periodicObligations?.contracts).toEqual({});
    const bytes = readFileSync(join(root, 'journal.jsonl'));
    expect(runtime.enablePeriodicAccess()).toEqual(activation);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    runtime.beginTurn(actor);
    expect(
      runtime.invoke(actor, { name: 'obligations.list', arguments: {}, requestId: 'read-private' })
        .ok,
    ).toBe(true);
    runtime.finishTurn(actor, { summary: 'Engineering query verification' });
    const state = structuredClone(runtime.state);
    const finalBytes = readFileSync(join(root, 'journal.jsonl'));
    runtime.close();
    runtime = new OpenSocietyRuntime(root);
    expect(runtime.state).toEqual(state);
    expect(runtime.state.world.publicGovernance).toBeUndefined();
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(finalBytes);
    expect(readFileSync(join(root, 'manifest.json'))).toEqual(originalManifest);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
