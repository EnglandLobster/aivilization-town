// Explicit engineering acceptance: collectively controlled information resources, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-group-control-cli-'));
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 4 }));
const [a, b, c, d] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c, d]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const results = [];
let ordinal = 0,
  closed = false;
async function call(actor, argv, expectedCode = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `group-cli-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit resource control CLI acceptance' });
  assert.equal(
    result.code,
    expectedCode,
    `${argv.slice(0, 2).join(' ')}: ${result.out} ${result.err}`,
  );
  const parsed = JSON.parse(result.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}
try {
  const now = runtime.state.world.clock.now;
  await call(a, ['rules', 'read', '--id', 'group-control']);
  await call(b, [
    'collectives',
    'create',
    '--id',
    'club',
    '--configuration',
    JSON.stringify({
      title: '共同管理通信空间',
      terms: '自己决定如何使用',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    }),
    '--expires-at',
    String(now + 100000),
  ]);
  await call(c, [
    'collectives',
    'respond',
    '--id',
    'club',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  await call(a, ['groups', 'create', '--id', 'g', '--title', '原始名称']);
  await call(a, ['groups', 'send', '--group-id', 'g', '--content', '原作者的原始消息']);
  const oldInvite = (await call(a, ['groups', 'invite', '--group-id', 'g', '--resident-id', d]))
    .data.id;
  await call(a, [
    'resources',
    'offer',
    '--kind',
    'group',
    '--id',
    'g',
    '--expected-revision',
    '1',
    '--expected-control-version',
    '1',
    '--target',
    JSON.stringify({ kind: 'collective', id: 'club' }),
    '--expires-at',
    String(now + 50000),
    '--terms',
    '管理交接，不代人入群',
  ]);
  let ordinal = 0;
  async function collective(capability, args) {
    const id = `decision-${++ordinal}`;
    await call(b, [
      'collectives',
      'propose',
      '--id',
      id,
      '--collective-id',
      'club',
      '--expected-version',
      '1',
      '--terms',
      '同意具体动作',
      '--action',
      JSON.stringify({ kind: 'resource', capability, resourceId: 'g', arguments: args }),
      '--closes-at',
      String(now + 10000),
      '--execute-before',
      String(now + 20000),
    ]);
    for (const actor of [b, c])
      await call(actor, [
        'collectives',
        'vote',
        '--id',
        id,
        '--expected-revision',
        String(runtime.state.collectives.decisions[id].revision),
        '--vote',
        'yes',
      ]);
    await call(b, [
      'collectives',
      'decide',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ]);
    await call(b, [
      'collectives',
      'execute',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ]);
    assert.equal(runtime.state.collectives.decisions[id].status, 'executed');
  }
  const versions = () => ({
    kind: 'group',
    expectedRevision: runtime.state.communication.groups.g.revision,
    expectedControlVersion: runtime.state.communication.groups.g.control.version,
  });
  await collective('resources.accept', versions());
  assert.deepEqual(runtime.state.communication.groups.g.members, [a]);
  assert.equal(
    runtime.state.communication.invitations[oldInvite].resolution,
    'controller-transfer',
  );
  await call(b, ['groups', 'messages', '--group-id', 'g'], 1);
  await call(a, ['groups', 'invite', '--group-id', 'g', '--resident-id', d], 1);
  await call(
    d,
    [
      'groups',
      'accept',
      '--id',
      oldInvite,
      '--expected-revision',
      String(versions().expectedRevision),
    ],
    1,
  );
  const withdrawMe = (await call(d, ['groups', 'join-request', '--group-id', 'g'])).data.id;
  await call(d, [
    'groups',
    'withdraw-request',
    '--id',
    withdrawMe,
    '--expected-revision',
    String(versions().expectedRevision),
  ]);
  assert.equal(runtime.state.communication.invitations[withdrawMe].resolution, 'request-withdrawn');
  await collective('resources.manage', {
    ...versions(),
    operation: { type: 'invite', invitationId: 'new-invite', residentId: d },
  });
  assert.equal(runtime.state.communication.invitations['new-invite'].invitedBy, b);
  assert.equal(runtime.state.communication.groups.g.members.includes(d), false);
  await call(d, [
    'groups',
    'accept',
    '--id',
    'new-invite',
    '--expected-revision',
    String(versions().expectedRevision),
  ]);
  await call(d, ['groups', 'send', '--group-id', 'g', '--content', '我本人选择发言']);
  assert.equal(
    Object.values(runtime.state.communication.messages).find((m) => m.content === '我本人选择发言')
      .authorId,
    d,
  );
  await collective('resources.manage', { ...versions(), operation: { type: 'close' } });
  await call(d, ['groups', 'messages', '--group-id', 'g']);
  await call(d, ['groups', 'send', '--group-id', 'g', '--content', '关闭后不能发言'], 1);
  const expected = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, expected);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    capability: 'M06-M09-group-control-slice',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    controlDoesNotGrantMembershipOrHistory: true,
    independentJoinAndWithdraw: true,
    priorInvitationsTerminatedWithActualReason: true,
    collectiveActionExactAndAtomic: true,
    actualMessageAuthorshipPreserved: true,
    closedHistoryRetainedForMembers: true,
    replayEqual: true,
    journalBytesUnchanged: true,
  };
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
