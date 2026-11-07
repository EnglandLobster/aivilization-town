import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import type { publicHousingQuery } from './publicHousingQuery';
import type { PublicHousingTerms } from '@aivilization/society';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = false, atHome = false) {
  const root = mkdtempSync(join(tmpdir(), 'housing-policy-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    housingChoice: true,
    publicHousing: enabled,
  });
  const r = new OpenSocietyRuntime(
    root,
    atHome
      ? {
          ...m,
          initialWorld: {
            ...m.initialWorld,
            agents: Object.fromEntries(
              Object.entries(m.initialWorld.agents).map(([id, agent]) => [
                id,
                { ...agent, locationId: agent.residenceLocationId ?? null },
              ]),
            ),
          },
        }
      : m,
  );
  cleanup.push(() => r.close());
  let n = 0;
  const [a, b, c] = m.residents.map((x) => x.id) as [string, string, string];
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `housing-test-${++n}` });
    r.finishTurn(actor, { summary: 'Directed housing rule verification' });
    return d;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}: ${d.error}`).toBe(true);
    return d.data;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    return next;
  };
  return { r, root, a, b, c, call, ok, replay };
}
test('explicit housing extension preserves original manifest and all resident facts, gives paged rules with bounded context and replays', () => {
  const t = fixture(),
    bytes = readFileSync(join(t.root, 'manifest.json')),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'governance.housing').error).toBe('public-housing-not-enabled');
  const activation = t.r.enablePublicHousing();
  expect(activation.ok).toBe(true);
  expect(t.r.enablePublicHousing()).toEqual(activation);
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.r.state.world.locations).toEqual(before.locations);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.publicGovernance!.authority.proposals).toEqual({});
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  const read = t.ok(t.a, 'governance.housing', { limit: 1 }) as ReturnType<
    typeof publicHousingQuery
  >;
  expect(read).toMatchObject({
    activeRevision: 1,
    latestRevision: 1,
    source: { kind: 'inherited-scenario' },
    standards: { nextOffset: 1 },
  });
  expect(read.standards.items).toHaveLength(1);
  expect(t.r.context(t.a).publicGovernance).toMatchObject({
    housingRulesWith: 'town governance housing',
  });
  expect(JSON.stringify(t.r.context(t.a).publicGovernance)).not.toContain('upkeepPerHour');
  expect(t.ok(t.a, 'rules.capability', { name: 'governance.housing' })).toMatchObject({
    availability: { adapterEnabled: true },
  });
  expect(t.replay().enablePublicHousing()).toEqual(activation);
});
test('independent public execution changes actual resident price observations, retains history and rejects stale enactment', () => {
  const t = fixture(true),
    old = t.r.state.world.publicHousing!.revisions[0]!.terms,
    terms: PublicHousingTerms = {
      ...old,
      landValueCoefficientPerHour: 0,
      standards: old.standards.map((s) => ({ ...s, upkeepPerHour: 1 })),
    };
  const rev = (id: string) => t.r.state.world.publicGovernance!.authority.proposals[id]!.revision;
  for (const id of ['reform', 'stale']) {
    t.ok(t.a, 'governance.propose', {
      id,
      text: 'Alternative housing tariff',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action: { kind: 'set-housing', expectedRevision: 1, terms },
    });
    t.ok(t.a, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
    t.ok(t.b, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
  }
  expect(t.r.advanceTime(60000, 'deadline').ok).toBe(true);
  for (const id of ['reform', 'stale'])
    t.ok(t.c, 'governance.close', { id, expectedRevision: rev(id) });
  const before = structuredClone(t.r.state.world);
  t.ok(t.c, 'governance.execute', { id: 'reform', expectedRevision: rev('reform') });
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.ok(t.a, 'governance.housing')).toMatchObject({
    activeRevision: 2,
    revision: 2,
    source: { proposalId: 'reform', actorId: t.c },
  });
  expect(t.ok(t.a, 'governance.housing', { revision: 1 })).toMatchObject({
    revision: 1,
    source: { kind: 'inherited-scenario' },
  });
  expect(t.ok(t.a, 'housing.standard')).toMatchObject({
    currentUpkeepRatePerHour: 1,
    upkeepSource: 'resident-public-housing-v1',
  });
  expect(
    t.call(t.c, 'governance.execute', { id: 'stale', expectedRevision: rev('stale') }).error,
  ).toBe('public-housing-revision-conflict');
  expect(t.r.state.world.publicGovernance!.authority.proposals.stale!.status).toBe('approved');
  expect(t.r.advanceTime(3600000, 'future-prices').ok).toBe(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBeCloseTo(before.agents[t.a]!.balance - 1, 6);
  t.replay();
});
test('public tariffs reject private-rent, body, invented currency and debt-erasure payloads and never invent authority', () => {
  const t = fixture(true),
    terms = t.r.state.world.publicHousing!.revisions[0]!.terms;
  for (const bad of [
    { ...terms, privateRent: 0 },
    { ...terms, upkeepArrears: 0 },
    { ...terms, body: { health: 100 } },
    { ...terms, landValueCoefficientPerHour: -1 },
    { ...terms, standards: terms.standards.map((s) => ({ ...s, authority: 'self' })) },
  ])
    expect(
      t.call(t.a, 'governance.propose', {
        id: 'invalid',
        text: 'invalid',
        expectedProcedureRevision: 1,
        closesAt: 60000,
        action: { kind: 'set-housing', expectedRevision: 1, terms: bad },
      }).ok,
    ).toBe(false);
  expect(t.call(t.a, 'governance.housing', { revision: 999 }).error).toBe(
    'public-housing-revision-not-found',
  );
  expect(t.r.state.world.publicGovernance!.authority.proposals).toEqual({});
  t.replay();
  expect(() =>
    createOpenSocietyManifest({
      count: 3,
      continuity: true,
      publicGovernance: true,
      publicHousing: true,
    }),
  ).toThrow('public-housing-requires-public-authority-choice-and-policy');
});

test('public fee amendments cannot rewrite an actual private lease, deposit or its independently agreed future rent', () => {
  const t = fixture(true, true);
  t.ok(t.a, 'leases.offer', {
    id: 'private',
    tenantId: t.b,
    locationId: 'residential-block',
    terms: 'Independent rent',
    rent: 2,
    deposit: 5,
    expiresAt: 3 * 86400000,
  });
  t.ok(t.b, 'leases.accept', { id: 'private', expectedRevision: 1 });
  const old = t.r.state.world.publicHousing!.revisions[0]!.terms,
    terms = {
      ...old,
      landValueCoefficientPerHour: 0,
      standards: old.standards.map((s) => ({ ...s, upkeepPerHour: 0 })),
    };
  const rev = () => t.r.state.world.publicGovernance!.authority.proposals.free!.revision;
  t.ok(t.a, 'governance.propose', {
    id: 'free',
    text: 'Free initial public service',
    expectedProcedureRevision: 1,
    closesAt: 60000,
    action: { kind: 'set-housing', expectedRevision: 1, terms },
  });
  for (const actor of [t.a, t.b])
    t.ok(actor, 'governance.vote', { id: 'free', choice: 'yes', expectedRevision: rev() });
  expect(t.r.advanceTime(60000, 'deadline').ok).toBe(true);
  t.ok(t.c, 'governance.close', { id: 'free', expectedRevision: rev() });
  const before = structuredClone(t.r.state.world);
  t.ok(t.c, 'governance.execute', { id: 'free', expectedRevision: rev() });
  expect(t.r.state.world.residentLeases).toEqual(before.residentLeases);
  expect(t.r.state.world.residentCommerce).toEqual(before.residentCommerce);
  expect(t.r.advanceTime(86400000 - 60000, 'private-rent-due').ok).toBe(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBeCloseTo(before.agents[t.a]!.balance + 2, 8);
  expect(t.r.state.world.agents[t.b]!.balance).toBeCloseTo(before.agents[t.b]!.balance - 2, 8);
  expect(t.r.state.world.residentLeases!.leases.private).toMatchObject({
    rent: 2,
    deposit: 5,
    status: 'active',
  });
  expect(t.r.state.world.moneySupply).toBeCloseTo(before.moneySupply, 8);
  t.replay();
});
