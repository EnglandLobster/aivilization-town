// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'public-employment-cli-'));
const m = createOpenSocietyManifest({ count: 3, continuity: true, publicGovernance: true });
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
    id = requestId ?? `employment-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit public employment CLI acceptance' });
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
  const originalManifest = readFileSync(join(root, 'manifest.json'));
  await cmd(a, 'governance.employment', {}, 1);
  assert.equal(runtime.enablePublicEmployment().ok, true);
  const first = (await cmd(a, 'governance.employment', { limit: 1 })).data;
  const rows = [...first.occupations.items];
  let offset = first.occupations.nextOffset;
  while (offset !== null) {
    const page = (await cmd(a, 'governance.employment', { offset, limit: 30 })).data;
    rows.push(...page.occupations.items);
    offset = page.occupations.nextOffset;
  }
  assert.equal(rows.length, first.occupations.total);
  const terms = {
    ...first.terms,
    quotaByResidentialTier: [3, 2, 1],
    ranking: ['submitted'],
    occupations: rows.map((o) =>
      o.occupationName === 'Chef'
        ? {
            ...o,
            minimumResidentialTier: 1,
            educationFloor: 0,
            eligibilityShare: 1,
            prerequisiteCommodity: null,
          }
        : o,
    ),
  };
  const rev = (id) => runtime.state.world.publicGovernance.authority.proposals[id].revision;
  const action = { kind: 'set-employment', expectedRevision: first.latestRevision, terms };
  await cmd(
    a,
    'governance.propose',
    {
      id: 'forgery',
      text: 'Invalid extra authority',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action: { ...action, terms: { ...terms, authority: 'self' } },
    },
    1,
  );
  for (const id of ['reform', 'stale']) {
    await cmd(a, 'governance.propose', {
      id,
      text: 'Directed engineering test; not spontaneous reform',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action,
    });
    await cmd(a, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
    await cmd(b, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
  }
  await cmd(c, 'governance.execute', { id: 'reform', expectedRevision: rev('reform') }, 1);
  assert.equal(runtime.advanceTime(60000, 'close-voting').ok, true);
  for (const id of ['reform', 'stale'])
    await cmd(c, 'governance.close', { id, expectedRevision: rev(id) });
  const before = structuredClone(runtime.state.world.agents);
  await cmd(c, 'governance.execute', { id: 'reform', expectedRevision: rev('reform') });
  assert.deepEqual(runtime.state.world.agents, before);
  await cmd(c, 'governance.execute', { id: 'stale', expectedRevision: rev('stale') }, 1);
  const pending = (await cmd(a, 'governance.employment', { revision: 2 })).data;
  assert.equal(pending.activeRevision, 1);
  assert.equal(pending.nextCycleRevision, 2);
  assert.equal(pending.source.proposalId, 'reform');
  const boundary = runtime.state.world.publicEmployment.cycleDurationMs;
  assert.equal(
    runtime.advanceTime(boundary - runtime.state.world.clock.now, 'next-cycle').ok,
    true,
  );
  const active = (await cmd(a, 'governance.employment')).data;
  assert.equal(active.activeRevision, 2);
  assert.equal(active.ownApplications.allowed, 3);
  await cmd(a, 'business.apply-job', { occupationName: 'Chef' });
  assert.equal(runtime.state.world.jobApplications.at(-1).publicEmploymentRevision, 2);
  assert.equal(runtime.state.world.jobApplications.at(-1).occupationName, 'Chef');
  await cmd(a, 'governance.employment', { revision: 999 }, 1);
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
        activeRevision: active.activeRevision,
        routes: results,
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
