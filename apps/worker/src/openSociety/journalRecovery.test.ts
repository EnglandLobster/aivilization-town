import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { OpenSocietyJournal, recoverOpenSocietyJournal } from './journal';
import { digest } from './jsonCommitments';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'society-recovery-'));
  roots.push(root);
  const m = createOpenSocietyManifest({ count: 2 });
  const r = new OpenSocietyRuntime(root, m),
    a = m.residents[0]!.id;
  r.beginTurn(a);
  const call = (name: string, args: Record<string, unknown>, requestId: string) =>
    r.invoke(a, { name, arguments: args, requestId });
  expect(
    call(
      'spaces.create',
      { id: 'notes', title: '原文', visibility: 'public', posting: 'everyone' },
      'space',
    ).ok,
  ).toBe(true);
  expect(
    call(
      'files.create',
      { spaceId: 'notes', path: 'story.md', content: '中文原文，不是扣款权' },
      'file',
    ).ok,
  ).toBe(true);
  const request = { name: 'world.deposit', arguments: { amount: 7 }, requestId: 'deposit' };
  const receipt = r.invoke(a, request);
  expect(receipt.ok).toBe(true);
  const state = structuredClone(r.state),
    journal = join(root, 'journal.jsonl');
  const bytes = readFileSync(journal),
    manifestBytes = readFileSync(join(root, 'manifest.json'));
  r.close();
  return { root, a, request, receipt, state, journal, bytes, manifestBytes };
}
test('explicit recovery preserves raw partial UTF8 tail, restores all society state, and retry cannot pay twice', () => {
  const t = fixture();
  const tail = Buffer.concat([
    Buffer.from('{"informationEvents":["'),
    Buffer.from('汉').subarray(0, 2),
  ]);
  appendFileSync(t.journal, tail);
  const damaged = readFileSync(t.journal);
  expect(() => new OpenSocietyRuntime(t.root)).toThrow('truncated-open-society-journal');
  const report = recoverOpenSocietyJournal(t.root);
  expect(report.action).toBe('removed-incomplete-tail');
  expect(report.throughRevision).toBe(t.state.revision);
  expect(readFileSync(report.backupPath!)).toEqual(damaged);
  expect(readFileSync(t.journal)).toEqual(t.bytes);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(t.manifestBytes);
  const r = new OpenSocietyRuntime(t.root);
  try {
    expect(r.state).toEqual(t.state);
    expect(r.invoke(t.a, t.request)).toEqual(t.receipt);
    expect(r.state).toEqual(t.state);
    expect(readFileSync(t.journal)).toEqual(t.bytes);
  } finally {
    r.close();
  }
  expect(recoverOpenSocietyJournal(t.root).action).toBe('unchanged');
  expect(readdirSync(t.root).filter((n) => n.endsWith('.original'))).toHaveLength(1);
});
test('complete final record missing delimiter is validated and retained, not treated as discarded labor or payment', () => {
  const t = fixture();
  writeFileSync(t.journal, t.bytes.subarray(0, -1));
  expect(recoverOpenSocietyJournal(t.root).action).toBe('completed-record-newline');
  expect(readFileSync(t.journal)).toEqual(t.bytes);
  const r = new OpenSocietyRuntime(t.root);
  try {
    expect(r.state).toEqual(t.state);
  } finally {
    r.close();
  }
});
test('a corrupt complete line before a partial tail refuses recovery without changing any evidence', () => {
  const t = fixture();
  const bad = Buffer.from(t.bytes.toString().replace('中文原文', '被改原文') + '{');
  writeFileSync(t.journal, bad);
  expect(() => recoverOpenSocietyJournal(t.root)).toThrow('invalid-open-society-journal-hash');
  expect(readFileSync(t.journal)).toEqual(bad);
  expect(readdirSync(t.root).filter((n) => n.startsWith('journal-recovery-'))).toEqual([]);
});
test('complete malformed hash at EOF is corruption, not permission to delete an event', () => {
  const t = fixture();
  const lines = t.bytes.toString().trimEnd().split('\n');
  const record = JSON.parse(lines.pop()!) as Record<string, unknown>;
  record.hash = 'wrong';
  const bad = Buffer.from(lines.join('\n') + '\n' + JSON.stringify(record));
  writeFileSync(t.journal, bad);
  expect(() => recoverOpenSocietyJournal(t.root)).toThrow('invalid-open-society-journal-hash');
  expect(readFileSync(t.journal)).toEqual(bad);
});
test('recovery cannot race a live writer and clean journal recovery is byte-for-byte inert', () => {
  const t = fixture(),
    r = new OpenSocietyRuntime(t.root);
  try {
    expect(() => recoverOpenSocietyJournal(t.root)).toThrow('writer-already-running');
  } finally {
    r.close();
  }
  expect(recoverOpenSocietyJournal(t.root)).toMatchObject({
    action: 'unchanged',
    throughRevision: t.state.revision,
  });
  expect(readFileSync(t.journal)).toEqual(t.bytes);
});
test('valid hashes cannot hide a sequence gap in the retained prefix', () => {
  const t = fixture();
  const lines = t.bytes.toString().trimEnd().split('\n');
  const record = JSON.parse(lines.pop()!) as Record<string, unknown>;
  delete record.hash;
  record.sequence = Number(record.sequence) + 1;
  const bad = Buffer.from(
    lines.join('\n') + '\n' + JSON.stringify({ ...record, hash: digest(record) }) + '\n{',
  );
  writeFileSync(t.journal, bad);
  expect(() => recoverOpenSocietyJournal(t.root)).toThrow('journal-sequence-gap');
  expect(readFileSync(t.journal)).toEqual(bad);
});

test('initialized empty worlds need no fabricated commit or recovery artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'society-empty-recovery-'));
  roots.push(root);
  const r = new OpenSocietyJournal(root, createOpenSocietyManifest({ count: 1 }));
  r.close();
  expect(recoverOpenSocietyJournal(root)).toMatchObject({
    action: 'unchanged',
    throughRevision: 0,
    originalBytes: 0,
  });
  expect(readdirSync(root)).toEqual(['manifest.json']);
});
