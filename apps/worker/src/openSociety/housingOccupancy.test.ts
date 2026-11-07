import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenSocietyRuntime } from './runtime';
import { openPremisesFixture, premisesCleanup } from './testFixtures/openPremises';
function replay(t: ReturnType<typeof openPremisesFixture>) {
  const before = structuredClone(t.r.state),
    bytes = readFileSync(join(t.root, 'journal.jsonl'));
  t.r.close();
  const r = new OpenSocietyRuntime(t.root);
  premisesCleanup.push(() => r.close());
  expect(r.state).toEqual(before);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
  return r;
}
test('real construction, independent residence permit, travel and registration remain distinct; expiry retains actual residence until personal departure', () => {
  const t = openPremisesFixture();
  const original = readFileSync(join(t.root, 'manifest.json')),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.c, 'housing.occupancy', {}).error).toBe('housing-occupancy-not-enabled');
  const enabled = t.r.enableHousingOccupancy();
  expect(enabled.ok).toBe(true);
  expect(t.r.enableHousingOccupancy()).toEqual(enabled);
  expect(t.r.state.world.agents).toEqual(before.agents);
  t.reserve();
  t.create();
  expect(t.r.state.world.locations['premises-home']).toBeUndefined();
  t.ok(t.b, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.project().plan.workMs,
  });
  t.time(t.project().plan.workMs);
  expect(t.r.state.world.premises!.buildings.home!.embodied).toEqual({ Wood: 8 });
  expect(t.stock().inventory).toEqual({});
  const at = t.r.state.world.clock.now,
    endAt = at + 3600000;
  t.ok(t.b, 'permits.offer', {
    id: 'living',
    buildingId: 'home',
    buildingRevision: t.r.state.world.premises!.buildings.home!.revision,
    granteeKind: 'resident',
    granteeId: t.c,
    users: [t.c],
    scopes: ['reside'],
    mode: 'shared',
    title: 'A residence',
    terms: 'Independent fixed period',
    startAt: at,
    endAt,
    acceptBy: at + 60000,
  });
  const originalHome = t.r.state.world.agents[t.c]!.residenceLocationId;
  t.ok(t.c, 'permits.accept', { id: 'living', expectedRevision: 1 });
  expect(t.r.state.world.agents[t.c]!.residenceLocationId).toBe(originalHome);
  expect(t.call(t.c, 'world.choose_residence', { locationId: 'premises-home' }).ok).toBe(false);
  t.ok(t.c, 'world.move', { targetLocationId: 'premises-home' });
  t.time(t.r.state.world.activityTimeByAgent[t.c]!.availableAt - t.r.state.world.clock.now);
  t.ok(t.c, 'world.choose_residence', { locationId: 'premises-home' });
  const view = t.ok(t.c, 'housing.occupancy', {}).data;
  expect(view).toMatchObject({
    residenceId: 'premises-home',
    locationId: 'premises-home',
    currentPermission: true,
    physicallyAvailable: true,
    registeredOccupants: 1,
    revision: 2,
    personalRights: { total: 1 },
  });
  expect(t.r.context(t.c).self).toMatchObject({ housingOccupancyWith: 'town housing occupancy' });
  t.time(endAt - t.r.state.world.clock.now);
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    residenceId: 'premises-home',
    currentPermission: false,
    physicallyAvailable: true,
    requiresRightsResolution: true,
    personalRights: { total: 0 },
  });
  const occupied = structuredClone(t.r.state.world);
  expect(
    t.call(t.d, 'housing.leave', { expectedResidenceId: 'premises-home', expectedRevision: 2 }).ok,
  ).toBe(false);
  expect(
    t.call(t.c, 'housing.leave', {
      expectedResidenceId: 'premises-home',
      expectedRevision: 2,
      actorId: t.d,
    }).ok,
  ).toBe(false);
  t.ok(t.c, 'housing.leave', { expectedResidenceId: 'premises-home', expectedRevision: 2 });
  expect(t.r.state.world.agents[t.c]).toEqual({
    ...occupied.agents[t.c],
    residenceLocationId: null,
  });
  expect(t.r.state.world.premisesRights).toEqual(occupied.premisesRights);
  expect(t.r.state.world.residentCommerce).toEqual(occupied.residentCommerce);
  expect(t.r.state.world.moneySupply).toBe(occupied.moneySupply);
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    residenceId: null,
    locationId: 'premises-home',
    revision: 3,
  });
  expect(t.call(t.c, 'world.choose_residence', { locationId: 'premises-home' }).ok).toBe(false);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(original);
  expect(replay(t).enableHousingOccupancy()).toEqual(enabled);
});
test('leaving registered residence does not cancel accepted private rent or return held deposits, and replay preserves that obligation', () => {
  const t = openPremisesFixture();
  expect(t.r.enableHousingOccupancy().ok).toBe(true);
  for (const actor of [t.b, t.c]) {
    t.ok(actor, 'world.move', { targetLocationId: 'residential-block' });
    t.time(t.r.state.world.activityTimeByAgent[actor]!.availableAt - t.r.state.world.clock.now);
  }
  t.ok(t.b, 'leases.offer', {
    id: 'private',
    tenantId: t.c,
    locationId: 'residential-block',
    terms: 'Separate contribution',
    rent: 2,
    deposit: 5,
    expiresAt: t.r.state.world.clock.now + 3 * 86400000,
  });
  t.ok(t.c, 'leases.accept', { id: 'private', expectedRevision: 1 });
  const before = structuredClone(t.r.state.world);
  const revision = t.r.state.world.housingOccupancy!.revisions[t.c] ?? 1;
  t.ok(t.c, 'housing.leave', {
    expectedResidenceId: 'residential-block',
    expectedRevision: revision,
  });
  expect(t.r.state.world.residentLeases).toEqual(before.residentLeases);
  expect(t.r.state.world.residentCommerce).toEqual(before.residentCommerce);
  expect(t.r.state.world.agents[t.c]).toEqual({ ...before.agents[t.c], residenceLocationId: null });
  t.time(86400000);
  expect(t.r.state.world.residentLeases!.leases.private).toMatchObject({
    status: 'active',
    rent: 2,
    deposit: 5,
  });
  expect(t.r.state.world.residentCommerce!.deposits['lease-deposit-private']!.status).toBe('held');
  replay(t);
});
