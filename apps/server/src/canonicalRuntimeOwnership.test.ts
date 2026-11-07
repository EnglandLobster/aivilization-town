import { expect, test, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireCanonicalRuntimeOwnership } from './canonicalRuntimeOwnership';
import { exportCanonicalSocietyArchive } from './canonicalSocietyArchive';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'canonical-ownership-'));
  roots.push(parent);
  const root = join(parent, 'runtime');
  mkdirSync(join(root, 'simulations'), { recursive: true });
  return { parent, root };
}
test('multiple canonical owners block archive until every owner actually releases', () => {
  const { root } = fixture();
  const a = acquireCanonicalRuntimeOwnership(root, 'writer'),
    b = acquireCanonicalRuntimeOwnership(root, 'writer');
  expect(() => acquireCanonicalRuntimeOwnership(root, 'archive')).toThrow(
    'writers-active-or-unrecovered',
  );
  a.release();
  a.release();
  expect(() => acquireCanonicalRuntimeOwnership(root, 'archive')).toThrow(
    'writers-active-or-unrecovered',
  );
  b.release();
  const archive = acquireCanonicalRuntimeOwnership(root, 'archive');
  expect(() => acquireCanonicalRuntimeOwnership(root, 'writer')).toThrow('archive-owns-source');
  expect(() => acquireCanonicalRuntimeOwnership(root, 'archive')).toThrow('archive-owns-source');
  archive.release();
  const next = acquireCanonicalRuntimeOwnership(root, 'writer');
  next.release();
});
test('symlink spelling shares ownership and old records never get replaced by PID guesses', () => {
  const { parent, root } = fixture();
  const alias = join(parent, 'alias');
  symlinkSync(root, alias);
  const owner = acquireCanonicalRuntimeOwnership(root, 'writer');
  expect(() => acquireCanonicalRuntimeOwnership(alias, 'archive')).toThrow(
    'writers-active-or-unrecovered',
  );
  writeFileSync(owner.recordPath, 'stale or externally changed');
  expect(() => owner.release()).toThrow('record-changed');
  expect(readFileSync(owner.recordPath, 'utf8')).toBe('stale or externally changed');
  expect(() => acquireCanonicalRuntimeOwnership(root, 'archive')).toThrow(
    'writers-active-or-unrecovered',
  );
});
test('archive refusal creates no destination, admitted archive leaves source bytes untouched', () => {
  const { parent, root } = fixture();
  writeFileSync(join(root, 'original'), 'unchanged');
  const request = {
    sourceRoot: root,
    targetRoot: join(parent, 'archive'),
    sourceWriterConfirmedStopped: true as const,
  };
  const owner = acquireCanonicalRuntimeOwnership(root, 'writer');
  expect(() => exportCanonicalSocietyArchive(request)).toThrow('writers-active-or-unrecovered');
  expect(existsSync(request.targetRoot)).toBe(false);
  owner.release();
  exportCanonicalSocietyArchive(request);
  expect(readFileSync(join(root, 'original'), 'utf8')).toBe('unchanged');
  const next = acquireCanonicalRuntimeOwnership(root, 'writer');
  next.release();
});

test('retirement survives lease release, binds one target and preserves original source bytes', () => {
  const { root, parent } = fixture();
  writeFileSync(join(root, 'original'), 'untouched');
  const input = {
    sourceTreeSha256: 'a'.repeat(64),
    targetManifestSha256: 'b'.repeat(64),
    simulationId: 'town',
    targetRoot: join(parent, 'target'),
  };
  const writer = acquireCanonicalRuntimeOwnership(root, 'writer');
  expect(() => writer.retire(input)).toThrow('exclusive-owner-required');
  writer.release();
  const owner = acquireCanonicalRuntimeOwnership(root, 'archive');
  expect(() => owner.retire({ ...input, targetRoot: join(root, 'target') })).toThrow(
    'roots-overlap',
  );
  expect(() => owner.retire({ ...input, sourceTreeSha256: 'invalid' })).toThrow('binding-invalid');
  const binding = owner.retire(input);
  expect(owner.retire(input)).toEqual(binding);
  owner.release();
  expect(() => owner.retire(input)).toThrow('exclusive-owner-required');
  expect(() => acquireCanonicalRuntimeOwnership(root, 'writer')).toThrow('source-retired');
  const retry = acquireCanonicalRuntimeOwnership(root, 'archive');
  expect(retry.retire(input)).toEqual(binding);
  expect(() => retry.retire({ ...input, targetManifestSha256: 'c'.repeat(64) })).toThrow(
    'binding-conflict',
  );
  retry.release();
  expect(readFileSync(join(root, 'original'), 'utf8')).toBe('untouched');
  expect(existsSync(input.targetRoot)).toBe(false);
});
test('damaged retirement markers fail closed, including source aliases', () => {
  const { root, parent } = fixture();
  const alias = join(parent, 'alias');
  symlinkSync(root, alias);
  const owner = acquireCanonicalRuntimeOwnership(root, 'archive');
  owner.retire({
    sourceTreeSha256: 'a'.repeat(64),
    targetManifestSha256: 'b'.repeat(64),
    simulationId: 'town',
    targetRoot: join(parent, 'target'),
  });
  owner.release();
  writeFileSync(join(parent, '.runtime.canonical-ownership', 'retired.json'), '{');
  expect(() => acquireCanonicalRuntimeOwnership(alias, 'writer')).toThrow('source-retired');
  const recovery = acquireCanonicalRuntimeOwnership(root, 'archive');
  expect(() =>
    recovery.retire({
      sourceTreeSha256: 'a'.repeat(64),
      targetManifestSha256: 'b'.repeat(64),
      simulationId: 'town',
      targetRoot: join(parent, 'target'),
    }),
  ).toThrow();
  recovery.release();
  expect(readFileSync(join(parent, '.runtime.canonical-ownership', 'retired.json'), 'utf8')).toBe(
    '{',
  );
});
