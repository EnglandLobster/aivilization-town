import { expect, test } from 'vitest';
import {
  RESOURCE_PRINCIPAL_POLICY,
  SUCCESSION_CONTROL_OFFER_SOURCE_VERSION,
  assertPrincipalAuthorization,
  decidePrincipalControl,
  applyPrincipalControl,
  successionControlOfferTerms,
  type SuccessionControlOfferSource,
  type PrincipalControlRequest,
  type PrincipalAuthorization,
  type PrincipalControlSnapshot,
} from './principal';
const source: SuccessionControlOfferSource = {
  kind: 'succession',
  policyVersion: SUCCESSION_CONTROL_OFFER_SOURCE_VERSION,
  executionId: 'offer-1',
  arrangementId: 'will',
  arrangementRevision: 4,
  termsRevision: 1,
  populationEventId: 'actual-death',
  beneficiaryId: 'recipient',
  executedAt: 60,
  executeBefore: 5050,
};
const request: PrincipalControlRequest = {
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: 4,
  controlVersion: 2,
  command: {
    type: 'offer',
    target: { kind: 'resident', id: 'recipient' },
    expiresAt: 500,
    terms: successionControlOfferTerms(source),
  },
};
const proof: PrincipalAuthorization = {
  actorId: 'executor',
  principal: { kind: 'resident', id: 'original' },
  request,
  source,
};
const snapshot: PrincipalControlSnapshot = { controller: proof.principal, version: 2, at: 50 };
const available = (p: { kind: string; id: string }) =>
  p.kind === 'resident' && ['executor', 'recipient', 'other'].includes(p.id);
const decide = (grant = proof, r = request, s = snapshot, at = 60) =>
  decidePrincipalControl({
    policy: RESOURCE_PRINCIPAL_POLICY,
    snapshot: s,
    request: r,
    actorId: 'executor',
    at,
    available,
    authorize: () => ({ ...grant, request: r }),
  });
test('explicit succession source offers custody from the original subject while retaining actual executor and requiring independent current beneficiary acceptance', () => {
  const d = decide();
  if (!d.accepted) throw Error(d.reason);
  const offered = applyPrincipalControl(snapshot, d.event);
  expect(offered.controller).toEqual(proof.principal);
  expect(offered.offer?.authorization).toEqual(proof);
  expect(offered.authorization.actorId).toBe('executor');
  const accept: PrincipalControlRequest = {
    ...request,
    resourceRevision: 5,
    controlVersion: 3,
    command: { type: 'accept' },
  };
  const accepted = decidePrincipalControl({
    policy: RESOURCE_PRINCIPAL_POLICY,
    snapshot: offered,
    request: accept,
    actorId: 'recipient',
    at: 70,
    available,
    authorize: (principal, r) => ({
      actorId: 'recipient',
      principal,
      request: r,
      source: { kind: 'personal' },
    }),
  });
  if (!accepted.accepted) throw Error(accepted.reason);
  const owned = applyPrincipalControl(offered, accepted.event);
  expect(owned.controller).toEqual({ kind: 'resident', id: 'recipient' });
  expect(owned.authorization.actorId).toBe('recipient');
  expect(owned.offer).toBeUndefined();
});
test('finite source cannot accept, cancel, administer, redirect to another beneficiary or make an unlimited offer', () => {
  for (const command of [
    { type: 'accept' as const },
    { type: 'cancel' as const },
    {
      type: 'offer' as const,
      target: { kind: 'resident' as const, id: 'other' },
      expiresAt: 500,
      terms: successionControlOfferTerms(source),
    },
    {
      type: 'offer' as const,
      target: { kind: 'collective' as const, id: 'recipient' },
      expiresAt: 500,
      terms: successionControlOfferTerms(source),
    },
    {
      type: 'offer' as const,
      target: { kind: 'resident' as const, id: 'recipient' },
      expiresAt: 5051,
      terms: successionControlOfferTerms(source),
    },
    {
      type: 'offer' as const,
      target: { kind: 'resident' as const, id: 'recipient' },
      expiresAt: 500,
      terms: 'arbitrary extra powers',
    },
  ]) {
    const r = { ...request, command };
    expect(() =>
      assertPrincipalAuthorization({ ...proof, request: r }, proof.principal, r, 'executor'),
    ).toThrow();
  }
  const operation = {
    resourceKind: 'stock',
    resourceId: 's',
    resourceRevision: 4,
    controlVersion: 2,
    operation: { capability: 'materials.withdraw', arguments: { quantity: 1 } },
  };
  expect(() =>
    assertPrincipalAuthorization(
      { ...proof, request: operation },
      proof.principal,
      operation,
      'executor',
    ),
  ).toThrow('finite-offer-scope');
});
test('new source cannot masquerade as personal consent or execute for a collective, enterprise or public grant', () => {
  expect(() =>
    assertPrincipalAuthorization(
      { ...proof, source: { kind: 'personal' } },
      proof.principal,
      request,
      'executor',
    ),
  ).toThrow('personal-consent-required');
  for (const kind of ['enterprise', 'collective', 'public'] as const)
    expect(() =>
      assertPrincipalAuthorization(
        { ...proof, principal: { kind, id: 'original' } },
        { kind, id: 'original' },
        request,
        'executor',
      ),
    ).toThrow();
  expect(() =>
    assertPrincipalAuthorization(
      { ...proof, actorId: 'original' },
      proof.principal,
      request,
      'original',
    ),
  ).toThrow('finite-offer-scope');
});
test('an old pending offer cannot be overwritten and execution cannot occur at another recorded time; replay checks those same facts', () => {
  const first = decide();
  if (!first.accepted) throw Error(first.reason);
  const offered = applyPrincipalControl(snapshot, first.event);
  const requestNext = { ...request, controlVersion: 3, resourceRevision: 5 };
  expect(decide(proof, requestNext, offered)).toMatchObject({
    accepted: false,
    reason: 'principal-succession-current-time-and-empty-offer-required',
  });
  expect(decide(proof, request, snapshot, 61)).toMatchObject({
    accepted: false,
    reason: 'principal-succession-current-time-and-empty-offer-required',
  });
  const changed = { ...first.event, control: { ...first.event.control, at: 61 } };
  expect(() => applyPrincipalControl(snapshot, changed)).toThrow('current-time-and-empty-offer');
});
test('source schema/version and original terms pointer are closed; malformed extra rights or changed versions reject without modifying control', () => {
  for (const changed of [
    { ...source, termsRevision: 5 },
    { ...source, executeBefore: Infinity },
    { ...source, executionId: '__proto__' },
    { ...source, policyVersion: 'silent-new-version' },
    { ...source, canTransferMoney: true },
  ]) {
    const forged = structuredClone(proof);
    Object.assign(forged.source, changed);
    expect(() =>
      assertPrincipalAuthorization(forged, proof.principal, request, 'executor'),
    ).toThrow('finite-offer-scope');
  }
  const d = decide();
  if (!d.accepted) throw Error(d.reason);
  expect(
    applyPrincipalControl(snapshot, JSON.parse(JSON.stringify(d.event)) as typeof d.event),
  ).toEqual(applyPrincipalControl(snapshot, d.event));
  expect(snapshot).toEqual({ controller: proof.principal, version: 2, at: 50 });
});
