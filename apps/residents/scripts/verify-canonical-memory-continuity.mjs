import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FileShortTermMemoryRepository } from '@aivilization/memory';
import { readCanonicalResidentMemory } from '@aivilization/worker';
const archive = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const output = resolve(process.argv[3] ?? '.local/canonical-memory-continuity-20261007.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(readFileSync(join(archive, 'archive.json'), 'utf8'));
const files = metadata.entries.filter((e) => e.kind === 'file');
function verifyFiles() {
  for (const entry of files) {
    assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
    assert.equal(digest(readFileSync(join(archive, 'source', entry.path))), entry.sha256);
  }
}
verifyFiles();
const authorityFiles = files.filter(
  (e) => e.path.startsWith('simulation-wide-authority/') && e.path.endsWith('/state.json'),
);
assert.equal(authorityFiles.length, 1, 'controlled-single-world-fixture');
const authority = JSON.parse(readFileSync(join(archive, 'source', authorityFiles[0].path), 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'canonical-memory-source-'));
try {
  const partitions = authority.partitionKeys.map((partitionKey) => {
    const path = `simulations/${encodeURIComponent(authority.simulationId)}/partitions/${encodeURIComponent(partitionKey)}/memory`;
    assert.ok(
      files.some(
        (f) =>
          f.path === `${path}/short-term-memory.deflate` ||
          f.path === `${path}/short-term-memory.jsonl`,
      ),
    );
    const rootDir = join(temp, encodeURIComponent(partitionKey));
    cpSync(join(archive, 'source', path), rootDir, { recursive: true });
    return { partitionKey, repository: new FileShortTermMemoryRepository({ rootDir }) };
  });
  const residentIds = Object.keys(authority.projection.agents);
  const result = await readCanonicalResidentMemory({ residentIds, partitions });
  const counts = Object.fromEntries(
    Object.entries(result.recordsByResident).map(([id, entries]) => [id, entries.length]),
  );
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  assert.ok(total > 0);
  verifyFiles();
  const report = {
    passed: true,
    archive,
    residents: residentIds.length,
    partitions: partitions.length,
    ledgerRecords: total,
    perResident: counts,
    recordsSha256: digest(JSON.stringify(result)),
    archiveUnchanged: true,
    limitations: [
      'All ledger pages for current residents in all declared captured partitions; not proof of history for departed subjects.',
      'Long-term profiles, planner intent and branch histories remain separately archived and are not imported by this slice.',
      'No target activation or new model experiment.',
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
