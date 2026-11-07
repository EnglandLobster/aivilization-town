// Compiled operator CLI acceptance. This is engineering verification, not emergence evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/open-residents/integrated-profile-acceptance');
assert.equal(existsSync(root), false, 'use-fresh-directory');
const cli = resolve('apps/residents/dist/cli.js');
function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 });
}
for (const args of [
  ['init', '--profile', 'unknown'],
  ['init', '--profile', 'society-integrated-v1', '--legacy'],
  ['report', '--profile', 'society-integrated-v1'],
]) {
  const result = run([...args, '--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid-or-conflicting-initialization-profile/);
  assert.equal(existsSync(root), false);
}
const args = ['init', '--root', root, '--count', '2', '--profile', 'society-integrated-v1'];
const initialized = run(args);
assert.equal(initialized.status, 0, initialized.stderr);
assert.equal(JSON.parse(initialized.stdout).profile, 'society-integrated-v1');
const manifest = readFileSync(join(root, 'manifest.json'));
assert.equal(run(args).status, 0, 'same profile initialization must remain idempotent');
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
const runtime = new OpenSocietyRuntime(root);
const actor = runtime.manifest.residents[0].id;
for (const [name, parameters] of [
  ['world.observe', { view: 'labor' }],
  ['business.services', {}],
]) {
  runtime.beginTurn(actor);
  const result = runtime.invoke(actor, {
    name,
    arguments: parameters,
    requestId: `profile-${name.replaceAll('.', '-')}`,
  });
  assert.equal(result.ok, true, result.error);
  runtime.finishTurn(actor, { summary: 'Compiled profile verification, not autonomous activity' });
}
const state = structuredClone(runtime.state);
const journal = readFileSync(join(root, 'journal.jsonl'));
runtime.close();
const replay = new OpenSocietyRuntime(root);
assert.deepEqual(replay.state, state);
replay.close();
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
mkdirSync(join(root, 'verification'), { recursive: true });
const report = {
  passed: true,
  profile: 'society-integrated-v1',
  invalidOptionsBeforeWrites: true,
  idempotentInitialization: true,
  formerlyDisabledQueriesAvailable: true,
  fullReplayEqual: true,
  evidenceClass: 'scripted-engineering-not-emergence',
};
writeFileSync(join(root, 'verification', 'profile.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
