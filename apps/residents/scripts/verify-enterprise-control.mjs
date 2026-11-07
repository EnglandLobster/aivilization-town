// Directed enterprise management transport verification, not autonomous institution evidence.
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

const root = mkdtempSync(join(tmpdir(), 'enterprise-control-cli-'));
const manifest = createOpenSocietyManifest({
  count: 4,
  continuity: true,
  elapsedRest: true,
  elapsedLabor: true,
  resourceControl: true,
  initialization: 'newcomers',
});
const [founder, manager, voter, employee] = manifest.residents.map((r) => r.id);
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
const credentials = loadResidentCredentials(root, [founder, manager, voter, employee]);
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
      [executable, ...argv, '--request-id', `enterprise-control-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed enterprise management CLI verification' });
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

let p = 0;
async function decision(capability, args) {
  const id = `decision-${++p}`;
  await call(manager, [
    'collectives',
    'propose',
    '--id',
    id,
    '--collective-id',
    'club',
    '--expected-version',
    String(runtime.state.collectives.charters.club.version),
    '--terms',
    'Only this exact company action',
    '--action',
    JSON.stringify({ kind: 'resource', capability, resourceId: 'firm', arguments: args }),
    '--closes-at',
    '10000',
    '--execute-before',
    '20000',
  ]);
  for (const actor of [manager, voter])
    await call(actor, [
      'collectives',
      'vote',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
      '--vote',
      'yes',
    ]);
  await call(manager, [
    'collectives',
    'decide',
    '--id',
    id,
    '--expected-revision',
    String(runtime.state.collectives.decisions[id].revision),
  ]);
  return id;
}
async function execute(id, code = 0) {
  return call(
    manager,
    [
      'collectives',
      'execute',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ],
    code,
  );
}
try {
  await call(founder, [
    'business',
    'found',
    '--enterprise-id',
    'firm',
    '--name',
    'Resident chosen company',
    '--occupation-name',
    'Helper',
    '--initial-capital',
    '100',
    '--max-employees',
    '3',
  ]);
  const supply = runtime.state.world.moneySupply;
  await call(manager, [
    'collectives',
    'create',
    '--id',
    'club',
    '--configuration',
    JSON.stringify({
      title: 'Our procedure',
      terms: 'Two independent choices',
      members: [manager, voter],
      voters: [manager, voter],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    }),
    '--expires-at',
    '100000',
  ]);
  await call(voter, [
    'collectives',
    'respond',
    '--id',
    'club',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  await call(founder, [
    'resources',
    'offer',
    '--kind',
    'enterprise',
    '--id',
    'firm',
    '--expected-revision',
    '1',
    '--expected-control-version',
    '1',
    '--target',
    JSON.stringify({ kind: 'collective', id: 'club' }),
    '--expires-at',
    '50000',
    '--terms',
    'Management only; capital and debts remain',
  ]);
  await call(
    manager,
    [
      'resources',
      'accept',
      '--kind',
      'enterprise',
      '--id',
      'firm',
      '--expected-revision',
      '2',
      '--expected-control-version',
      '2',
    ],
    1,
  );
  await execute(
    await decision('resources.accept', {
      kind: 'enterprise',
      expectedRevision: 2,
      expectedControlVersion: 2,
    }),
  );
  const firm = runtime.state.world.enterprises.firm;
  assert.equal(firm.ownerAgentId, founder);
  assert.deepEqual(firm.control.controller, { kind: 'collective', id: 'club' });
  await call(manager, ['resources', 'read', '--kind', 'enterprise', '--id', 'firm']);
  for (const actor of [founder, manager])
    await call(
      actor,
      [
        'business',
        'post-job',
        '--enterprise-id',
        'firm',
        '--wage-offer',
        '30',
        '--open-slots',
        '3',
      ],
      1,
    );
  await execute(
    await decision('business.post-job', { expectedControlVersion: 3, wageOffer: 30, openSlots: 3 }),
  );
  assert.deepEqual(runtime.state.world.enterprises.firm.employeeAgentIds, []);
  await call(employee, ['business', 'join', '--enterprise-id', 'firm']);
  const impossible = await decision('market.trade', {
    expectedControlVersion: 3,
    side: 'buy',
    commodityName: 'Apple',
    quantity: 100000,
  });
  const assets = structuredClone(runtime.state.world.enterprises.firm);
  await execute(impossible, 1);
  assert.deepEqual(runtime.state.world.enterprises.firm, assets);
  assert.equal(runtime.state.collectives.decisions[impossible].status, 'passed');
  const founderBalance = runtime.state.world.agents[founder].balance,
    managerBalance = runtime.state.world.agents[manager].balance;
  await execute(await decision('business.close', { expectedControlVersion: 3 }));
  assert.equal(runtime.state.world.agents[founder].balance, founderBalance + 100);
  assert.equal(runtime.state.world.agents[manager].balance, managerBalance);
  assert.equal(runtime.state.world.agents[employee].job, null);
  assert.equal(runtime.state.world.moneySupply, supply);
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
        independentGroupAcceptance: true,
        noFounderOrMemberBypass: true,
        independentEmployeeJoining: true,
        failedDecisionRemainsUsable: true,
        capitalAndManagementSeparate: true,
        moneySupplyConserved: true,
        replayEqual: true,
        journalBytesUnchanged: true,
        results,
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
