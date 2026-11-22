import { asAgentId } from '@aivilization/sim-core';
import { expect, test } from 'vitest';
import {
  decideCollective,
  authorizeCollectiveResourceExecution,
  type CollectiveCommand,
} from '@aivilization/collaboration';
import { normalizeEnterpriseState } from '@aivilization/enterprise';
import {
  RESOURCE_CONTROL_POLICY,
  type PrincipalControlCommand,
  type PrincipalRequest,
} from '@aivilization/authority';
import { materialOperationRequest } from '@aivilization/materials';
import {
  enableResourcePrincipalsEvent,
  residentPrincipalControlEvent,
  residentMaterialEvent,
  applyWorldEvent,
  type WorldEvent,
} from '@aivilization/world';
import { createOpenSocietyManifest } from './manifest';
import { initialOpenSocietyState, applyOpenSocietyEffects } from './state';
import { principalCollectiveAuthority } from './principalCollectiveAuthority';
import type { OpenSocietyEffects } from './types';

function fixture(firm = false) {
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    materials: true,
    publicGovernance: true,
    resourceControl: true,
  });
  const [a, b, c] = m.residents.map((r) => r.id) as [string, string, string];
  const location = Object.values(m.initialWorld.locations).find(
    (l) => l.kind === 'production',
  )!.locationId;
  const initial = initialOpenSocietyState({
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, v]) => [
          id,
          { ...v, locationId: location, inventory: { Wood: 8 } },
        ]),
      ),
      // Explicit zero-cash test endowment. The actual collective still forms through independent resident consent below.
      ...(firm
        ? {
            enterprises: {
              firm: normalizeEnterpriseState({
                enterpriseId: 'firm',
                name: '测试企业',
                ownerAgentId: asAgentId(a),
                occupationName: 'Helper',
                balance: 0,
                inventory: {},
                maxEmployees: 3,
                employeeAgentIds: [],
                employeeWageOffers: {},
                ownershipShares: { [a]: 1 },
                status: 'active',
                foundedAt: 0,
                cumulativeSales: 0,
                cumulativePurchases: 0,
                cumulativeWages: 0,
                control: {
                  policyVersion: RESOURCE_CONTROL_POLICY.version,
                  controller: { kind: 'collective', id: 'club' },
                  version: 2,
                  at: 0,
                  changedBy: a,
                  decisionId: 'declared-test-control',
                },
              }),
            },
          }
        : {}),
    },
  });
  let state = initial,
    n = 0;
  const commits: OpenSocietyEffects[] = [];
  const apply = (effects: OpenSocietyEffects) => {
    state = applyOpenSocietyEffects(state, effects);
    commits.push(effects);
  };
  const context = (actorId = a) => ({
    projection: state.world,
    actorId,
    requestId: `p${++n}`,
    simulationId: m.simulationId,
    nextSequence: state.worldSequence + 1,
  });
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (d.accepted) apply({ worldEvents: d.events });
  };
  const auth = {
    authorize: () => undefined,
    controlAvailable: () => true,
    hasExternalObligation: () => false,
    mayStoreAt: () => true,
  };
  ok(
    residentMaterialEvent({
      ...context(),
      authorization: auth,
      command: { type: 'create-stock', id: 's', title: '实际库存', locationId: location },
    }),
  );
  ok(
    residentMaterialEvent({
      ...context(),
      authorization: auth,
      command: { type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 5 } },
    }),
  );
  apply({ worldEvents: [enableResourcePrincipalsEvent(context())] });
  const collective = (actorId: string, command: CollectiveCommand) => {
    const d = decideCollective({
      state: state.collectives!,
      actorId,
      at: state.world.clock.now,
      command,
      exists: (id) => !!state.residents[id],
      validateResource: () => undefined,
    });
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) apply({ collectiveEvents: d.events });
  };
  collective(b, {
    type: 'create',
    id: 'club',
    configuration: {
      title: '共同决定',
      terms: '两人独立同意',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 100000,
  });
  collective(c, { type: 'respond', id: 'club', expectedRevision: 1, accept: true });
  const request = (command: PrincipalControlCommand) => ({
    resourceKind: 'stock',
    resourceId: 's',
    resourceRevision: state.world.materials!.stocks.s!.revision,
    controlVersion: state.world.materials!.stocks.s!.control.version,
    command,
  });
  const control = (actorId: string, command: PrincipalControlCommand, decisionId?: string) =>
    residentPrincipalControlEvent({
      ...context(actorId),
      request: request(command),
      collective: principalCollectiveAuthority(state, decisionId ? { decisionId } : {}),
    });
  const approve = (r: PrincipalRequest, id = 'd') => {
    collective(b, {
      type: 'propose',
      id,
      collectiveId: 'club',
      expectedVersion: state.collectives!.charters.club!.version,
      terms: '批准精确资源动作',
      action: {
        kind: 'resource',
        capability: 'operation' in r ? 'principals.operate' : 'principals.control',
        resourceId: r.resourceId,
        arguments: { request: r },
      },
      closesAt: 10000,
      executeBefore: 100000,
    });
    for (const actor of [b, c])
      collective(actor, {
        type: 'vote',
        id,
        expectedRevision: state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    collective(b, {
      type: 'decide',
      id,
      expectedRevision: state.collectives!.decisions[id]!.revision,
    });
    const proof = authorizeCollectiveResourceExecution({
      state: state.collectives!,
      actorId: b,
      id,
      expectedRevision: state.collectives!.decisions[id]!.revision,
      at: state.world.clock.now,
    });
    if (!proof.accepted) throw Error(proof.reason);
    return proof.event;
  };
  return {
    a,
    b,
    c,
    get state() {
      return state;
    },
    apply,
    context,
    ok,
    auth,
    request,
    control,
    approve,
    replay: () => expect(commits.reduce(applyOpenSocietyEffects, initial)).toEqual(state),
  };
}

test('collective custody and operation replay require actual current approval plus its atomic consumption', () => {
  const t = fixture();
  t.ok(
    t.control(t.a, {
      type: 'offer',
      target: { kind: 'collective', id: 'club' },
      expiresAt: 10000,
      terms: '集体承担',
    }),
  );
  expect(t.control(t.b, { type: 'accept' }).accepted).toBe(false);
  const consumed = t.approve(t.request({ type: 'accept' }));
  const d = t.control(t.b, { type: 'accept' }, 'd');
  if (!d.accepted) throw Error(d.reason);
  expect(() => applyWorldEvent(t.state.world, d.events[0]!)).toThrow(
    'world-principal-authority-source-mismatch',
  );
  const before = t.state;
  expect(() => t.apply({ worldEvents: d.events })).toThrow(
    'world-principal-authority-source-mismatch',
  );
  expect(() => t.apply({ collectiveEvents: [consumed] })).toThrow(
    'principal-collective-consumption-needs-resource-effect',
  );
  expect(t.state).toBe(before);
  t.apply({ worldEvents: d.events, collectiveEvents: [consumed] });
  expect(t.state.world.materials!.stocks.s!.control.controller).toEqual({
    kind: 'collective',
    id: 'club',
  });
  const stock = t.state.world.materials!.stocks.s!,
    command = {
      type: 'withdraw' as const,
      id: 's',
      expectedRevision: stock.revision,
      recipientId: t.b,
      items: { Wood: 1 },
    };
  const operation = materialOperationRequest(stock, command),
    operationConsumed = t.approve(operation, 'withdraw');
  const op = residentMaterialEvent({
    ...t.context(t.b),
    authorization: t.auth,
    command,
    collective: principalCollectiveAuthority(t.state, { decisionId: 'withdraw' }),
  });
  if (!op.accepted) throw Error(op.reason);
  expect(() => t.apply({ worldEvents: op.events })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  t.apply({ worldEvents: op.events, collectiveEvents: [operationConsumed] });
  expect(t.state.world.agents[t.b]!.inventory.Wood).toBe(9);
  expect(t.state.world.materials!.stocks.s!.inventory.Wood).toBe(4);
  expect(t.state.collectives!.decisions.withdraw!.status).toBe('executed');
  t.replay();
});

test('collective enterprise managers need the same exact independent decision, and approval cannot be repurposed for another quantity', () => {
  const t = fixture(true);
  t.ok(
    t.control(t.a, {
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      expiresAt: 10000,
      terms: '企业承担，管理集体不能私取',
    }),
  );
  const consumed = t.approve(t.request({ type: 'accept' }));
  const d = t.control(t.b, { type: 'accept' }, 'd');
  if (!d.accepted) throw Error(d.reason);
  t.apply({ worldEvents: d.events, collectiveEvents: [consumed] });
  const stock = t.state.world.materials!.stocks.s!,
    command = {
      type: 'withdraw' as const,
      id: 's',
      expectedRevision: stock.revision,
      recipientId: t.b,
      items: { Wood: 1 },
    };
  expect(
    residentMaterialEvent({ ...t.context(t.b), authorization: t.auth, command }).accepted,
  ).toBe(false);
  const record = t.approve(materialOperationRequest(stock, command), 'withdraw');
  const collective = principalCollectiveAuthority(t.state, { decisionId: 'withdraw' });
  expect(
    residentMaterialEvent({
      ...t.context(t.b),
      authorization: t.auth,
      command: { ...command, items: { Wood: 2 } },
      collective,
    }).accepted,
  ).toBe(false);
  const op = residentMaterialEvent({
    ...t.context(t.b),
    authorization: t.auth,
    command,
    collective,
  });
  if (!op.accepted) throw Error(op.reason);
  t.apply({ worldEvents: op.events, collectiveEvents: [record] });
  expect(t.state.world.materials!.stocks.s!.control.controller).toEqual({
    kind: 'enterprise',
    id: 'firm',
  });
  expect(t.state.world.enterprises.firm!.ownershipShares).toEqual({ [t.a]: 1 });
  t.replay();
});
