import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from '../manifest';
import { OpenSocietyRuntime } from '../runtime';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
export function openFreightFixture(
  enabled = true,
  evidenceTrade = true,
  commonMaxBalance = 1000000000,
  publicGoodsProcurement = false,
) {
  const root = mkdtempSync(join(tmpdir(), 'resident-logistics-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({
    count: 5,
    continuity: true,
    logistics: enabled,
    evidenceTrade,
    ...(publicGoodsProcurement
      ? { publicGovernance: true, publicProcurement: true, publicGoodsProcurement: true }
      : {}),
  });
  const [a, b, c, d, outsider] = manifest.residents.map((r) => r.id) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const west = manifest.initialWorld.agents[a]!.locationId!,
    east = Object.values(manifest.initialWorld.locations).find(
      (l) => l.locationId !== west && l.kind === 'market',
    )!.locationId;
  const initialWorld = {
    ...manifest.initialWorld,
    commonAccounts: {
      ...manifest.initialWorld.commonAccounts!,
      policy: {
        ...manifest.initialWorld.commonAccounts!.policy,
        maxBalance: commonMaxBalance,
        maxTransfer: Math.min(
          commonMaxBalance,
          manifest.initialWorld.commonAccounts!.policy.maxTransfer,
        ),
      },
    },
    agents: Object.fromEntries(
      Object.entries(manifest.initialWorld.agents).map(([id, agent]) => [
        id,
        {
          ...agent,
          inventory: { Wood: id === a ? 10 : 1 },
          locationId: id === c ? east : west,
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
    residentMobility: {
      ...manifest.initialWorld.residentMobility!,
      vehicles: Object.fromEntries(
        Object.entries(manifest.initialWorld.residentMobility!.vehicles).map(([id, v]) => [
          id,
          { ...v, locationId: west },
        ]),
      ),
    },
  };
  const runtime = new OpenSocietyRuntime(root, {
    ...manifest,
    initialWorld,
    worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
  });
  cleanup.push(() => runtime.close());
  let n = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown> = {},
    requestId = `freight-test-${++n}`,
  ) => {
    runtime.beginTurn(actor);
    const r = runtime.invoke(actor, { name, arguments: args, requestId });
    runtime.finishTurn(actor, { summary: 'Explicit freight engineering acceptance' });
    return r;
  };
  const ok = (
    actor: string,
    name: string,
    args: Record<string, unknown> = {},
    requestId?: string,
  ) => {
    const result = call(actor, name, args, requestId);
    expect(result.ok, `${name}:${result.error}`).toBe(true);
    return result;
  };
  const time = (ms: number) => {
    const r = runtime.advanceTime(ms, `freight-tick-${++n}`);
    expect(r.ok, r.error).toBe(true);
  };
  const freight = () => runtime.state.world.logistics!.freight.parcel!;
  const op = (actor: string, operation: string) =>
    ok(actor, `freight.${operation}`, { id: 'parcel', expectedRevision: freight().revision });
  const prepare = (vehicle = false, collectivePayer = false) => {
    ok(a, 'stocks.create', { id: 'src', title: '来源', locationId: west });
    ok(c, 'stocks.create', { id: 'dst', title: '接收', locationId: east });
    ok(a, 'stocks.deposit', { id: 'src', expectedRevision: 1, items: { Wood: 8 } });
    ok(a, 'materials.reserve', {
      id: 'goods',
      stockId: 'src',
      expectedStockRevision: 2,
      beneficiaryKind: 'resident',
      beneficiaryId: a,
      consumerDomain: 'logistics',
      consumerId: 'parcel',
      items: { Wood: 4 },
      terms: '只运这一份原物',
      expiresAt: runtime.state.world.clock.now + 86400000,
    });
    ok(a, 'freight.offer', {
      id: 'parcel',
      controllerKind: 'resident',
      controllerId: a,
      recipientKind: 'resident',
      recipientId: c,
      sourceStockId: 'src',
      destinationStockId: 'dst',
      sourceLocationId: west,
      destinationLocationId: east,
      reservationId: 'goods',
      reservationRevision: 1,
      items: { Wood: 4 },
      carrierId: b,
      ...(vehicle ? { vehicleId: 'seed-car-1' } : {}),
      payerSector: collectivePayer ? 'collective' : 'agent',
      payerId: collectivePayer ? 'pool' : d,
      deliveryFee: 8,
      returnFee: 3,
      deadline: runtime.state.world.clock.now + 86400000,
      title: '居民自拟运输',
      terms: '真实交付或退回才付对应费用',
    });
    op(c, 'accept');
    if (!collectivePayer) op(d, 'fund');
    if (vehicle)
      ok(a, 'vehicles.authorize', { id: 'seed-car-1', residentId: b, expectedRevision: 1 });
  };
  const arrive = () =>
    time(runtime.state.world.transitByAgent![b]!.arrivesAt - runtime.state.world.clock.now);
  const replay = () => {
    const state = structuredClone(runtime.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    runtime.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    return next;
  };
  return {
    r: runtime,
    root,
    a,
    b,
    c,
    d,
    outsider,
    west,
    east,
    call,
    ok,
    op,
    prepare,
    freight,
    time,
    arrive,
    replay,
  };
}
