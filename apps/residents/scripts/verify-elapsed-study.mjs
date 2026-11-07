// Directed compiled HTTP/CLI acceptance, not an autonomous education institution experiment.
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
import { residentStudyEscrowBalance } from '@aivilization/world';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'elapsed-study-cli-'));
const m = createOpenSocietyManifest({
  count: 2,
  continuity: true,
  elapsedRest: true,
  elapsedStudy: true,
  initialization: 'newcomers',
});
const initialWorld = {
  ...m.initialWorld,
  agents: Object.fromEntries(
    Object.entries(m.initialWorld.agents).map(([id, a], i) => [
      id,
      {
        ...a,
        locationId: 'school',
        educationScore: i === 0 ? 0 : 25,
        educationLevel: i === 0 ? 0 : 1,
        job: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld,
  worldPolicies: serializableWorldPolicy(m.seed, initialWorld, m.rhythm),
});
const [a, b] = m.residents.map((r) => r.id),
  credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials),
  executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const results = [];
let n = 0,
  closed = false;
async function call(actor, argv, code = 0) {
  runtime.beginTurn(actor);
  const v = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `study-cli-${++n}`],
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
    child.on('close', (status) => resolve({ status, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Directed actual-study CLI acceptance' });
  assert.equal(v.status, code, `${argv.join(' ')}: ${v.out} ${v.err}`);
  const parsed = JSON.parse(v.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    exitCode: v.status,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}
const time = (ms) => {
  const r = runtime.advanceTime(ms, `time-${++n}`);
  assert.equal(r.ok, true, r.error);
};
const session = (actor) =>
  Object.values(runtime.state.world.residentStudy.process.sessions).find(
    (s) => s.actorId === actor,
  );
const close = (actor, s, code = 0) =>
  call(actor, ['education', 'stop', '--id', s.id, '--expected-revision', String(s.revision)], code);
try {
  await call(a, ['city', 'observe', '--view', 'rules', '--section', 'study']);
  const before = runtime.state.world.agents[a].educationScore,
    supply = runtime.state.world.moneySupply;
  await call(a, ['education', 'study', '--duration-seconds', '3600']);
  assert.equal(runtime.state.world.agents[a].educationScore, before);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.ok(residentStudyEscrowBalance(runtime.state.world.residentStudy) > 0);
  const started = session(a);
  await call(a, ['city', 'observe', '--view', 'action']);
  await call(b, ['city', 'observe', '--view', 'study', '--section', started.id], 1);
  await close(b, started, 1);
  await call(a, ['education', 'study', '--duration-seconds', '60'], 1);
  time(900000);
  const partial = session(a);
  assert.equal(partial.elapsedMs, 900000);
  assert.equal(partial.applied.educationNanoPoints, 15e9);
  await call(a, ['city', 'observe', '--view', 'study', '--section', partial.id]);
  await close(a, started, 1);
  await close(a, partial);
  assert.equal(session(a).status, 'interrupted');
  assert.equal(residentStudyEscrowBalance(runtime.state.world.residentStudy), 0);
  await call(a, ['city', 'observe', '--view', 'study', '--limit', '1']);
  const treasuryBefore = runtime.state.world.treasury;
  await call(b, ['education', 'study', '--duration-seconds', '3600']);
  assert.ok(session(b).terms.allocation.treasuryMicros > 0);
  time(600000);
  const bPart = session(b);
  await close(b, bPart);
  // Canonical upkeep and other retained initial policies may also run; compare study's exact recorded refund.
  assert.ok(runtime.state.world.treasury < treasuryBefore);
  assert.equal(
    session(b).applied.treasuryMicros,
    Math.floor(session(b).terms.allocation.treasuryMicros / 6),
  );
  assert.equal(residentStudyEscrowBalance(runtime.state.world.residentStudy), 0);
  await call(b, ['city', 'observe', '--view', 'study', '--section', bPart.id]);
  const expected = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, expected);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => r.ok === false).length,
        results,
        noPrepaidKnowledge: true,
        actualPartialLearning: true,
        unusedTuitionRefundsOriginalPayers: true,
        ownHistoryOnly: true,
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
