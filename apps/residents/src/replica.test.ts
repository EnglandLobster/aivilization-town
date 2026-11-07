import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  createIntegratedSocietyManifest,
  OpenSocietyRuntime,
  SocietyCommitReplica,
} from '@aivilization/worker';
import { loadResidentCredentials } from './credentials';
import { startResidentServer } from './server';
import { syncSocietyReplica } from './replica';

test('trusted HTTP replication preserves complete private and money facts; residents cannot read the feed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'society-feed-'));
  const manifest = createIntegratedSocietyManifest({ count: 2 });
  const source = new OpenSocietyRuntime(join(root, 'authority'), manifest);
  const actor = manifest.residents[0]!.id;
  source.beginTurn(actor);
  for (const [name, args, id] of [
    [
      'spaces.create',
      { id: 'secret', title: '个人', visibility: 'private', posting: 'owner' },
      'space',
    ],
    ['files.create', { spaceId: 'secret', path: 'record.md', content: '本人原文' }, 'file'],
    ['world.deposit', { amount: 9 }, 'deposit'],
  ] as const)
    expect(source.invoke(actor, { name, arguments: args, requestId: id }).ok).toBe(true);
  const credentials = loadResidentCredentials(
    join(root, 'authority'),
    manifest.residents.map((r) => r.id),
  );
  const server = await startResidentServer(source, credentials);
  try {
    for (const path of [
      '/admin/replication/manifest',
      '/admin/replication/commits?sequence=0&hash=x',
    ]) {
      expect(
        (
          await fetch(server.url + path, {
            headers: { authorization: `Bearer ${credentials.residents[actor]}` },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(server.url + path)).status).toBe(401);
    }
    const replicaRoot = join(root, 'replica');
    const input = { root: replicaRoot, endpoint: server.url, token: credentials.admin };
    const first = await syncSocietyReplica({ ...input, maxPages: 1 });
    expect(first.status).toBe('page-budget');
    const bytes = readFileSync(join(replicaRoot, 'journal.jsonl'));
    expect((await syncSocietyReplica(input)).status).toBe('caught-up');
    expect(readFileSync(join(replicaRoot, 'journal.jsonl'))).toEqual(bytes);
    source.advanceTime(60000, 'clock');
    expect((await syncSocietyReplica(input)).status).toBe('caught-up');
    const replica = new SocietyCommitReplica(replicaRoot);
    try {
      expect(replica.state).toEqual(source.state);
    } finally {
      replica.close();
    }
    expect(() => new OpenSocietyRuntime(replicaRoot)).toThrow('replica-cannot-own-authority');
  } finally {
    await server.close();
    source.close();
    rmSync(root, { recursive: true, force: true });
  }
});
