import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { materialOperationRequest } from '@aivilization/materials';
import type { PrincipalControlCommand, PrincipalRequest } from '@aivilization/authority';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resource-principals-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    resourceControl: true,
    materials: true,
    publicGovernance: true,
    resourcePrincipals: enabled,
  });
  const location = Object.values(m.initialWorld.locations).find(
    (l) => l.kind === 'production',
  )!.locationId;
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, a]) => [
          id,
          { ...a, locationId: location, inventory: { Wood: 8 } },
        ]),
      ),
    },
  });
  clean.push(() => r.close());
  const [a, b, c] = m.residents.map((r) => r.id) as [string, string, string];
  let n = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `r${++n}`,
  ) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Explicit principal engineering acceptance' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const v = call(actor, name, args, requestId);
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v;
  };
  ok(a, 'stocks.create', { id: 's', title: '原料', locationId: location });
  ok(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 5 } });
  const stock = () => r.state.world.materials!.stocks.s!;
  const request = (command: PrincipalControlCommand) => ({
    resourceKind: 'stock',
    resourceId: 's',
    resourceRevision: stock().revision,
    controlVersion: stock().control.version,
    command,
  });
  const club = () => {
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '共同决定',
        terms: '每项独立授权',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: 1000000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  };
  const approve = (request: PrincipalRequest, id: string) => {
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: '批准这一个精确动作',
      action: {
        kind: 'resource',
        capability: 'operation' in request ? 'principals.operate' : 'principals.control',
        resourceId: 's',
        arguments: { request },
      },
      closesAt: 100000,
      executeBefore: 1000000,
    });
    for (const actor of [b, c])
      ok(actor, 'collectives.vote', {
        id,
        expectedRevision: r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    ok(b, 'collectives.decide', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    reopened.close();
  };
  return { r, a, b, c, root, call, ok, stock, request, club, approve, replay };
}
test('authenticated collective execution reaches actual stock effects, rejects stale decisions, and replays with one authority source', () => {
  const t = fixture();
  t.club();
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'collective', id: 'club' },
      expiresAt: 1000000,
      terms: '接收库存及原有义务',
    }),
  });
  expect(t.call(t.b, 'principals.control', { request: t.request({ type: 'accept' }) }).ok).toBe(
    false,
  );
  t.approve(t.request({ type: 'accept' }), 'accept');
  t.ok(t.b, 'collectives.execute', {
    id: 'accept',
    expectedRevision: t.r.state.collectives!.decisions.accept!.revision,
  });
  expect(t.stock().control.controller).toEqual({ kind: 'collective', id: 'club' });
  const command = {
    type: 'withdraw' as const,
    id: 's',
    expectedRevision: t.stock().revision,
    items: { Wood: 1 },
    recipientId: t.b,
  };
  const request = materialOperationRequest(t.stock(), command);
  expect(t.call(t.b, 'principals.operate', { request }).ok).toBe(false);
  t.approve(request, 'withdraw');
  const args = {
    id: 'withdraw',
    expectedRevision: t.r.state.collectives!.decisions.withdraw!.revision,
  };
  t.ok(t.b, 'collectives.execute', args, 'once');
  t.ok(t.b, 'collectives.execute', args, 'once');
  expect(t.stock().inventory.Wood).toBe(4);
  expect(t.r.state.world.agents[t.b]!.inventory.Wood).toBe(9);
  expect(t.r.state.collectives!.decisions.withdraw!.status).toBe('executed');
  t.approve(
    materialOperationRequest(t.stock(), { ...command, expectedRevision: t.stock().revision }),
    'stale',
  );
  t.ok(t.a, 'stocks.deposit', {
    id: 's',
    expectedRevision: t.stock().revision,
    items: { Wood: 1 },
  });
  const before = structuredClone(t.r.state.world.materials);
  expect(
    t.call(t.b, 'collectives.execute', {
      id: 'stale',
      expectedRevision: t.r.state.collectives!.decisions.stale!.revision,
    }).ok,
  ).toBe(false);
  expect(t.r.state.world.materials).toEqual(before);
  expect(t.r.state.collectives!.decisions.stale!.status).toBe('passed');
  t.replay();
});
