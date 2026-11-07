import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(seedProcurement = false) {
  const root = mkdtempSync(join(tmpdir(), 'public-procurement-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 4,
    continuity: true,
    publicGovernance: true,
    publicProcurement: seedProcurement,
  });
  const [a, b, c, d] = m.residents.map((r) => r.id) as [string, string, string, string];
  const initialWorld = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, agent]) => [
        id,
        {
          ...agent,
          locationId: m.initialWorld.agents[a]!.locationId!,
          physiology: { energy: 100, satiety: 100, health: 50 },
          job: null,
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld,
    worldPolicies: serializableWorldPolicy(m.seed, initialWorld, m.rhythm),
  });
  cleanup.push(() => r.close());
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `procurement-${++n}` });
    r.finishTurn(actor, { summary: 'Explicit engineering procurement test' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result.data;
  };
  const terms = {
    id: 'svc',
    controllerKind: 'resident',
    controllerId: a,
    title: 'Original public assistance',
    terms: 'Public financial terms, voluntary time.',
    locationId: initialWorld.agents[a]!.locationId,
    providerId: a,
    recipientId: b,
    payerSector: 'treasury',
    payerId: 'public-treasury',
    revenueSector: 'agent',
    revenueId: a,
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  };
  const revision = () => r.state.world.publicGovernance!.authority.proposals.p!.revision;
  const time = (ms: number) => expect(r.advanceTime(ms, `time-${++n}`).ok).toBe(true);
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, d, call, ok, terms, revision, time, replay };
}

test('procurement upgrade preserves manifest, old private visibility and repeat activation; new seed explicitly records its provenance', () => {
  const t = fixture();
  const bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.a, 'engagements.offer', t.terms).ok).toBe(false);
  const oldGrant = structuredClone(t.r.state.world.publicGovernance!.authority.grant);
  expect(t.r.enablePublicProcurement().ok).toBe(true);
  const count = t.r.journal.commits.length;
  expect(t.r.enablePublicProcurement().ok).toBe(true);
  expect(t.r.journal.commits.length).toBe(count);
  expect(t.r.state.world.publicGovernance!.authority.grant.source).toEqual(oldGrant.source);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.ok(t.a, 'engagements.offer', { ...t.terms, id: 'private', payerSector: 'agent', payerId: t.a });
  expect(t.call(t.d, 'engagements.read', { id: 'private' }).ok).toBe(false);
  t.replay();
  const seeded = fixture(true);
  expect(seeded.r.manifest.provenance.publicProcurement).toBe('resident-public-procurement-v1');
  expect(seeded.r.state.world.governance?.publicBudget?.allocations).toEqual([]);
  seeded.replay();
});

test('resident tools expose public terms and actual financial evidence without exposing other participants bodily state', () => {
  const t = fixture(true);
  t.ok(t.a, 'engagements.offer', t.terms);
  const terms = t.ok(t.d, 'engagements.read', { id: 'svc' });
  expect(terms).toMatchObject({ payer: { sector: 'treasury' }, maximumCharge: 36 });
  expect(t.call(t.a, 'engagements.accept', { id: 'svc', expectedRevision: 1 }).ok).toBe(false);
  t.ok(t.b, 'engagements.accept', { id: 'svc', expectedRevision: 1 });
  expect(t.call(t.a, 'engagements.fund', { id: 'svc', expectedRevision: 2 }).error).toBe(
    'service-payer-authority-required',
  );
  t.ok(t.c, 'governance.propose', {
    id: 'p',
    text: '选择公开服务合同',
    action: { kind: 'fund-service', engagementId: 'svc', expectedRevision: 2, maximumCharge: 36 },
    closesAt: 60000,
    expectedProcedureRevision: 1,
  });
  for (const actor of [t.a, t.b, t.c])
    t.ok(actor, 'governance.vote', { id: 'p', expectedRevision: t.revision(), choice: 'yes' });
  t.time(60000);
  t.ok(t.d, 'governance.close', { id: 'p', expectedRevision: t.revision() });
  const treasury = t.r.state.world.treasury!;
  const supply = t.r.state.world.moneySupply;
  t.ok(t.c, 'governance.execute', { id: 'p', expectedRevision: t.revision() });
  expect(t.r.state.world.treasury).toBeCloseTo(treasury - 36, 8);
  for (const actor of [t.a, t.b])
    t.ok(actor, 'engagements.start', {
      id: 'svc',
      expectedRevision: t.r.state.world.serviceEngagements!.engagements.svc!.revision,
      until: 3660000,
    });
  t.time(600000);
  const ledger = t.ok(t.d, 'engagements.ledger', { id: 'svc', limit: 1 });
  expect(JSON.stringify(ledger)).toContain('charge');
  expect(JSON.stringify(ledger)).not.toMatch(
    /providerBefore|recipientBefore|ownBefore|educationScore|health|satiety|energy/,
  );
  expect(JSON.stringify(t.ok(t.b, 'engagements.ledger', { id: 'svc', limit: 1 }))).toContain(
    'ownBefore',
  );
  t.ok(t.b, 'engagements.leave', {
    id: 'svc',
    expectedRevision: t.r.state.world.serviceEngagements!.engagements.svc!.revision,
  });
  expect(t.r.state.world.serviceEngagements!.engagements.svc).toMatchObject({
    charged: 6,
    refunded: 30,
    status: 'ended',
  });
  expect(t.r.state.world.moneySupply).toBe(supply);
  expect(t.ok(t.d, 'governance.status')).toMatchObject({
    procurement: { abstractBudget: 'disabled', policy: { source: 'explicit-scenario-extension' } },
  });
  const events = t.r.journal.commits.flatMap((c) => c.worldEvents ?? []);
  expect(events.some((e) => e.type === 'PublicBudgetSpent')).toBe(false);
  t.replay();
});
