import { setTimeout, clearTimeout } from 'node:timers';
// Cross-process formal CLI admission: actual daemon blocks archive, graceful exit releases it.
import assert from 'node:assert/strict';
import { OpenSocietyRuntime } from '@aivilization/worker';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-verification');
assert.equal(existsSync(root), false, 'fresh-directory-required');
mkdirSync(root, { recursive: true, mode: 0o700 });
const source = join(root, 'source'),
  archive = join(root, 'archive');
const cli = resolve('apps/server/dist/localRuntimeTownCliMain.js');
const child = spawn(
  process.execPath,
  [cli, '--llm-mode', 'deterministic', '--root-dir', source, '--port', '0'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let out = '',
  err = '',
  resolveStarted;
const started = new Promise((resolve) => {
  resolveStarted = resolve;
});
child.stdout.on('data', (b) => {
  out += b.toString();
  if (out.includes('aivilization-runtime-started')) resolveStarted();
});
child.stderr.on('data', (b) => {
  err += b.toString();
});
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
let timer;
const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(Error('ownership-verification-deadline')), 60000);
});
const call = (target, confirm = true) =>
  spawnSync(
    process.execPath,
    [
      cli,
      'export-society-source',
      '--source',
      source,
      '--target',
      target,
      ...(confirm ? ['--confirm-source-stopped'] : []),
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
let report;
try {
  await Promise.race([
    started,
    exited.then((r) => {
      throw Error(`daemon-exited-before-ready:${JSON.stringify(r)}:${err.slice(-2000)}`);
    }),
    deadline,
  ]);
  const refused = call(archive);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /canonical-writers-active-or-unrecovered/);
  assert.equal(existsSync(archive), false);
  assert.equal(child.kill('SIGTERM'), true);
  const exit = await Promise.race([exited, deadline]);
  assert.deepEqual(exit, { code: 0, signal: null }, err);
  const success = call(archive);
  assert.equal(success.status, 0, success.stderr);
  const first = readFileSync(join(archive, 'archive.json'));
  const again = call(archive);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(readFileSync(join(archive, 'archive.json')), first);
  const meta = JSON.parse(first.toString());
  const manifestPaths = meta.entries.filter(
    (e) => e.kind === 'file' && e.path.startsWith('operations/resolved-run-manifests/'),
  );
  const authorityPaths = meta.entries.filter(
    (e) =>
      e.kind === 'file' &&
      e.path.startsWith('simulation-wide-authority/') &&
      e.path.endsWith('/state.json'),
  );
  assert.equal(manifestPaths.length, 1);
  assert.equal(authorityPaths.length, 1);
  const manifest = JSON.parse(readFileSync(join(archive, 'source', manifestPaths[0].path), 'utf8'));
  const authority = JSON.parse(
    readFileSync(join(archive, 'source', authorityPaths[0].path), 'utf8'),
  );
  const consumerIds = Object.fromEntries(
    authority.partitionKeys.map((key) => {
      const cursors = Object.values(authority.materializerCursors).filter(
        (c) => c.partitionKey === key,
      );
      assert.equal(cursors.length, 1);
      return [key, cursors[0].consumerId];
    }),
  );
  const optionsPath = join(root, 'source-options.json');
  writeFileSync(optionsPath, JSON.stringify({ policyConfiguration: {}, consumerIds }));
  const target = join(root, 'society');
  const migrate = () =>
    spawnSync(
      process.execPath,
      [
        cli,
        'migrate-society',
        '--archive',
        archive,
        '--target',
        target,
        '--simulation',
        authority.simulationId,
        '--run-manifest',
        manifest.runManifestId,
        '--source-options',
        optionsPath,
        '--confirm-source-stopped',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
  const publication = migrate();
  assert.equal(publication.status, 0, publication.stderr);
  assert.equal(JSON.parse(publication.stdout).status, 'published');
  const runtime = new OpenSocietyRuntime(target);
  let completedTrips, after;
  try {
    const trips = Object.values(runtime.state.world.transitByAgent ?? {});
    completedTrips = trips.length;
    const until = Math.max(runtime.state.world.clock.now + 1, ...trips.map((t) => t.arrivesAt));
    assert.equal(
      runtime.advanceTime(until - runtime.state.world.clock.now, 'published-validation').ok,
      true,
    );
    for (const trip of trips)
      assert.equal(runtime.state.world.agents[trip.agentId].locationId, trip.toLocationId);
    after = structuredClone(runtime.state);
  } finally {
    runtime.close();
  }
  const journal = readFileSync(join(target, 'journal.jsonl'));
  const repeated = migrate();
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).status, 'already-published');
  assert.deepEqual(readFileSync(join(target, 'journal.jsonl')), journal);
  const reopened = new OpenSocietyRuntime(target);
  try {
    assert.deepEqual(reopened.state, after);
  } finally {
    reopened.close();
  }
  const restart = spawnSync(
    process.execPath,
    [cli, '--llm-mode', 'deterministic', '--root-dir', source, '--port', '0'],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.notEqual(restart.status, 0);
  assert.match(restart.stderr, /canonical-source-retired/);
  const preserved = call(archive);
  assert.equal(preserved.status, 0, preserved.stderr);
  assert.deepEqual(readFileSync(join(archive, 'archive.json')), first);
  report = {
    passed: true,
    retiredFormalRestartRefused: true,
    archiveAfterRetirementUnchanged: true,
    publishedViaFormalCli: true,
    completedOriginalTrips: completedTrips,
    targetReplayMatched: true,
    repeatedPublicationPreservedNewFacts: true,

    root,
    actualDaemonStarted: true,
    archiveRefusedWhileWriterActive: true,
    refusalCreatedNoTarget: true,
    daemonExit: exit,
    archiveAcceptedAfterGracefulExit: true,
    repeatedArchiveUnchanged: true,
    archiveCliCalls: 4,
    sourceTreeSha256: JSON.parse(first.toString()).sourceTreeSha256,
    limitations: [
      'Controlled new source and target; original operating worlds untouched. Base source continuation published, new social policies not implicitly enabled.',
      'Orderly error recovery tested separately; no SIGKILL lock recovery or multi-host claim.',
      'Deterministic engineering daemon, not OpenCode or free social emergence.',
      'Cooperative same-filesystem admission; no legacy-writer, multi-host or forced-crash recovery claim.',
    ],
  };
} catch (error) {
  report = { passed: false, root, error: error.message, stderr: err.slice(-2000) };
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await exited;
  }
  writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
