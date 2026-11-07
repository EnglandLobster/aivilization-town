import type * as ChildProcess from 'node:child_process';
import type * as FileSystem from 'node:fs';
import type { PathLike } from 'node:fs';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  fsyncSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
// This protocol test executes a real child, but does not need the compiled shell or an installed provider.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: () => RESIDENT_CLI_VERSION,
}));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof FileSystem>();
  return {
    ...fs,
    fsyncSync: vi.fn(fs.fsyncSync),
    existsSync: (path: PathLike) =>
      typeof path === 'string' && path.endsWith('/src/residentShell.js')
        ? true
        : fs.existsSync(path),
  };
});
import { createOpenCodeResidentDriver } from './openCode';
import { legacyProviderWorkspaceId, preserveResidentProviderWorkspace } from './providerWorkspace';
import { observedPartitionSession } from './partitionCheckpoint';
import { RESIDENT_CLI_VERSION } from './cliCatalog';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'provider-session-protocol-'));
  roots.push(root);
  const executable = join(root, 'provider.mjs');
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst resumed = process.argv.includes('--session');\nconsole.log(JSON.stringify({ type: 'text', sessionID: 'fixture-cli-session', part: { text: resumed ? 'resumed' : 'fresh' } }));\nprocess.exitCode = resumed ? 0 : 1;\n`,
    { mode: 0o700 },
  );
  const options = {
    connection: { endpoint: 'http://127.0.0.1:1', token: 'fixture-token' },
    model: 'fixture',
    directory: root,
    executable,
  };
  const run = (turnId: string, sessionId?: string) =>
    createOpenCodeResidentDriver({ ...options, ...(sessionId ? { sessionId } : {}) }).run({
      actorId: 'resident-a',
      turnId,
      context: {},
      signal: new AbortController().signal,
      invoke: () => Promise.reject(Error('protocol-fixture-must-not-invoke-world')),
    });
  return { root, run, options };
}
test('session observed in a failed first CLI provider run persists and is resumed by the next process', async () => {
  const t = fixture();
  const first = await t.run('first');
  expect(first).toMatchObject({ status: 'provider-error', sessionId: 'fixture-cli-session' });
  expect(JSON.parse(readFileSync(join(t.root, 'cli-session.json'), 'utf8')) as unknown).toEqual({
    version: RESIDENT_CLI_VERSION,
    sessionId: first.sessionId,
    workspaceId: legacyProviderWorkspaceId(t.root),
  });
  const second = await t.run('second', first.sessionId);
  expect(second).toMatchObject({
    status: 'completed',
    sessionId: first.sessionId,
    summary: 'resumed',
  });
});
test('an unproven or old transport session is not adopted from an argument alone', async () => {
  const t = fixture();
  writeFileSync(
    join(t.root, 'cli-session.json'),
    JSON.stringify({ version: 'old-mcp', sessionId: 'fixture-cli-session' }),
  );
  expect((await t.run('legacy', 'fixture-cli-session')).status).toBe('provider-error');
  expect((await t.run('wrong-id', 'different-session')).status).toBe('provider-error');
});

test('a moved compute evidence directory resumes the same session in the original provider working directory', async () => {
  const t = fixture();
  writeFileSync(
    t.options.executable,
    `#!${process.execPath}\nconsole.log(JSON.stringify({type:'text',sessionID:'fixture-cli-session',part:{text:process.argv[process.argv.indexOf('--dir')+1]}}));\n`,
    { mode: 0o700 },
  );
  const first = await t.run('native');
  const moved = join(t.root, 'moved-compute');
  mkdirSync(moved);
  writeFileSync(join(moved, 'cli-session.json'), readFileSync(join(t.root, 'cli-session.json')));
  preserveResidentProviderWorkspace(t.root, moved, first.sessionId!);
  const resumed = await createOpenCodeResidentDriver({
    ...t.options,
    directory: moved,
    sessionId: first.sessionId!,
  }).run({
    actorId: 'resident-a',
    turnId: 'partition',
    context: {},
    signal: new AbortController().signal,
    invoke: () => Promise.reject(Error('no-world-in-protocol-test')),
  });
  expect(resumed).toMatchObject({
    status: 'completed',
    sessionId: first.sessionId,
    summary: first.summary,
  });
  expect(JSON.parse(readFileSync(join(moved, 'partition.json'), 'utf8')) as unknown).toMatchObject({
    workingDirectory: first.summary,
    workspaceId: legacyProviderWorkspaceId(t.root),
  });
});

test('observed session is durable before provider exit and repeated turn evidence is never overwritten', async () => {
  const t = fixture();
  writeFileSync(
    t.options.executable,
    `#!${process.execPath}\nconsole.log(JSON.stringify({type:'text',sessionID:'early-session',part:{text:'Observed'}}));if(!process.argv.includes('--session'))setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  );
  const controller = new AbortController();
  const input = {
    actorId: 'resident-a',
    turnId: 'interrupted-turn',
    context: {},
    invoke: () => Promise.reject(Error('no world')),
  };
  const first = createOpenCodeResidentDriver({
    ...t.options,
    sessionScope: 'authority-fixture',
  }).run({ ...input, signal: controller.signal });
  await expect.poll(() => existsSync(join(t.root, 'observed-session.json'))).toBe(true);
  expect(
    JSON.parse(readFileSync(join(t.root, 'observed-session.json'), 'utf8')) as unknown,
  ).toMatchObject({
    actorId: 'resident-a',
    turnId: 'interrupted-turn',
    sessionId: 'early-session',
    scope: 'authority-fixture',
  });
  expect(
    observedPartitionSession(t.root, 'resident-a', 'interrupted-turn', 'authority-fixture'),
  ).toBe('early-session');
  expect(
    observedPartitionSession(t.root, 'resident-a', 'interrupted-turn', 'another-world'),
  ).toBeUndefined();
  controller.abort();
  expect((await first).status).toBe('provider-error');
  const bytes = readFileSync(join(t.root, 'interrupted-turn.json'));
  const next = await createOpenCodeResidentDriver({
    ...t.options,
    sessionId: 'early-session',
    sessionScope: 'authority-fixture',
  }).run({ ...input, signal: new AbortController().signal });
  expect(next.status).toBe('completed');
  expect(next.sessionId).toBe('early-session');
  expect(readFileSync(join(t.root, 'interrupted-turn.json'))).toEqual(bytes);
  expect(
    readdirSync(t.root).filter((x) => x.startsWith('interrupted-turn') && x.endsWith('.json')),
  ).toHaveLength(2);
});

test('session checkpoint I/O failure is reported as provider failure instead of swallowed as diagnostic output', async () => {
  const t = fixture();
  writeFileSync(
    t.options.executable,
    `#!${process.execPath}\nconsole.log(JSON.stringify({type:'text',sessionID:'io-session',part:{text:'done'}}));\n`,
    { mode: 0o700 },
  );
  vi.mocked(fsyncSync).mockImplementationOnce(() => {
    throw Error('test-fsync-failure');
  });
  const result = await t.run('io-failure');
  expect(result.status).toBe('provider-error');
  expect(
    JSON.parse(readFileSync(join(t.root, 'io-failure.json'), 'utf8')) as unknown,
  ).toMatchObject({ status: 'provider-error', checkpointFailure: 'test-fsync-failure' });
});
