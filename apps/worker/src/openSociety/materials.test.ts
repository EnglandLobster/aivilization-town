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
function fixture(enabled = true, physicalProduction = false) {
  const root = mkdtempSync(join(tmpdir(), 'resident-materials-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
      count: 3,
      continuity: true,
      materials: enabled,
      physicalProduction,
    }),
    location = Object.values(m.initialWorld.locations).find(
      (l) => l.kind === 'production',
    )!.locationId;
  // Explicit test seed: existing materials and colocated residents, not a production or relocation action.
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, a]) => [
          id,
          {
            ...a,
            locationId: location,
            inventory: { ...a.inventory, Wood: 10 },
            physiology: { energy: 100, satiety: 100, health: 100 },
          },
        ]),
      ),
    },
  });
  clean.push(() => r.close());
  const [a, b, c] = r.manifest.residents.map((v) => v.id) as [string, string, string];
  let n = 0,
    dn = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `mat-${++n}`,
  ) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Explicit material acceptance' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const v = call(actor, name, args, requestId);
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v;
  };
  const stock = () => r.state.world.materials!.stocks.s!,
    job = () => r.state.world.materials!.productions.j!;
  const seed = () => {
    ok(a, 'stocks.create', { id: 's', title: '真实材料', locationId: location });
    ok(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 3 } });
  };
  const create = () => {
    ok(a, 'production.create', {
      id: 'j',
      stockId: 's',
      expectedRevision: stock().revision,
      recipeId: 'book',
      quantity: 2,
      productName: '自选作品名',
      description: '作者原话，不是药效或学历',
      workers: [a, b],
    });
  };
  const time = (deltaMs: number) => {
    const v = r.advanceTime(deltaMs, `time-${++n}`);
    expect(v.ok, v.error).toBe(true);
  };
  const club = () => {
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '共同经营',
        terms: '共同决定具体资源',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: r.state.world.clock.now + 10000000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  };
  const propose = (capability: string, resourceId: string, args: Record<string, unknown>) => {
    const id = `d${++dn}`;
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: '批准这一项',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 1000000,
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
    return id;
  };
  const execute = (id: string, actor = b) =>
    ok(actor, 'collectives.execute', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
  const adopt = () => {
    club();
    ok(a, 'stocks.offer', {
      id: 's',
      expectedRevision: stock().revision,
      expectedControlVersion: stock().control.version,
      targetKind: 'collective',
      targetId: 'club',
      expiresAt: r.state.world.clock.now + 10000000,
      terms: '接收库存及既有义务',
    });
    execute(
      propose('stocks.accept', 's', {
        expectedRevision: stock().revision,
        expectedControlVersion: stock().control.version,
      }),
    );
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
  return {
    r,
    root,
    a,
    b,
    c,
    call,
    ok,
    seed,
    create,
    stock,
    job,
    time,
    club,
    propose,
    execute,
    adopt,
    replay,
  };
}
test('real stock movements, discovery and retries preserve inventory and private visibility', () => {
  const t = fixture();
  t.seed();
  expect(t.r.state.world.agents[t.a]!.inventory.Wood).toBe(7);
  expect(t.call(t.b, 'stocks.read', { id: 's' }).error).toBe('material-stock-not-readable');
  t.ok(t.a, 'stocks.configure', {
    id: 's',
    expectedRevision: t.stock().revision,
    contributors: [t.b],
    readers: [],
  });
  const read = t.ok(t.b, 'stocks.read', { id: 's' }).data;
  expect(read).not.toHaveProperty('contents');
  const args = { id: 's', expectedRevision: t.stock().revision, items: { Wood: 1 } },
    result = t.ok(t.b, 'stocks.deposit', args, 'retry-material');
  expect(t.ok(t.b, 'stocks.deposit', args, 'retry-material')).toEqual(result);
  expect(t.stock().inventory.Wood).toBe(4);
  expect(t.r.state.world.agents[t.b]!.inventory.Wood).toBe(9);
  expect(
    t.call(t.b, 'stocks.withdraw', {
      id: 's',
      expectedRevision: t.stock().revision,
      recipientId: t.b,
      items: { Wood: 1 },
    }).ok,
  ).toBe(false);
  t.replay();
});
test('actual elapsed production, partial leave and independent successor produce registered goods with body costs', () => {
  const t = fixture();
  t.seed();
  t.create();
  const start = t.r.state.world.clock.now,
    unit = t.job().recipe.workMs;
  expect(t.ok(t.a, 'production.read', { id: 'j' }).data).toMatchObject({
    workWindow: { minimumDurationMs: 1, maximumDurationMs: 2 * unit },
    workTiming: { now: start },
  });
  expect(t.call(t.c, 'production.read', { id: 'j' }).ok).toBe(false);
  expect(
    t.call(t.a, 'production.start', { id: 'j', expectedRevision: 1, until: start + 2 * unit + 1 })
      .error,
  ).toBe('invalid-production-duration');
  // A finite partial shift, followed by an even earlier personal departure.
  t.ok(t.a, 'production.start', { id: 'j', expectedRevision: 1, until: start + unit });
  expect(t.stock().inventory.Book).toBeUndefined();
  t.time(unit / 2);
  expect(t.job().progressMs).toBe(unit / 2);
  expect(t.job().completed).toBe(0);
  t.ok(t.a, 'production.leave', { id: 'j', expectedRevision: t.job().revision });
  expect(t.r.state.world.activityTimeByAgent[t.a]!.availableAt).toBe(start + unit / 2);
  expect(t.ok(t.b, 'production.read', { id: 'j' }).data).toMatchObject({
    workWindow: { minimumDurationMs: 1, maximumDurationMs: 1.5 * unit },
  });
  t.ok(t.b, 'production.start', {
    id: 'j',
    expectedRevision: t.job().revision,
    until: start + 2 * unit,
  });
  t.time(unit * 1.5);
  expect(t.job().status).toBe('completed');
  expect(t.job().held).toEqual({});
  expect(t.stock().inventory).toEqual({ Wood: 1, Book: 2 });
  expect(t.r.state.world.agents[t.a]!.physiology.energy).toBeLessThan(85);
  expect(t.r.state.world.agents[t.b]!.physiology.energy).toBeLessThan(53);
  t.replay();
});
test('collective material execution binds the actual recipient; members cannot substitute themselves or bypass the exact decision', () => {
  const t = fixture();
  t.seed();
  t.adopt();
  const id = t.propose('stocks.withdraw', 's', {
    expectedRevision: t.stock().revision,
    recipientId: t.c,
    items: { Wood: 1 },
  });
  const before = t.stock();
  expect(
    t.call(t.b, 'collectives.execute', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    }).error,
  ).toBe('material-recipient-must-execute');
  expect(t.stock()).toEqual(before);
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('passed');
  expect(
    t.call(t.c, 'stocks.withdraw', {
      id: 's',
      expectedRevision: t.stock().revision,
      recipientId: t.c,
      items: { Wood: 1 },
    }).error,
  ).toBe('resource-controller-authority-required');
  t.execute(id, t.c);
  expect(t.r.state.world.agents[t.c]!.inventory.Wood).toBe(11);
  expect(t.r.state.world.agents[t.b]!.inventory.Wood).toBe(10);
  expect(t.stock().inventory.Wood).toBe(2);
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('executed');
  t.replay();
});
test('collective production preserves personal participation and cancellation atomically returns held materials', () => {
  const t = fixture();
  t.seed();
  t.adopt();
  t.execute(
    t.propose('production.create', 'j', {
      stockId: 's',
      expectedRevision: t.stock().revision,
      recipeId: 'book',
      quantity: 2,
      productName: '集体自选作品',
      description: '原始说明',
      workers: [t.a],
    }),
  );
  expect(
    t.call(t.b, 'production.start', {
      id: 'j',
      expectedRevision: 1,
      until: t.r.state.world.clock.now + 1000,
    }).error,
  ).toBe('production-worker-not-authorized');
  t.ok(t.a, 'production.start', {
    id: 'j',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.job().recipe.workMs * 2,
  });
  t.time(1000);
  expect(
    t.call(t.b, 'collectives.propose', {
      id: 'body-bypass',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '代别人离开',
      action: {
        kind: 'resource',
        capability: 'production.leave',
        resourceId: 'j',
        arguments: { expectedRevision: t.job().revision },
      },
      closesAt: t.r.state.world.clock.now + 10000,
      executeBefore: t.r.state.world.clock.now + 100000,
    }).ok,
  ).toBe(false);
  t.execute(t.propose('production.cancel', 'j', { expectedRevision: t.job().revision }));
  expect(t.job().status).toBe('cancelled');
  expect(t.job().held).toEqual({});
  expect(t.stock().inventory.Wood).toBe(3);
  expect(t.r.state.world.activityTimeByAgent[t.a]!.availableAt).toBe(t.r.state.world.clock.now);
  t.replay();
});
test('large and split time advancement have identical material results and elapsed body effects', () => {
  const a = fixture(),
    b = fixture();
  for (const t of [a, b]) {
    t.seed();
    t.create();
    t.ok(t.a, 'production.start', {
      id: 'j',
      expectedRevision: 1,
      until: t.r.state.world.clock.now + t.job().recipe.workMs * 2,
    });
  }
  const duration = a.job().recipe.workMs * 2;
  a.time(duration);
  b.time(10000);
  b.time(50000);
  b.time(duration - 60000);
  expect(a.stock().inventory).toEqual(b.stock().inventory);
  expect(a.job().completed).toBe(b.job().completed);
  expect(a.job().progressMs).toBe(b.job().progressMs);
  expect(a.r.state.world.agents[a.a]!.physiology.energy).toBeCloseTo(
    b.r.state.world.agents[b.a]!.physiology.energy,
    8,
  );
  a.replay();
  b.replay();
});
test('settlement waits for held materials and closure never destroys inventory or unresolved production', () => {
  const t = fixture();
  t.seed();
  t.create();
  t.ok(t.a, 'stocks.settle', { id: 's', expectedRevision: t.stock().revision });
  expect(t.call(t.a, 'stocks.close', { id: 's', expectedRevision: t.stock().revision }).error).toBe(
    'material-stock-unsettled',
  );
  t.ok(t.a, 'production.cancel', { id: 'j', expectedRevision: 1 });
  t.ok(t.a, 'stocks.withdraw', {
    id: 's',
    expectedRevision: t.stock().revision,
    recipientId: t.a,
    items: { Wood: 3 },
  });
  t.ok(t.a, 'stocks.close', { id: 's', expectedRevision: t.stock().revision });
  expect(t.r.state.world.agents[t.a]!.inventory.Wood).toBe(10);
  t.replay();
});
test('a collective can reserve finite sources by exact vote but cannot start another residents labor', () => {
  const t = fixture(true, true);
  t.seed();
  t.adopt();
  const decision = t.propose('production.gather', 'harvest', {
    stockId: 's',
    expectedRevision: t.stock().revision,
    sourceId: 'source-wheat',
    sourceRevision: 1,
    quantity: 1,
    productName: '共同的谷物',
    description: '独立本人劳动',
    workers: [t.a],
  });
  t.execute(decision);
  const j = () => t.r.state.world.materials!.productions.harvest!;
  expect(j().session).toBeUndefined();
  expect(t.stock().inventory.Wheat).toBeUndefined();
  expect(
    t.call(t.b, 'production.start', {
      id: 'harvest',
      expectedRevision: j().revision,
      until: t.r.state.world.clock.now + 60000,
    }).error,
  ).toBe('production-worker-not-authorized');
  t.ok(t.a, 'production.start', {
    id: 'harvest',
    expectedRevision: j().revision,
    until: t.r.state.world.clock.now + 60000,
  });
  t.time(60000);
  expect(t.stock().inventory.Wheat).toBe(1);
  expect(t.r.state.world.materials!.extraction!.sources['source-wheat']!.remaining).toBe(99);
  t.replay();
});
