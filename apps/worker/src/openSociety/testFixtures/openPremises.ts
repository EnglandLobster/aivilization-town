import { asLocationId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from '../manifest';
import { OpenSocietyRuntime } from '../runtime';
export const premisesCleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of premisesCleanup.reverse()) f();
  premisesCleanup.length = 0;
});
export function openPremisesFixture(
  enabled = true,
  facilityUse = true,
  blueprintExtras: Record<string, string | number> = {},
  options: {
    /** Further manifest options, e.g. features a test needs from the start. */
    manifest?: Partial<Parameters<typeof createOpenSocietyManifest>[0]>;
    wearIntervalMs?: number;
    wearPerInterval?: number;
    principals?: boolean;
    elapsedRest?: boolean;
    initialEnergy?: number;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'resident-premises-'));
  premisesCleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
      count: 4,
      continuity: true,
      ...(options.elapsedRest ? { elapsedRest: true } : {}),
      premises: enabled,
      facilityUse,
      ...(options.principals ? { resourcePrincipals: true, publicGovernance: true } : {}),
      ...options.manifest,
    }),
    site = Object.values(m.initialWorld.premises?.sites ?? {})[0],
    location =
      site?.parentLocationId ??
      Object.values(m.initialWorld.locations).find((l) => l.connections !== undefined)!.locationId;
  const manifest = {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      ...(m.initialWorld.premises
        ? {
            premises: {
              ...m.initialWorld.premises,
              policy: {
                ...m.initialWorld.premises.policy,
                ...(options.wearIntervalMs !== undefined
                  ? { wearIntervalMs: options.wearIntervalMs }
                  : {}),
                ...(options.wearPerInterval !== undefined
                  ? { wearPerInterval: options.wearPerInterval }
                  : {}),
              },
            },
          }
        : {}),
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, a]) => [
          id,
          {
            ...a,
            locationId: asLocationId(location),
            // Explicit fixture: donor holds construction stock; builders carry only their later production inputs.
            inventory: id === m.residents[0]!.id ? { Wood: 20, 'Iron Ingot': 5 } : { Wood: 20 },
            physiology: { energy: options.initialEnergy ?? 100, satiety: 100, health: 100 },
          },
        ]),
      ),
    },
  };
  const r = new OpenSocietyRuntime(root, {
    ...manifest,
    worldPolicies: serializableWorldPolicy(m.seed, manifest.initialWorld, m.rhythm),
  });
  premisesCleanup.push(() => r.close());
  const [a, b, c, d] = m.residents.map((r) => r.id) as [string, string, string, string];
  let n = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `prem-${++n}`,
  ) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: '工程验收' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const v = call(actor, name, args, requestId);
    expect(v.ok, `${name}:${v.error}`).toBe(true);
    return v;
  };
  const time = (ms: number) => {
    const v = r.advanceTime(ms, `time-${++n}`);
    expect(v.ok, v.error).toBe(true);
  };
  const stock = () => r.state.world.materials!.stocks.s!,
    project = () => r.state.world.premises!.projects.p!;
  const blueprint = {
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    workstations: 0,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 0,
    ...blueprintExtras,
  };
  const reserve = (
    expiresAt = r.state.world.clock.now + 1000000,
    items: Record<string, number> = { Wood: 8 },
  ) => {
    ok(a, 'stocks.create', { id: 's', title: '材料', locationId: location });
    ok(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items });
    ok(a, 'materials.reserve', {
      id: 'r',
      stockId: 's',
      expectedStockRevision: stock().revision,
      beneficiaryKind: 'resident',
      beneficiaryId: b,
      consumerDomain: 'premises',
      consumerId: 'p',
      items,
      terms: '建造这一个房屋',
      expiresAt,
    });
  };
  const create = () =>
    ok(b, 'construction.create', {
      id: 'p',
      kind: 'build',
      buildingId: 'home',
      siteId: site!.id,
      expectedSiteRevision: r.state.world.premises!.sites[site!.id]!.revision,
      controllerKind: 'resident',
      controllerId: b,
      title: '自行命名',
      description: '用途和合作者由居民决定',
      workers: [b, c],
      reservationRefs: ['r@1'],
      ...blueprint,
    });
  return {
    r,
    root,
    manifest,
    site,
    location,
    a,
    b,
    c,
    d,
    call,
    ok,
    time,
    stock,
    project,
    blueprint,
    reserve,
    create,
  };
}
