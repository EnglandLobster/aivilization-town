// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'capital-cli-'));
const m = createOpenSocietyManifest({ count: 3, continuity: true, capitalAgreements: true });
const [a, b, c] = m.residents.map((r) => r.id);
const runtime = new OpenSocietyRuntime(root, m);
const credentials = loadResidentCredentials(root, [a, b, c]),
  server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url)),
  results = [];
let ordinal = 0,
  closed = false;
async function cmd(actor, route, args = {}, expectedCode = 0, requestId) {
  const argv = [
      ...route.split('.'),
      ...Object.entries(args).flatMap(([key, value]) => {
        const flag = '--' + key.replace(/[A-Z]/g, (s) => '-' + s.toLowerCase());
        if (Array.isArray(value)) return value.flatMap((v) => [flag, String(v)]);
        return [flag, typeof value === 'object' ? JSON.stringify(value) : String(value)];
      }),
    ],
    id = requestId ?? `capital-cli-${++ordinal}`;
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...argv, '--request-id', id], {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Directed capital CLI acceptance' });
  assert.equal(result.code, expectedCode, `${route}: ${result.out} ${result.err}`);
  const parsed = JSON.parse(result.out);
  results.push({
    route,
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}

const rev = () => runtime.state.world.enterprises.firm.capital.agreements.round.revision;
try {
  const originalManifest = readFileSync(join(root, 'manifest.json'));
  await cmd(a, 'business.found', {
    enterpriseId: 'firm',
    name: 'Chosen project',
    occupationName: 'Chosen work',
    initialCapital: 100,
    maxEmployees: 3,
  });
  const supply = runtime.state.world.moneySupply;
  await cmd(a, 'capital.initialize', { enterpriseId: 'firm' });
  await cmd(b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: 'Shared investment',
      terms: 'Two independent choices',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 100000,
  });
  await cmd(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  await cmd(b, 'funds.open', { id: 'pool', collectiveId: 'club', title: 'Actual common capital' });
  await cmd(b, 'funds.contribute', {
    id: 'pool',
    expectedRevision: runtime.state.world.commonAccounts.accounts.pool.revision,
    amount: 50,
    note: 'Chosen contribution',
  });
  await cmd(a, 'capital.propose', {
    enterpriseId: 'firm',
    id: 'round',
    expectedEquityVersion: 1,
    expiresAt: 50000,
    terms: 'Explicit company capital and rights',
    allocation: {
      positions: [
        { account: { sector: 'agent', id: a }, weight: 60 },
        { account: { sector: 'collective', id: 'pool' }, weight: 40 },
      ],
      contributions: [{ account: { sector: 'collective', id: 'pool' }, amount: 30 }],
      disbursements: [{ account: { sector: 'enterprise' }, amount: 30 }],
    },
  });
  const consent = {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: rev(),
    accountSector: 'collective',
    accountId: 'pool',
  };
  await cmd(b, 'capital.accept', consent, 1);
  const resourceArgs = { ...consent };
  delete resourceArgs.enterpriseId;
  await cmd(b, 'collectives.propose', {
    id: 'invest',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: 'Exact investment consent',
    action: {
      kind: 'resource',
      capability: 'capital.accept',
      resourceId: 'firm',
      arguments: resourceArgs,
    },
    closesAt: 10000,
    executeBefore: 20000,
  });
  for (const actor of [b, c])
    await cmd(actor, 'collectives.vote', {
      id: 'invest',
      expectedRevision: runtime.state.collectives.decisions.invest.revision,
      vote: 'yes',
    });
  await cmd(b, 'collectives.decide', {
    id: 'invest',
    expectedRevision: runtime.state.collectives.decisions.invest.revision,
  });
  await cmd(b, 'collectives.execute', {
    id: 'invest',
    expectedRevision: runtime.state.collectives.decisions.invest.revision,
  });
  assert.equal(runtime.state.world.commonAccounts.accounts.pool.balance, 20);
  assert.equal(runtime.state.world.enterprises.firm.balance, 100);
  await cmd(a, 'capital.accept', {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: rev(),
    accountSector: 'agent',
    accountId: a,
  });
  await cmd(
    a,
    'capital.execute',
    { enterpriseId: 'firm', id: 'round', expectedRevision: rev() },
    1,
  );
  await cmd(a, 'capital.authorize', {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: rev(),
    expectedControlVersion: 1,
  });
  await cmd(a, 'capital.execute', { enterpriseId: 'firm', id: 'round', expectedRevision: rev() });
  assert.equal(runtime.state.world.enterprises.firm.balance, 130);
  assert.equal(runtime.state.world.enterprises.firm.capital.equityVersion, 2);
  await cmd(
    a,
    'capital.execute',
    { enterpriseId: 'firm', id: 'round', expectedRevision: rev() },
    1,
  );
  const rights = (await cmd(b, 'capital.rights', { enterpriseId: 'firm', limit: 1 })).data;
  assert.equal(rights.positions.total, 2);
  assert.equal(Object.hasOwn(rights, 'companyBalance'), false);
  await cmd(
    b,
    'capital.close',
    { enterpriseId: 'firm', expectedEquityVersion: 2, expectedControlVersion: 1 },
    1,
  );
  const ownerBefore = runtime.state.world.agents[a].balance,
    delegateBefore = runtime.state.world.agents[b].balance;
  await cmd(a, 'capital.close', {
    enterpriseId: 'firm',
    expectedEquityVersion: 2,
    expectedControlVersion: 1,
  });
  assert.equal(runtime.state.world.enterprises.firm.status, 'closed');
  assert.equal(runtime.state.world.commonAccounts.accounts.pool.balance, 72);
  assert.equal(runtime.state.world.agents[a].balance, ownerBefore + 78);
  assert.equal(runtime.state.world.agents[b].balance, delegateBefore);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), originalManifest);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  assert.deepEqual(replay.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  replay.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        validation: 'compiled-authenticated-HTTP-CLI-not-emergence',
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
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
