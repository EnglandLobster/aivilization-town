// Real compiled authenticated CLI/HTTP acceptance; explicit fixtures, no social emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'periodic-obligations-cli-'));
const m = createOpenSocietyManifest({
  count: 4,
  continuity: true,
  elapsedRest: true,
  publicGovernance: true,
});
const [a, b, c, d] = m.residents.map((r) => r.id);
const runtime = new OpenSocietyRuntime(root, m);
const credentials = loadResidentCredentials(root, [a, b, c, d]),
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
    id = requestId ?? `periodic-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Actual finite periodic CLI acceptance' });
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

const now = () => runtime.state.world.clock.now;
const contract = (id) => runtime.state.world.periodicObligations.contracts[id];
const offer = (id, payer, amount = 25, periods = 3) => ({
  type: 'offer',
  id,
  title: '居民自定原文',
  terms: '不创造房屋或成员身份',
  payer,
  revenue: { sector: 'agent', id: c },
  amount,
  periods,
  firstDueAt: now() + 500000,
  periodMs: 60000,
  acceptBy: now() + 400000,
});
const read = async (actor, id) => (await cmd(actor, 'obligations.read', { id })).data;
const prepare = async (command) => (await cmd(a, 'obligations.prepare', { command })).data.request;
async function collective(request, id) {
  await cmd(a, 'collectives.propose', {
    id,
    collectiveId: 'club',
    expectedVersion: runtime.state.collectives.charters.club.version,
    terms: '批准精确全部期数',
    action: {
      kind: 'resource',
      capability: 'principals.operate',
      resourceId: request.resourceId,
      arguments: { request },
    },
    closesAt: now() + 10000,
    executeBefore: now() + 200000,
  });
  for (const actor of [a, b])
    await cmd(actor, 'collectives.vote', {
      id,
      expectedRevision: runtime.state.collectives.decisions[id].revision,
      vote: 'yes',
    });
  await cmd(a, 'collectives.decide', {
    id,
    expectedRevision: runtime.state.collectives.decisions[id].revision,
  });
  await cmd(a, 'collectives.execute', {
    id,
    expectedRevision: runtime.state.collectives.decisions[id].revision,
  });
}
async function publicExecute(request, id) {
  await cmd(a, 'governance.propose', {
    id,
    text: '有限财政约定',
    action: { kind: 'manage-resource', expectedRevision: request.resourceRevision, request },
    closesAt: now() + 60000,
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
  });
  for (const actor of [a, b, c])
    await cmd(actor, 'governance.vote', {
      id,
      choice: 'yes',
      expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
    });
  assert.equal(runtime.advanceTime(60000, `ballot-${id}`).ok, true);
  await cmd(d, 'governance.close', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
  await cmd(d, 'governance.execute', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
}
try {
  const manifest = readFileSync(join(root, 'manifest.json'));
  await cmd(a, 'obligations.list', {}, 1);
  const before = structuredClone(runtime.state.world);
  assert.equal(runtime.enablePeriodicObligations().ok, true);
  assert.deepEqual(runtime.state.world.agents, before.agents);
  assert.equal(runtime.state.world.treasury, before.treasury);
  assert.equal(runtime.enablePeriodicObligations().ok, true);
  await cmd(a, 'business.found', {
    enterpriseId: 'firm',
    name: '真实企业',
    occupationName: '经营',
    initialCapital: 100,
    maxEmployees: 2,
  });
  await cmd(a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '原文章程',
      terms: '两人决定',
      members: [a, b],
      voters: [a, b],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: now() + 1000000,
  });
  await cmd(b, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  await cmd(a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '真实资金' });
  await cmd(d, 'funds.contribute', {
    id: 'pool',
    expectedRevision: 1,
    amount: 100,
    note: '实际投入',
  });
  for (const sector of ['agent', 'enterprise', 'collective', 'treasury']) {
    const payer = {
      sector,
      id:
        sector === 'agent'
          ? a
          : sector === 'enterprise'
            ? 'firm'
            : sector === 'collective'
              ? 'pool'
              : 'public-treasury',
    };
    const command = offer(
      sector,
      payer,
      sector === 'collective' ? 100 : 25,
      sector === 'collective' ? 2 : 3,
    );
    const request = await prepare(command);
    assert.equal(
      request.operation.arguments.maximumTotalMicros,
      command.amount * command.periods * 1000000,
    );
    await cmd(b, 'principals.operate', { request }, 1);
    if (sector === 'collective') await collective(request, 'whole-common');
    else if (sector === 'treasury') await publicExecute(request, 'whole-public');
    else await cmd(a, 'principals.operate', { request });
    await cmd(
      b,
      'obligations.read',
      { id: sector },
      sector === 'agent' || sector === 'enterprise' ? 1 : 0,
    );
    const receipt = await read(c, sector),
      accept = receipt.operations.accept;
    const frozen = structuredClone(runtime.state.world);
    await cmd(a, 'principals.operate', { request: accept }, 1);
    assert.deepEqual(runtime.state.world, frozen);
    await cmd(
      c,
      'principals.operate',
      { request: { ...accept, arguments: { ...accept.arguments, actorId: a } } },
      1,
    );
    assert.deepEqual(runtime.state.world, frozen);
    await cmd(c, 'principals.operate', { request: accept });
    await cmd(c, 'principals.operate', { request: accept }, 1);
    assert.equal(contract(sector).cursor, 0);
  }
  const contractCount = Object.keys(runtime.state.world.periodicObligations.contracts).length;
  const active = Object.values(runtime.state.world.periodicObligations.contracts);
  assert.equal(
    runtime.advanceTime(
      Math.max(...active.map((c) => c.firstDueAt + (c.periods - 1) * c.periodMs)) - now(),
      'all-actual-due',
    ).ok,
    true,
  );
  for (const id of ['agent', 'enterprise', 'treasury']) {
    assert.equal(contract(id).status, 'ended');
    assert.deepEqual(
      Object.values(contract(id).installments).map((i) => i.status),
      ['paid', 'paid', 'paid'],
    );
  }
  assert.equal(runtime.state.world.enterprises.firm.balance, 25);
  assert.deepEqual(
    Object.values(contract('collective').installments).map((i) => i.status),
    ['paid', 'unpaid'],
  );
  const old = await read(c, 'collective');
  assert.equal(old.unpaidAmount, 100);
  const cash = runtime.state.world.agents[c].balance;
  await cmd(c, 'principals.operate', { request: old.installments.items[1].operations.waive });
  assert.equal(runtime.state.world.agents[c].balance, cash);
  assert.equal(contract('collective').installments['2'].status, 'waived');
  assert.equal(
    contract('collective').installments['2'].unpaidReason,
    'periodic-insufficient-funds',
  );
  const early = offer('early', { sector: 'agent', id: a });
  await cmd(a, 'principals.operate', { request: await prepare(early) });
  await cmd(c, 'principals.operate', { request: (await read(c, 'early')).operations.accept });
  await cmd(a, 'principals.operate', { request: (await read(a, 'early')).operations.terminate });
  assert.equal(contract('early').cursor, 0);
  assert.equal(contract('early').status, 'terminated');
  assert.equal(
    Object.keys(runtime.state.world.periodicObligations.contracts).length,
    contractCount + 1,
  );
  const actualDue = () =>
    runtime.journal.commits
      .flatMap((c) => c.worldEvents ?? [])
      .filter(
        (e) =>
          e.type === 'ResidentPeriodicObligationsCommitted' &&
          e.payload.event.type === 'PeriodicInstallmentRecorded',
      );
  const count = actualDue().length;
  assert.equal(count, 11);
  for (const e of actualDue()) {
    assert.equal(e.payload.actorId, 'system');
    for (const tx of e.payload.transactions)
      assert.equal(
        tx.entries.reduce((n, e) => n + e.amount, 0),
        0,
      );
  }
  assert.equal(runtime.advanceTime(60000, 'no-hidden-retry').ok, true);
  assert.equal(actualDue().length, count);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        validation: 'compiled-authenticated-HTTP-CLI-not-emergence',
        policy: 'resident-periodic-obligations-v1',
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
        checks: [
          'four-actual-payer-accounts',
          'independent-acceptance',
          'whole-finite-public-and-collective-approval',
          'identity-binding',
          'once-only-due',
          'unpaid-preserved',
          'creditor-waiver-not-cash',
          'future-stop',
          'unchanged-legacy-manifest',
          'full-journal-replay',
        ],
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
