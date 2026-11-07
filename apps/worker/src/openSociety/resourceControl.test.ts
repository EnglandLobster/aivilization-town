import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-resource-control-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, resourceControl: enabled }),
  );
  clean.push(() => r.close());
  const [a, b, c, d] = r.manifest.residents.map((v) => v.id) as [string, string, string, string];
  let n = 0,
    m = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `ctrl-${++n}`,
  ) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Resource control verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const result = call(actor, name, args, requestId);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const seed = () => {
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '自己治理',
        terms: '共同管理，不替成员行动',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: r.state.world.clock.now + 100000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    ok(a, 'spaces.create', {
      id: 'archive',
      title: '私有原文',
      visibility: 'private',
      posting: 'owner',
      members: [],
    });
    ok(a, 'files.create', { spaceId: 'archive', path: 'original.md', content: '原作者原话' });
    ok(a, 'registers.create', {
      id: 'records',
      title: '自己的依据',
      visibility: 'private',
      readers: [b],
      editors: [],
      fields: { score: 'number' },
    });
    ok(a, 'records.put', {
      registerId: 'records',
      key: 'one',
      expectedRevision: 0,
      values: { score: 4 },
    });
  };
  const propose = (capability: string, resourceId: string, args: Record<string, unknown>) => {
    const id = `decision-${++m}`;
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: '对这一个具体资源动作决定',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 20000,
    });
    for (const voter of [b, c])
      ok(voter, 'collectives.vote', {
        id,
        expectedRevision: r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    ok(b, 'collectives.decide', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
    return id;
  };
  const execute = (id: string, requestId?: string) =>
    ok(
      b,
      'collectives.execute',
      { id, expectedRevision: r.state.collectives!.decisions[id]!.revision },
      requestId,
    );
  const offer = (kind: string, id: string) =>
    ok(a, 'resources.offer', {
      kind,
      id,
      expectedRevision: 1,
      expectedControlVersion: 1,
      target: { kind: 'collective', id: 'club' },
      expiresAt: r.state.world.clock.now + 50000,
      terms: '只交接控制，不伪造原作',
    });
  const adopt = (kind: string, id: string) => {
    offer(kind, id);
    const decision = propose('resources.accept', id, {
      kind,
      expectedRevision: 2,
      expectedControlVersion: 2,
    });
    execute(decision);
    return decision;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, d, call, ok, seed, propose, execute, offer, adopt, replay };
}
test('independent personal offer and collective acceptance commit actual control with proof exactly once', () => {
  const t = fixture();
  t.seed();
  const original = structuredClone(t.r.state.information.documents['archive/original.md']);
  t.offer('space', 'archive');
  expect(t.r.state.information.spaces.archive!.control?.controller).toEqual({
    kind: 'resident',
    id: t.a,
  });
  expect(
    t.call(t.b, 'resources.accept', {
      kind: 'space',
      id: 'archive',
      expectedRevision: 2,
      expectedControlVersion: 2,
    }).error,
  ).toBe('resource-controller-authority-required');
  const id = t.propose('resources.accept', 'archive', {
    kind: 'space',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  const receipt = t.execute(id, 'accept-once');
  const committed = t.r.journal.commits.find((c) => c.sequence === receipt.revision)!;
  expect(committed.informationEvents?.[0]?.type).toBe('SpaceChanged');
  expect(committed.collectiveEvents?.[0]?.type).toBe('CollectiveDecisionChanged');
  expect(t.r.state.information.spaces.archive!.control?.controller).toEqual({
    kind: 'collective',
    id: 'club',
  });
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('executed');
  expect(t.r.state.information.documents['archive/original.md']).toEqual(original);
  expect(t.call(t.a, 'files.read', { spaceId: 'archive', path: 'original.md' }).ok).toBe(false);
  expect(t.call(t.b, 'files.read', { spaceId: 'archive', path: 'original.md' }).ok).toBe(false);
  expect(
    t.call(t.a, 'files.delete', { spaceId: 'archive', path: 'original.md', expectedRevision: 1 })
      .ok,
  ).toBe(false);
  expect(t.call(t.d, 'resources.read', { kind: 'space', id: 'archive' }).error).toBe(
    'information-resource-not-found',
  );
  const repeated = t.call(
    t.b,
    'collectives.execute',
    {
      id,
      expectedRevision:
        committed.collectiveEvents![0]!.type === 'CollectiveDecisionChanged'
          ? committed.collectiveEvents![0]!.decision.revision - 1
          : 0,
    },
    'accept-once',
  );
  expect(repeated).toEqual(receipt);
  t.replay();
});
test('only exact collective administration changes ACL; it grants use, not authorship or social membership', () => {
  const t = fixture();
  t.seed();
  t.adopt('register', 'records');
  expect(
    t.call(t.a, 'registers.configure', {
      id: 'records',
      expectedRevision: 3,
      visibility: 'public',
      readers: [],
      editors: [t.a],
    }).ok,
  ).toBe(false);
  const operation = {
    type: 'configure',
    visibility: 'private',
    readers: [t.b, t.d],
    editors: [t.d],
  };
  expect(
    t.call(t.b, 'resources.manage', {
      kind: 'register',
      id: 'records',
      expectedRevision: 3,
      expectedControlVersion: 3,
      operation,
    }).error,
  ).toBe('resource-controller-authority-required');
  t.execute(
    t.propose('resources.manage', 'records', {
      kind: 'register',
      expectedRevision: 3,
      expectedControlVersion: 3,
      operation,
    }),
  );
  t.ok(t.d, 'records.put', {
    registerId: 'records',
    key: 'one',
    expectedRevision: 1,
    values: { score: 8 },
  });
  expect(t.r.state.sharedRecords!.records['records/one']).toMatchObject({
    createdBy: t.a,
    editedBy: t.d,
    authorityId: t.d,
  });
  expect(t.r.state.collectives!.charters.club!.members).not.toContain(t.d);
  t.adopt('space', 'archive');
  t.execute(
    t.propose('resources.manage', 'archive', {
      kind: 'space',
      expectedRevision: 3,
      expectedControlVersion: 3,
      operation: { type: 'configure', visibility: 'private', posting: 'members', members: [t.d] },
    }),
  );
  t.ok(t.d, 'files.read', { spaceId: 'archive', path: 'original.md' });
  t.ok(t.d, 'files.create', { spaceId: 'archive', path: 'new.md', content: '新的实际作者' });
  expect(t.r.state.information.documents['archive/original.md']!.authorId).toBe(t.a);
  expect(t.r.state.information.documents['archive/new.md']!.authorId).toBe(t.d);
  t.replay();
});
test('withdrawn or changed offer makes an old passed acceptance fail without consuming the decision', () => {
  const t = fixture();
  t.seed();
  t.offer('register', 'records');
  const id = t.propose('resources.accept', 'records', {
    kind: 'register',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  t.ok(t.a, 'resources.cancel', {
    kind: 'register',
    id: 'records',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  const revision = t.r.state.collectives!.decisions[id]!.revision;
  expect(t.call(t.b, 'collectives.execute', { id, expectedRevision: revision }).ok).toBe(false);
  expect(t.r.state.collectives!.decisions[id]!.revision).toBe(revision);
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('passed');
  expect(t.r.state.sharedRecords!.registers.records!.control?.controller).toEqual({
    kind: 'resident',
    id: t.a,
  });
  t.replay();
});
test('old manifest enables control once without rewriting seed; unsupported actions cannot invent another resource domain', () => {
  const t = fixture(false),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.a, 'resources.list', {}).error).toBe('resource-control-not-enabled');
  expect(t.r.enableResourceControl().ok).toBe(true);
  const count = t.r.journal.commits.length;
  expect(t.r.enableResourceControl().ok).toBe(true);
  expect(t.r.journal.commits).toHaveLength(count);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.seed();
  expect(
    t.call(t.a, 'resources.manage', {
      kind: 'register',
      id: 'records',
      expectedRevision: 1,
      expectedControlVersion: 1,
      operation: {
        type: 'configure',
        visibility: 'public',
        readers: [],
        editors: [],
        balance: 100,
      },
    }).error,
  ).toBe('invalid-resource-action');
  expect(
    t.call(t.a, 'resources.offer', {
      kind: 'register',
      id: 'records',
      expectedRevision: 1,
      expectedControlVersion: 1,
      target: { kind: 'collective', id: 'missing' },
      expiresAt: t.r.state.world.clock.now + 1000,
      terms: '不存在',
    }).error,
  ).toBe('invalid-control-target');
  t.replay();
});

test('collectively controlled groups keep membership and private history separate from administration', () => {
  const t = fixture();
  t.seed();
  t.ok(t.a, 'groups.create', { id: 'g', title: '自主交流' });
  t.ok(t.a, 'groups.send', { groupId: 'g', content: '原作者保留的发言' });
  t.ok(t.a, 'groups.invite', { groupId: 'g', residentId: t.d });
  const pending = Object.values(t.r.state.communication!.invitations).find(
    (i) => i.groupId === 'g',
  )!;
  t.adopt('group', 'g');
  expect(t.r.state.communication!.groups.g!.members).toEqual([t.a]);
  expect(t.r.state.communication!.invitations[pending.id]).toMatchObject({
    status: 'rejected',
    resolution: 'controller-transfer',
    resolvedBy: t.b,
  });
  expect(t.call(t.b, 'groups.messages', { groupId: 'g' }).error).toBe('member-required');
  expect(t.call(t.a, 'groups.invite', { groupId: 'g', residentId: t.c }).error).toBe(
    'owner-required',
  );
  const id = t.propose('resources.manage', 'g', {
    kind: 'group',
    expectedRevision: 3,
    expectedControlVersion: 3,
    operation: { type: 'invite', invitationId: 'new-invite', residentId: t.d },
  });
  t.execute(id);
  expect(t.r.state.communication!.invitations['new-invite']!.invitedBy).toBe(t.b);
  const adminList = t.ok(t.c, 'groups.invitations', {});
  expect(JSON.stringify(adminList.data)).toContain('new-invite');
  expect(t.r.context(t.c).lifeInbox?.items.some((i) => i.id === 'new-invite')).toBe(true);
  expect(t.r.context(t.d).lifeInbox?.items.some((i) => i.id === 'new-invite')).toBe(true);
  expect(t.r.context(t.a).lifeInbox?.items.some((i) => i.id === 'new-invite')).toBe(false);
  expect(t.r.state.communication!.groups.g!.members).not.toContain(t.d);
  t.ok(t.d, 'groups.accept', { id: 'new-invite', expectedRevision: 3 });
  t.ok(t.d, 'groups.send', { groupId: 'g', content: '本人独立加入后发言' });
  expect(Object.values(t.r.state.communication!.messages).map((m) => m.authorId)).toEqual([
    t.a,
    t.d,
  ]);
  t.ok(t.a, 'groups.leave', { groupId: 'g', expectedRevision: 4 });
  expect(t.r.state.communication!.groups.g!.members).toEqual([t.d]);
  t.replay();
});
test('withdrawn personal requests invalidate a passed collective admission without consuming proof', () => {
  const t = fixture();
  t.seed();
  t.ok(t.a, 'groups.create', { id: 'g', title: '申请由本人决定' });
  t.adopt('group', 'g');
  t.ok(t.d, 'groups.join-request', { groupId: 'g' });
  const request = Object.values(t.r.state.communication!.invitations).find(
    (i) => i.groupId === 'g' && i.kind === 'request',
  )!;
  const decision = t.propose('resources.manage', 'g', {
    kind: 'group',
    expectedRevision: 3,
    expectedControlVersion: 3,
    operation: { type: 'respond', invitationId: request.id, accept: true },
  });
  t.ok(t.d, 'groups.withdraw-request', { id: request.id, expectedRevision: 3 });
  const revision = t.r.state.collectives!.decisions[decision]!.revision;
  expect(
    t.call(t.b, 'collectives.execute', { id: decision, expectedRevision: revision }).error,
  ).toBe('invitation-already-resolved');
  expect(t.r.state.collectives!.decisions[decision]!.status).toBe('passed');
  expect(t.r.state.communication!.groups.g!.members).not.toContain(t.d);
  expect(t.r.state.communication!.invitations[request.id]).toMatchObject({
    resolution: 'request-withdrawn',
    resolvedBy: t.d,
  });
  t.replay();
});
test('new controlled groups refuse one-sided legacy transfer while recipient can accept explicit control without joining', () => {
  const t = fixture();
  t.seed();
  t.ok(t.a, 'groups.create', { id: 'g', title: '管理与参加分离' });
  t.ok(t.a, 'groups.invite', { groupId: 'g', residentId: t.d });
  const i = Object.values(t.r.state.communication!.invitations).find((i) => i.groupId === 'g')!;
  t.ok(t.d, 'groups.accept', { id: i.id, expectedRevision: 1 });
  expect(
    t.call(t.a, 'groups.transfer', { groupId: 'g', expectedRevision: 2, targetId: t.d }).error,
  ).toBe('resource-control-offer-required');
  t.ok(t.a, 'resources.offer', {
    kind: 'group',
    id: 'g',
    expectedRevision: 2,
    expectedControlVersion: 1,
    target: { kind: 'resident', id: t.b },
    expiresAt: t.r.state.world.clock.now + 1000,
    terms: '邀请管理，独立接受',
  });
  t.ok(t.b, 'resources.accept', {
    kind: 'group',
    id: 'g',
    expectedRevision: 3,
    expectedControlVersion: 2,
  });
  expect(t.r.state.communication!.groups.g!.members).toEqual([t.a, t.d]);
  expect(t.call(t.b, 'groups.messages', { groupId: 'g' }).error).toBe('member-required');
  t.ok(t.b, 'groups.close', { groupId: 'g', expectedRevision: 4 });
  expect(t.r.state.communication!.groups.g!.closed).toBe(true);
  t.replay();
});
test('collective closure cancels pending requests with honest provenance and retains members readable originals', () => {
  const t = fixture();
  t.seed();
  t.ok(t.a, 'groups.create', { id: 'g', title: '关闭后保留原文' });
  t.ok(t.a, 'groups.send', { groupId: 'g', content: '不可更改作者的历史' });
  t.adopt('group', 'g');
  t.ok(t.d, 'groups.join-request', { groupId: 'g' });
  const request = Object.values(t.r.state.communication!.invitations).find(
    (i) => i.groupId === 'g',
  )!;
  t.execute(
    t.propose('resources.manage', 'g', {
      kind: 'group',
      expectedRevision: 3,
      expectedControlVersion: 3,
      operation: { type: 'close' },
    }),
  );
  expect(t.r.state.communication!.invitations[request.id]).toMatchObject({
    resolution: 'group-closed',
    resolvedBy: t.b,
  });
  expect(t.r.state.communication!.groups.g).toMatchObject({ closed: true, members: [t.a] });
  const original = t.ok(t.a, 'groups.messages', { groupId: 'g' });
  expect(JSON.stringify(original.data)).toContain('不可更改作者的历史');
  expect(t.call(t.a, 'groups.send', { groupId: 'g', content: '不能再发' }).error).toBe(
    'group-closed',
  );
  t.replay();
});

test('group rules require explicit opt-in in an older control-enabled manifest and preserve existing groups', () => {
  const root = mkdtempSync(join(tmpdir(), 'resident-group-policy-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 3, groupControl: false }),
  );
  clean.push(() => r.close());
  const a = r.manifest.residents[0]!.id;
  let n = 0;
  const call = (name: string, args: Record<string, unknown>) => {
    r.beginTurn(a);
    const result = r.invoke(a, { name, arguments: args, requestId: `group-policy-${++n}` });
    r.finishTurn(a, { summary: 'Verify explicit group upgrade' });
    return result;
  };
  const originalManifest = readFileSync(join(root, 'manifest.json'));
  expect(call('groups.create', { id: 'old', title: 'Old group' }).ok).toBe(true);
  expect(r.state.communication!.groups.old!.control).toBeUndefined();
  expect(call('resources.read', { kind: 'group', id: 'old' }).ok).toBe(false);
  const oldGroup = r.state.communication!.groups.old;
  expect(r.enableGroupControl().ok).toBe(true);
  const count = r.journal.commits.length;
  expect(r.enableGroupControl().ok).toBe(true);
  expect(r.journal.commits).toHaveLength(count);
  expect(r.state.communication!.groups.old).toEqual(oldGroup);
  expect(call('resources.read', { kind: 'group', id: 'old' }).ok).toBe(true);
  expect(call('groups.create', { id: 'new', title: 'New group' }).ok).toBe(true);
  expect(r.state.communication!.groups.new!.control?.controller).toEqual({
    kind: 'resident',
    id: a,
  });
  expect(readFileSync(join(root, 'manifest.json'))).toEqual(originalManifest);
  const state = r.state;
  r.close();
  const replay = new OpenSocietyRuntime(root);
  clean.push(() => replay.close());
  expect(replay.state).toEqual(state);
});

test('enterprise management rule availability reflects the actual resource controller adapter', () => {
  for (const enabled of [false, true]) {
    const t = fixture(enabled);
    expect(t.ok(t.a, 'rules.read', { id: 'enterprise-management-control' }).data).toMatchObject({
      enabled,
    });
  }
});
