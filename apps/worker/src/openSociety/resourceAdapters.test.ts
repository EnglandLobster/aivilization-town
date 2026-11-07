import { authorizedDriver } from '@aivilization/mobility';
import { openPermitsFixture } from './testFixtures/openPermits';
import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { resourcePrincipalSnapshot } from '@aivilization/authority';
import { resourceSaleRequest, type ResourceSaleCommand } from '@aivilization/commerce';
import {
  applyWorldEvent,
  worldResourceSaleSource,
  enableResourceAdaptersEvent,
} from '@aivilization/world';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(mobility = false) {
  const root = mkdtempSync(join(tmpdir(), 'independent-resources-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: mobility,
    societyKernel: true,
    materials: true,
    mobility,
    premises: false,
    publicGovernance: false,
  });
  // Explicit engineering endowment, not a production claim.
  const initialWorld = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        { ...a, inventory: { Wood: 3 } },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, { ...m, initialWorld });
  clean.push(() => r.close());
  const [a, b, c] = m.residents.map((x) => x.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId: `i${++n}` });
    r.finishTurn(actor, { summary: 'engineering only' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const v = call(actor, name, args);
    expect(v.ok, v.error).toBe(true);
    return v;
  };
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { root, r, a, b, c, call, ok, replay };
}
test('stock-only world independently sells real control, charges both accounts atomically, and never grants public scope', () => {
  const t = fixture(),
    w = t.r.state.world;
  expect(w.publicGovernance).toBeUndefined();
  expect(w.premises).toBeUndefined();
  expect(w.residentMobility).toBeUndefined();
  expect(t.r.enableResourcePrincipals().ok).toBe(false);
  const manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableResourceAdapters(['stock']).ok).toBe(true);
  const revision = t.r.state.revision;
  expect(t.r.enableResourceAdapters(['stock']).ok).toBe(true);
  expect(t.r.state.revision).toBe(revision);
  expect(t.r.state.world.publicGovernance).toBeUndefined();
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.ok(t.a, 'stocks.create', {
    id: 's',
    locationId: w.agents[t.a]!.locationId,
    title: 'private stock',
  });
  t.ok(t.a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 2 } });
  const stock = () => t.r.state.world.materials!.stocks.s!;
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'stock',
    resourceId: 's',
    resourceRevision: stock().revision,
    controlVersion: resourcePrincipalSnapshot(stock()).version,
    command,
  });
  const terms = {
    type: 'offer',
    target: { kind: 'resident', id: t.b },
    terms: 'chosen terms',
    expiresAt: w.clock.now + 100000,
  };
  expect(t.call(t.c, 'principals.control', { request: control(terms) }).ok).toBe(false);
  expect(
    t.call(t.a, 'principals.control', {
      request: control({ ...terms, target: { kind: 'public', id: 'town' } }),
    }).ok,
  ).toBe(false);
  t.ok(t.a, 'principals.control', { request: control(terms) });
  const request = (command: ResourceSaleCommand) =>
    resourceSaleRequest(
      t.r.state.world.resourceSales!,
      command,
      worldResourceSaleSource(t.r.state.world, 's', 'stock'),
    );
  t.ok(t.a, 'principals.operate', {
    request: request({
      type: 'offer',
      id: 'sale',
      title: 'stock control',
      terms: 'no fabricated goods',
      resource: { kind: 'stock', id: 's', expectedRevision: stock().revision },
      payer: { sector: 'agent', id: t.b },
      revenue: { sector: 'agent', id: t.a },
      amount: 1,
      acceptBy: stock().control.offer!.expiresAt,
    }),
  });
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.b, 'principals.control', { request: control({ type: 'accept' }) }).error).toBe(
    'paid-resource-sale-acceptance-required',
  );
  expect(
    t.call(t.c, 'principals.operate', {
      request: request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    }).ok,
  ).toBe(false);
  expect(t.r.state.world).toEqual(before);
  t.ok(t.b, 'principals.operate', {
    request: request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
  });
  expect(stock().control.controller).toEqual({ kind: 'resident', id: t.b });
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before.agents[t.a]!.balance + 1);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance - 1);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(stock().inventory).toEqual(before.materials!.stocks.s!.inventory);
  expect(worldResourceSaleSource(t.r.state.world, 'missing', 'vehicle')).toBeUndefined();
  t.replay();
});
test('closed activation is atomic, validates resource presence, and cannot remove an existing adapter or run during a resident turn', () => {
  const t = fixture(),
    before = structuredClone(t.r.state.world);
  for (const kinds of [[], ['stock', 'stock'], ['unknown'], ['stock', 'vehicle']]) {
    expect(t.r.enableResourceAdapters(kinds).ok).toBe(false);
    expect(t.r.state.world).toEqual(before);
  }
  t.r.beginTurn(t.a);
  expect(t.r.enableResourceAdapters(['stock']).error).toBe('resident-turn-active');
  t.r.finishTurn(t.a, { summary: 'engineering only' });
  expect(t.r.enableResourceAdapters(['stock']).ok).toBe(true);
  const e = enableResourceAdaptersEvent({
    projection: t.r.state.world,
    kinds: ['stock'],
    simulationId: t.r.manifest.simulationId,
    requestId: 'proof',
    nextSequence: t.r.state.worldSequence + 1,
  });
  expect(applyWorldEvent(t.r.state.world, e)).toEqual(t.r.state.world);
  if (e.type !== 'ResidentResourceAdaptersEnabled') throw Error('wrong event');
  expect(() =>
    applyWorldEvent(t.r.state.world, { ...e, payload: { ...e.payload, kinds: ['vehicle'] } }),
  ).toThrow();
  t.replay();
});

test('building adapter operates independently of material principal and public grants', () => {
  const t = openPermitsFixture();
  expect(t.r.state.world.publicGovernance).toBeUndefined();
  expect(t.r.enableResourceAdapters(['premises']).ok).toBe(true);
  expect(t.r.state.world.materials!.resourcePrincipals).toBeUndefined();
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: t.building().revision,
    controlVersion: t.building().control.version,
    command,
  });
  t.ok(t.b, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'resident', id: t.c },
      terms: 'chosen building transfer',
      expiresAt: t.r.state.world.clock.now + 100000,
    }),
  });
  t.ok(t.c, 'principals.control', { request: control({ type: 'accept' }) });
  expect(t.building().control.controller).toEqual({ kind: 'resident', id: t.c });
  expect(t.r.state.world.publicGovernance).toBeUndefined();
  t.replay();
});

test('vehicle control has its own explicit adapter without granting material or public power', () => {
  const t = fixture(true);
  const vehicle = () => Object.values(t.r.state.world.residentMobility!.vehicles)[0]!;
  expect(vehicle().ownerId).toBe(t.a);
  expect(t.r.enableResourceAdapters(['vehicle']).ok).toBe(true);
  expect(t.r.state.world.materials!.resourcePrincipals).toBeUndefined();
  const before = structuredClone(vehicle());
  const request = (command: Record<string, unknown>) => ({
    resourceKind: 'vehicle',
    resourceId: vehicle().id,
    resourceRevision: vehicle().revision,
    controlVersion: resourcePrincipalSnapshot(vehicle()).version,
    command,
  });
  t.ok(t.a, 'principals.control', {
    request: request({
      type: 'offer',
      target: { kind: 'resident', id: t.b },
      terms: 'independent vehicle transfer',
      expiresAt: t.r.state.world.clock.now + 100000,
    }),
  });
  t.ok(t.b, 'principals.control', { request: request({ type: 'accept' }) });
  expect(vehicle().control!.controller).toEqual({ kind: 'resident', id: t.b });
  expect(vehicle().locationId).toBe(before.locationId);
  for (const actor of [t.a, t.b, t.c])
    expect(authorizedDriver(vehicle(), actor)).toBe(authorizedDriver(before, actor));
  expect(t.r.state.world.publicGovernance).toBeUndefined();
  t.replay();
});
