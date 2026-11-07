import {
  FileBranchPlanRepository,
  FileBranchPlanProgressRepository,
} from '@aivilization/agent-runtime';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  FileShortTermMemoryRepository,
  FileLongTermProfileRepository,
  FileAgentIntentionRepository,
} from '@aivilization/memory';
import { readCanonicalResidentMemory, readCanonicalCognitiveDocuments } from '@aivilization/worker';
const archive = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const output = resolve(process.argv[3] ?? '.local/canonical-planning-continuity-20261007.json');
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
    const planningPath = `simulations/${encodeURIComponent(authority.simulationId)}/partitions/${encodeURIComponent(partitionKey)}/planning`;
    for (const name of ['branch-plans.jsonl', 'branch-plan-progress.jsonl'])
      assert.ok(files.some((f) => f.path === `${planningPath}/${name}`));
    const planningRoot = join(temp, `${encodeURIComponent(partitionKey)}-planning`);
    cpSync(join(archive, 'source', planningPath), planningRoot, { recursive: true });
    return {
      partitionKey,
      planning: {
        plans: new FileBranchPlanRepository({ rootDir: planningRoot }),
        progress: new FileBranchPlanProgressRepository({ rootDir: planningRoot }),
      },
      repository: new FileShortTermMemoryRepository({ rootDir }),
      profiles: new FileLongTermProfileRepository({ rootDir }),
      intentions: new FileAgentIntentionRepository({ rootDir }),
    };
  });
  const residentIds = Object.keys(authority.projection.agents);
  const result = await readCanonicalResidentMemory({ residentIds, partitions });
  const documents = await readCanonicalCognitiveDocuments({
    residentIds,
    capturedAt: authority.projection.clock.now,
    partitions,
  });
  const allDocuments = Object.values(documents.documentsByResident).flat();
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
    branchPlans: allDocuments.filter((d) => d.kind === 'branch-plan').length,
    branchProgress: allDocuments.filter((d) => d.kind === 'branch-progress').length,
    profileSnapshots: allDocuments.filter((d) => d.kind === 'profile').length,
    intentionSnapshots: allDocuments.filter((d) => d.kind === 'intentions').length,
    documentsSha256: digest(JSON.stringify(documents)),
    perResident: counts,
    recordsSha256: digest(JSON.stringify(result)),
    archiveUnchanged: true,
    limitations: [
      'All ledger pages for current residents in all declared captured partitions; not proof of history for departed subjects.',
      'Latest existing profiles and intentions decoded via original repositories; latest plans and their existing progress included; historical revisions and orphan progress remain archived and require separate mapping.',
      'No target activation or new model experiment.',
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
