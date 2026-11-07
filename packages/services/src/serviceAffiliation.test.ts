import { expect, test } from 'vitest';
import {
  resourcePrincipalSnapshot,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  applyServicesEvent,
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  type ServicesEvent,
} from './model';
import { SERVICE_PRINCIPALS_POLICY } from './servicePrincipalModel';
import { SERVICE_SUPPLY_POLICY } from './serviceSupplyModel';
import {
  SERVICE_AFFILIATION_POLICY,
  type ServiceAffiliationEvent,
} from './serviceAffiliationModel';
import {
  decideServiceAffiliation,
  decideAffiliatedServiceControl,
  serviceAffiliationRequest,
  applyServiceAffiliationEvent,
} from './serviceAffiliation';
import { decideServicePrincipalControl, type ServicePrincipalsPorts } from './servicePrincipals';
function fixture() {
  const legacy = {
    ...emptyServicesState(STAFFED_SERVICES_POLICY),
    services: {
      clinic: {
        id: 'clinic',
        ownerId: 'owner',
        enterpriseId: 'firm',
        locationId: 'site',
        kind: 'appointment' as const,
        title: '原文',
        description: '原企业供给',
        capacity: 1,
        revision: 1,
        active: true,
      },
    },
  };
  const activation: ServicesEvent[] = [
    { type: 'ServicePrincipalsEnabled', policy: SERVICE_PRINCIPALS_POLICY },
    { type: 'ServiceSupplyEnabled', policy: SERVICE_SUPPLY_POLICY },
    { type: 'ServiceAffiliationsEnabled', policy: SERVICE_AFFILIATION_POLICY },
  ];
  let state = activation.reduce(applyServicesEvent, legacy),
    actor = 'owner';
  const history: ServicesEvent[] = [...activation];
  const ports: ServicePrincipalsPorts = {
    available: () => true,
    authorizeControl: (p, r) =>
      p.kind === 'resident' && p.id === actor
        ? { actorId: actor, principal: p, request: r, source: { kind: 'personal' } }
        : p.kind === 'enterprise' && actor === 'manager'
          ? {
              actorId: actor,
              principal: p,
              request: r,
              source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
            }
          : undefined,
    authorizeOperation: (p, r) =>
      p.kind === 'enterprise' && actor === 'manager'
        ? {
            actorId: actor,
            principal: p,
            request: r,
            source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
          }
        : undefined,
    inheritedProviders: () => ['owner'],
    service: { exists: () => true, presentAndIdle: () => true, locationCapacity: () => 1 },
  };
  const control = (command: PrincipalControlRequest['command']): PrincipalControlRequest => ({
    resourceKind: 'service',
    resourceId: 'clinic',
    resourceRevision: state.services.clinic!.revision,
    controlVersion: resourcePrincipalSnapshot(state.services.clinic!).version,
    command,
  });
  const apply = (
    d:
      | { accepted: true; events: readonly ServiceAffiliationEvent[] }
      | { accepted: false; reason: string },
  ) => {
    if (d.accepted)
      for (const e of d.events) {
        state = applyServicesEvent(state, e);
        history.push(e);
      }
    return d;
  };
  const approve = (who: string, r: PrincipalControlRequest, at = 10, expiresAt = 100) => {
    actor = who;
    return apply(
      decideServiceAffiliation(
        state,
        actor,
        at,
        serviceAffiliationRequest(state, 'clinic', {
          type: 'services.approve-control',
          request: r,
          expiresAt,
          registryRevision: state.affiliations!.revision,
        }),
        ports,
      ),
    );
  };
  const execute = (who: string, r: PrincipalControlRequest, at = 20) => {
    actor = who;
    return apply(decideAffiliatedServiceControl(state, who, at, r, ports));
  };
  const revoke = (who: string, at = 15) => {
    actor = who;
    return apply(
      decideServiceAffiliation(
        state,
        who,
        at,
        serviceAffiliationRequest(state, 'clinic', {
          type: 'services.revoke-control',
          expectedConsentVersion: state.affiliations!.consents.clinic!.version,
          registryRevision: state.affiliations!.revision,
        }),
        ports,
      ),
    );
  };
  return {
    get state() {
      return state;
    },
    legacy,
    history,
    ports,
    control,
    approve,
    execute,
    revoke,
    actor: (who: string) => {
      actor = who;
    },
  };
}
test('independent enterprise manager and directory owner each consent to exact offer, then receiver independently accepts with fresh firm consent', () => {
  const t = fixture(),
    r = t.control({
      type: 'offer',
      target: { kind: 'resident', id: 'receiver' },
      expiresAt: 90,
      terms: '目录交接，原合同保留',
    }),
    before = structuredClone(t.state);
  expect(t.approve('owner', r).accepted).toBe(false);
  expect(t.approve('manager', r).accepted).toBe(true);
  expect(t.state.services).toEqual(before.services);
  expect(t.execute('manager', r).accepted).toBe(false);
  expect(t.state.affiliations!.consents.clinic!.status).toBe('available');
  expect(t.execute('owner', r).accepted).toBe(true);
  expect(t.state.affiliations!.consents.clinic!.status).toBe('used');
  expect(t.state.services.clinic!.control!.controller).toEqual({ kind: 'resident', id: 'owner' });
  expect(t.state.services.clinic!.namedProviders).toEqual(['owner']);
  const accept = t.control({ type: 'accept' });
  expect(t.execute('receiver', accept, 30).accepted).toBe(false);
  expect(t.approve('manager', accept, 25).accepted).toBe(true);
  expect(t.execute('receiver', accept, 30).accepted).toBe(true);
  expect(t.state.services.clinic).toMatchObject({
    ownerId: 'owner',
    enterpriseId: 'firm',
    control: { controller: { kind: 'resident', id: 'receiver' } },
    namedProviders: ['owner'],
  });
  expect(t.history.reduce(applyServicesEvent, t.legacy)).toEqual(t.state);
  expect(t.state.bookings).toEqual(before.bookings);
  expect(t.state.slots).toEqual(before.slots);
});
test('consent cannot be used with edited full terms, stale resources, at expiry, unavailable firm or different current actor', () => {
  const t = fixture(),
    r = t.control({
      type: 'offer',
      target: { kind: 'resident', id: 'receiver' },
      expiresAt: 90,
      terms: 'exact',
    });
  expect(t.approve('manager', r, 10, 10).accepted).toBe(false);
  expect(
    t.approve('manager', r, 10, 10 + SERVICE_AFFILIATION_POLICY.maxConsentHorizonMs + 1).accepted,
  ).toBe(false);
  expect(t.approve('manager', r).accepted).toBe(true);
  expect(t.approve('manager', r).accepted).toBe(false);
  expect(
    t.execute('owner', {
      ...r,
      command: {
        type: 'offer',
        target: { kind: 'resident', id: 'receiver' },
        expiresAt: 90,
        terms: 'edited',
      },
    }).accepted,
  ).toBe(false);
  expect(t.execute('owner', { ...r, resourceRevision: r.resourceRevision + 1 }).accepted).toBe(
    false,
  );
  expect(t.execute('owner', r, 100).accepted).toBe(false);
  t.actor('owner');
  expect(
    decideAffiliatedServiceControl(t.state, 'owner', 20, r, {
      ...t.ports,
      available: (p) => p.kind !== 'enterprise',
    }).accepted,
  ).toBe(false);
  expect(t.state.affiliations!.consents.clinic!.status).toBe('available');
});
test('revoke is independent enterprise action, prevents pending use, preserves all resource facts and deterministic replay', () => {
  const t = fixture(),
    r = t.control({
      type: 'offer',
      target: { kind: 'resident', id: 'receiver' },
      expiresAt: 90,
      terms: 'exact',
    });
  expect(t.approve('manager', r).accepted).toBe(true);
  const before = structuredClone(t.state.services);
  expect(t.revoke('owner').accepted).toBe(false);
  expect(t.revoke('manager').accepted).toBe(true);
  expect(t.state.services).toEqual(before);
  expect(t.execute('owner', r).accepted).toBe(false);
  expect(t.revoke('manager').accepted).toBe(false);
  expect(t.history.reduce(applyServicesEvent, t.legacy)).toEqual(t.state);
});
test('v2 same-actor history stays unchanged and new proof facts reject forged expiry, grant source and duplicate consumption', () => {
  const t = fixture(),
    r = t.control({
      type: 'offer',
      target: { kind: 'resident', id: 'receiver' },
      expiresAt: 90,
      terms: 'exact',
    });
  t.actor('owner');
  expect(decideServicePrincipalControl(t.state, 'owner', 20, r, t.ports)).toMatchObject({
    accepted: false,
    reason: 'service-enterprise-affiliation-authority-required',
  });
  expect(t.approve('manager', r).accepted).toBe(true);
  const e = t.history.at(-1)!;
  if (e.type !== 'ServiceAffiliationConsentApproved') throw Error('fixture');
  const before = t.history.slice(0, -1).reduce(applyServicesEvent, t.legacy);
  expect(() =>
    applyServiceAffiliationEvent(before, { ...e, consent: { ...e.consent, expiresAt: 101 } }),
  ).toThrow('invalid-service-affiliation-consent-fact');
  expect(() =>
    applyServiceAffiliationEvent(before, {
      ...e,
      consent: { ...e.consent, authorization: { ...e.consent.authorization, actorId: 'intruder' } },
    }),
  ).not.toThrow(); // Domain checks shape; world owns actual manager source validation.
  const unused = structuredClone(t.state);
  expect(t.execute('owner', r).accepted).toBe(true);
  const used = t.history.at(-1)!;
  if (used.type !== 'ServiceAffiliatedPrincipalControlChanged') throw Error('fixture');
  expect(applyServiceAffiliationEvent(unused, used)).toEqual(t.state);
  expect(() => applyServiceAffiliationEvent(t.state, used)).toThrow(
    'service-affiliation-version-conflict',
  );
  t.actor('manager');
  const bad: PrincipalOperationRequest = {
    ...e.consent.authorization.request,
    operation: {
      capability: 'services.approve-control',
      arguments: { ...e.consent.authorization.request.operation.arguments, actorId: 'owner' },
    },
  };
  expect(decideServiceAffiliation(before, 'manager', 10, bad, t.ports).accepted).toBe(false);
});
