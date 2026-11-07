// Directed real transport verification, not evidence of an autonomously founded enterprise.
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

const root = mkdtempSync(join(tmpdir(), 'elapsed-labor-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  elapsedLabor: true,
  initialization: 'newcomers',
});
const initialWorld = {
  ...manifest.initialWorld,
  // Explicit test scenario capital for later recapitalization; not a resident money-creation operation.
  moneySupply: manifest.initialWorld.moneySupply + 900,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      {
        ...a,
        balance: a.balance + (id === manifest.residents[0].id ? 900 : 0),
        locationId: 'workshop',
        job: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
const [owner, worker, other] = manifest.residents.map((r) => r.id);
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
      [executable, ...argv, '--request-id', `labor-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed actual enterprise labor CLI verification' });
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
const session = () =>
  Object.values(runtime.state.world.residentLabor.process.sessions).find(
    (s) => s.actorId === worker,
  );
const claim = () => runtime.state.world.enterprises.firm.earnedPayroll.claims[session().id];
const read = (actor, id = session().id, code = 0) =>
  call(actor, ['city', 'observe', '--view', 'labor', '--section', id], code);
const stop = (actor, s, code = 0) =>
  call(actor, ['life', 'stop-work', '--id', s.id, '--expected-revision', String(s.revision)], code);
const collect = (actor, c, code = 0) =>
  call(
    actor,
    ['business', 'claim-wage', '--id', c.id, '--expected-revision', String(c.revision)],
    code,
  );
try {
  await call(owner, [
    'business',
    'found',
    '--enterprise-id',
    'firm',
    '--name',
    'Resident workshop',
    '--occupation-name',
    'Maker',
    '--initial-capital',
    '100',
    '--max-employees',
    '3',
  ]);
  await call(owner, [
    'business',
    'post-job',
    '--enterprise-id',
    'firm',
    '--wage-offer',
    '10000',
    '--open-slots',
    '3',
  ]);
  await call(worker, ['business', 'join', '--enterprise-id', 'firm']);
  await call(worker, ['city', 'observe', '--view', 'rules', '--section', 'labor']);
  const opportunity = await call(worker, [
    'city',
    'observe',
    '--view',
    'rules',
    '--section',
    'educationOpportunityCost',
  ]);
  assert.equal(opportunity.data.currentOccupationName, 'Maker');
  assert.equal(opportunity.data.foregoneLaborIncome, 625);
  const before = runtime.state.world.agents[worker].balance;
  await call(worker, ['business', 'work', '--occupation-name', 'Maker', '--labor-seconds', '1800']);
  assert.equal(runtime.state.world.agents[worker].balance, before);
  assert.equal(claim().earnedMicros, 0);
  const started = session();
  await call(worker, ['city', 'observe', '--view', 'action']);
  await read(other, started.id, 1);
  await stop(other, started, 1);
  await call(
    worker,
    ['business', 'work', '--occupation-name', 'Maker', '--labor-seconds', '60'],
    1,
  );
  const advanced = runtime.advanceTime(600000, 'ten-minutes');
  assert.equal(advanced.ok, true, advanced.error);
  assert.equal(session().elapsedMs, 600000);
  assert.ok(claim().earnedMicros > claim().paidMicros);
  await read(worker);
  await stop(worker, started, 1);
  await call(owner, ['business', 'close', '--enterprise-id', 'firm'], 1);
  await stop(worker, session());
  await call(worker, ['business', 'leave', '--enterprise-id', 'firm']);
  const outstanding = claim();
  await collect(other, outstanding, 1);
  await call(owner, ['business', 'fund', '--enterprise-id', 'firm', '--amount', '200']);
  const balanceBefore = runtime.state.world.agents[worker].balance;
  const taxBefore = runtime.state.world.residentLabor.withheldMicrosBySession[session().id] ?? 0;
  await collect(worker, outstanding);
  const paid = claim().paidMicros - outstanding.paidMicros;
  const tax = runtime.state.world.residentLabor.withheldMicrosBySession[session().id] - taxBefore;
  assert.ok(
    Math.abs(runtime.state.world.agents[worker].balance - balanceBefore - (paid - tax) / 1e6) <
      1e-8,
  );
  assert.equal(claim().paidMicros, claim().earnedMicros);
  assert.equal(runtime.state.world.enterprises.firm.wageArrears, 0);
  await collect(worker, outstanding, 1);
  await read(worker);
  await call(worker, ['city', 'observe', '--view', 'labor', '--limit', '1']);
  await call(owner, ['business', 'close', '--enterprise-id', 'firm']);
  await read(worker);
  assert.equal(runtime.state.world.enterprises.firm.status, 'closed');
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
        noPrepaidWage: true,
        actualPartialLabor: true,
        wageDebtSurvivesLeaving: true,
        onlyOwnDebtPaid: true,
        cashAndWithholdingVerified: true,
        unpaidClosureRejected: true,
        residentDefinedOccupationQueryable: true,
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
