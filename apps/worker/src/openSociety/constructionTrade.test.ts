import { createOpenSocietyManifest } from './manifest';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  constructionTradeRequest,
  evidenceTradeEscrowBalance,
  type ConstructionTradeCommand,
} from '@aivilization/commerce';
import { premisesPrincipalRequest, type PrincipalPremisesCommand } from '@aivilization/premises';
import { materialOperationRequest } from '@aivilization/materials';
import type { PrincipalOperationRequest, ResourcePrincipal } from '@aivilization/authority';
import { OpenSocietyRuntime } from './runtime';
import { applyOpenSocietyEffects } from './state';
import { openPremisesFixture, premisesCleanup } from './testFixtures/openPremises';
function fixture() {
  const t = openPremisesFixture(true, true, {}, false, { principals: true });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  const manifest = readFileSync(join(t.root, 'manifest.json'), 'utf8');
  expect(t.r.state.world.residentTrade?.constructionOrders).toBeUndefined();
  expect(t.r.enableConstructionTrade().ok).toBe(true);
  expect(t.r.enableConstructionTrade().ok).toBe(true);
  expect(readFileSync(join(t.root, 'manifest.json'), 'utf8')).toBe(manifest);
  const approve = (id: string, request: PrincipalOperationRequest) => {
    t.ok(t.b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '仅此版本资源操作',
      action: {
        kind: 'resource',
        capability: 'principals.operate',
        resourceId: request.resourceId,
        arguments: { request },
      },
      closesAt: t.r.state.world.clock.now + 100000,
      executeBefore: t.r.state.world.clock.now + 1000000,
    });
    for (const actor of [t.b, t.c])
      t.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    t.ok(t.b, 'collectives.decide', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
    return { id, expectedRevision: t.r.state.collectives!.decisions[id]!.revision };
  };
  const publicApprove = (id: string, request: PrincipalOperationRequest) => {
    t.ok(t.a, 'governance.propose', {
      id,
      text: '独立公共资源决定',
      action: { kind: 'manage-resource', expectedRevision: request.resourceRevision, request },
      closesAt: t.r.state.world.clock.now + 60000,
      expectedProcedureRevision: t.r.state.world.publicGovernance!.authority.procedureRevision,
    });
    for (const actor of [t.a, t.b, t.c])
      t.ok(actor, 'governance.vote', {
        id,
        expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
        choice: 'yes',
      });
    t.time(60000);
    t.ok(t.d, 'governance.close', {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
    return {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    };
  };
  const project = (buyer: ResourcePrincipal = { kind: 'resident', id: t.b }) => {
    t.ok(t.a, 'stocks.create', { id: 's', title: '自愿供料', locationId: t.location });
    t.ok(t.a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
    const control = (command: Record<string, unknown>) => ({
      resourceKind: 'stock',
      resourceId: 's',
      resourceRevision: t.stock().revision,
      controlVersion: t.stock().control.version,
      command,
    });
    t.ok(t.a, 'principals.control', {
      request: control({
        type: 'offer',
        target: { kind: 'resident', id: t.b },
        terms: '独立保管交接',
        expiresAt: t.r.state.world.clock.now + 1000000,
      }),
    });
    t.ok(t.b, 'principals.control', { request: control({ type: 'accept' }) });
    t.ok(t.b, 'principals.operate', {
      request: materialOperationRequest(t.stock(), {
        type: 'reserve-materials',
        offer: {
          id: 'r',
          stockId: 's',
          expectedStockRevision: t.stock().revision,
          beneficiary: buyer,
          consumer: { domain: 'premises', id: 'p' },
          items: { Wood: 8 },
          terms: '此工程',
          expiresAt: t.r.state.world.clock.now + 1000000,
        },
      }),
    });
    const command: PrincipalPremisesCommand = {
      type: 'create-construction',
      construction: {
        id: 'p',
        kind: 'build',
        buildingId: 'home',
        siteId: t.site!.id,
        expectedSiteRevision: t.r.state.world.premises!.sites[t.site!.id]!.revision,
        controller: buyer,
        title: '居民自定工程',
        description: '原文',
        blueprint: {
          primaryUse: 'residence',
          floorArea: 8,
          capacity: 2,
          fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
        },
        workers: [t.c],
        reservations: [{ id: 'r', revision: 1 }],
      },
    };
    const request = premisesPrincipalRequest(t.r.state.world.premises!, command);
    if (buyer.kind === 'collective') t.ok(t.b, 'collectives.execute', approve('build', request));
    else if (buyer.kind === 'public')
      t.ok(t.d, 'governance.execute', publicApprove('build-public', request));
    else t.ok(t.b, 'principals.operate', { request });
  };
  const offer = (
    buyer: ResourcePrincipal = { kind: 'resident', id: t.b },
    id = 'order',
    acceptBy = t.r.state.world.clock.now + 10000,
  ): ConstructionTradeCommand => ({
    type: 'offer',
    terms: {
      id,
      projectId: 'p',
      sourceRevision: t.project().revision,
      seller: { kind: 'resident', id: t.c },
      buyer,
      payer:
        buyer.kind === 'collective'
          ? { sector: 'collective', id: 'pool' }
          : buyer.kind === 'public'
            ? { sector: 'treasury', id: 'public-treasury' }
            : { sector: 'agent', id: t.b },
      revenue: { sector: 'agent', id: t.c },
      amount: 30,
      acceptBy,
      title: '原文施工约定',
      terms: '完成交付不代表主观满意',
    },
  });
  const act = (actor: string, c: ConstructionTradeCommand) =>
    t.ok(actor, 'principals.operate', { request: constructionTradeRequest(c) });
  const complete = () => {
    t.ok(t.c, 'construction.start', {
      id: 'p',
      expectedRevision: t.project().revision,
      until: t.r.state.world.clock.now + t.project().plan.workMs,
    });
    t.time(t.project().plan.workMs);
  };
  const replay = () => {
    const state = structuredClone(t.r.state),
      journal = readFileSync(join(t.root, 'journal.jsonl'), 'utf8');
    t.r.close();
    const next = new OpenSocietyRuntime(t.root);
    premisesCleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(t.root, 'journal.jsonl'), 'utf8')).toBe(journal);
  };
  return { ...t, approve, publicApprove, project, offer, act, complete, replay };
}
test('real resident entry funds actual construction, protects private terms, settles actual completion and reopens the same journal', () => {
  const t = fixture();
  t.project();
  const before = t.r.state.world.agents[t.b]!.balance;
  const hiddenOffer = t.offer();
  if (hiddenOffer.type !== 'offer') throw Error('fixture');
  const hidden = {
    ...hiddenOffer,
    terms: {
      ...hiddenOffer.terms,
      id: 'probe',
      seller: { kind: 'resident' as const, id: t.d },
      revenue: { sector: 'agent' as const, id: t.d },
    },
  };
  expect(
    t.call(t.d, 'principals.operate', { request: constructionTradeRequest(hidden) }).error,
  ).toBe('construction-not-readable');
  expect(t.r.state.world.residentTrade!.constructionOrders!.orders.probe).toBeUndefined();
  t.act(t.c, t.offer());
  expect(t.call(t.d, 'principals.read', { kind: 'construction-order', id: 'order' }).ok).toBe(
    false,
  );
  const page = t.ok(t.b, 'principals.list', {});
  expect(JSON.stringify(page.data)).toContain('construction-order');
  expect(JSON.stringify(page.data)).not.toContain('完成交付不代表主观满意');
  t.act(t.b, { type: 'accept', id: 'order', expectedRevision: 1, side: 'buyer' });
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before - 30);
  expect(evidenceTradeEscrowBalance(t.r.state.world.residentTrade)).toBe(30);
  t.complete();
  const seller = t.r.state.world.agents[t.c]!.balance;
  t.act(t.c, { type: 'observe', id: 'order', expectedRevision: 2, side: 'seller' });
  expect(t.r.state.world.agents[t.c]!.balance).toBe(seller + 30);
  expect(evidenceTradeEscrowBalance(t.r.state.world.residentTrade)).toBe(0);
  expect(t.r.state.world.premises!.buildings.home).toBeDefined();
  expect(
    t.ok(t.b, 'principals.read', { kind: 'construction-order', id: 'order' }).data,
  ).toMatchObject({ order: { status: 'completed' } });
  t.replay();
});
test('time expires unpaid competing offers at their exact boundary but retains funded construction responsibilities', () => {
  const t = fixture();
  t.project();
  const at = t.r.state.world.clock.now;
  t.act(t.c, t.offer(undefined, 'expires', at + 1000));
  t.act(t.c, t.offer(undefined, 'funded', at + 2000));
  t.act(t.b, { type: 'accept', id: 'funded', expectedRevision: 1, side: 'buyer' });
  t.time(5000);
  expect(t.r.state.world.residentTrade!.constructionOrders!.orders.expires).toMatchObject({
    status: 'cancelled',
    at: at + 1000,
  });
  expect(t.r.state.world.residentTrade!.constructionOrders!.orders.funded).toMatchObject({
    status: 'funded',
    escrowMicros: 30000000,
  });
  expect(t.r.state.world.premises!.projects.p!.status).toBe('open');
  t.replay();
});
test('collective project and common-account payment require separate exact decisions; missing consumption cannot publish financial effects', () => {
  const t = fixture();
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同建造',
      terms: '独立同意',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 1000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  t.ok(t.b, 'funds.open', { id: 'pool', collectiveId: 'club', title: '共同资金' });
  t.ok(t.a, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 40, note: '自愿投入' });
  const buyer = { kind: 'collective', id: 'club' } as const;
  t.project(buyer);
  t.act(t.c, t.offer(buyer));
  const request = constructionTradeRequest({
    type: 'accept',
    id: 'order',
    expectedRevision: 1,
    side: 'buyer',
  });
  expect(t.call(t.b, 'principals.operate', { request }).ok).toBe(false);
  const execute = t.approve('fund', request),
    before = structuredClone(t.r.state);
  t.ok(t.b, 'collectives.execute', execute);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(10);
  expect(t.r.state.collectives!.decisions.fund!.status).toBe('executed');
  const last = t.r.journal.commits.find((c) =>
    c.worldEvents?.some(
      (e) =>
        e.type === 'ResidentConstructionTradeCommitted' &&
        e.payload.events[0]?.type === 'ConstructionTradeCommitted' &&
        e.payload.events[0].command.type === 'accept',
    ),
  );
  if (!last) throw Error('journal');
  expect(() => applyOpenSocietyEffects(before, { worldEvents: last.worldEvents ?? [] })).toThrow();
  expect(t.call(t.b, 'collectives.execute', execute).ok).toBe(false);
  t.complete();
  t.act(t.c, { type: 'observe', id: 'order', expectedRevision: 2, side: 'seller' });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(10);
  expect(evidenceTradeEscrowBalance(t.r.state.world.residentTrade)).toBe(0);
  t.replay();
});

test('public building creation and procurement each consume independent authority before actual personal work and payment', () => {
  const t = fixture(),
    buyer = { kind: 'public', id: t.r.state.world.publicGovernance!.authority.grant.id } as const;
  t.project(buyer);
  t.act(t.c, t.offer(buyer, 'order', t.r.state.world.clock.now + 120000));
  const before = t.r.state.world.treasury!;
  const execute = t.publicApprove(
    'procure',
    constructionTradeRequest({ type: 'accept', id: 'order', expectedRevision: 1, side: 'buyer' }),
  );
  t.ok(t.d, 'governance.execute', execute);
  expect(t.r.state.world.treasury).toBe(before - 30);
  expect(t.r.state.world.publicGovernance!.authority.proposals.procure!.status).toBe('executed');
  t.complete();
  const seller = t.r.state.world.agents[t.c]!.balance;
  t.act(t.c, { type: 'observe', id: 'order', expectedRevision: 2, side: 'seller' });
  expect(t.r.state.world.agents[t.c]!.balance).toBe(seller + 30);
  expect(t.r.state.world.premises!.buildings.home!.control.controller).toEqual(buyer);
  t.replay();
});
test('manifest declares procurement only with explicit valid dependencies and rules expose actual activation', () => {
  const input = {
    count: 4,
    continuity: true,
    publicGovernance: true,
    resourcePrincipals: true,
    premisesPrincipals: true,
  };
  const old = createOpenSocietyManifest(input),
    fresh = createOpenSocietyManifest({ ...input, constructionTrade: true });
  expect(old.initialWorld.residentTrade?.constructionOrders).toBeUndefined();
  expect(fresh.initialWorld.residentTrade?.constructionOrders?.policy.version).toBe(
    'construction-trade-v1',
  );
  expect(fresh.provenance.constructionTrade).toBe('construction-trade-v1');
  expect(() =>
    createOpenSocietyManifest({ ...input, premisesPrincipals: false, constructionTrade: true }),
  ).toThrow();
  const t = fixture();
  expect(t.ok(t.a, 'rules.read', { id: 'construction-procurement' }).data).toMatchObject({
    enabled: true,
    policySources: {
      constructionTrade: { version: 'construction-trade-v1' },
      publicConstructionTrade: { version: 'public-construction-trade-v1' },
    },
  });
});
