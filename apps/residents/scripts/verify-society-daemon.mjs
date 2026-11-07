// Formal executable + real free OpenCode opportunities, with explicit process budgets, no social task.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/open-residents/society-daemon-acceptance');
const resume = process.argv[5] === 'resume';
const timeout = Number(process.argv[4] ?? 180000);
if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000)
  throw Error('invalid-verification-timeout');
if (existsSync(join(root, 'manifest.json')) && !resume)
  throw Error('use-fresh-acceptance-directory');
if (resume && !existsSync(join(root, 'manifest.json'))) throw Error('resume-needs-existing-world');
mkdirSync(root, { recursive: true, mode: 0o700 });
const seeded = new OpenSocietyRuntime(
  root,
  resume ? undefined : createOpenSocietyManifest({ count: 2, continuity: true }),
);
const previousTurns = Object.values(seeded.state.turns);
const previousRevision = seeded.state.revision;
const suffix = resume ? `-resume-${previousRevision}` : '';
seeded.close();
const manifest = readFileSync(join(root, 'manifest.json'));
const prefix = readFileSync(join(root, 'journal.jsonl'));
const cli = fileURLToPath(new URL('../../server/dist/localRuntimeTownCliMain.js', import.meta.url));
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
const runs = [];
let failure;
for (const count of [2, 1]) {
  console.log(JSON.stringify({ stage: runs.length + 1, opportunities: count, status: 'running' }));
  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        'resident-society',
        '--root',
        root,
        '--port',
        '0',
        '--model',
        model,
        '--max-opportunities',
        String(count),
        '--timeout',
        String(timeout),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (v) => {
      out += v;
    });
    child.stderr.on('data', (v) => {
      err += v;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, out, err }));
  });
  runs.push(outcome);
  writeFileSync(
    join(root, `daemon-process${suffix}-${runs.length}.json`),
    JSON.stringify(outcome, null, 2),
    { mode: 0o600 },
  );
  if (outcome.code !== 0) {
    failure = 'daemon-process-failed';
    break;
  }
}
const r = new OpenSocietyRuntime(root);
const state = structuredClone(r.state);
const allTurns = Object.values(state.turns);
const turns = allTurns.slice(previousTurns.length);
const commits = r.journal.commits.slice(previousRevision);
const calls = commits.filter((c) => !c.capability.startsWith('turn.') && c.actorId !== 'system');
let manifestAndPriorPrefixUnchanged = false;
try {
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')).subarray(0, prefix.length), prefix);
  manifestAndPriorPrefixUnchanged = true;
  assert.equal(failure, undefined);
  assert.equal(turns.length, 3);
  assert.ok(
    turns.every(
      (t) =>
        typeof t.sessionId === 'string' && t.status !== 'provider-error' && t.status !== 'running',
    ),
  );
  const actors = new Set(allTurns.map((t) => t.actorId));
  assert.equal(actors.size, 2);
  for (const actor of actors) {
    const own = allTurns.filter((t) => t.actorId === actor);
    assert.ok(own.some((t) => t.status !== 'provider-error' && t.status !== 'running'));
    assert.ok(
      own.every((t) => t.sessionId === own[0].sessionId),
      'provider session changed across process restart',
    );
  }
  assert.ok(calls.length > 0, 'no actual resident tools used');
} catch (error) {
  failure = error instanceof Error ? error.message : 'verification-failed';
}
r.close();
const bytes = readFileSync(join(root, 'journal.jsonl'));
const replay = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(replay.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
} finally {
  replay.close();
}
const report = {
  mode: 'real-daemon-short-free-run-not-stable-emergence',
  passed: !failure,
  model,
  timeout,
  resume,
  previousRevision,
  previousTurns,
  runs: runs.map(({ code, signal }) => ({ code, signal })),
  turns,
  residentCalls: calls.map((c) => ({
    actorId: c.actorId,
    capability: c.capability,
    ok: c.result.ok,
    error: c.result.error,
  })),
  fullStateReplayEqual: true,
  manifestAndPriorPrefixUnchanged,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, `verification${suffix}.json`), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
