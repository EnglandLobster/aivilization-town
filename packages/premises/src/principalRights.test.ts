import { expect, test } from 'vitest';
import { type ResourcePrincipal, type PrincipalAuthoritySource } from '@aivilization/authority';
import { type PremisesBuilding } from './model';
import { applyPremisesRightsEvent, decidePremisesRights, expirePremisesRights } from './rights';
import {
  applyPrincipalPremisesRightsEvent,
  decidePrincipalPremisesRights,
  principalPermitTradeRequest,
} from './principalRights';
import { premisesPermitAllows, premisesHasPermitObligations } from './rightsAccess';
import {
  PRINCIPAL_PREMISES_RIGHTS_POLICY,
  PREMISES_RIGHTS_POLICY,
  type PrincipalPremisesRightsCommand,
  type PrincipalPremisesRightsPorts,
  type PrincipalPremisesRightsEvent,
  type PremisesRightsEvent,
} from './rightsModel';
function fixture(grantee: ResourcePrincipal = { kind: 'resident', id: 'user' }) {
  const issuer: ResourcePrincipal = { kind: 'enterprise', id: 'firm' };
  const base = applyPremisesRightsEvent(undefined, {
    type: 'PremisesRightsEnabled',
    policy: PREMISES_RIGHTS_POLICY,
  });
  let state = applyPrincipalPremisesRightsEvent(base, {
    type: 'PrincipalPremisesRightsEnabled',
    policy: PRINCIPAL_PREMISES_RIGHTS_POLICY,
  });
  const history: (PrincipalPremisesRightsEvent | PremisesRightsEvent)[] = [];
  let actorId = 'manager';
  let building: PremisesBuilding = {
    id: 'hall',
    siteId: 'site',
    locationId: 'room',
    ownerId: 'historic-author',
    title: 'Hall',
    control: {
      policyVersion: 'resource-principals-v2',
      controller: issuer,
      version: 1,
      at: 0,
      authorization: {
        actorId: 'manager',
        principal: issuer,
        source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
        request: {
          resourceKind: 'premises',
          resourceId: 'hall',
          resourceRevision: 1,
          controlVersion: 1,
          command: { type: 'cancel' },
        },
      },
    },
    blueprint: {
      primaryUse: 'residence',
      floorArea: 20,
      capacity: 4,
      fixtures: { workstations: 1, careStations: 0, teachingStations: 0, storageUnits: 10 },
    },
    condition: 1000,
    status: 'operational',
    access: { entry: 'listed', visitors: [], operators: [], residents: [] },
    embodied: { Wood: 10 },
    salvage: {},
    footprintReleased: false,
    wearSettledAt: 0,
    revision: 1,
    at: 0,
  };
  const ports: PrincipalPremisesRightsPorts = {
    building: () => building,
    exists: (id) => ['manager', 'user', 'guest'].includes(id),
    available: () => true,
    authorize: (principal, request) => {
      const source: PrincipalAuthoritySource =
        principal.kind === 'resident'
          ? { kind: 'personal' }
          : principal.kind === 'enterprise'
            ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
            : principal.kind === 'collective'
              ? { kind: 'collective', decisionId: 'independent-vote', charterVersion: 2 }
              : { kind: 'public', proposalId: 'public-vote', procedureRevision: 2 };
      return { actorId, principal, request, source };
    },
    conflict: () => undefined,
    releaseBlocked: () => undefined,
  };
  const offer = (id = 'permit'): Extract<PrincipalPremisesRightsCommand, { type: 'offer' }> => ({
    type: 'offer',
    buildingRevision: building.revision,
    terms: {
      id,
      buildingId: 'hall',
      grantee,
      users: ['user', 'guest'],
      scopes: ['operate', 'store'],
      mode: 'shared',
      title: 'shared workshop',
      terms: 'exact scope only',
      startAt: 10,
      endAt: 100,
      acceptBy: 30,
    },
  });
  const run = (
    actor: string,
    at: number,
    c: PrincipalPremisesRightsCommand,
    override: Partial<PrincipalPremisesRightsPorts> = {},
  ) => {
    actorId = actor;
    const d = decidePrincipalPremisesRights(state, actor, at, c, { ...ports, ...override });
    if (d.accepted)
      for (const e of d.events) {
        state = applyPrincipalPremisesRightsEvent(state, e);
        history.push(e);
      }
    return d;
  };
  return {
    get state() {
      return state;
    },
    ports,
    offer,
    run,
    history,
    base,
    setBuilding: (patch: Partial<PremisesBuilding>) => {
      building = { ...building, ...patch };
    },
    expire: (at: number) => {
      for (const e of expirePremisesRights(state, at)) {
        state = applyPremisesRightsEvent(state, e);
        history.push(e);
      }
    },
    replay: () => {
      let s = applyPrincipalPremisesRightsEvent(base, {
        type: 'PrincipalPremisesRightsEnabled',
        policy: PRINCIPAL_PREMISES_RIGHTS_POLICY,
      });
      for (const e of JSON.parse(JSON.stringify(history)) as typeof history)
        s = e.type.startsWith('Principal')
          ? applyPrincipalPremisesRightsEvent(s, e as PrincipalPremisesRightsEvent)
          : applyPremisesRightsEvent(s, e as PremisesRightsEvent);
      expect(s).toEqual(state);
    },
  };
}
test('principal permits require explicit upgrade, exact manager proof and independent acceptance; original creator has no authority', () => {
  const f = fixture();
  expect(decidePrincipalPremisesRights(f.base, 'manager', 0, f.offer(), f.ports)).toMatchObject({
    accepted: false,
    reason: 'principal-permits-not-enabled',
  });
  expect(f.run('manager', 0, f.offer(), { authorize: () => undefined }).accepted).toBe(false);
  expect(f.run('manager', 0, f.offer()).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 20, false)).toBe(false);
  expect(f.run('manager', 1, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(false);
  expect(f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 20, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'reside', 20, false)).toBe(false);
  expect(premisesPermitAllows(f.state, 'hall', 'manager', 'operate', 20, false)).toBe(false);
  f.replay();
});
test('paid consent records the exact parent trade authority and cannot be replayed as a free acceptance', () => {
  const f = fixture({ kind: 'public', id: 'town' });
  f.run('manager', 0, f.offer());
  const binding = { orderId: 'fee-order', orderRevision: 1 };
  const d = decidePrincipalPremisesRights(
    f.state,
    'user',
    1,
    { type: 'accept', id: 'permit', revision: 1 },
    {
      ...f.ports,
      authorize: (principal, request) => ({
        actorId: 'user',
        principal,
        request,
        source: { kind: 'public', proposalId: 'paid-vote', procedureRevision: 2 },
      }),
    },
    binding,
  );
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  expect(e.type).toBe('PrincipalPremisesPermitTradeAccepted');
  if (e.type !== 'PrincipalPremisesPermitTradeAccepted') throw Error('expected paid consent');
  expect(e.authorization.request).toEqual(principalPermitTradeRequest(binding));
  const after = applyPrincipalPremisesRightsEvent(f.state, e);
  expect(after.permits.permit!.status).toBe('accepted');
  expect(() =>
    applyPrincipalPremisesRightsEvent(f.state, {
      ...e,
      binding: { ...binding, orderId: 'other-order' },
    }),
  ).toThrow('principal-authority-scope-mismatch');
  expect(() =>
    applyPrincipalPremisesRightsEvent(f.state, {
      type: 'PrincipalPremisesPermitAccepted',
      id: e.id,
      revision: e.revision,
      authorization: e.authorization,
      at: e.at,
    }),
  ).toThrow('principal-authority-scope-mismatch');
  expect(
    applyPrincipalPremisesRightsEvent(f.state, JSON.parse(JSON.stringify(e)) as typeof e),
  ).toEqual(after);
});
test('collective and public contracts retain actual independent proof; body rights do not extend to all members', () => {
  for (const kind of ['collective', 'public', 'enterprise'] as const) {
    const f = fixture({ kind, id: 'recipient' });
    f.run('manager', 0, f.offer());
    expect(
      f.run(
        'user',
        1,
        { type: 'accept', id: 'permit', revision: 1 },
        { authorize: () => undefined },
      ).accepted,
    ).toBe(false);
    expect(f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(true);
    const p = f.state.permits.permit!;
    expect('principalAuthorization' in p && p.principalAuthorization.accepted?.principal).toEqual({
      kind,
      id: 'recipient',
    });
    expect(premisesPermitAllows(f.state, 'hall', 'manager', 'operate', 20, false)).toBe(false);
    f.replay();
  }
});
test('current exact building custody is required until acceptance; accepted rights and history survive transfer and expiry', () => {
  const f = fixture();
  f.run('manager', 0, f.offer());
  const old = f.ports.building('hall')!;
  if (old.control.policyVersion !== 'resource-principals-v2') throw Error('principal required');
  f.setBuilding({
    control: { ...old.control, controller: { kind: 'public', id: 'town' }, version: 2 },
  });
  expect(f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-control-changed',
  });
  f.setBuilding({ control: old.control });
  f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 });
  f.setBuilding({
    control: { ...old.control, controller: { kind: 'public', id: 'town' }, version: 2 },
  });
  expect(premisesHasPermitObligations(f.state, 'hall', 20)).toBe(true);
  f.expire(100);
  f.expire(1000);
  expect(f.state.permits.permit!.status).toBe('expired');
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 99, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 100, false)).toBe(false);
  f.replay();
});
test('old acceptance and closure cannot bypass principal contracts; actual work and unsettled provision block release', () => {
  const f = fixture();
  f.run('manager', 0, f.offer());
  const oldPorts = { ...f.ports, controllerAvailable: () => true, authorize: () => undefined };
  expect(
    decidePremisesRights(
      f.state,
      'user',
      1,
      { type: 'accept', id: 'permit', revision: 1 },
      oldPorts,
    ),
  ).toMatchObject({ accepted: false, reason: 'principal-permit-operation-required' });
  expect(() =>
    applyPremisesRightsEvent(f.state, {
      type: 'PremisesPermitAccepted',
      id: 'permit',
      revision: 2,
      signature: { actorId: 'user', at: 1 },
    }),
  ).toThrow('principal-permit-operation-required');
  f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 });
  expect(
    f.run('manager', 20, { type: 'withdraw', id: 'permit', revision: 2, side: 'issuer' }).accepted,
  ).toBe(false);
  expect(
    f.run(
      'user',
      20,
      { type: 'release', id: 'permit', revision: 2 },
      { releaseBlocked: () => 'actual-work-in-progress' },
    ),
  ).toMatchObject({ accepted: false, reason: 'actual-work-in-progress' });
  expect(f.run('user', 20, { type: 'release', id: 'permit', revision: 2 }).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 19, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 20, false)).toBe(false);
  f.replay();
});
test('versioned proof binds full terms; exclusive conflicts, wrong version, expiry and invalid users reject', () => {
  const f = fixture(),
    o = f.offer();
  f.run('manager', 0, { ...o, terms: { ...o.terms, mode: 'exclusive' } });
  const e = f.history[0]!;
  if (e.type !== 'PrincipalPremisesPermitOffered') throw Error('missing offer');
  expect(() =>
    applyPrincipalPremisesRightsEvent(
      applyPrincipalPremisesRightsEvent(f.base, {
        type: 'PrincipalPremisesRightsEnabled',
        policy: PRINCIPAL_PREMISES_RIGHTS_POLICY,
      }),
      { ...e, terms: { ...e.terms, users: ['manager'] } },
    ),
  ).toThrow('principal-authority-scope-mismatch');
  f.run('user', 1, { type: 'accept', id: 'permit', revision: 1 });
  expect(f.run('user', 2, { type: 'accept', id: 'permit', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-revision-conflict',
  });
  f.run('manager', 2, f.offer('other'));
  expect(f.run('user', 3, { type: 'accept', id: 'other', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-exclusive-conflict',
  });
  const g = fixture();
  expect(
    g.run('manager', 0, { ...g.offer(), terms: { ...g.offer().terms, users: ['missing'] } })
      .accepted,
  ).toBe(false);
  g.run('manager', 0, g.offer());
  expect(g.run('user', 30, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(false);
  f.replay();
});
