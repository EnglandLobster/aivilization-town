import { asAgentId } from '@aivilization/sim-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { publicEmploymentQuery } from './publicEmploymentQuery';
import type { PublicEmploymentTerms } from '@aivilization/society';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = false) {
  const root = mkdtempSync(join(tmpdir(), 'employment-policy-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    publicEmployment: enabled,
  });
  const r = new OpenSocietyRuntime(root, m);
  cleanup.push(() => r.close());
  let n = 0;
  const [a, b, c] = m.residents.map((x) => x.id) as [string, string, string];
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `employment-test-${++n}` });
    r.finishTurn(actor, { summary: 'Directed employment rule verification' });
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
test('paginated exact terms support independent public amendment; next policy is queryable, stale execution atomic, nonmonotonic quota does not break resident observations', () => {
  const t = fixture(true),
    w = t.r.state.world,
    terms: PublicEmploymentTerms = {
      ...w.publicEmployment!.revisions[0]!.terms,
      quotaByResidentialTier: [3, 2, 1],
      ranking: ['submitted'],
    };
  const rev = (id: string) => t.r.state.world.publicGovernance!.authority.proposals[id]!.revision;
  for (const id of ['reform', 'stale']) {
    t.ok(t.a, 'governance.propose', {
      id,
      text: 'Test an alternative admission institution',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action: { kind: 'set-employment', expectedRevision: 1, terms },
    });
    t.ok(t.a, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
    t.ok(t.b, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
  }
  expect(t.r.advanceTime(60000, 'voting-deadline').ok).toBe(true);
  for (const id of ['reform', 'stale'])
    t.ok(t.c, 'governance.close', { id, expectedRevision: rev(id) });
  t.ok(t.c, 'governance.execute', { id: 'reform', expectedRevision: rev('reform') });
  expect(t.ok(t.a, 'governance.employment', { revision: 2 })).toMatchObject({
    activeRevision: 1,
    nextCycleRevision: 2,
    latestRevision: 2,
    terms: { quotaByResidentialTier: [3, 2, 1] },
    source: { proposalId: 'reform', actorId: t.c },
  });
  expect(
    t.call(t.c, 'governance.execute', { id: 'stale', expectedRevision: rev('stale') }).error,
  ).toBe('public-employment-revision-conflict');
  expect(t.r.state.world.publicGovernance!.authority.proposals.stale!.status).toBe('approved');
  const remaining = w.publicEmployment!.cycleDurationMs - t.r.state.world.clock.now;
  expect(t.r.advanceTime(remaining, 'new-cycle').ok).toBe(true);
  expect(t.ok(t.a, 'governance.employment')).toMatchObject({
    activeRevision: 2,
    ownApplications: { allowed: 3 },
  });
  t.ok(t.a, 'world.observe', { view: 'rules' });
  t.r.context(t.a);
  t.replay();
});
test('public action cannot fabricate qualifications, expand jurisdiction, mutate one missing occupation, or apply arbitrary ranking code', () => {
  const t = fixture(true),
    terms = t.r.state.world.publicEmployment!.revisions[0]!.terms;
  for (const invalid of [
    { ...terms, occupations: terms.occupations.slice(1) },
    { ...terms, qualification: 5 },
    { ...terms, ranking: ['llm-score'] },
    { ...terms, occupations: terms.occupations.map((o) => ({ ...o, authority: 'self' })) },
  ]) {
    expect(
      t.call(t.a, 'governance.propose', {
        id: 'invalid',
        text: 'invalid',
        expectedProcedureRevision: 1,
        closesAt: 60000,
        action: { kind: 'set-employment', expectedRevision: 1, terms: invalid },
      }).ok,
    ).toBe(false);
  }
  expect(t.r.state.world.publicEmployment!.revisions).toHaveLength(1);
  expect(t.r.state.world.publicGovernance!.authority.proposals).toEqual({});
  t.replay();
});

test('own application history preserves recorded outcomes, stable pages and old missing fields without exposing another resident', () => {
  const t = fixture(true);
  const base = {
    cycleNumber: 0,
    residentialTier: 1,
    educationScore: 0,
    submittedAt: 100,
    occupationName: 'Cleaner',
  };
  const world = {
    ...t.r.state.world,
    jobApplications: [
      { ...base, applicationId: 'z', agentId: asAgentId(t.a), status: 'pending' as const },
      { ...base, applicationId: 'private-other', agentId: asAgentId(t.b), status: 'pending' as const },
      { ...base, applicationId: 'a', agentId: asAgentId(t.a), status: 'accepted' as const, resolvedAt: 200 },
      {
        ...base,
        submittedAt: 50,
        applicationId: 'old',
        agentId: asAgentId(t.a),
        status: 'rejected' as const,
        resolutionReason: 'recorded reason',
      },
    ],
  };
  const before = structuredClone(world);
  const page = (offset: number) =>
    publicEmploymentQuery(world, t.a, { section: 'applications', offset, limit: 1 });
  expect(page(0).applications).toMatchObject({
    total: 3,
    nextOffset: 1,
    items: [{ applicationId: 'a', status: 'accepted', resolvedAt: 200 }],
  });
  expect(page(1).applications?.items[0]?.applicationId).toBe('z');
  expect(page(2).applications).toMatchObject({
    nextOffset: null,
    items: [{ applicationId: 'old', status: 'rejected', resolutionReason: 'recorded reason' }],
  });
  expect(page(2).applications?.items[0]).not.toHaveProperty('publicEmploymentRevision');
  expect(page(3).applications?.items).toEqual([]);
  expect(JSON.stringify(page(0))).not.toContain('private-other');
  expect(world).toEqual(before);
  expect(() => publicEmploymentQuery(world, t.a, { section: 'applications', revision: 1 })).toThrow(
    'employment-applications-not-policy-revision',
  );
});

test('authenticated application query remains bounded, empty when no records, rejects invalid sections and replays without world effects', () => {
  const t = fixture(true),
    before = structuredClone(t.r.state.world);
  expect(t.ok(t.a, 'governance.employment')).toMatchObject({
    applicationsWith: 'town governance employment --section applications',
  });
  expect(t.ok(t.a, 'governance.employment', { section: 'applications', limit: 1 })).toMatchObject({
    applications: { total: 0, items: [], nextOffset: null },
  });
  expect(t.call(t.a, 'governance.employment', { section: 'applications', revision: 1 }).error).toBe(
    'employment-applications-not-policy-revision',
  );
  expect(t.call(t.a, 'governance.employment', { section: 'other' }).ok).toBe(false);
  expect(t.r.state.world).toEqual(before);
  t.replay();
});
