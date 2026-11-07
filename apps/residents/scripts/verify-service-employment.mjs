// Directed company/service/payroll transport verification, not autonomous institution evidence.
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
  activateSocietyFoundations,
  activateSocietyLivelihoods,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const explicitActivation = process.argv.includes('--explicit-activation');
const root = mkdtempSync(join(tmpdir(), 'service-employment-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  serviceTime: !explicitActivation,
  elapsedLabor: true,
  serviceEmployment: !explicitActivation,
  initialization: 'newcomers',
});
const [owner, worker, other] = manifest.residents.map((r) => r.id);
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      {
        ...a,
        locationId: 'town-square',
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
if (explicitActivation) {
  assert.equal(runtime.state.world.serviceEmployment, undefined);
  assert.equal(activateSocietyFoundations(runtime).status, 'enabled');
  const report = activateSocietyLivelihoods(runtime);
  assert.equal(report.status, 'enabled', JSON.stringify(report));
}
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
      [executable, ...argv, '--request-id', `service-body-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed actual service/employment CLI verification' });
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
const engagement = () => runtime.state.world.serviceEngagements.engagements.service;
const operation = (actor, action, more = [], code = 0) =>
  call(
    actor,
    [
      'engagements',
      action,
      '--id',
      'service',
      '--expected-revision',
      String(engagement().revision),
      ...more,
    ],
    code,
  );
try {
  await call(owner, [
    'business',
    'found',
    '--enterprise-id',
    'firm',
    '--name',
    'Their service organization',
    '--occupation-name',
    'Helper',
    '--initial-capital',
    '100',
    '--max-employees',
    '2',
  ]);
  await call(owner, [
    'business',
    'post-job',
    '--enterprise-id',
    'firm',
    '--wage-offer',
    '100000',
    '--open-slots',
    '2',
  ]);
  await call(worker, ['business', 'join', '--enterprise-id', 'firm']);
  await call(worker, [
    'engagements',
    'offer',
    '--id',
    'service',
    '--controller-kind',
    'resident',
    '--controller-id',
    worker,
    '--title',
    'Resident service',
    '--terms',
    'Actual participation, separate consent and wages',
    '--location-id',
    'town-square',
    '--provider-id',
    worker,
    '--recipient-id',
    other,
    '--payer-sector',
    'agent',
    '--payer-id',
    other,
    '--revenue-sector',
    'enterprise',
    '--revenue-id',
    'firm',
    '--provider-share-bps',
    '5000',
    '--price-per-hour',
    '36',
    '--model-id',
    'personal-assistance-v1',
    '--max-duration-ms',
    '3600000',
    '--start-at',
    '0',
    '--end-at',
    '7200000',
  ]);
  await operation(other, 'accept');
  await operation(other, 'fund', [], 1);
  const authorize = [
    'business',
    'authorize-service',
    '--enterprise-id',
    'firm',
    '--service-id',
    'service',
    '--expected-service-revision',
    String(engagement().revision),
    '--wage-basis',
    'attendance',
  ];
  await call(worker, authorize, 1);
  await call(owner, authorize);
  await call(owner, ['business', 'services']);
  await call(owner, ['business', 'service', '--enterprise-id', 'firm', '--service-id', 'service']);
  await call(
    other,
    ['business', 'service', '--enterprise-id', 'firm', '--service-id', 'service'],
    1,
  );
  await operation(other, 'fund');
  await operation(worker, 'start', ['--until', '3600000'], 1);
  const info = await call(worker, ['engagements', 'read', '--id', 'service']);
  assert.equal(info.data.ownEmployment.wageBasis, 'attendance');
  await operation(worker, 'start', [
    '--until',
    '3600000',
    '--expected-employment-revision',
    String(info.data.ownEmployment.expectedEmploymentRevision),
  ]);
  const record = () => Object.values(runtime.state.world.serviceEmployment.claims)[0];
  const claim = () => runtime.state.world.enterprises.firm.earnedPayroll.claims[record().id];
  assert.equal(claim().earnedMicros, 0);
  assert.equal(runtime.advanceTime(60000, 'actual-waiting').ok, true);
  assert.equal(engagement().charged, 0);
  assert.equal(engagement().progressMs, 0);
  assert.equal(claim().elapsedMs, 60000);
  assert.ok(claim().earnedMicros > 0);
  await operation(other, 'start', ['--until', '3600000']);
  assert.equal(runtime.advanceTime(900000, 'actual-service').ok, true);
  assert.equal(engagement().charged, 9);
  assert.equal(engagement().progressMs, 900000);
  assert.equal(claim().elapsedMs, 960000);
  assert.ok(claim().earnedMicros > claim().paidMicros);
  for (const actor of [owner, worker, other]) {
    const text = JSON.stringify(
      (await call(actor, ['engagements', 'ledger', '--id', 'service'])).data,
    );
    assert.equal(text.includes('elapsedBody'), false);
    assert.equal(text.includes('recipientBefore'), false);
    assert.equal(text.includes('ownBefore'), actor !== owner);
  }
  await call(owner, ['business', 'close', '--enterprise-id', 'firm'], 1);
  await call(owner, [
    'business',
    'layoff',
    '--enterprise-id',
    'firm',
    '--employee-agent-id',
    worker,
  ]);
  assert.equal(engagement().status, 'ended');
  assert.equal(engagement().refunded, 27);
  assert.equal(claim().status, 'ended');
  const earned = claim().earnedMicros,
    paid = claim().paidMicros;
  await call(
    other,
    ['business', 'claim-wage', '--id', claim().id, '--expected-revision', String(claim().revision)],
    1,
  );
  await call(other, ['city', 'observe', '--view', 'labor', '--section', claim().id], 1);
  await call(other, ['business', 'fund', '--enterprise-id', 'firm', '--amount', '10']);
  await call(worker, [
    'business',
    'claim-wage',
    '--id',
    claim().id,
    '--expected-revision',
    String(claim().revision),
  ]);
  assert.equal(claim().earnedMicros, earned);
  assert.equal(claim().paidMicros, paid + 10000000);
  await call(worker, ['city', 'observe', '--view', 'labor', '--section', claim().id]);
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
        explicitActivation,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        independentCompanyPermission: true,
        independentWorkerAcceptance: true,
        actualWaitingDistinctFromService: true,
        serviceIncomeAndWagesSeparate: true,
        patientBodyPrivacy: true,
        layoffPreservesPersonalDebt: true,
        actualCashPaysOnlyCreditor: true,
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
