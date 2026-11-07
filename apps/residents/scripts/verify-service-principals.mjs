// Authenticated compiled CLI acceptance; this is an engineering scenario, not an emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'service-principals-cli-'));
const manifest = createOpenSocietyManifest({ count: 3, continuity: true, publicGovernance: true });
const [a, b, c] = manifest.residents.map((v) => v.id);
const location = Object.values(manifest.initialWorld.locations).find((l) => l.kind === 'market').locationId;
const initialWorld = { ...manifest.initialWorld, agents: Object.fromEntries(Object.entries(manifest.initialWorld.agents).map(([id, actor]) => [id, { ...actor, locationId: location }])) };
const runtime = new OpenSocietyRuntime(root, { ...manifest, initialWorld });
const credentials = loadResidentCredentials(root, [a, b, c]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let commands = 0, expectedRefusals = 0, closed = false;
async function cmd(actor, route, args = {}, expected = 0) {
  const argv = [...route.split('.'), ...Object.entries(args).flatMap(([key, value]) => ['--' + key.replace(/[A-Z]/g, (v) => '-' + v.toLowerCase()), typeof value === 'object' ? JSON.stringify(value) : String(value)])];
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [executable, ...argv, '--request-id', `service-cli-${++commands}`], { env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', (v) => out += v); p.stderr.on('data', (v) => err += v); p.on('error', reject); p.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit service authority CLI acceptance' });
  assert.equal(result.code, expected, `${route}: ${result.out} ${result.err}`);
  if (expected) expectedRefusals++;
  return JSON.parse(result.out);
}
const directory = () => runtime.state.services.services.clinic;
const base = () => ({ resourceKind: 'service', resourceId: 'clinic', resourceRevision: directory().revision, controlVersion: directory().control?.version ?? 1 });
const control = (actor, command, expected = 0) => cmd(actor, 'principals.control', { request: { ...base(), command } }, expected);
const adminRequest = (command) => ({ ...base(), operation: { capability: command.type === 'accept' || command.type === 'cancel' ? `bookings.${command.type}` : command.type === 'call' ? 'queues.call' : `services.${command.type}`, arguments: { command } } });
const admin = (actor, command, expected = 0) => cmd(actor, 'principals.operate', { request: adminRequest(command) }, expected);
const permission = (actor, type, residentId, expected = 0) => cmd(actor, 'principals.operate', { request: { ...base(), operation: { capability: type, arguments: { type, id: 'clinic', expectedRevision: directory().revision, residentId } } } }, expected);
const advance = (ms) => assert.equal(runtime.advanceTime(ms, `service-time-${commands}`).ok, true);
try {
  await cmd(a, 'services.publish', { id: 'clinic', kind: 'appointment', locationId: location, title: '居民服务原文', description: '管理不是出勤', capacity: 2 });
  const old = structuredClone(runtime.state.services.services), manifestBytes = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enableServicePrincipals().ok, true);
  assert.deepEqual(runtime.state.services.services, old);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifestBytes);
  await cmd(a, 'rules.read', { id: 'resource-principals' });
  await cmd(a, 'principals.read', { kind: 'service', id: 'clinic' });
  await cmd(b, 'principals.read', { kind: 'service', id: 'clinic' }, 1);
  await cmd(b, 'business.found', { enterpriseId: 'firm', name: '居民服务组织', occupationName: '居民角色', initialCapital: 100, maxEmployees: 3 });
  await control(a, { type: 'offer', target: { kind: 'enterprise', id: 'firm' }, expiresAt: 1000000, terms: '独立交接目录' });
  await control(c, { type: 'accept' }, 1); await control(b, { type: 'accept' });
  assert.deepEqual(directory().namedProviders, [a]);
  const now = runtime.state.world.clock.now;
  const schedule = { type: 'schedule', id: 'slot', serviceId: 'clinic', start: now, end: now + 60000, capacity: 1 };
  await cmd(a, 'services.schedule', { id: 'bad', serviceId: 'clinic', start: now, end: now + 60000, capacity: 1 }, 1);
  await admin(b, schedule);
  await cmd(b, 'services.start', { id: 'slot', expectedRevision: 1, until: now + 50000 }, 1);
  await cmd(a, 'services.start', { id: 'slot', expectedRevision: 1, until: now + 50000 });
  await permission(b, 'services.revoke-provider', a, 1);
  await cmd(c, 'bookings.request', { id: 'visit', slotId: 'slot', units: 1 });
  await cmd(b, 'bookings.read', { id: 'visit' }); await cmd(a, 'bookings.read', { id: 'visit' }, 1);
  const world = structuredClone(runtime.state.world);
  await admin(b, { type: 'accept', id: 'visit', expectedRevision: 1 });
  assert.deepEqual(runtime.state.world.agents, world.agents);
  assert.deepEqual(runtime.state.world.activityTimeByAgent, world.activityTimeByAgent);
  await admin(b, { type: 'close', id: 'clinic', expectedRevision: directory().revision }, 1);
  await cmd(b, 'business.close', { enterpriseId: 'firm' }, 1);
  await cmd(c, 'bookings.check-in', { id: 'visit', expectedRevision: 2, until: now + 40000 });
  advance(1000);
  await cmd(a, 'services.stop', { id: 'slot', expectedRevision: 2 });
  assert.equal(runtime.state.services.bookings.visit.attendedMs, 1000);
  assert.equal(runtime.state.services.bookings.visit.providerOverlapMs, 1000);
  await permission(b, 'services.revoke-provider', a);
  await admin(b, { type: 'close', id: 'clinic', expectedRevision: directory().revision });
  await control(b, { type: 'offer', target: { kind: 'resident', id: a }, expiresAt: 1000000, terms: '关闭不抹除控制资产' });
  await control(a, { type: 'accept' });
  await cmd(b, 'business.close', { enterpriseId: 'firm' });
  assert.equal(runtime.state.world.enterprises.firm.status, 'closed');
  const before = structuredClone(runtime.state), journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close(); closed = true; runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try { assert.deepEqual(replay.state, before); assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal); } finally { replay.close(); }
  console.log(JSON.stringify({ passed: true, commands, expectedRefusals, policy: 'resident-service-principals-v2', checks: ['compiled-authenticated-cli', 'explicit-old-manifest-activation', 'current-enterprise-control', 'manager-not-personal-provider', 'no-old-author-backdoor', 'active-provider-revocation-rejected', 'booking-not-body-consent', 'actual-provider-overlap', 'private-booking-visibility', 'external-directory-estate-guard', 'inactive-directory-independent-handover', 'exact-journal-replay'] }));
} finally {
  if (!closed) await server.close(); runtime.close(); rmSync(root, { recursive: true, force: true });
}
