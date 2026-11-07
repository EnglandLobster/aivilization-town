// Real provider interruption and a new runtime/server/provider process; prompted read-only acceptance.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import {
  createOpenCodeResidentDriver,
  loadResidentCredentials,
  startResidentServer,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/provider-session-recovery');
if (existsSync(join(root, 'manifest.json'))) throw Error('use-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
let runtime = new OpenSocietyRuntime(
  root,
  createOpenSocietyManifest({ count: 1, continuity: true }),
);
const actorId = runtime.manifest.residents[0].id;
const credentials = loadResidentCredentials(root, [actorId]);
let server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
const directory = join(root, 'opencode', actorId);
const initialWorld = structuredClone(runtime.state.world);
const results = [];
let failure;
try {
  const abort = new globalThis.AbortController();
  const originalInvoke = runtime.invoke.bind(runtime);
  let injected = false;
  runtime.invoke = (actor, request) => {
    const result = originalInvoke(actor, request);
    if (result.ok && !injected) {
      injected = true;
      globalThis.setTimeout(() => abort.abort('test-after-authoritative-receipt'), 100);
    }
    return result;
  };
  const turn = runtime.beginTurn(actorId);
  console.log(JSON.stringify({ stage: 'interrupt-after-real-query', status: 'running' }));
  const first = await createOpenCodeResidentDriver({
    connection: { endpoint: server.url, token: credentials.residents[actorId] },
    model,
    directory,
    task: '这是明确提示的恢复验收。只查询自己的当前状态并简短报告；不转账、不移动、不发布或安排等待。',
  }).run({
    actorId,
    turnId: turn.id,
    context: runtime.context(actorId),
    signal: globalThis.AbortSignal.any([abort.signal, globalThis.AbortSignal.timeout(180000)]),
    invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
  });
  results.push(first);
  runtime.finishTurn(actorId, first);
  assert.equal(injected, true);
  assert.equal(first.status, 'provider-error');
  assert.equal(typeof first.sessionId, 'string');
  const marker = JSON.parse(readFileSync(join(directory, 'cli-session.json')));
  assert.equal(marker.sessionId, first.sessionId);
  const beforeRestart = structuredClone(runtime.state);
  await server.close();
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, beforeRestart);
  server = await startResidentServer(runtime, credentials);
  const next = runtime.beginTurn(actorId);
  console.log(JSON.stringify({ stage: 'resume-original-provider-session', status: 'running' }));
  const second = await createOpenCodeResidentDriver({
    connection: { endpoint: server.url, token: credentials.residents[actorId] },
    model,
    directory,
    sessionId: first.sessionId,
    task: '这是中断后的恢复验收。仍只查询自己的当前状态，简短报告后结束；不转账、不移动、不发布或安排等待。',
  }).run({
    actorId,
    turnId: next.id,
    context: runtime.context(actorId),
    signal: globalThis.AbortSignal.timeout(180000),
    invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
  });
  results.push(second);
  runtime.finishTurn(actorId, second);
  assert.equal(second.status, 'completed');
  assert.equal(second.sessionId, first.sessionId);
  assert.deepEqual(runtime.state.world, initialWorld);
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown-error';
}
const state = structuredClone(runtime.state);
await server.close();
runtime.close();
const bytes = readFileSync(join(root, 'journal.jsonl'));
const reopened = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(reopened.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
} finally {
  reopened.close();
}
const report = {
  passed: !failure,
  mode: 'prompted-real-provider-interruption-not-emergence',
  model,
  results,
  replayEqual: true,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
