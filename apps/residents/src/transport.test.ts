import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials } from './credentials';
import { startResidentServer, record } from './server';
import { runResidentCli } from './residentCli';
import { openCodeResidentConfig } from './openCode';
import { verifyResidentChain } from './report';

function responseData(text: string): Record<string, unknown> {
  return record(record(JSON.parse(text) as unknown).data);
}
function responseItems(text: string): unknown[] {
  const items = responseData(text).items;
  if (!Array.isArray(items)) throw new Error('expected-items');
  return items as unknown[];
}
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'town-transport-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 2 }));
  cleanup.push(() => runtime.close());
  const [a, b] = runtime.manifest.residents.map((resident) => resident.id) as [string, string];
  const credentials = loadResidentCredentials(root, [a, b]);
  const server = await startResidentServer(runtime, credentials);
  cleanup.push(server.close);
  const connection = { endpoint: server.url, token: credentials.residents[a]! };
  return { root, runtime, a, b, credentials, server, connection };
}
test('HTTP binds identity and blocks administrator access and injected actors', async () => {
  const { runtime, a, b, credentials, server } = await setup();
  expect((await fetch(`${server.url}/context`)).status).toBe(401);
  const headers = {
    authorization: `Bearer ${credentials.residents[a]!}`,
    'content-type': 'application/json',
  };
  expect((await fetch(`${server.url}/admin/report`, { headers })).status).toBe(403);
  const context: unknown = await (await fetch(`${server.url}/context`, { headers })).json();
  expect(context).toMatchObject({ identity: { id: a } });
  runtime.beginTurn(a);
  expect(
    (
      await fetch(`${server.url}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actorId: b,
          name: 'world.observe',
          arguments: { view: 'self' },
          requestId: 'inject',
        }),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(`${server.url}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'world.observe',
          arguments: { view: 'self' },
          requestId: 'observe',
        }),
      })
    ).status,
  ).toBe(200);
  expect(runtime.journal.commits.at(-1)?.actorId).toBe(a);
  expect(
    (
      await fetch(`${server.url}/admin/report`, {
        headers: { authorization: `Bearer ${credentials.admin}` },
      })
    ).status,
  ).toBe(200);
});
test('CLI executes authoritative movement and preserves identical retries', async () => {
  const { runtime, a, connection } = await setup();
  runtime.beginTurn(a);
  const args = ['travel', 'go', '--target-location-id', 'restaurant', '--request-id', 'cli-move'];
  const first = await runResidentCli(args, connection);
  expect(first.exitCode).toBe(0);
  expect(runtime.state.world.transitByAgent?.[a]).toBeDefined();
  const revision = runtime.state.revision;
  expect(await runResidentCli(args, connection)).toEqual(first);
  expect(runtime.state.revision).toBe(revision);
  const changed = await runResidentCli(
    ['travel', 'go', '--target-location-id', 'school', '--request-id', 'cli-move'],
    connection,
  );
  expect(changed.exitCode).not.toBe(0);
  expect(runtime.state.revision).toBe(revision);
  expect(
    (await runResidentCli(['city', 'observe', '--view', 'self', '--actor', 'other'], connection))
      .exitCode,
  ).toBe(2);
  expect((await runResidentCli(['context'], { ...connection, token: 'wrong' })).exitCode).toBe(2);
});
test('OpenCode exposes only command execution, with an explicit shell and no MCP', () => {
  const config = openCodeResidentConfig('/sandbox/town-shell.mjs', 'provider/model');
  expect(config.permission).toEqual({
    '*': 'deny',
    bash: { '*': 'deny', town: 'allow', 'town *': 'allow' },
  });
  expect(config.agent.resident.permission).toEqual(config.permission);
  expect(config.shell).toBe('/sandbox/town-shell.mjs');
  expect(config.mcp).toEqual({});
  expect(config.share).toBe('disabled');
});
test('CLI posts preserve original text, owner revisions, metadata, retries and replay', async () => {
  const { runtime, root, a, b, connection, credentials } = await setup();
  runtime.beginTurn(a);
  runtime.beginTurn(b);
  const original = "  原文\n<script>literal</script>\n$HOME `whoami` ; && ' \\n  ";
  const args = [
    'apps',
    'publish',
    '--channel',
    'shops',
    '--title',
    '计划',
    '--content',
    original,
    '--tags',
    '想法',
    '--tags',
    '开店',
    '--request-id',
    'post-1',
  ];
  const created = await runResidentCli(args, connection);
  expect(created.exitCode).toBe(0);
  const revision = runtime.state.revision;
  expect(await runResidentCli(args, connection)).toEqual(created);
  expect(runtime.state.revision).toBe(revision);
  const doc = Object.values(runtime.state.information.documents).find(
    (item) => item.authorId === a,
  )!;
  expect(doc.content).toBe(original);
  expect(doc.tags).toEqual(['想法', '开店']);
  const indexed = responseItems(
    (await runResidentCli(['apps', 'list', '--channel', 'shops'], connection)).output,
  );
  expect(indexed).toHaveLength(1);
  expect(indexed[0]).not.toHaveProperty('content');
  const peer = { ...connection, token: credentials.residents[b]! };
  expect(
    responseData(
      (await runResidentCli(['apps', 'read', '--channel', 'shops', '--path', doc.path], peer))
        .output,
    ).content,
  ).toBe(original);
  const edit = [
    'files',
    'update',
    '--space-id',
    'app-shops',
    '--path',
    doc.path,
    '--expected-revision',
    '1',
    '--content',
    '修订',
  ];
  expect((await runResidentCli(edit, peer)).exitCode).toBe(1);
  expect((await runResidentCli(edit, connection)).exitCode).toBe(0);
  expect((await runResidentCli(edit, connection)).exitCode).toBe(1);
  const historical = responseItems(
    (
      await runResidentCli(
        ['files', 'history', '--space-id', 'app-shops', '--path', doc.path],
        connection,
      )
    ).output,
  );
  expect(record(historical[0]).content).toBe(original);
  expect(runtime.state.world.moneySupply).toBe(runtime.manifest.initialWorld.moneySupply);
  const snapshot = structuredClone(runtime.state);
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  expect(replay.state).toEqual(snapshot);
  replay.close();
});
test('CLI scope and raw private documents remain authorized', async () => {
  const { runtime, a, b, connection, credentials } = await setup();
  runtime.beginTurn(a);
  runtime.beginTurn(b);
  expect(
    (
      await runResidentCli(
        [
          'spaces',
          'create',
          '--id',
          'private',
          '--title',
          '私密',
          '--visibility',
          'private',
          '--posting',
          'owner',
        ],
        connection,
      )
    ).exitCode,
  ).toBe(0);
  expect(
    (
      await runResidentCli(
        ['files', 'create', '--space-id', 'private', '--path', 'note.md', '--content-stdin'],
        connection,
        () => Promise.resolve('自己的原文\n'),
      )
    ).exitCode,
  ).toBe(0);
  expect(
    (
      await runResidentCli(['files', 'read', '--space-id', 'private', '--path', 'note.md'], {
        ...connection,
        token: credentials.residents[b]!,
      })
    ).exitCode,
  ).toBe(1);
  expect(
    (
      await runResidentCli(
        ['apps', 'publish', '--channel', 'shops', '--space-id', 'private', '--content', 'x'],
        connection,
      )
    ).exitCode,
  ).toBe(2);
  expect(
    (
      await runResidentCli(
        ['apps', 'publish', '--channel', 'missing', '--content', 'x'],
        connection,
      )
    ).exitCode,
  ).toBe(2);
});
test('a successful provider exit without effects does not pass acceptance', async () => {
  const { runtime, a, b } = await setup();
  for (const actor of [a, b, a, b]) {
    runtime.beginTurn(actor);
    runtime.finishTurn(actor, { summary: 'I plan to move and talk.' });
  }
  expect(verifyResidentChain(runtime)).toMatchObject({ passed: false });
  expect(verifyResidentChain(runtime).residents[0]?.missing).toContain('startedJourney');
});
