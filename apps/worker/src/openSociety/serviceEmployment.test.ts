import { verifyEndedWageAfterExit } from './testFixtures/earnedWageExit';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true, agreed = false) {
  const root = mkdtempSync(join(tmpdir(), 'service-employment-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    elapsedRest: true,
    elapsedLabor: true,
    serviceTime: true,
    serviceEmployment: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    ...(agreed && m.initialWorld.residentLabor
      ? {
          residentLabor: {
            ...m.initialWorld.residentLabor,
            configuration: {
              policy: m.initialWorld.residentLabor.configuration.policy,
              effort: m.initialWorld.residentLabor.configuration.effort,
              critical: m.initialWorld.residentLabor.configuration.critical,
              locationIds: m.initialWorld.residentLabor.configuration.locationIds,
              compensationSource: 'accepted-enterprise-labor-terms-v1' as const,
            },
          },
        }
      : {}),
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('town-square'),
          job: null,
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: world,
    worldPolicies: serializableWorldPolicy(m.seed, world, m.rhythm),
  });
  cleanup.push(() => r.close());
  const [owner, worker, other] = m.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `service-business-${++n}` });
    r.finishTurn(actor, { summary: 'Directed service enterprise verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { root, r, owner, worker, other, call, ok, replay };
}

function prepare(
  t: ReturnType<typeof fixture>,
  wageBasis: 'attendance' | 'effective-service',
  wageOffer = 100,
  initialCapital = 100,
) {
  t.ok(t.owner, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: 'Their own service business',
    occupationName: 'Helper',
    initialCapital,
    maxEmployees: 2,
  });
  t.ok(t.owner, 'world.post_job', { enterpriseId: 'firm', wageOffer, openSlots: 2 });
  t.ok(t.worker, 'world.join_enterprise', { enterpriseId: 'firm' });
  if (t.r.state.world.residentLabor?.configuration.compensationSource) {
    t.ok(t.owner, 'business.change-labor-terms', {
      enterpriseId: 'firm',
      operation: 'offer',
      id: 'hourly',
      employeeId: t.worker,
      wageMicros: 60_000_000,
      referenceMs: 3_600_000,
      validUntil: 86_400_000,
    });
    t.ok(t.worker, 'business.change-labor-terms', {
      enterpriseId: 'firm',
      operation: 'accept',
      id: 'hourly',
      expectedRevision: 1,
    });
  }

  t.ok(t.worker, 'engagements.offer', {
    id: 'service',
    controllerKind: 'resident',
    controllerId: t.worker,
    title: 'Residents choose the service',
    terms: 'Actual presence, independent patient consent and employer wage',
    locationId: 'town-square',
    providerId: t.worker,
    recipientId: t.other,
    payerSector: 'agent',
    payerId: t.other,
    revenueSector: 'enterprise',
    revenueId: 'firm',
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  });
  const revision = () => t.r.state.world.serviceEngagements!.engagements.service!.revision;
  const op = (actor: string, action: string, extra: Record<string, unknown> = {}) =>
    t.ok(actor, `engagements.${action}`, { id: 'service', expectedRevision: revision(), ...extra });
  op(t.other, 'accept');
  expect(
    t.call(t.other, 'engagements.fund', { id: 'service', expectedRevision: revision() }).error,
  ).toBe('exact-enterprise-service-authorization-required');
  expect(
    t.call(t.worker, 'business.authorize-service', {
      enterpriseId: 'firm',
      serviceId: 'service',
      expectedServiceRevision: revision(),
      wageBasis,
    }).ok,
  ).toBe(false);
  t.ok(t.owner, 'business.authorize-service', {
    enterpriseId: 'firm',
    serviceId: 'service',
    expectedServiceRevision: revision(),
    wageBasis,
  });
  op(t.other, 'fund');
  expect(
    t.call(t.worker, 'engagements.start', {
      id: 'service',
      expectedRevision: revision(),
      until: 3600000,
    }).error,
  ).toBe('exact-current-service-employment-acceptance-required');
  const employmentRevision =
    t.r.state.world.enterprises.firm!.serviceBusiness!.contracts.service!.revision;
  expect(t.ok(t.worker, 'engagements.read', { id: 'service' }).data).toMatchObject({
    ownEmployment: { expectedEmploymentRevision: employmentRevision, wageBasis },
  });
  expect(JSON.stringify(t.ok(t.other, 'engagements.read', { id: 'service' }).data)).not.toContain(
    'ownEmployment',
  );
  op(t.worker, 'start', { until: 3600000, expectedEmploymentRevision: employmentRevision });
  return { op, revision, claimId: Object.keys(t.r.state.world.serviceEmployment!.claims)[0]! };
}
test('independent financial permission and own payroll are discoverable without exposing other bodies or wages', () => {
  const t = fixture();
  const s = prepare(t, 'attendance');
  expect(t.r.context(t.worker).action.labor!.active).toMatchObject({
    id: s.claimId,
    sourceKind: 'actual-service',
    wageBasis: 'attendance',
  });
  expect(t.r.advanceTime(60000, 'waiting').ok).toBe(true);
  expect(t.r.state.world.serviceEngagements!.engagements.service!.charged).toBe(0);
  expect(
    t.r.state.world.enterprises.firm!.earnedPayroll!.claims[s.claimId]!.earnedMicros,
  ).toBeGreaterThan(0);
  s.op(t.other, 'start', { until: 3600000 });
  expect(t.r.advanceTime(900000, 'work').ok).toBe(true);
  for (const actor of [t.owner, t.worker, t.other]) {
    const text = JSON.stringify(t.ok(actor, 'engagements.ledger', { id: 'service' }).data);
    expect(text).not.toContain('elapsedBody');
    expect(text).not.toContain('recipientBefore');
    expect(text.includes('ownBefore')).toBe(actor !== t.owner);
  }
  expect(t.call(t.other, 'world.observe', { view: 'labor', section: s.claimId }).error).toBe(
    'own-labor-not-found',
  );
  expect(
    t.call(t.other, 'business.service', { enterpriseId: 'firm', serviceId: 'service' }).ok,
  ).toBe(false);
  expect(t.ok(t.worker, 'business.services', {}).data).toMatchObject({ total: 1 });
  t.ok(t.owner, 'world.layoff_employee', { enterpriseId: 'firm', employeeAgentId: t.worker });
  expect(t.r.state.world.serviceEngagements!.engagements.service!.status).toBe('ended');
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[s.claimId]!.status).toBe('ended');
  expect(t.r.context(t.worker).action.labor!.active).toBeNull();
  t.replay();
});
test('service wages remain individual debt after exit and later funding pays only the actual creditor', () => {
  const t = fixture();
  const s = prepare(t, 'effective-service', 100000, 100);
  s.op(t.other, 'start', { until: 3600000 });
  expect(t.r.advanceTime(900000, 'underfunded-service').ok).toBe(true);
  s.op(t.worker, 'leave');
  const claim = () => t.r.state.world.enterprises.firm!.earnedPayroll!.claims[s.claimId]!;
  expect(claim().earnedMicros).toBeGreaterThan(claim().paidMicros);
  const earned = claim().earnedMicros,
    paid = claim().paidMicros;
  t.ok(t.worker, 'world.leave_enterprise', { enterpriseId: 'firm' });
  expect(claim().earnedMicros).toBe(earned);
  expect(
    t.call(t.other, 'world.claim_wage', { id: s.claimId, expectedRevision: claim().revision }).ok,
  ).toBe(false);
  t.ok(t.other, 'world.fund_enterprise', { enterpriseId: 'firm', amount: 10 });
  const moneySupply = t.r.state.world.moneySupply;
  t.ok(t.worker, 'world.claim_wage', { id: s.claimId, expectedRevision: claim().revision });
  expect(claim().paidMicros).toBeGreaterThan(paid);
  expect(claim().earnedMicros).toBe(earned);
  expect(t.r.state.world.moneySupply).toBe(moneySupply);
  expect(t.ok(t.worker, 'world.observe', { view: 'labor', section: s.claimId }).data).toMatchObject(
    { source: { serviceId: 'service' }, claim: { status: 'ended' } },
  );
  t.replay();
});

test('explicit activation preserves legacy manifest and refuses already-funded service before an independent cancellation', () => {
  const t = fixture(false),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.owner, 'business.services', {}).error).toBe('service-employment-not-enabled');
  t.ok(t.worker, 'engagements.offer', {
    id: 'legacy',
    controllerKind: 'resident',
    controllerId: t.worker,
    title: 'Existing service',
    terms: 'Existing terms',
    locationId: 'town-square',
    providerId: t.worker,
    recipientId: t.other,
    payerSector: 'agent',
    payerId: t.other,
    revenueSector: 'agent',
    revenueId: t.worker,
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  });
  t.ok(t.other, 'engagements.accept', { id: 'legacy', expectedRevision: 1 });
  t.ok(t.other, 'engagements.fund', { id: 'legacy', expectedRevision: 2 });
  expect(t.r.enableServiceEmployment().ok).toBe(false);
  expect(t.r.state.world.serviceEngagements!.engagements.legacy!.escrow).toBe(36);
  t.ok(t.worker, 'engagements.cancel', { id: 'legacy', expectedRevision: 3 });
  expect(t.r.enableServiceEmployment().ok).toBe(true);
  const bytes = readFileSync(join(t.root, 'journal.jsonl'));
  expect(t.r.enableServiceEmployment().ok).toBe(true);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.replay();
});
test('unused independent enterprise permission can be revoked, never silently reused at funding', () => {
  const t = fixture();
  t.ok(t.owner, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: 'Own business',
    occupationName: 'Helper',
    initialCapital: 100,
    maxEmployees: 2,
  });
  t.ok(t.worker, 'engagements.offer', {
    id: 'unused',
    controllerKind: 'resident',
    controllerId: t.worker,
    title: 'Candidate terms',
    terms: 'No person obliged to begin',
    locationId: 'town-square',
    providerId: t.worker,
    recipientId: t.other,
    payerSector: 'agent',
    payerId: t.other,
    revenueSector: 'enterprise',
    revenueId: 'firm',
    providerShareBps: 0,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  });
  t.ok(t.owner, 'business.authorize-service', {
    enterpriseId: 'firm',
    serviceId: 'unused',
    expectedServiceRevision: 1,
    wageBasis: 'none',
  });
  t.ok(t.other, 'engagements.accept', { id: 'unused', expectedRevision: 1 });
  expect(
    t.call(t.owner, 'business.revoke-service', {
      enterpriseId: 'firm',
      serviceId: 'unused',
      expectedServiceRevision: 2,
      expectedAuthorizationRevision: 2,
    }).ok,
  ).toBe(false);
  t.ok(t.owner, 'business.revoke-service', {
    enterpriseId: 'firm',
    serviceId: 'unused',
    expectedServiceRevision: 2,
    expectedAuthorizationRevision: 1,
  });
  expect(t.call(t.other, 'engagements.fund', { id: 'unused', expectedRevision: 2 }).error).toBe(
    'exact-enterprise-service-authorization-required',
  );
  expect(t.r.state.world.enterprises.firm!.balance).toBe(100);
  t.replay();
});

test('service attendance uses accepted hourly terms without changing customer prices', () => {
  const t = fixture(true, true);
  const s = prepare(t, 'attendance');
  const money = t.r.state.world.moneySupply;
  t.ok(t.owner, 'business.change-labor-terms', {
    enterpriseId: 'firm',
    operation: 'offer',
    id: 'future',
    employeeId: t.worker,
    wageMicros: 120_000_000,
    referenceMs: 3_600_000,
    validUntil: 86_400_000,
  });
  t.ok(t.worker, 'business.change-labor-terms', {
    enterpriseId: 'firm',
    operation: 'accept',
    id: 'future',
    expectedRevision: 1,
  });
  expect(t.r.advanceTime(60_000, 'agreed-service').ok).toBe(true);
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[s.claimId]!.earnedMicros).toBe(
    1_000_000,
  );
  expect(t.r.state.world.serviceEngagements!.engagements.service!.charged).toBe(0);
  expect(t.r.state.world.moneySupply).toBe(money);
  t.replay();
});

test.each([false, true])(
  'preserved service creditor: ended debt pays, active work must first end (%s)',
  (active) => {
    const t = fixture();
    const s = prepare(t, 'effective-service', 100000, 100);
    s.op(t.other, 'start', { until: 3600000 });
    expect(t.r.advanceTime(900000, 'estate-service').ok).toBe(true);
    if (!active) {
      s.op(t.worker, 'leave');
      t.ok(t.other, 'world.fund_enterprise', { enterpriseId: 'firm', amount: 10 });
    }
    verifyEndedWageAfterExit(t.r.state.world, t.worker, s.claimId, 'service', active);
    t.replay();
  },
);
