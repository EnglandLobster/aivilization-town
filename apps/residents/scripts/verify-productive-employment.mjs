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

const root = mkdtempSync(join(tmpdir(), 'productive-employment-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  elapsedLabor: true,
  productiveEmployment: true,
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
        inventory: { ...a.inventory, Wood: 10 },
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
const record = () =>
  Object.values(runtime.state.world.productiveEmployment.claims).find((c) => c.actorId === worker);
const claim = () => runtime.state.world.enterprises.firm.earnedPayroll.claims[record().id];
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
    'Resident productive workshop',
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
    '100000',
    '--open-slots',
    '3',
  ]);
  await call(worker, ['business', 'join', '--enterprise-id', 'firm']);
  await call(owner, [
    'stocks',
    'create',
    '--id',
    'stock',
    '--title',
    'Actual personal warehouse',
    '--location-id',
    'workshop',
  ]);
  await call(owner, [
    'stocks',
    'deposit',
    '--id',
    'stock',
    '--expected-revision',
    '1',
    '--items',
    JSON.stringify({ Wood: 4 }),
  ]);
  const create = [
    'production',
    'create',
    '--id',
    'job',
    '--stock-id',
    'stock',
    '--expected-revision',
    '2',
    '--recipe-id',
    'book',
    '--quantity',
    '2',
    '--product-name',
    'Resident book',
    '--description',
    'Original product description',
    '--workers',
    worker,
    '--enterprise-id',
    'firm',
  ];
  await call(other, create, 1);
  await call(owner, create);
  const info = await call(worker, ['production', 'read', '--id', 'job']);
  assert.equal(info.data.employment.ownQuotedWage, 100000);
  assert.equal(info.data.employment.stockController.id, owner);
  const job = runtime.state.world.materials.productions.job,
    duration = job.recipe.workMs * 2;
  const before = runtime.state.world.agents[worker];
  await call(worker, [
    'production',
    'start',
    '--id',
    'job',
    '--expected-revision',
    '1',
    '--until',
    String(duration),
  ]);
  assert.equal(claim().earnedMicros, 0);
  assert.equal(runtime.state.world.agents[worker].balance, before.balance);
  await call(
    worker,
    ['business', 'work', '--occupation-name', 'Maker', '--labor-seconds', '60'],
    1,
  );
  await call(other, ['city', 'observe', '--view', 'labor', '--section', record().id], 1);
  const partial = Math.floor(duration * 0.75);
  const advanced = runtime.advanceTime(partial, 'actual-productive-time');
  assert.equal(advanced.ok, true, advanced.error);
  assert.equal(claim().elapsedMs, partial);
  assert.ok(claim().earnedMicros > claim().paidMicros);
  assert.equal(runtime.state.world.materials.productions.job.progressMs, partial);
  assert.equal(runtime.state.world.materials.stocks.stock.inventory.Book, 1);
  const decay = runtime.manifest.worldPolicies.calendar.physiologicalDecay;
  const expectedEnergy =
    before.physiology.energy -
    (job.recipe.energyCost * partial) / job.recipe.workMs -
    (decay.energyPerHour * partial) / 3600000;
  assert.ok(Math.abs(runtime.state.world.agents[worker].physiology.energy - expectedEnergy) < 1e-8);
  await call(worker, ['production', 'leave', '--id', 'job', '--expected-revision', '1'], 1);
  await call(owner, ['business', 'close', '--enterprise-id', 'firm'], 1);
  await call(
    other,
    ['business', 'layoff', '--enterprise-id', 'firm', '--employee-agent-id', worker],
    1,
  );
  await call(owner, [
    'business',
    'layoff',
    '--enterprise-id',
    'firm',
    '--employee-agent-id',
    worker,
  ]);
  assert.equal(runtime.state.world.materials.productions.job.session, undefined);
  assert.equal(claim().status, 'ended');
  assert.equal(runtime.state.world.agents[worker].job, null);
  const outstanding = claim();
  await collect(other, outstanding, 1);
  await call(owner, ['business', 'fund', '--enterprise-id', 'firm', '--amount', '500']);
  const balance = runtime.state.world.agents[worker].balance,
    tax = record().withheldMicros;
  await collect(worker, outstanding);
  assert.equal(claim().paidMicros, claim().earnedMicros);
  assert.ok(
    Math.abs(
      runtime.state.world.agents[worker].balance -
        balance -
        (claim().paidMicros - outstanding.paidMicros - record().withheldMicros + tax) / 1e6,
    ) < 1e-8,
  );
  await collect(worker, outstanding, 1);
  await call(worker, ['city', 'observe', '--view', 'labor', '--section', record().id]);
  await call(owner, ['business', 'close', '--enterprise-id', 'firm']);
  const revision = runtime.state.world.materials.productions.job.revision;
  await call(
    worker,
    [
      'production',
      'start',
      '--id',
      'job',
      '--expected-revision',
      String(revision),
      '--until',
      String(partial + 30000),
    ],
    1,
  );
  await call(owner, [
    'production',
    'cancel',
    '--id',
    'job',
    '--expected-revision',
    String(revision),
  ]);
  assert.deepEqual(runtime.state.world.materials.stocks.stock.inventory, { Wood: 3, Book: 1 });
  assert.equal(runtime.state.world.moneySupply, initialWorld.moneySupply);
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
        actualProductionAndWagesTogether: true,
        oneBodyEffort: true,
        employerAuthorityAndIndependentWorker: true,
        physicalProgressSurvivesLayoff: true,
        wagesSurviveLayoff: true,
        privateClaim: true,
        paidTaxAndNetVerified: true,
        unusedMaterialsReturned: true,
        stockOwnershipUnchanged: true,
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
