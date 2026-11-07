import { expect, test } from 'vitest';
import { type ResourcePrincipal, type PrincipalControlCommand } from '@aivilization/authority';
import { type MaterialReservation } from '@aivilization/materials';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  emptyPremisesState,
  applyPremisesEvent,
  applyPremisesCommit,
  PREMISES_PRINCIPALS_POLICY,
  createConstruction,
  startConstruction,
  progressConstruction,
  finalizeConstruction,
  managePremises,
  initialPublicSiteGrant,
  decidePremisesPrincipalControl,
  type PremisesPorts,
  type PrincipalCreateConstruction,
  type ConstructionWorkDecision,
  type PremisesEvent,
  type ConstructionEffort,
} from './index';
function fixture(principal: ResourcePrincipal = { kind: 'enterprise', id: 'firm' }) {
  let state = applyPremisesEvent(emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY), {
    type: 'ConstructionSiteRegistered',
    site: {
      id: 'site',
      parentLocationId: 'street',
      usableFloorArea: 16,
      occupiedFloorArea: 0,
      reservedFloorArea: 0,
      accessTravelMs: 1000,
      revision: 1,
      source: 'scenario-seed',
      sourceId: 'seed',
    },
  });
  const initial = state,
    commits: { events: readonly PremisesEvent[]; efforts: readonly ConstructionEffort[] }[] = [];
  let reservation: MaterialReservation = {
    id: 'r',
    stockId: 's',
    beneficiary: principal,
    consumer: { domain: 'premises', id: 'p' },
    original: { Wood: 8 },
    held: { Wood: 8 },
    allocated: {},
    returned: {},
    createdBy: 'donor',
    terms: '独立供料',
    expiresAt: 1000000,
    revision: 1,
    at: 0,
    status: 'offered',
    principalVersion: 'resource-principals-v2',
  };
  const ports: PremisesPorts = {
    exists: (id) => ['manager', 'worker', 'donor'].includes(id),
    present: () => true,
    idle: () => true,
    body: () => ({ energy: 100, satiety: 100, capable: true }),
    reservation: () => reservation,
    stockLocation: () => 'street',
    authorize: () => undefined,
    controlAvailable: () => true,
    principalAvailable: () => true,
    authorizePrincipal: (p, request) => ({
      actorId: 'manager',
      principal: p,
      request,
      source:
        p.kind === 'enterprise'
          ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
          : { kind: 'public', proposalId: 'approved', procedureRevision: 1 },
    }),
    siteGrant: (id, p) => initialPublicSiteGrant(state, id, p),
    occupiedOrReserved: () => 0,
    hasObligations: () => false,
    sessionReserved: () => true,
  };
  const c: PrincipalCreateConstruction = {
    id: 'p',
    kind: 'build',
    buildingId: 'home',
    siteId: 'site',
    expectedSiteRevision: 1,
    controller: principal,
    title: '居民自行定义的住宅',
    description: '真实建设',
    blueprint: {
      primaryUse: 'residence',
      floorArea: 8,
      capacity: 2,
      fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
    },
    workers: ['worker'],
    reservations: [{ id: 'r', revision: 1 }],
  };
  const commit = (d: ConstructionWorkDecision) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    const efforts = d.effort ? [d.effort] : [];
    state = applyPremisesCommit(state, d.events, efforts).state;
    commits.push({ events: d.events, efforts });
    return d;
  };
  const enable = () =>
    commit({
      accepted: true,
      events: [{ type: 'PremisesResourcePrincipalsEnabled', policy: PREMISES_PRINCIPALS_POLICY }],
      materials: [],
    });
  const build = () => {
    enable();
    commit(createConstruction(state, 'manager', 0, 'create', c, ports, true));
    reservation = { ...reservation, status: 'bound', revision: 2, boundBy: 'manager' };
    commit(startConstruction(state, 'worker', 0, 'p', 1, 480000, ports));
    commit(progressConstruction(state, 'worker', 480000, 'p', 'work', ports));
    commit(finalizeConstruction(state, 'worker', 480000, 'p', 'complete', ports));
  };
  return {
    get state() {
      return state;
    },
    ports,
    c,
    commit,
    enable,
    build,
    replay: () => {
      let s = initial;
      for (const h of commits) s = applyPremisesCommit(s, h.events, h.efforts).state;
      expect(s).toEqual(state);
    },
  };
}
test('enterprise and public construction require separate authority, real workers and material evidence; final worker is not the owner', () => {
  for (const kind of ['enterprise', 'public'] as const) {
    const t = fixture({ kind, id: kind === 'enterprise' ? 'firm' : 'town' });
    expect(createConstruction(t.state, 'manager', 0, 'early', t.c, t.ports, true)).toMatchObject({
      accepted: false,
    });
    t.enable();
    expect(createConstruction(t.state, 'worker', 0, 'steal', t.c, t.ports, true)).toMatchObject({
      accepted: false,
    });
    const created = t.commit(
      createConstruction(t.state, 'manager', 0, 'create', t.c, t.ports, true),
    );
    expect(t.state.buildings).toEqual({});
    expect(t.state.projects.p!.session).toBeUndefined();
    expect(created.materials[0]!.authorization.beneficiary).toEqual(t.c.controller);
    const standalone = t.state;
    expect(() =>
      applyPremisesCommit(standalone, [
        {
          type: 'PremisesBuildingChanged',
          building: {
            id: 'fake',
            siteId: 'site',
            locationId: 'fake',
            ownerId: 'worker',
            control: {
              policyVersion: 'resource-control-v1',
              controller: { kind: 'resident', id: 'worker' },
              version: 1,
              at: 0,
              changedBy: 'worker',
            },
            title: 'fake',
            blueprint: t.c.blueprint,
            condition: 1000,
            status: 'operational',
            access: { entry: 'public', visitors: [], operators: [], residents: [] },
            embodied: { Wood: 8 },
            salvage: {},
            footprintReleased: false,
            wearSettledAt: 0,
            revision: 1,
            at: 0,
          },
        },
      ]),
    ).toThrow();
    t.replay();
  }
});
test('actual completion creates principal-controlled building; old creator/worker cannot administer or erase existing authority', () => {
  const t = fixture();
  t.build();
  const b = t.state.buildings.home!;
  expect(b.control.controller).toEqual({ kind: 'enterprise', id: 'firm' });
  expect(b.ownerId).toBe('manager');
  expect(b.control.version).toBe(1);
  expect(b.embodied).toEqual({ Wood: 8 });
  expect(t.state.projects.p!.progressMs).toBe(480000);
  expect(t.state.sites.site!.occupiedFloorArea).toBe(8);
  expect(
    managePremises(t.state, 'worker', 480000, 'home', 1, { type: 'close' }, t.ports),
  ).toMatchObject({ accepted: false });
  expect(
    managePremises(
      t.state,
      'manager',
      480000,
      'home',
      1,
      { type: 'close' },
      { ...t.ports, authorizePrincipal: () => undefined },
    ),
  ).toMatchObject({ accepted: false });
  const d = managePremises(
    t.state,
    'manager',
    480000,
    'home',
    1,
    {
      type: 'configure',
      title: '开放住宅',
      access: { entry: 'public', visitors: [], operators: [], residents: ['worker'] },
    },
    t.ports,
  );
  if (!d.accepted) throw Error(d.reason);
  expect(() =>
    applyPremisesCommit(
      t.state,
      d.events.filter((e) => e.type !== 'PremisesPrincipalOperationRecorded'),
    ),
  ).toThrow('principal-building-operation-proof-required');
  t.commit(d);
  expect(t.state.buildings.home!.control).toEqual(b.control);
  expect(
    managePremises(
      t.state,
      'manager',
      480000,
      'home',
      2,
      { type: 'close' },
      { ...t.ports, occupiedOrReserved: () => 1 },
    ),
  ).toMatchObject({ accepted: false, reason: 'premises-unsettled' });
  t.commit(managePremises(t.state, 'manager', 480000, 'home', 2, { type: 'close' }, t.ports));
  t.replay();
});
test('cancel preserves real partial effort, releases the project and returns source obligations without producing a building', () => {
  const t = fixture();
  t.enable();
  t.commit(createConstruction(t.state, 'manager', 0, 'create', t.c, t.ports, true));
  t.commit(startConstruction(t.state, 'worker', 0, 'p', 1, 480000, t.ports));
  const d = progressConstruction(t.state, 'manager', 120000, 'p', 'cancel', t.ports, 'cancel');
  if (!d.accepted) throw Error(d.reason);
  // Application composes both domain decisions in one atomic commit.
  const interim = d.events.reduce(applyPremisesEvent, t.state),
    proof = d.events.find((e) => e.type === 'PremisesPrincipalOperationRecorded');
  const r = t.ports.reservation('r')!;
  const final = finalizeConstruction(
    interim,
    'manager',
    120000,
    'p',
    'cancel',
    {
      ...t.ports,
      reservation: () => ({ ...r, status: 'bound', revision: 2, boundBy: 'manager' }),
    },
    true,
    proof?.type === 'PremisesPrincipalOperationRecorded' ? proof.receipt.authorization : undefined,
  );
  if (!final.accepted) throw Error(final.reason);
  expect(() =>
    applyPremisesCommit(
      t.state,
      [...d.events, ...final.events].filter((e) => e.type !== 'PremisesPrincipalOperationRecorded'),
      d.effort ? [d.effort] : [],
    ),
  ).toThrow('principal-construction-cancel-proof-required');
  t.commit({ ...d, events: [...d.events, ...final.events], materials: final.materials });
  expect(t.state.projects.p).toMatchObject({ status: 'cancelled', progressMs: 120000 });
  expect(t.state.buildings).toEqual({});
  expect(t.state.sites.site!.reservedFloorArea).toBe(0);
  expect(final.materials[0]!.authorization).toMatchObject({ finish: true });
  expect(final.materials[0]!.authorization.allocation).toBeUndefined();
  t.replay();
});

test('maximum valid building identifiers still allow uniquely versioned principal administrative receipts', () => {
  const t = fixture();
  t.build();
  const old = t.state.buildings.home!,
    id = 'b'.repeat(96);
  const state = { ...t.state, buildings: { [id]: { ...old, id } } };
  const d = managePremises(
    state,
    'manager',
    480000,
    id,
    old.revision,
    { type: 'configure', title: '长标识', access: old.access },
    t.ports,
  );
  if (!d.accepted) throw Error(d.reason);
  const after = applyPremisesCommit(state, d.events).state;
  expect(after.buildings[id]!.title).toBe('长标识');
  expect(Object.keys(after.principalReceipts ?? {})).toContain(
    `premises-${id}-${old.revision + 1}`,
  );
});

test('bilateral building custody preserves physical facts and historical project; pending/expired/stale or legacy consent cannot become current control', () => {
  const t = fixture();
  t.build();
  const original = t.state.buildings.home!;
  let state = t.state;
  const apply = (event: Extract<PremisesEvent, { type: 'PremisesPrincipalControlChanged' }>) => {
    state = applyPremisesCommit(state, [event]).state;
  };
  const request = (command: PrincipalControlCommand) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: state.buildings.home!.revision,
    controlVersion: state.buildings.home!.control.version,
    command,
  });
  const decide = (actorId: string, command: PrincipalControlCommand, at = 480000) =>
    decidePremisesPrincipalControl({
      state,
      actorId,
      at,
      request: request(command),
      available: () => true,
      authorize: (principal, request) => ({
        actorId,
        principal,
        request,
        source:
          principal.kind === 'resident'
            ? { kind: 'personal' }
            : { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
      }),
    });
  const offer = decide('manager', {
    type: 'offer',
    target: { kind: 'resident', id: 'worker' },
    terms: '不抹掉任何义务',
    expiresAt: 490000,
  });
  if (!offer.accepted) throw Error(offer.reason);
  apply(offer.event);
  expect(state.buildings.home!.control.controller).toEqual(original.control.controller);
  expect(decide('manager', { type: 'accept' }).accepted).toBe(false);
  expect(decide('worker', { type: 'accept' }, 490000).accepted).toBe(false);
  expect(
    managePremises(
      state,
      'manager',
      480000,
      'home',
      state.buildings.home!.revision,
      { type: 'close' },
      t.ports,
    ).accepted,
  ).toBe(false);
  const accept = decide('worker', { type: 'accept' });
  if (!accept.accepted) throw Error(accept.reason);
  apply(accept.event);
  expect(state.buildings.home!.control.controller).toEqual({ kind: 'resident', id: 'worker' });
  expect(state.buildings.home!.ownerId).toBe('manager');
  expect(state.buildings.home!.embodied).toEqual(original.embodied);
  expect(state.buildings.home!.blueprint).toEqual(original.blueprint);
  expect(state.buildings.home!.access).toEqual(original.access);
  expect(state.projects.p!.controller).toEqual({ kind: 'enterprise', id: 'firm' });
  expect(() => applyPremisesCommit(state, [accept.event])).toThrow();
  expect(() =>
    applyPremisesCommit(t.state, [
      offer.event,
      { type: 'PremisesBuildingChanged', building: { ...original, revision: 2, at: 480000 } },
    ]),
  ).toThrow();
  expect(
    applyPremisesCommit(applyPremisesCommit(t.state, [offer.event]).state, [accept.event]).state,
  ).toEqual(state);
});
