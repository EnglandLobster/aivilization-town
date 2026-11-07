// Directed formal qualification verification, not autonomous institution creation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  OpenSocietyRuntime,
  createOpenSocietyManifest,
  serializableWorldPolicy,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'education-authority-cli-'));
const manifest = createOpenSocietyManifest({
  count: 4,
  continuity: true,
  elapsedRest: true,
  elapsedStudy: true,
  educationAuthority: true,
  initialization: 'newcomers',
});
const [owner, other, worker] = manifest.residents.map((r) => r.id);
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      { ...a, locationId: 'school', job: null },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
const credentials = loadResidentCredentials(root, [owner, worker, other]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let n = 0,
  closed = false;
const results = [];
async function call(actor, argv, expected = 0) {
  runtime.beginTurn(actor);
  const r = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `education-cli-${++n}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Directed formal qualification CLI verification' });
  assert.equal(r.code, expected, `${argv.join(' ')}: ${r.out} ${r.err}`);
  const value = JSON.parse(r.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    ok: value.ok,
    exitCode: r.code,
    ...(value.error ? { error: value.error } : {}),
  });
  return value;
}
try {
  const index = await call(worker, ['city', 'observe', '--view', 'rules', '--section', 'index']);
  assert.ok(
    index.data.sections.some(
      (s) => s.name === 'occupations' && s.readWith.includes('--section occupations'),
    ),
  );
  await call(worker, ['city', 'observe', '--view', 'rules', '--section', 'occupations']);
  const policy = await call(worker, [
    'city',
    'observe',
    '--view',
    'rules',
    '--section',
    'education',
  ]);
  assert.equal(policy.data.authority, 'resident-education-authority-v1');
  const before = await call(worker, ['city', 'observe', '--view', 'qualifications']);
  assert.equal(before.data.educationLevel, 2);
  assert.equal(before.data.educationScore, 160);
  assert.equal(before.data.origin.source, 'scenario-initial-qualification');
  await call(worker, ['education', 'apply-exam', '--target-level', '3'], 1);
  await call(worker, ['education', 'study', '--duration-seconds', '1300']);
  assert.equal(runtime.advanceTime(1300000, 'real-study').ok, true);
  const earned = await call(worker, ['city', 'observe', '--view', 'qualifications']);
  assert.ok(earned.data.educationScore > 180);
  assert.equal(earned.data.educationLevel, 2);
  assert.equal(runtime.state.world.educationExamApplications.length, 0);
  await call(worker, ['education', 'apply-exam', '--target-level', '3']);
  await call(worker, ['education', 'apply-exam', '--target-level', '3'], 1);
  const end = runtime.state.world.educationAuthority.institution.examCycleDurationMs;
  assert.equal(
    runtime.advanceTime(end - runtime.state.world.clock.now, 'actual-admission').ok,
    true,
  );
  const admitted = await call(worker, ['city', 'observe', '--view', 'qualifications']);
  assert.equal(admitted.data.educationLevel, 3);
  assert.equal(admitted.data.origin.level, 2);
  assert.equal(runtime.state.world.educationExamApplications[0].status, 'admitted');
  const ownOther = await call(other, ['city', 'observe', '--view', 'qualifications']);
  assert.equal(ownOther.data.origin.level, manifest.initialWorld.agents[other].educationLevel);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    reopened.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        actualLearningSeparateFromFormalQualification: true,
        admissionRequired: true,
        originRetained: true,
        ruleDiscovery: true,
        replayEqual: true,
        journalBytesUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (!closed) {
    await server.close();
    runtime.close();
  }
  rmSync(root, { recursive: true, force: true });
}
