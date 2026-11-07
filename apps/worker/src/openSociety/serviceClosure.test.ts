import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
test('private service activation records dependency without public grant; explicit migration is idempotent and replays', () => {
  const root = mkdtempSync(join(tmpdir(), 'service-closure-'));
  let r: OpenSocietyRuntime | undefined;
  try {
    r = new OpenSocietyRuntime(
      root,
      createOpenSocietyManifest({ count: 2, continuity: true, publicGovernance: false }),
    );
    const original = readFileSync(join(root, 'manifest.json'));
    expect(r.state.world.publicGovernance).toBeUndefined();
    const actor = Object.keys(r.state.residents)[0]!;
    r.beginTurn(actor);
    expect(r.enableServiceClosure().error).toBe('resident-turn-active');
    r.finishTurn(actor, { summary: 'Directed migration gate verification' });
    const before = structuredClone(r.state.world);
    expect(r.enableIndependentServicePrincipals().ok).toBe(true);
    expect(r.state.world.serviceClosurePolicy).toEqual({
      version: 'independent-service-closure-v1',
    });
    expect(r.state.world.publicGovernance).toBeUndefined();
    expect(r.state.world.agents).toEqual(before.agents);
    const bytes = readFileSync(join(root, 'journal.jsonl'));
    expect(r.enableServiceClosure().ok).toBe(true);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    const state = structuredClone(r.state);
    r.close();
    r = new OpenSocietyRuntime(root);
    expect(r.state).toEqual(state);
    expect(readFileSync(join(root, 'manifest.json'))).toEqual(original);
  } finally {
    r?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
