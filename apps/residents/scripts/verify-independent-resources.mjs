// Directed real CLI acceptance; no government, buildings, vehicles or scripted social emergence.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'independent-resource-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  societyKernel: true,
  materials: true,
  mobility: false,
  premises: false,
  publicGovernance: false,
});
let runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld: {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        { ...a, inventory: { Wood: 3 } },
      ]),
    ),
  },
});
const [a, b, c] = m.residents.map((r) => r.id);
const originalManifest = readFileSync(join(root, 'manifest.json'));
runtime.close();
const admin = (kinds, expected = 0) => {
  const p = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
      'enable-resource-adapters',
      '--root',
      root,
      '--args',
      JSON.stringify(kinds),
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(p.status, expected, p.stdout + p.stderr);
  return JSON.parse(p.stdout);
};
const originalJournal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(admin(['stock', 'vehicle'], 1).ok, false);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), originalJournal);
assert.equal(admin(['stock']).ok, true);
const enabledJournal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(admin(['stock']).ok, true);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), enabledJournal);
runtime = new OpenSocietyRuntime(root);
const credentials = loadResidentCredentials(root, [a, b, c]);
const server = await startResidentServer(runtime, credentials);
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
    id = requestId ?? `paid-resource-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Actual paid resource CLI acceptance' });
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

try {
  assert.equal(runtime.state.world.publicGovernance, undefined);
  assert.equal(runtime.state.world.premises, undefined);
  assert.equal(runtime.state.world.residentMobility, undefined);
  await cmd(a, 'stocks.create', {
    id: 's',
    title: 'independent stock',
    locationId: runtime.state.world.agents[a].locationId,
  });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 2 } });
  const first = (await cmd(a, 'principals.read', { kind: 'stock', id: 's' })).data;
  const handover = {
    ...first.requestBase,
    command: {
      type: 'offer',
      target: { kind: 'resident', id: b },
      terms: 'chosen exchange',
      expiresAt: runtime.state.world.clock.now + 100000,
    },
  };
  await cmd(c, 'principals.control', { request: handover }, 1);
  await cmd(a, 'principals.control', { request: handover });
  const entry = (await cmd(a, 'principals.read', { kind: 'stock', id: 's' })).data;
  const source = entry.resourceSaleOfferSource;
  const request = {
    ...entry.resourceSaleOfferBase,
    resourceId: 'sale',
    operation: {
      capability: 'resource-sales.offer',
      arguments: {
        source,
        command: {
          type: 'offer',
          id: 'sale',
          title: 'stock sale',
          terms: 'retains all actual goods',
          resource: { kind: 'stock', id: 's', expectedRevision: entry.revision },
          payer: { sector: 'agent', id: b },
          revenue: { sector: 'agent', id: a },
          amount: 1,
          acceptBy: source.offer.expiresAt,
        },
      },
    },
  };
  await cmd(a, 'principals.operate', { request });
  const quote = (await cmd(b, 'principals.read', { kind: 'resource-sale', id: 'sale' })).data;
  const before = structuredClone(runtime.state.world);
  await cmd(c, 'principals.operate', { request: quote.operations.accept }, 1);
  assert.deepEqual(runtime.state.world, before);
  await cmd(b, 'principals.operate', { request: quote.operations.accept });
  assert.equal(runtime.state.world.agents[a].balance, before.agents[a].balance + 1);
  assert.equal(runtime.state.world.agents[b].balance, before.agents[b].balance - 1);
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
  assert.deepEqual(runtime.state.world.materials.stocks.s.inventory, { Wood: 2 });
  assert.deepEqual(runtime.state.world.materials.stocks.s.control.controller, {
    kind: 'resident',
    id: b,
  });
  assert.equal(runtime.state.world.publicGovernance, undefined);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), originalManifest);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-cli-not-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        adminMissingDomainAtomic: true,
        adminRetryIdempotent: true,
        noGovernmentBuildingsOrVehicles: true,
        actualGoodsPreserved: true,
        moneySupplyUnchanged: true,
        replayMatched: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
