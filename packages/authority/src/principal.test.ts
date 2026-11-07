import { expect, test } from 'vitest';
import {
  RESOURCE_PRINCIPAL_POLICY,
  decidePrincipalControl,
  applyPrincipalControl,
  type ResourcePrincipal,
  type PrincipalControlSnapshot,
  type PrincipalControlRequest,
  type PrincipalAuthorizationPort,
  type PrincipalAuthoritySource,
} from './principal';
const resident: ResourcePrincipal = { kind: 'resident', id: 'a' },
  company: ResourcePrincipal = { kind: 'enterprise', id: 'firm' },
  town: ResourcePrincipal = { kind: 'public', id: 'town' };
const initial: PrincipalControlSnapshot = { controller: resident, version: 1, at: 0 };
function request(
  command: PrincipalControlRequest['command'],
  controlVersion = 1,
): PrincipalControlRequest {
  return {
    resourceKind: 'premises',
    resourceId: 'building',
    resourceRevision: 7,
    controlVersion,
    command,
  };
}
const offer = request({
  type: 'offer',
  target: company,
  expiresAt: 100,
  terms: 'Exact custodian transfer',
});
const grant =
  (actorId: string, source: PrincipalAuthoritySource): PrincipalAuthorizationPort =>
  (principal, request) => ({ actorId, principal, request, source });
const decide = (
  snapshot: PrincipalControlSnapshot,
  r: PrincipalControlRequest,
  actorId = 'a',
  authorize = grant(actorId, { kind: 'personal' }),
  at = 0,
) =>
  decidePrincipalControl({
    policy: RESOURCE_PRINCIPAL_POLICY,
    snapshot,
    request: r,
    actorId,
    authorize,
    at,
    available: () => true,
  });
test('a company or public subject receives custody only through the other side independent exact authorization; executing managers never become the holder', () => {
  const proposed = decide(initial, offer);
  if (!proposed.accepted) throw Error(proposed.reason);
  const offered = applyPrincipalControl(initial, proposed.event);
  expect(offered.controller).toEqual(resident);
  expect(initial).not.toHaveProperty('offer');
  expect(decide(offered, request({ type: 'accept' }, 2), 'manager').accepted).toBe(false);
  const accepted = decide(
    offered,
    request({ type: 'accept' }, 2),
    'manager',
    grant('manager', { kind: 'enterprise', managementVersion: 3, managementDecisionId: null }),
    10,
  );
  if (!accepted.accepted) throw Error(accepted.reason);
  const owned = applyPrincipalControl(offered, accepted.event);
  expect(owned.controller).toEqual(company);
  expect(owned.authorization.actorId).toBe('manager');
  expect(owned.offer).toBeUndefined();
  const publicOffer = decide(
    owned,
    request(
      {
        type: 'offer',
        target: town,
        expiresAt: 200,
        terms: 'Public receiver independently approves',
      },
      3,
    ),
    'manager',
    grant('manager', { kind: 'enterprise', managementVersion: 3, managementDecisionId: null }),
    20,
  );
  if (!publicOffer.accepted) throw Error(publicOffer.reason);
  const offeredTown = applyPrincipalControl(owned, publicOffer.event);
  const publicAccept = decide(
    offeredTown,
    request({ type: 'accept' }, 4),
    'executor',
    grant('executor', { kind: 'public', proposalId: 'approved-exact-asset', procedureRevision: 2 }),
    30,
  );
  if (!publicAccept.accepted) throw Error(publicAccept.reason);
  expect(applyPrincipalControl(offeredTown, publicAccept.event)).toMatchObject({
    controller: town,
    authorization: { actorId: 'executor', source: { proposalId: 'approved-exact-asset' } },
  });
  expect(() => applyPrincipalControl(owned, accepted.event)).toThrow(
    'invalid-principal-control-event',
  );
});
test('scope substitutions, stale management kind, forged personal consent and old resource/control versions cannot pass the pure operation envelope', () => {
  const altered: PrincipalAuthorizationPort = (p, r) => ({
    actorId: 'a',
    principal: p,
    request: { ...r, resourceId: 'other' },
    source: { kind: 'personal' },
  });
  expect(decide(initial, offer, 'a', altered)).toMatchObject({
    accepted: false,
    reason: 'principal-authority-scope-mismatch',
  });
  const termsChanged: PrincipalAuthorizationPort = (p, r) => ({
    actorId: 'a',
    principal: p,
    request: { ...r, command: { type: 'offer', target: town, expiresAt: 100, terms: 'Different' } },
    source: { kind: 'personal' },
  });
  expect(decide(initial, offer, 'a', termsChanged).accepted).toBe(false);
  expect(decide(initial, offer, 'intruder').accepted).toBe(false);
  expect(decide(initial, { ...offer, controlVersion: 2 })).toMatchObject({
    accepted: false,
    reason: 'principal-control-version-conflict',
  });
  expect(
    decide(
      initial,
      offer,
      'a',
      grant('a', { kind: 'public', proposalId: 'fake', procedureRevision: 1 }),
    ).accepted,
  ).toBe(false);
  const proposed = decide(initial, offer);
  if (!proposed.accepted) throw Error(proposed.reason);
  const s = applyPrincipalControl(initial, proposed.event);
  expect(
    decide(
      s,
      request({ type: 'accept' }, 2),
      'manager',
      grant('manager', { kind: 'enterprise', managementVersion: 0, managementDecisionId: null }),
      10,
    ).accepted,
  ).toBe(false);
  expect(
    decide(
      s,
      request({ type: 'accept' }, 2),
      'manager',
      grant('manager', { kind: 'enterprise', managementVersion: 3, managementDecisionId: null }),
      100,
    ),
  ).toMatchObject({ accepted: false, reason: 'principal-control-offer-expired-or-unavailable' });
  expect(() =>
    applyPrincipalControl(initial, {
      ...proposed.event,
      control: {
        ...proposed.event.control,
        offer: { ...proposed.event.control.offer!, expiresAt: 200 },
      },
    }),
  ).toThrow('invalid-principal-control-offer-event');
  for (const at of [-1, NaN, Infinity])
    expect(decide(initial, offer, 'a', grant('a', { kind: 'personal' }), at).accepted).toBe(false);
});
test('collective proof stays distinct, cancellation preserves custody, and v2 cannot assume a principal exists', () => {
  const collective: ResourcePrincipal = { kind: 'collective', id: 'group' },
    s: PrincipalControlSnapshot = { controller: collective, version: 5, at: 10 };
  expect(decide(s, { ...offer, controlVersion: 5 }, 'member').accepted).toBe(false);
  const d = decide(
    s,
    { ...offer, controlVersion: 5 },
    'member',
    grant('member', { kind: 'collective', decisionId: 'group-offer', charterVersion: 2 }),
    10,
  );
  if (!d.accepted) throw Error(d.reason);
  const offered = applyPrincipalControl(s, d.event);
  const cancelled = decide(
    offered,
    request({ type: 'cancel' }, 6),
    'member',
    grant('member', { kind: 'collective', decisionId: 'group-cancel', charterVersion: 2 }),
    20,
  );
  if (!cancelled.accepted) throw Error(cancelled.reason);
  expect(applyPrincipalControl(offered, cancelled.event)).toMatchObject({
    controller: collective,
    version: 7,
  });
  expect(applyPrincipalControl(offered, cancelled.event)).not.toHaveProperty('offer');
  expect(
    decidePrincipalControl({
      policy: RESOURCE_PRINCIPAL_POLICY,
      snapshot: initial,
      request: offer,
      actorId: 'a',
      at: 0,
      authorize: grant('a', { kind: 'personal' }),
      available: (p) => p.kind === 'resident',
    }),
  ).toMatchObject({ accepted: false, reason: 'principal-control-target-unavailable' });
  expect(
    decide(
      { ...initial, version: Number.MAX_SAFE_INTEGER },
      { ...offer, controlVersion: Number.MAX_SAFE_INTEGER },
    ),
  ).toMatchObject({ accepted: false, reason: 'principal-control-version-limit' });
});
