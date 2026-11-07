import { setTimeout, clearTimeout } from 'node:timers';
// Cross-process formal CLI admission: actual daemon blocks archive, graceful exit releases it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '.local/canonical-ownership-verification');
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
  report = {
    passed: true,
    root,
    actualDaemonStarted: true,
    archiveRefusedWhileWriterActive: true,
    refusalCreatedNoTarget: true,
    daemonExit: exit,
    archiveAcceptedAfterGracefulExit: true,
    repeatedArchiveUnchanged: true,
    archiveCliCalls: 3,
    sourceTreeSha256: JSON.parse(first.toString()).sourceTreeSha256,
    limitations: [
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
