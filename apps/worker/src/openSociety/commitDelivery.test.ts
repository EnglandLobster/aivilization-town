import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createIntegratedSocietyManifest } from './runProfile';
import { OpenSocietyJournal, digest, recoverOpenSocietyJournal } from './journal';
import { SocietyCommitReplica, readSocietyCommitPage } from './commitDelivery';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'society-delivery-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function fixture() {
  const manifest = createIntegratedSocietyManifest({ count: 2 });
  const source = new OpenSocietyRuntime(directory(), manifest);
  cleanup.push(() => source.close());
  const actor = manifest.residents[0]!.id;
  source.beginTurn(actor);
  for (const [name, args, requestId] of [
    [
      'spaces.create',
      { id: 'private-notes', title: '本人原文', visibility: 'private', posting: 'owner' },
      'space',
    ],
    [
      'files.create',
      { spaceId: 'private-notes', path: 'note.md', content: '同意必须本人表达' },
      'file',
    ],
    ['world.deposit', { amount: 7 }, 'deposit'],
  ] as const) {
    const result = source.invoke(actor, { name, arguments: args, requestId });
    expect(result.ok, result.error).toBe(true);
  }
  const other = manifest.residents[1]!.id;
  const proposal = source.invoke(actor, {
    name: 'collectives.create',
    requestId: 'charter',
    arguments: {
      id: 'club',
      configuration: {
        title: '自主章程',
        terms: '两人独立同意',
        members: [actor, other],
        voters: [actor, other],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: 10000,
    },
  });
  expect(proposal.ok, proposal.error).toBe(true);
  source.finishTurn(actor, { summary: 'Engineering collective proposal' });
  source.beginTurn(other);
  const consent = source.invoke(other, {
    name: 'collectives.respond',
    requestId: 'consent',
    arguments: { id: 'club', expectedRevision: 1, accept: true },
  });
  expect(consent.ok, consent.error).toBe(true);
  source.finishTurn(other, { summary: 'Independent consent verification' });
  const root = directory();
  const replica = new SocietyCommitReplica(root, manifest);
  cleanup.push(() => replica.close());
  return { manifest, source, replica, root, actor };
}
test('complete society state is durably delivered, retried, resumed and extended without a second decision', () => {
  const t = fixture();
  const first = readSocietyCommitPage(t.source.journal, t.replica.cursor, 2);
  t.replica.receive(first);
  const prefix = readFileSync(join(t.root, 'journal.jsonl'));
  t.replica.receive(first);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(prefix);
  t.replica.close();
  const resumed = new SocietyCommitReplica(t.root);
  cleanup.push(() => resumed.close());
  while (resumed.cursor.sequence < t.source.state.revision)
    resumed.receive(readSocietyCommitPage(t.source.journal, resumed.cursor, 2));
  expect(resumed.state).toEqual(t.source.state);
  expect(resumed.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 7);
  expect(resumed.state.world.moneySupply).toBe(t.manifest.initialWorld.moneySupply);
  expect(resumed.state.information.spaces['private-notes']).toBeDefined();
  expect(resumed.state.collectives!.charters['club']).toEqual(
    t.source.state.collectives!.charters['club'],
  );
  expect(resumed.state.collectives!.charters['club']).toBeDefined();
  const old = readSocietyCommitPage(
    t.source.journal,
    { sequence: 0, hash: digest(t.manifest) },
    64,
  );
  t.source.advanceTime(60000, 'advance');
  resumed.receive(old);
  resumed.receive(readSocietyCommitPage(t.source.journal, resumed.cursor));
  expect(resumed.state).toEqual(t.source.state);
});
test('wrong world, tampering, broken framing and ahead cursor refuse before any commit', () => {
  const t = fixture();
  const page = readSocietyCommitPage(t.source.journal, t.replica.cursor);
  expect(() => t.replica.receive({ ...page, manifestHash: 'other' })).toThrow('world-mismatch');
  expect(() => t.replica.receive({ ...page, next: { ...page.next, hash: 'wrong' } })).toThrow(
    'next-cursor',
  );
  expect(() =>
    t.replica.receive({
      ...page,
      records: [{ ...page.records[0]!, actorId: 'forged' }, ...page.records.slice(1)],
    }),
  ).toThrow('journal-hash');
  expect(() => t.replica.receive({ ...page, records: page.records.slice(1) })).toThrow(
    'delivery-chain',
  );
  expect(() => readSocietyCommitPage(t.source.journal, { sequence: 999, hash: 'missing' })).toThrow(
    'cursor',
  );
  expect(() => readSocietyCommitPage(t.source.journal, t.replica.cursor, 65)).toThrow('limit');
  expect(t.replica.cursor.sequence).toBe(0);
});
test('replica role prevents Runtime promotion and authority conversion, including after recovery', () => {
  const t = fixture();
  t.replica.receive(readSocietyCommitPage(t.source.journal, t.replica.cursor));
  t.replica.close();
  expect(() => new OpenSocietyRuntime(t.root)).toThrow('replica-cannot-own-authority');
  const journal = new OpenSocietyJournal(t.root, undefined, { replica: true });
  cleanup.push(() => journal.close());
  expect(() =>
    journal.commit({
      actorId: t.actor,
      requestId: 'bad',
      fingerprint: 'bad',
      capability: 'fake',
      result: { ok: true, revision: 0, simulationTime: 0 },
      effects: {},
    }),
  ).toThrow('replica-cannot-decide');
  journal.close();
  appendFileSync(join(t.root, 'journal.jsonl'), '{"unfinished":');
  expect(() => new SocietyCommitReplica(t.root)).toThrow('truncated');
  expect(recoverOpenSocietyJournal(t.root).action).toBe('removed-incomplete-tail');
  const restored = new SocietyCommitReplica(t.root);
  cleanup.push(() => restored.close());
  expect(restored.state).toEqual(t.source.state);
  restored.close();
  expect(() => new OpenSocietyRuntime(t.root)).toThrow('replica-cannot-own-authority');
  expect(() => t.source.journal.receive(t.source.journal.commits[0]!)).toThrow(
    'authority-cannot-receive-replica-record',
  );
  const authorityRoot = t.source.journal.rootDir;
  t.source.close();
  expect(() => new SocietyCommitReplica(authorityRoot)).toThrow('authority-cannot-become-replica');
});
test('received object mutation cannot rewrite a durable replica or authority feed', () => {
  const t = fixture();
  const page = readSocietyCommitPage(t.source.journal, t.replica.cursor);
  t.replica.receive(page);
  const state = structuredClone(t.replica.state);
  Object.assign(page.records[0]!, { hash: 'changed' });
  expect(t.replica.state).toEqual(state);
  t.replica.receive(
    readSocietyCommitPage(t.source.journal, { sequence: 0, hash: digest(t.manifest) }),
  );
  expect(
    readSocietyCommitPage(t.source.journal, { sequence: 0, hash: digest(t.manifest) }).records[0]!
      .hash,
  ).not.toBe('changed');
  t.replica.close();
  const r = new SocietyCommitReplica(t.root);
  cleanup.push(() => r.close());
  expect(r.state).toEqual(state);
});

test('failure after a durable prefix resumes from that prefix and never acknowledges a duplicate request', () => {
  const t = fixture();
  const page = readSocietyCommitPage(t.source.journal, t.replica.cursor, 2);
  const first = page.records[0]!;
  const { hash, ...body } = page.records[1]!;
  const altered = { ...body, actorId: first.actorId, requestId: first.requestId };
  const second = { ...altered, hash: digest(altered) };
  expect(second.hash).not.toBe(hash);
  expect(() =>
    t.replica.receive({
      ...page,
      records: [first, second],
      next: { sequence: second.sequence, hash: second.hash },
    }),
  ).toThrow('duplicate-journal-request');
  expect(t.replica.cursor).toEqual({ sequence: first.sequence, hash: first.hash });
  t.replica.close();
  const resumed = new SocietyCommitReplica(t.root);
  cleanup.push(() => resumed.close());
  expect(resumed.cursor.sequence).toBe(1);
  resumed.receive(page);
  resumed.receive(readSocietyCommitPage(t.source.journal, resumed.cursor));
  expect(resumed.state).toEqual(t.source.state);
});
