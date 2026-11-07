// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resource-principals-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  resourceControl: true,
  materials: true,
  publicGovernance: true,
});
const [a, b, c] = m.residents.map((r) => r.id);
const location = Object.values(m.initialWorld.locations).find(
  (l) => l.kind === 'production',
).locationId;
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld: {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, v]) => [
        id,
        { ...v, locationId: location, inventory: { Wood: 8 } },
      ]),
    ),
  },
});
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
    id = requestId ?? `resource-principals-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit resource principal CLI acceptance' });
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

const stock = () => runtime.state.world.materials.stocks.s;
const request = (command) => ({
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: stock().revision,
  controlVersion: stock().control.version,
  command,
});
const operation = (command) => ({
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: stock().revision,
  controlVersion: stock().control.version,
  operation: { capability: 'materials.' + command.type, arguments: command },
});
async function collectiveDecision(id, request) {
  await cmd(b, 'collectives.propose', {
    id,
    collectiveId: 'club',
    expectedVersion: runtime.state.collectives.charters.club.version,
    terms: '精确同意',
    action: {
      kind: 'resource',
      capability: 'operation' in request ? 'principals.operate' : 'principals.control',
      resourceId: 's',
      arguments: { request },
    },
    closesAt: runtime.state.world.clock.now + 100000,
    executeBefore: runtime.state.world.clock.now + 1000000,
  });
  for (const actor of [b, c])
    await cmd(actor, 'collectives.vote', {
      id,
      expectedRevision: runtime.state.collectives.decisions[id].revision,
      vote: 'yes',
    });
  await cmd(b, 'collectives.decide', {
    id,
    expectedRevision: runtime.state.collectives.decisions[id].revision,
  });
  await cmd(b, 'collectives.execute', {
    id,
    expectedRevision: runtime.state.collectives.decisions[id].revision,
  });
}
async function publicDecision(id, request) {
  const closesAt = runtime.state.world.clock.now + 60000;
  await cmd(a, 'governance.propose', {
    id,
    text: '精确公共授权',
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
    closesAt,
    action: {
      kind: 'operation' in request ? 'manage-resource' : 'control-resource',
      expectedRevision: request.resourceRevision,
      request,
    },
  });
  for (const actor of [a, b, c])
    await cmd(actor, 'governance.vote', {
      id,
      expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
      choice: 'yes',
    });
  assert.equal(
    runtime.advanceTime(closesAt - runtime.state.world.clock.now, 'close-' + id).ok,
    true,
  );
  await cmd(c, 'governance.close', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
  await cmd(c, 'governance.execute', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
}
try {
  const original = readFileSync(join(root, 'manifest.json'));
  await cmd(a, 'principals.list', {}, 1);
  const before = structuredClone(runtime.state.world);
  assert.equal(runtime.enableResourcePrincipals().ok, true);
  assert.deepEqual(runtime.state.world.agents, before.agents);
  assert.equal(runtime.enableResourcePrincipals().ok, true);
  await cmd(a, 'stocks.create', { id: 's', title: '真实库存', locationId: location });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 5 } });
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: '居民企业',
    occupationName: '居民自选工作',
    initialCapital: 100,
    maxEmployees: 3,
  });
  await cmd(a, 'principals.control', {
    request: request({
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      expiresAt: 1000000,
      terms: '独立接收',
    }),
  });
  await cmd(c, 'principals.control', { actorId: b, request: request({ type: 'accept' }) }, 2);
  await cmd(c, 'principals.control', { request: request({ type: 'accept' }) }, 1);
  await cmd(b, 'principals.control', { request: request({ type: 'accept' }) });
  assert.deepEqual(stock().control.controller, { kind: 'enterprise', id: 'firm' });
  await cmd(b, 'business.close', { enterpriseId: 'firm' }, 1);
  await cmd(
    a,
    'stocks.withdraw',
    { id: 's', expectedRevision: stock().revision, recipientId: a, items: { Wood: 1 } },
    1,
  );
  await cmd(b, 'principals.operate', {
    request: operation({
      type: 'withdraw',
      id: 's',
      expectedRevision: stock().revision,
      recipientId: b,
      items: { Wood: 2 },
    }),
  });
  assert.equal(runtime.state.world.agents[b].inventory.Wood, 10);
  await cmd(b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同管理',
      terms: '两人独立授权',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 1000000,
  });
  await cmd(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  await cmd(b, 'principals.control', {
    request: request({
      type: 'offer',
      target: { kind: 'collective', id: 'club' },
      expiresAt: 1000000,
      terms: '管理交接',
    }),
  });
  await cmd(b, 'principals.control', { request: request({ type: 'accept' }) }, 1);
  await collectiveDecision('accept', request({ type: 'accept' }));
  assert.deepEqual(stock().control.controller, { kind: 'collective', id: 'club' });
  await cmd(b, 'business.close', { enterpriseId: 'firm' });
  assert.equal(runtime.state.world.enterprises.firm.status, 'closed');
  await collectiveDecision(
    'to-public',
    request({
      type: 'offer',
      target: { kind: 'public', id: runtime.state.world.publicGovernance.authority.grant.id },
      expiresAt: 1000000,
      terms: '公共独立接收',
    }),
  );
  await publicDecision('public-accept', request({ type: 'accept' }));
  assert.equal(stock().control.controller.kind, 'public');
  await cmd(
    c,
    'stocks.withdraw',
    { id: 's', expectedRevision: stock().revision, recipientId: c, items: { Wood: 1 } },
    1,
  );
  await publicDecision(
    'public-give',
    operation({
      type: 'withdraw',
      id: 's',
      expectedRevision: stock().revision,
      recipientId: c,
      items: { Wood: 1 },
    }),
  );
  assert.equal(stock().inventory.Wood, 2);
  assert.equal(runtime.state.world.agents[c].inventory.Wood, 9);
  assert.equal(
    Object.values(runtime.state.world.agents).reduce((n, v) => n + (v.inventory.Wood ?? 0), 0) +
      stock().inventory.Wood,
    24,
  );
  const visible = await cmd(c, 'principals.read', { kind: 'stock', id: 's' });
  assert.equal(visible.data.controller.kind, 'public');
  await cmd(c, 'principals.list', { limit: 1 });
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), original);
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
