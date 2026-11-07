import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyJournal, recoverOpenSocietyJournal } from './journal';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import type { OpenSocietyCommit } from './types';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
/** A town with a few commits; returns the raw journal lines as written. */
function town() {
  const root = mkdtempSync(join(tmpdir(), 'journal-history-'));
  roots.push(root);
  const m = createOpenSocietyManifest({ count: 2 });
  const r = new OpenSocietyRuntime(root, m);
  const a = m.residents[0]!.id;
  r.beginTurn(a);
  for (const id of ['n1', 'n2', 'n3'])
    expect(
      r.invoke(a, {
        name: 'spaces.create',
        arguments: { id, title: id, visibility: 'public', posting: 'everyone' },
        requestId: id,
      }).ok,
    ).toBe(true);
  expect(r.advanceTime(60_000, 'tick').ok).toBe(true);
  const path = join(root, 'journal.jsonl');
  const lines = () =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OpenSocietyCommit);
  return { root, r, a, path, lines };
}

test('history is read back from the file exactly as written, by range and after reopening', () => {
  const t = town();
  const written = t.lines();
  expect(t.r.journal.commitCount).toBe(written.length);
  expect(t.r.journal.commits).toEqual(written);
  expect(t.r.journal.readCommits(2, 2)).toEqual(written.slice(1, 3));
  expect(t.r.journal.readCommits(written.length, 10)).toEqual(written.slice(-1));
  expect(t.r.journal.readCommits(written.length + 1, 10)).toEqual([]);
  expect(t.r.journal.commitAt(3)).toEqual(written[2]);
  expect(t.r.journal.hashAt(3)).toBe(written[2]!.hash);
  expect(() => t.r.journal.readCommits(0, 1)).toThrow('journal-sequence-out-of-range');
  expect(() => t.r.journal.hashAt(written.length + 1)).toThrow('journal-sequence-out-of-range');
  // The request index keeps only what a retry needs.
  expect(t.r.journal.lookup(t.a, 'n2')).toEqual({
    fingerprint: written.find((c) => c.requestId === 'n2')!.fingerprint,
    result: written.find((c) => c.requestId === 'n2')!.result,
  });
  // New commits are readable at once and after reopening.
  t.r.beginTurn(t.a);
  t.r.invoke(t.a, {
    name: 'spaces.create',
    arguments: { id: 'n4', title: 'n4', visibility: 'public', posting: 'everyone' },
    requestId: 'n4',
  });
  const after = t.lines();
  expect(t.r.journal.commits).toEqual(after);
  t.r.close();
  const reopened = new OpenSocietyRuntime(t.root);
  try {
    expect(reopened.journal.commits).toEqual(after);
    expect(reopened.journal.commitAt(after.length)).toEqual(after.at(-1));
  } finally {
    reopened.close();
  }
});

test('a journal changed underneath the writer is detected instead of returning another commit', () => {
  const t = town();
  const original = readFileSync(t.path);
  const lines = original.toString('utf8').split('\n');
  // Same byte length, different content: swap two digits inside the second record's hash.
  const second = lines[1]!;
  const at = second.indexOf('"hash":"') + 8;
  lines[1] = second.slice(0, at) + (second[at] === '0' ? '1' : '0') + second.slice(at + 1);
  writeFileSync(t.path, lines.join('\n'));
  expect(() => t.r.journal.commitAt(2)).toThrow('journal-read-mismatch');
  writeFileSync(t.path, original);
  t.r.close();
});

test('offsets stay correct after recovering a journal whose last record lost its newline', () => {
  const t = town();
  const written = t.lines();
  t.r.close();
  // Drop only the final newline: the record is whole and recovery completes it.
  const bytes = readFileSync(t.path);
  writeFileSync(t.path, bytes.subarray(0, bytes.length - 1));
  expect(recoverOpenSocietyJournal(t.root).action).toBe('completed-record-newline');
  const journal = new OpenSocietyJournal(t.root);
  try {
    expect(journal.commits).toEqual(written);
    expect(journal.commitAt(written.length)).toEqual(written.at(-1));
  } finally {
    journal.close();
  }
  // A trailing blank line is tolerated as before and does not shift any record.
  appendFileSync(t.path, '\n');
  const again = new OpenSocietyJournal(t.root);
  try {
    expect(again.readCommits(1, written.length)).toEqual(written);
  } finally {
    again.close();
  }
});
