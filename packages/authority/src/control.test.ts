import { expect, test } from 'vitest';
import {
  RESOURCE_CONTROL_POLICY,
  decideResourceControl,
  effectiveController,
  personalControlAuthorization,
  personallyControls,
  resourceAdministration,
  revisedResourceControl,
  type ControlledResource,
  type ControlCommand,
  type ControlAuthorizationPort,
} from './control';
const collective = { kind: 'collective' as const, id: 'council' };
const council: ControlAuthorizationPort = (c) =>
  c.kind === 'collective' && c.id === 'council'
    ? { actorId: 'b', decisionId: 'vote-1' }
    : undefined;
const decide = (
  resource: ControlledResource,
  actorId: string,
  command: ControlCommand,
  at = 10,
  authorize: ControlAuthorizationPort = personalControlAuthorization(actorId),
) =>
  decideResourceControl({
    resource,
    actorId,
    command,
    at,
    authorize,
    policy: RESOURCE_CONTROL_POLICY,
    available: (c) => c.id !== 'missing',
  });
function offered() {
  const r = { ownerId: 'a' },
    d = decide(r, 'a', {
      type: 'offer',
      expectedVersion: 1,
      target: collective,
      expiresAt: 100,
      terms: '交接管理权，保留原作署名',
    });
  if (!d.accepted) throw Error(d.reason);
  return { ...r, control: d.control };
}
test('legacy personal control remains unchanged until an independently accepted exact offer', () => {
  const r = { ownerId: 'a' };
  expect(effectiveController(r)).toEqual({ kind: 'resident', id: 'a' });
  expect(revisedResourceControl(r, { actorId: 'a' }, 10)).toBeUndefined();
  const proposed = offered();
  expect(personallyControls(proposed, 'a')).toBe(true);
  expect(decide(proposed, 'a', { type: 'accept', expectedVersion: 2 }).accepted).toBe(false);
  const accepted = decide(proposed, 'b', { type: 'accept', expectedVersion: 2 }, 20, council);
  expect(accepted).toMatchObject({
    accepted: true,
    control: { controller: collective, version: 3, changedBy: 'b', decisionId: 'vote-1' },
  });
  if (!accepted.accepted) throw Error(accepted.reason);
  const next = { ...proposed, control: accepted.control };
  expect(next.ownerId).toBe('a');
  expect(personallyControls(next, 'a')).toBe(false);
  expect(resourceAdministration(next, 'a')).toBeUndefined();
  expect(resourceAdministration(next, 'b', council)).toEqual({
    actorId: 'b',
    decisionId: 'vote-1',
  });
});
test('a collective port cannot forge another resident or use an unbound actor and missing proof', () => {
  const fake: ControlAuthorizationPort = () => ({ actorId: 'intruder', decisionId: 'vote-1' });
  expect(
    decide(
      { ownerId: 'a' },
      'intruder',
      { type: 'offer', expectedVersion: 1, target: collective, expiresAt: 100, terms: 'claim' },
      10,
      fake,
    ).accepted,
  ).toBe(false);
  for (const authorize of [
    () => ({ actorId: 'b' }),
    () => ({ actorId: 'other', decisionId: 'vote-1' }),
    () => ({ actorId: 'b', decisionId: '__proto__' }),
  ])
    expect(
      decide(offered(), 'b', { type: 'accept', expectedVersion: 2 }, 20, authorize).accepted,
    ).toBe(false);
});
test('stale, expired, cancelled and invalidated offers cannot transfer control', () => {
  const r = offered();
  expect(decide(r, 'b', { type: 'accept', expectedVersion: 1 }, 20, council)).toMatchObject({
    accepted: false,
    reason: 'control-version-conflict',
  });
  expect(decide(r, 'b', { type: 'accept', expectedVersion: 2 }, 100, council)).toMatchObject({
    accepted: false,
    reason: 'control-offer-expired',
  });
  const cancelled = decide(r, 'a', { type: 'cancel', expectedVersion: 2 });
  if (!cancelled.accepted) throw Error(cancelled.reason);
  expect(
    decide(
      { ...r, control: cancelled.control },
      'b',
      { type: 'accept', expectedVersion: 3 },
      20,
      council,
    ),
  ).toMatchObject({ accepted: false, reason: 'control-offer-not-found' });
  const changed = revisedResourceControl(r, { actorId: 'a' }, 20)!;
  expect(changed).not.toHaveProperty('offer');
  expect(
    decide({ ...r, control: changed }, 'b', { type: 'accept', expectedVersion: 3 }, 30, council)
      .accepted,
  ).toBe(false);
});
test('two-sided collective to individual handover requires that exact recipient personally accept', () => {
  const accepted = decide(offered(), 'b', { type: 'accept', expectedVersion: 2 }, 20, council);
  if (!accepted.accepted) throw Error(accepted.reason);
  const r = { ownerId: 'a', control: accepted.control };
  const toPerson = decide(
    r,
    'b',
    {
      type: 'offer',
      expectedVersion: 3,
      target: { kind: 'resident', id: 'successor' },
      expiresAt: 100,
      terms: '接管',
    },
    30,
    council,
  );
  if (!toPerson.accepted) throw Error(toPerson.reason);
  const offeredToPerson = { ...r, control: toPerson.control };
  expect(
    decide(offeredToPerson, 'a', { type: 'accept', expectedVersion: 4 }, 40, () => ({
      actorId: 'a',
    })).accepted,
  ).toBe(false);
  const done = decide(offeredToPerson, 'successor', { type: 'accept', expectedVersion: 4 }, 40);
  expect(done).toMatchObject({
    accepted: true,
    control: { controller: { kind: 'resident', id: 'successor' }, version: 5 },
  });
  if (!done.accepted) throw Error(done.reason);
  expect(done.control).not.toHaveProperty('decisionId');
  expect(done.control).not.toHaveProperty('offer');
  expect(JSON.parse(JSON.stringify(done.control))).toEqual(done.control);
});
test('bounded terms, horizons, existing targets and control version exhaustion are enforced', () => {
  const base = {
    type: 'offer' as const,
    expectedVersion: 1,
    target: collective,
    expiresAt: 100,
    terms: 'valid',
  };
  for (const extra of [
    { expiresAt: 10 },
    { expiresAt: Infinity },
    { expiresAt: 10 + RESOURCE_CONTROL_POLICY.maxOfferHorizonMs + 1 },
    { terms: ' ' },
    { terms: 'x'.repeat(2001) },
    { target: { kind: 'collective' as const, id: 'missing' } },
    { target: { kind: 'resident' as const, id: 'a' } },
  ])
    expect(decide({ ownerId: 'a' }, 'a', { ...base, ...extra }).accepted).toBe(false);
  expect(
    decide(
      {
        ownerId: 'a',
        control: {
          controller: { kind: 'resident', id: 'a' },
          policyVersion: 'resource-control-v1',
          version: Number.MAX_SAFE_INTEGER,
          at: 0,
          changedBy: 'a',
        },
      },
      'a',
      { ...base, expectedVersion: Number.MAX_SAFE_INTEGER },
    ),
  ).toMatchObject({ accepted: false, reason: 'control-version-limit' });
});
