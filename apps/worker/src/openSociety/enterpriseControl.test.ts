import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(productive = false) {
  const root = mkdtempSync(join(tmpdir(), 'enterprise-control-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 4,
    continuity: true,
    elapsedRest: true,
    elapsedLabor: true,
    serviceTime: true,
    serviceEmployment: true,
    resourceControl: true,
    productiveEmployment: productive,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          job: null,
          locationId: asLocationId(productive ? 'workshop' : 'town-square'),
          inventory: { ...a.inventory, Wood: 4 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: world,
    worldPolicies: serializableWorldPolicy(m.seed, world, m.rhythm),
  });
  clean.push(() => r.close());
  const [a, b, c, d] = m.residents.map((v) => v.id) as [string, string, string, string];
  let n = 0,
    p = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `enterprise-${++n}`,
  ) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Directed management and capital separation verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const propose = (capability: string, resourceId: string, args: Record<string, unknown>) => {
    const id = `decision-${++p}`;
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: 'This exact business decision',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 20000,
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
  const execute = (id: string) =>
    ok(b, 'collectives.execute', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
  const setup = () => {
    ok(a, 'world.found_enterprise', {
      enterpriseId: 'firm',
      name: 'Their business',
      occupationName: 'Resident Helper',
      initialCapital: 100,
      maxEmployees: 3,
    });
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: 'Our own procedure',
        terms: 'Two independent votes',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: 100000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    ok(a, 'resources.offer', {
      kind: 'enterprise',
      id: 'firm',
      expectedRevision: 1,
      expectedControlVersion: 1,
      target: { kind: 'collective', id: 'club' },
      expiresAt: 50000,
      terms: 'Management only. Capital and earned wages remain.',
    });
    expect(
      call(b, 'resources.accept', {
        kind: 'enterprise',
        id: 'firm',
        expectedRevision: 2,
        expectedControlVersion: 2,
      }).ok,
    ).toBe(false);
    execute(
      propose('resources.accept', 'firm', {
        kind: 'enterprise',
        expectedRevision: 2,
        expectedControlVersion: 2,
      }),
    );
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    clean.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, d, call, ok, propose, execute, setup, replay };
}
test('collective adoption, exact hiring decisions, independent joining and capital-correct closure are replayable without owner/member bypass', () => {
  const t = fixture();
  t.setup();
  const before = t.r.state.world.enterprises.firm!;
  expect(before.ownerAgentId).toBe(t.a);
  expect(before.control?.controller).toEqual({ kind: 'collective', id: 'club' });
  for (const actor of [t.a, t.b, t.c])
    expect(
      t.call(actor, 'world.post_job', { enterpriseId: 'firm', wageOffer: 30, openSlots: 3 }).ok,
    ).toBe(false);
  t.ok(t.b, 'resources.read', { kind: 'enterprise', id: 'firm' });
  const managerView = t.ok(t.b, 'world.observe', { view: 'enterprises' }).data as {
    items: { ownBusiness?: unknown }[];
  };
  const founderView = t.ok(t.a, 'world.observe', { view: 'enterprises' }).data as {
    items: { ownBusiness?: unknown }[];
  };
  expect(managerView.items[0]!.ownBusiness).toBeDefined();
  expect(founderView.items[0]!.ownBusiness).toBeUndefined();
  t.execute(
    t.propose('business.post-job', 'firm', {
      expectedControlVersion: 3,
      wageOffer: 30,
      openSlots: 3,
    }),
  );
  expect(t.r.state.world.enterprises.firm!.employeeAgentIds).toEqual([]);
  t.ok(t.d, 'world.join_enterprise', { enterpriseId: 'firm' });
  expect(t.r.state.world.enterprises.firm!.employeeWageOffers?.[t.d]).toBe(30);
  expect(
    t.call(t.d, 'world.trade', {
      enterpriseId: 'firm',
      side: 'buy',
      commodityName: 'Apple',
      quantity: 1,
    }).ok,
  ).toBe(false);
  const balance = t.r.state.world.agents[t.a]!.balance,
    operatorBalance = t.r.state.world.agents[t.b]!.balance;
  t.execute(t.propose('business.close', 'firm', { expectedControlVersion: 3 }));
  expect(t.r.state.world.agents[t.a]!.balance).toBe(balance + 100);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(operatorBalance);
  expect(t.r.state.world.enterprises.firm!.status).toBe('closed');
  expect(t.r.state.world.agents[t.d]!.job).toBeNull();
  t.replay();
});
test('failed exact spending keeps votes usable and creates no partial company effects; transfer invalidates older control decisions', () => {
  const t = fixture();
  t.setup();
  const id = t.propose('market.trade', 'firm', {
      expectedControlVersion: 3,
      side: 'buy',
      commodityName: 'Apple',
      quantity: 100000,
    }),
    before = structuredClone(t.r.state.world.enterprises.firm);
  expect(
    t.call(t.b, 'collectives.execute', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    }).ok,
  ).toBe(false);
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('passed');
  expect(t.r.state.world.enterprises.firm).toEqual(before);
  const stale = t.propose('business.post-job', 'firm', {
    expectedControlVersion: 3,
    wageOffer: 20,
    openSlots: 2,
  });
  t.execute(
    t.propose('resources.offer', 'firm', {
      kind: 'enterprise',
      expectedRevision: 3,
      expectedControlVersion: 3,
      target: { kind: 'resident', id: t.a },
      expiresAt: 50000,
      terms: 'Return operating control with every existing obligation',
    }),
  );
  t.ok(t.a, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 4,
    expectedControlVersion: 4,
  });
  expect(
    t.call(t.b, 'collectives.execute', {
      id: stale,
      expectedRevision: t.r.state.collectives!.decisions[stale]!.revision,
    }).ok,
  ).toBe(false);
  expect(t.r.state.collectives!.decisions[stale]!.status).toBe('passed');
  t.ok(t.a, 'world.post_job', { enterpriseId: 'firm', wageOffer: 40, openSlots: 2 });
  t.replay();
});
test('collective service finance requires its own precise decision while workers and customers still participate independently', () => {
  const t = fixture();
  t.setup();
  t.execute(
    t.propose('business.post-job', 'firm', {
      expectedControlVersion: 3,
      wageOffer: 30,
      openSlots: 3,
    }),
  );
  t.ok(t.d, 'world.join_enterprise', { enterpriseId: 'firm' });
  t.ok(t.d, 'engagements.offer', {
    id: 'svc',
    controllerKind: 'resident',
    controllerId: t.d,
    title: 'Residents chose the service',
    terms: 'Actual participants, independent accounts and wages',
    locationId: 'town-square',
    providerId: t.d,
    recipientId: t.c,
    payerSector: 'agent',
    payerId: t.c,
    revenueSector: 'enterprise',
    revenueId: 'firm',
    providerShareBps: 0,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  });
  const service = () => t.r.state.world.serviceEngagements!.engagements.svc!;
  t.ok(t.c, 'engagements.accept', { id: 'svc', expectedRevision: service().revision });
  const terms = {
    serviceId: 'svc',
    expectedServiceRevision: service().revision,
    wageBasis: 'attendance',
  };
  for (const actor of [t.a, t.b])
    expect(t.call(actor, 'business.authorize-service', { enterpriseId: 'firm', ...terms }).ok).toBe(
      false,
    );
  t.execute(
    t.propose('business.authorize-service', 'firm', { expectedControlVersion: 3, ...terms }),
  );
  expect(service().status).toBe('accepted');
  expect(service().providerPresence).toBeUndefined();
  t.ok(t.c, 'engagements.fund', { id: 'svc', expectedRevision: service().revision });
  const details = t.ok(t.d, 'engagements.read', { id: 'svc' }).data as {
    ownEmployment: { expectedEmploymentRevision: number };
  };
  t.ok(t.d, 'engagements.start', {
    id: 'svc',
    expectedRevision: service().revision,
    until: 60000,
    expectedEmploymentRevision: details.ownEmployment.expectedEmploymentRevision,
  });
  t.ok(t.c, 'engagements.start', { id: 'svc', expectedRevision: service().revision, until: 60000 });
  expect(t.r.advanceTime(60000, 'actual-company-service').ok).toBe(true);
  const firm = t.r.state.world.enterprises.firm!,
    claims = Object.values(firm.earnedPayroll!.claims);
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({ actorId: t.d, elapsedMs: 60000 });
  expect(claims[0]!.earnedMicros).toBeGreaterThan(0);
  expect(firm.serviceBusiness!.contracts.svc!.revenueMicros).toBeGreaterThan(0);
  t.ok(t.b, 'business.service', { enterpriseId: 'firm', serviceId: 'svc' });
  expect(t.call(t.a, 'business.service', { enterpriseId: 'firm', serviceId: 'svc' }).ok).toBe(
    false,
  );
  const paid = claims[0]!.paidMicros,
    contract = structuredClone(firm.serviceBusiness!.contracts.svc);
  t.execute(
    t.propose('resources.offer', 'firm', {
      kind: 'enterprise',
      expectedRevision: 3,
      expectedControlVersion: 3,
      target: { kind: 'resident', id: t.a },
      expiresAt: 110000,
      terms: 'Existing contracts and earned wages remain',
    }),
  );
  t.ok(t.a, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 4,
    expectedControlVersion: 4,
  });
  expect(t.r.state.world.enterprises.firm!.serviceBusiness!.contracts.svc).toEqual(contract);
  expect(
    Object.values(t.r.state.world.enterprises.firm!.earnedPayroll!.claims)[0]!.paidMicros,
  ).toBe(paid);
  t.ok(t.a, 'business.service', { enterpriseId: 'firm', serviceId: 'svc' });
  expect(t.call(t.b, 'business.service', { enterpriseId: 'firm', serviceId: 'svc' }).ok).toBe(
    false,
  );
  t.replay();
});

test('the same collective authorizes its stock and company wages together while actual workers choose to start', () => {
  const t = fixture(true);
  t.setup();
  t.execute(
    t.propose('business.post-job', 'firm', {
      expectedControlVersion: 3,
      wageOffer: 100,
      openSlots: 3,
    }),
  );
  t.ok(t.d, 'world.join_enterprise', { enterpriseId: 'firm' });
  t.ok(t.a, 'stocks.create', {
    id: 'stock',
    title: 'Materials from an independent contributor',
    locationId: 'workshop',
  });
  t.ok(t.a, 'stocks.deposit', { id: 'stock', expectedRevision: 1, items: { Wood: 2 } });
  t.ok(t.a, 'stocks.offer', {
    id: 'stock',
    expectedRevision: 2,
    expectedControlVersion: 1,
    targetKind: 'collective',
    targetId: 'club',
    expiresAt: 50000,
    terms: 'The materials have their own controller',
  });
  t.execute(
    t.propose('stocks.accept', 'stock', { expectedRevision: 3, expectedControlVersion: 2 }),
  );
  const terms = {
    stockId: 'stock',
    expectedRevision: 4,
    recipeId: 'book',
    quantity: 1,
    workers: [t.d],
    productName: 'Chosen product',
    description: 'Original resident specification',
    enterpriseId: 'firm',
    expectedEnterpriseControlVersion: 3,
  };
  const proposeInvalid = (args: Record<string, unknown>) =>
    t.call(t.b, 'collectives.propose', {
      id: 'bad',
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: 'Invalid source',
      action: {
        kind: 'resource',
        capability: 'production.create',
        resourceId: 'job',
        arguments: args,
      },
      closesAt: 10000,
      executeBefore: 20000,
    });
  expect(proposeInvalid({ ...terms, expectedEnterpriseControlVersion: 2 }).error).toBe(
    'enterprise-control-revision-conflict',
  );
  expect(proposeInvalid({ ...terms, enterpriseId: 'other' }).error).toBe(
    'collective-does-not-control-production-employer',
  );
  const { expectedEnterpriseControlVersion, ...missingVersion } = terms;
  void expectedEnterpriseControlVersion;
  expect(proposeInvalid(missingVersion).error).toBe('invalid-collective-production-employer');
  t.execute(t.propose('production.create', 'job', terms));
  const job = t.r.state.world.materials!.productions.job!;
  expect(job.session).toBeUndefined();
  expect(t.r.state.world.enterprises.firm!.productionEmployment!.assignments.job).toMatchObject({
    authority: {
      controller: { kind: 'collective', id: 'club' },
      actorId: t.b,
      operation: 'authorize-production',
    },
  });
  expect(
    t.call(t.b, 'production.start', { id: 'job', expectedRevision: 1, until: job.recipe.workMs })
      .ok,
  ).toBe(false);
  t.ok(t.d, 'production.start', { id: 'job', expectedRevision: 1, until: job.recipe.workMs });
  expect(t.r.advanceTime(job.recipe.workMs, 'actual-collective-production').ok).toBe(true);
  const firm = t.r.state.world.enterprises.firm!,
    claims = Object.values(firm.earnedPayroll!.claims);
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({ actorId: t.d, elapsedMs: job.recipe.workMs, status: 'ended' });
  expect(claims[0]!.earnedMicros).toBeGreaterThan(0);
  expect(t.r.state.world.materials!.stocks.stock!.inventory).toEqual({ Book: 1, Wood: 1 });
  t.replay();
});
