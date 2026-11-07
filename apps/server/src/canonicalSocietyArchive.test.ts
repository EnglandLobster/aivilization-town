import type * as Fs from 'node:fs';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  exportCanonicalSocietyArchive,
  verifyCanonicalSocietyArchive,
} from './canonicalSocietyArchive';
import { runCanonicalSocietyArchiveCli } from './canonicalSocietyArchiveCli';
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof Fs>();
  return { ...original, cpSync: vi.fn(original.cpSync) };
});
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'canonical-archive-'));
  roots.push(root);
  const sourceRoot = join(root, 'old'),
    targetRoot = join(root, 'archive');
  mkdirSync(join(sourceRoot, 'simulations', 's', 'partitions', 'p', 'memory'), { recursive: true });
  mkdirSync(join(sourceRoot, 'empty'));
  const files = {
    'simulations/s/authority.json': '{"pendingTransfers":{"a":"unfinished"}}\n',
    'simulations/s/partitions/p/memory/original.jsonl': '{"text":"原话，不是迁移指令"}\n',
    'future-domain.bin': Buffer.from([0, 255, 10, 23]),
    '.private-config': 'operator credentials fixture',
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(sourceRoot, name), bytes);
  return { root, sourceRoot, targetRoot, sourceWriterConfirmedStopped: true as const, files };
}
test('preserves all source bytes including unknown fields, private files, empty directories, and pending responsibilities', () => {
  const t = fixture();
  const result = exportCanonicalSocietyArchive(t);
  expect(result.stopEvidence).toBe('operator-declaration-only');
  expect(result.purpose).toBe('source-preservation-not-runnable-migration');
  for (const [path, bytes] of Object.entries(t.files)) {
    expect(readFileSync(join(t.targetRoot, 'source', path))).toEqual(Buffer.from(bytes));
    expect(readFileSync(join(t.sourceRoot, path))).toEqual(Buffer.from(bytes));
  }
  expect(readdirSync(join(t.targetRoot, 'source', 'empty'))).toEqual([]);
  expect(verifyCanonicalSocietyArchive(t.targetRoot)).toEqual(result);
  const manifest = readFileSync(join(t.targetRoot, 'archive.json'));
  expect(exportCanonicalSocietyArchive(t)).toEqual(result);
  expect(readFileSync(join(t.targetRoot, 'archive.json'))).toEqual(manifest);
  expect(existsSync(`${t.targetRoot}.export-lock`)).toBe(false);
});
test('source change or archive corruption never silently overwrites a previous archive', () => {
  const t = fixture();
  exportCanonicalSocietyArchive(t);
  const manifest = readFileSync(join(t.targetRoot, 'archive.json'));
  writeFileSync(join(t.sourceRoot, 'future-domain.bin'), 'changed source');
  expect(() => exportCanonicalSocietyArchive(t)).toThrow('source-archive-source-changed');
  expect(readFileSync(join(t.targetRoot, 'archive.json'))).toEqual(manifest);
  writeFileSync(join(t.targetRoot, 'source', 'future-domain.bin'), 'corrupted archive');
  expect(() => verifyCanonicalSocietyArchive(t.targetRoot)).toThrow(
    'source-archive-content-mismatch',
  );
});
test('overlapping roots and symlink aliases cannot create an archive inside its own source', () => {
  const t = fixture();
  expect(() =>
    exportCanonicalSocietyArchive({ ...t, targetRoot: join(t.sourceRoot, 'nested') }),
  ).toThrow('roots-overlap');
  symlinkSync(t.sourceRoot, join(t.root, 'alias'));
  expect(() =>
    exportCanonicalSocietyArchive({ ...t, targetRoot: join(t.root, 'alias', 'missing', 'nested') }),
  ).toThrow('roots-overlap');
  expect(existsSync(join(t.sourceRoot, 'missing'))).toBe(false);
  expect(() => exportCanonicalSocietyArchive({ ...t, targetRoot: t.root })).toThrow(
    'roots-overlap',
  );
});
test('source symlinks fail closed, existing targets and active exporter locks are preserved', () => {
  const t = fixture();
  symlinkSync('/etc/hosts', join(t.sourceRoot, 'linked'));
  expect(() => exportCanonicalSocietyArchive(t)).toThrow('symlink-rejected');
  expect(existsSync(t.targetRoot)).toBe(false);
  rmSync(join(t.sourceRoot, 'linked'));
  mkdirSync(`${t.targetRoot}.export-lock`);
  writeFileSync(join(`${t.targetRoot}.export-lock`, 'owner'), 'other exporter');
  expect(() => exportCanonicalSocietyArchive(t)).toThrow();
  expect(readFileSync(join(`${t.targetRoot}.export-lock`, 'owner'), 'utf8')).toBe('other exporter');
  rmSync(`${t.targetRoot}.export-lock`, { recursive: true });
  mkdirSync(t.targetRoot);
  writeFileSync(join(t.targetRoot, 'existing'), 'keep');
  expect(() => exportCanonicalSocietyArchive(t)).toThrow();
  expect(readFileSync(join(t.targetRoot, 'existing'), 'utf8')).toBe('keep');
});
test('metadata symlinks and unexpected archive entries are not accepted as verified exports', () => {
  const t = fixture();
  exportCanonicalSocietyArchive(t);
  writeFileSync(join(t.targetRoot, 'extra'), 'unexpected');
  expect(() => verifyCanonicalSocietyArchive(t.targetRoot)).toThrow('unexpected-entry');
  rmSync(join(t.targetRoot, 'extra'));
  const contents = readFileSync(join(t.targetRoot, 'archive.json'));
  rmSync(join(t.targetRoot, 'archive.json'));
  writeFileSync(join(t.root, 'metadata.json'), contents);
  symlinkSync(join(t.root, 'metadata.json'), join(t.targetRoot, 'archive.json'));
  expect(() => verifyCanonicalSocietyArchive(t.targetRoot)).toThrow(
    'invalid-source-archive-metadata',
  );
});
test('operator CLI requires explicit offline declaration, rejects duplicate/unknown flags, and does not print file contents', () => {
  const t = fixture();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const args of [
    [],
    ['--source', t.sourceRoot, '--target', t.targetRoot],
    ['--confirm-source-stopped', '--confirm-source-stopped'],
    ['--unknown'],
    ['--source', '--target'],
  ]) {
    expect(() => runCanonicalSocietyArchiveCli(args)).toThrow();
  }
  expect(existsSync(t.targetRoot)).toBe(false);
  runCanonicalSocietyArchiveCli([
    '--source',
    t.sourceRoot,
    '--target',
    t.targetRoot,
    '--confirm-source-stopped',
  ]);
  expect(log.mock.calls.flat().join('')).not.toContain('operator credentials fixture');
  expect(verifyCanonicalSocietyArchive(t.targetRoot).purpose).toBe(
    'source-preservation-not-runnable-migration',
  );
});

test('source mutation during copy aborts publication and cleans only the newly created staging directory', async () => {
  const t = fixture();
  const actual = await vi.importActual<typeof Fs>('node:fs');
  vi.mocked(cpSync).mockImplementationOnce((source, destination, options) => {
    actual.cpSync(source, destination, options);
    writeFileSync(join(t.sourceRoot, 'future-domain.bin'), 'concurrent write');
  });
  expect(() => exportCanonicalSocietyArchive(t)).toThrow('source-changed-during-archive');
  expect(existsSync(t.targetRoot)).toBe(false);
  expect(existsSync(`${t.targetRoot}.export-lock`)).toBe(false);
  expect(readdirSync(t.root).sort()).toEqual(['.old.canonical-ownership', 'old']);
  expect(readFileSync(join(t.sourceRoot, 'future-domain.bin'), 'utf8')).toBe('concurrent write');
});
