import { describe, it, expect } from 'vitest';
import { personalControlAuthorization } from '@aivilization/authority';
import {
  serviceEffectRequirements,
  residentServiceEffect,
  type ServiceParticipantCondition,
} from '@aivilization/society';
import {
  emptyServiceEngagementsState,
  SERVICE_PUBLIC_FUNDING_POLICY,
  type ServiceEngagementCommand,
  type ServiceEngagement,
  type ServiceEngagementPorts,
  type ServiceEngagementTerms,
  type ServicePresence,
  type ServiceEngagementDecision,
} from './engagementModel';
import {
  decideServiceEngagement,
  advanceServiceEngagement,
  nextServiceEngagementBoundary,
} from './engagements';
import { applyServiceEngagementCommit } from './engagementCommit';
import { SERVICE_ENGAGEMENT_ESCROW } from './engagementMoney';
function fixture(patch: Partial<ServiceEngagementTerms> = {}) {
  let state = emptyServiceEngagementsState(),
    at = 0,
    actor = 'alice',
    facility = true;
  const conditions: Record<string, ServiceParticipantCondition> = Object.fromEntries(
    ['alice', 'bob', 'charlie', 'dana'].map((id) => [
      id,
      { energy: 100, satiety: 100, health: 50, educationScore: id === 'bob' ? 10 : 9 },
    ]),
  );
  const balances: Record<string, number> = {
    'agent:alice': 100,
    'agent:bob': 100,
    'agent:charlie': 100,
    'agent:dana': 100,
    [SERVICE_ENGAGEMENT_ESCROW.accountId]: 0,
  };
  const sessions: Record<string, ServicePresence> = {};
  const material: NonNullable<ReturnType<ServiceEngagementPorts['material']>> = {
    revision: 1,
    status: 'offered',
    expiresAt: 7200000,
    beneficiary: { kind: 'resident', id: 'alice' },
    consumerDomain: 'services',
    consumerId: 'svc',
    locationId: 'place',
    held: {},
  };
  const terms: ServiceEngagementTerms = {
    id: 'svc',
    controller: { kind: 'resident', id: 'alice' },
    title: 'An original service',
    terms: 'Actual time, partial payment and voluntary exit.',
    locationId: 'place',
    providerId: 'bob',
    recipientId: 'charlie',
    payer: { sector: 'agent', id: 'dana' },
    revenue: { sector: 'agent', id: 'alice' },
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    materials: [],
    ...patch,
  };
  material.held = serviceEffectRequirements(
    residentServiceEffect(terms.modelId)!,
    terms.maxDurationMs,
  );
  const ports: ServiceEngagementPorts = {
    exists: (id) => !!conditions[id],
    controllerAvailable: (c) => !!conditions[c.id],
    authorize: (c) => personalControlAuthorization(actor)(c),
    account: (a) =>
      balances[`${a.sector}:${a.id}`] === undefined
        ? undefined
        : {
            balance: balances[`${a.sector}:${a.id}`]!,
            controller: { kind: 'resident', id: a.id },
            status: 'open',
          },
    presentAndIdle: (id, loc) => !!conditions[id] && loc === 'place' && !sessions[id],
    present: (id, loc) => !!conditions[id] && loc === 'place',
    condition: (id) => conditions[id],
    mayOperate: () => true,
    locationAvailable: (loc) => loc === 'place',
    facilityAvailable: () => facility,
    sessionReserved: (_id, p) => JSON.stringify(sessions[p.actorId]) === JSON.stringify(p),
    material: (id) => (id === 'input' ? material : undefined),
  };
  const apply = (d: ServiceEngagementDecision) => {
    if (!d.accepted) return d;
    const result = applyServiceEngagementCommit(
      state,
      d.events,
      d.transactions,
      d.materialInstructions,
    );
    for (const t of d.transactions)
      for (const e of t.entries)
        balances[e.account.accountId] = (balances[e.account.accountId] ?? 0) + e.amount;
    for (const f of result.settlements) {
      const e = result.state.engagements[f.engagementId]!;
      conditions[e.providerId] = f.providerAfter;
      conditions[e.recipientId] = f.recipientAfter;
    }
    for (const i of d.materialInstructions) {
      material.held = Object.fromEntries(
        Object.entries(material.held).map(([item, q]) => [item, q - (i.consumed[item] ?? 0)]),
      );
      material.revision++;
      material.status = i.finish ? 'settled' : 'bound';
    }
    for (const r of result.reserves) sessions[r.actorId] = r;
    for (const r of result.releases) delete sessions[r.actorId];
    state = result.state;
    return d;
  };
  const command = (who: string, c: ServiceEngagementCommand) => {
    actor = who;
    return apply(decideServiceEngagement(state, who, at, c, ports));
  };
  const operation = (who: string, type: 'accept' | 'fund' | 'leave' | 'cancel') =>
    command(who, { type, id: 'svc', expectedRevision: state.engagements.svc!.revision });
  const start = (who: string, until = 7200000) =>
    command(who, {
      type: 'start',
      id: 'svc',
      expectedRevision: state.engagements.svc!.revision,
      until,
    });
  const prepare = () => {
    expect(command('alice', { type: 'offer', ...terms }).accepted).toBe(true);
    expect(operation('charlie', 'accept').accepted).toBe(true);
    expect(operation('dana', 'fund').accepted).toBe(true);
  };
  return {
    terms,
    apply,
    ports,
    balances,
    conditions,
    material,
    command,
    operation,
    start,
    prepare,
    get state() {
      return state;
    },
    get engagement() {
      return state.engagements.svc!;
    },
    get sessions() {
      return sessions;
    },
    time: (n: number) => {
      at = n;
    },
    facility: (v: boolean) => {
      facility = v;
    },
    tick: (n: number) => {
      at = n;
      return apply(advanceServiceEngagement(state, 'svc', at, ports));
    },
  };
}
describe('service engagements', () => {
  it('separates resource authority, personal consent and third party funding', () => {
    const h = fixture();
    expect(h.command('bob', { type: 'offer', ...h.terms })).toEqual({
      accepted: false,
      reason: 'resource-controller-authority-required',
    });
    expect(h.command('alice', { type: 'offer', ...h.terms }).accepted).toBe(true);
    expect(h.operation('dana', 'fund')).toEqual({
      accepted: false,
      reason: 'service-engagement-not-accepted',
    });
    expect(h.operation('alice', 'accept')).toEqual({
      accepted: false,
      reason: 'service-recipient-consent-required',
    });
    expect(h.operation('charlie', 'accept').accepted).toBe(true);
    expect(h.operation('charlie', 'fund')).toEqual({
      accepted: false,
      reason: 'service-payer-authority-required',
    });
    h.balances['agent:dana'] = 1;
    expect(h.operation('dana', 'fund')).toEqual({
      accepted: false,
      reason: 'insufficient-service-funding',
    });
    expect(h.engagement.escrow).toBe(0);
    h.balances['agent:dana'] = 100;
    expect(h.operation('dana', 'fund').accepted).toBe(true);
    expect(h.balances['agent:dana']).toBe(64);
    expect(h.engagement.escrow).toBe(36);
    expect(h.start('alice')).toEqual({
      accepted: false,
      reason: 'personal-service-participation-required',
    });
  });
  it('charges only actual overlap, preserves earned wages and refunds the original sponsor on personal exit', () => {
    const h = fixture();
    h.prepare();
    expect(h.start('bob').accepted).toBe(true);
    h.tick(600000);
    expect(h.engagement.progressMs).toBe(0);
    expect(h.conditions.bob!.energy).toBe(100);
    expect(h.start('charlie').accepted).toBe(true);
    h.tick(1200000);
    expect(h.engagement.progressMs).toBe(600000);
    expect(h.engagement.charged).toBe(6);
    expect(h.balances['agent:bob']).toBe(103);
    expect(h.balances['agent:alice']).toBe(103);
    expect(h.operation('charlie', 'leave').accepted).toBe(true);
    expect(h.engagement.status).toBe('ended');
    expect(h.engagement.refunded).toBe(30);
    expect(h.balances['agent:dana']).toBe(94);
    expect(h.sessions).toEqual({});
    expect(Object.values(h.balances).reduce((a, b) => a + b, 0)).toBe(400);
    expect(h.tick(1300000)).toMatchObject({ accepted: true, events: [] });
  });
  it('uses cumulative fixed precision so irregular settlement intervals do not change money or effort', () => {
    const run = (steps: number[]) => {
      const h = fixture({ pricePerHour: 0.123456, providerShareBps: 3333 });
      h.prepare();
      h.start('bob');
      h.start('charlie');
      for (const t of steps) h.tick(t);
      h.operation('bob', 'leave');
      return h;
    };
    const one = run([1234567]),
      split = run([123, 111111, 888888, 1234567]);
    for (const field of [
      'charged',
      'providerPaid',
      'revenuePaid',
      'refunded',
      'progressMs',
    ] as const)
      expect(split.engagement[field]).toBe(one.engagement[field]);
    expect(split.conditions).toEqual(one.conditions);
  });
  it('binds meals after acceptance, consumes only actual food, and returns unconsumed inputs on exit', () => {
    const h = fixture({ modelId: 'meal-assistance-v1', materials: [{ id: 'input', revision: 1 }] });
    h.prepare();
    expect(h.material.status).toBe('bound');
    h.start('bob');
    h.start('charlie');
    h.tick(900000);
    expect(h.material.held.Apple).toBe(3);
    expect(h.engagement.charged).toBe(9);
    expect(h.operation('bob', 'leave').accepted).toBe(true);
    expect(h.material.status).toBe('settled');
    expect(h.material.held.Apple).toBe(3);
    expect(h.engagement.refunded).toBe(27);
  });
  it('requires teaching knowledge and a real facility, preserves the book and grants no credential', () => {
    const h = fixture({ modelId: 'guided-study-v1', materials: [{ id: 'input', revision: 1 }] });
    h.prepare();
    h.facility(false);
    expect(h.start('bob')).toEqual({ accepted: false, reason: 'service-facility-unavailable' });
    h.facility(true);
    h.conditions.bob = { ...h.conditions.bob!, educationScore: 8 };
    expect(h.start('bob')).toEqual({
      accepted: false,
      reason: 'service-provider-knowledge-required',
    });
    h.conditions.bob = { ...h.conditions.bob, educationScore: 10 };
    h.start('bob');
    h.start('charlie');
    h.tick(3600000);
    expect(h.conditions.charlie!.educationScore).toBe(10);
    expect(h.material.held.Book).toBe(1);
    expect(h.engagement.endReason).toBe('completed');
    expect(h.material.status).toBe('settled');
  });
  it('settles only affordable care, releases both people and permits free contracts', () => {
    const h = fixture({ modelId: 'supportive-care-v1', pricePerHour: 0 });
    h.prepare();
    h.conditions.bob = { ...h.conditions.bob!, energy: 1 };
    h.start('bob');
    h.start('charlie');
    expect(nextServiceEngagementBoundary(h.state, 0)).toBe(60000);
    h.tick(600000);
    expect(h.engagement.progressMs).toBe(360000);
    expect(h.engagement.endReason).toBe('physical-budget-exhausted');
    expect(h.conditions.charlie!.health).toBe(50.4);
    expect(h.conditions.bob.energy).toBe(0);
    expect(h.engagement.charged).toBe(0);
    expect(h.balances['agent:dana']).toBe(100);
  });
  it('expires unsupported waiting without effects and rejects forged money, effects or materials at replay', () => {
    const h = fixture();
    h.prepare();
    h.start('bob');
    h.start('charlie');
    const d = advanceServiceEngagement(h.state, 'svc', 60000, h.ports);
    if (!d.accepted) throw new Error(d.reason);
    expect(() =>
      applyServiceEngagementCommit(h.state, d.events, [], d.materialInstructions),
    ).toThrow('service-accounting-proof-mismatch');
    const altered = d.events.map((e) =>
      e.type === 'ServiceEngagementSettled'
        ? {
            ...e,
            settlement: {
              ...e.settlement,
              recipientAfter: { ...e.settlement.recipientAfter, health: 99 },
            },
          }
        : e,
    );
    expect(() =>
      applyServiceEngagementCommit(h.state, altered, d.transactions, d.materialInstructions),
    ).toThrow('service-effect-proof-mismatch');
    const waiting = fixture();
    waiting.prepare();
    waiting.tick(7200000);
    expect(waiting.engagement.refunded).toBe(36);
    expect(waiting.engagement.progressMs).toBe(0);
  });
});

it('public funding requires an explicit extension, independent recipient consent and an exact external authorization port', () => {
  const h = fixture({ payer: { sector: 'treasury', id: 'public-treasury' } });
  expect(h.command('alice', { type: 'offer', ...h.terms }).accepted).toBe(false);
  h.apply({
    accepted: true,
    events: [{ type: 'ServicePublicFundingEnabled', policy: SERVICE_PUBLIC_FUNDING_POLICY }],
    transactions: [],
    materialInstructions: [],
    releases: [],
  });
  let approved = false;
  const publicPorts = {
    ...h.ports,
    publicFunding: {
      balance: 36,
      authorize: (e: ServiceEngagement, actorId: string) =>
        approved && actorId === 'alice' && e.id === 'svc' && e.revision === 2
          ? { decisionId: 'approved-proposal' }
          : undefined,
    },
  };
  const act = (actor: string, c: ServiceEngagementCommand) =>
    h.apply(decideServiceEngagement(h.state, actor, 0, c, publicPorts));
  expect(act('alice', { type: 'offer', ...h.terms }).accepted).toBe(true);
  expect(act('alice', { type: 'fund', id: 'svc', expectedRevision: 1 }).accepted).toBe(false);
  expect(act('alice', { type: 'accept', id: 'svc', expectedRevision: 1 }).accepted).toBe(false);
  expect(act('charlie', { type: 'accept', id: 'svc', expectedRevision: 1 }).accepted).toBe(true);
  expect(act('alice', { type: 'fund', id: 'svc', expectedRevision: 2 })).toMatchObject({
    accepted: false,
    reason: 'service-payer-authority-required',
  });
  approved = true;
  expect(
    decideServiceEngagement(
      h.state,
      'alice',
      0,
      { type: 'fund', id: 'svc', expectedRevision: 2 },
      { ...publicPorts, publicFunding: { ...publicPorts.publicFunding, balance: 35.999999 } },
    ),
  ).toMatchObject({ accepted: false, reason: 'insufficient-service-funding' });
  const funding = act('alice', { type: 'fund', id: 'svc', expectedRevision: 2 });
  expect(funding.accepted).toBe(true);
  if (!funding.accepted) throw Error('fixture');
  expect(
    funding.transactions[0]?.entries.find(
      (e) => e.account.accountId === 'treasury:public-treasury',
    ),
  ).toMatchObject({ amount: -36 });
  expect(h.engagement).toMatchObject({
    escrow: 36,
    progressMs: 0,
    fundingDecisionId: 'approved-proposal',
  });
  expect(h.operation('charlie', 'cancel').accepted).toBe(true);
  expect(h.engagement).toMatchObject({ refunded: 36, charged: 0, status: 'ended' });
  expect(h.balances['treasury:public-treasury']).toBe(0);
});
