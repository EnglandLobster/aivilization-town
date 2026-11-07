import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { normalizeEnterpriseState } from '@aivilization/enterprise';
import {
  createMaterialsPolicy,
  materialOperationRequest,
  type MaterialCommand,
} from '@aivilization/materials';
import type {
  PrincipalControlCommand,
  PrincipalControlRequest,
  PrincipalOperationRequest,
} from '@aivilization/authority';
import type { PublicCommand } from '@aivilization/governance';
import {
  createWorldProjection,
  dispatchWorldCommand,
  applyWorldEvent,
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
  enableResourcePrincipalsEvent,
  residentPrincipalControlEvent,
  enterpriseControlEvent,
  handleAdvanceSimulationTimeCommand,
  type WorldEvent,
  type MaterialAuthorization,
} from './index';

function fixture() {
  const initial = createWorldProjection({
    agents: ['a', 'b', 'c'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: { Wood: id === 'a' ? 9 : 8 },
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: null,
      locationId: asLocationId('site'),
    })),
    locations: [
      {
        locationId: asLocationId('site'),
        name: '工地',
        kind: 'production',
        activityAffinities: [],
        capacity: 10,
      },
    ],
    moneySupply: 1500,
    treasury: 1000,
    enterprises: [
      normalizeEnterpriseState({
        enterpriseId: 'firm',
        name: '居民公司',
        ownerAgentId: asAgentId('b'),
        occupationName: 'Helper',
        balance: 200,
        inventory: {},
        maxEmployees: 3,
        employeeAgentIds: [asAgentId('c')],
        employeeWageOffers: { c: 10 },
        ownershipShares: { b: 1 },
        status: 'active',
        foundedAt: 0,
        cumulativeSales: 0,
        cumulativePurchases: 0,
        cumulativeWages: 0,
      }),
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `r${++n}`,
    simulationId: 'principal-test',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
    expect(w.moneySupply).toBe(1500);
    expect(
      Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
        w.treasury! +
        w.enterprises.firm!.balance,
    ).toBe(1500);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  const authorization: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: () => true,
    hasExternalObligation: () => false,
    mayStoreAt: () => true,
  };
  const material = (command: MaterialCommand, actor = 'a') =>
    residentMaterialEvent({ ...context(actor), authorization, command });
  commit([
    enableResidentMaterialsEvent({
      at: 0,
      simulationId: 'principal-test',
      requestId: 'material-enable',
      nextSequence: 1,
      policy: createMaterialsPolicy([
        {
          id: 'boards',
          version: 'v1',
          inputs: { Wood: 2 },
          outputs: { Board: 1 },
          workMs: 1000,
          energyCost: 2,
          satietyCost: 1,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  ok(material({ type: 'create-stock', id: 'stock', locationId: 'site', title: '库存' }));
  ok(material({ type: 'deposit', id: 'stock', expectedRevision: 1, items: { Wood: 8 } }));
  commit([
    enableResidentPublicGovernanceEvent({
      ...context(),
      institutionPolicy: {
        policyVersion: 'test',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 1000,
        maximumTreasuryReserve: 10000,
        maximumSubsidyBalanceFloor: 1000,
        maximumSubsidyPerCadence: 1000,
      },
      grant: {
        id: 'town',
        source: { kind: 'explicit-scenario-grant', version: 'test', description: '明确的公共制度' },
        residents: ['a', 'b', 'c'],
        actions: ['set-procedure'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  const request = (command: PrincipalControlCommand): PrincipalControlRequest => ({
    resourceKind: 'stock',
    resourceId: 'stock',
    resourceRevision: w.materials!.stocks.stock!.revision,
    controlVersion: w.materials!.stocks.stock!.control.version,
    command,
  });
  const control = (actorId: string, command: PrincipalControlCommand) =>
    residentPrincipalControlEvent({ ...context(actorId), request: request(command) });
  const publicCommand = (
    command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number },
    actor = 'a',
  ) => residentPublicGovernanceCommand({ ...context(actor), command });
  const publicRev = (id = 'p') => w.publicGovernance!.authority.proposals[id]!.revision;
  const time = (deltaMs: number) =>
    commit(
      handleAdvanceSimulationTimeCommand({
        projection: w,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time-${++n}`,
          simulationId: 'principal-test',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs },
          issuedAt: w.clock.now,
        }),
      }),
    );
  return {
    get w() {
      return w;
    },
    events,
    context,
    commit,
    ok,
    material,
    control,
    request,
    publicCommand,
    publicRev,
    time,
    enable: () => commit([enableResourcePrincipalsEvent(context())]),
    approve: (r: PrincipalControlRequest | PrincipalOperationRequest, id = 'p') => {
      const action =
        'operation' in r
          ? { kind: 'manage-resource' as const, expectedRevision: r.resourceRevision, request: r }
          : { kind: 'control-resource' as const, expectedRevision: r.resourceRevision, request: r };
      ok(
        publicCommand({
          type: 'propose',
          id,
          text: '按明确范围操作公共资源',
          expectedProcedureRevision: 1,
          closesAt: w.clock.now + 100,
          action,
        }),
      );
      for (const actor of ['a', 'b'])
        ok(
          publicCommand(
            { type: 'vote', id, expectedRevision: publicRev(id), choice: 'yes' },
            actor,
          ),
        );
      time(100);
      ok(publicCommand({ type: 'close', id, expectedRevision: publicRev(id) }));
    },
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
const offer = (kind: 'enterprise' | 'public', id: string): PrincipalControlCommand => ({
  type: 'offer',
  target: { kind, id },
  expiresAt: 10000,
  terms: '材料、现有许可及未结义务随库存保留',
});

test('real enterprise custody and exact operation authority survive manager handover without granting the creator or employee authority', () => {
  const t = fixture();
  const before = structuredClone(t.w);
  t.enable();
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.enterprises).toEqual(before.enterprises);
  expect(t.w.materials!.stocks).toEqual(before.materials!.stocks);
  t.ok(t.control('a', offer('enterprise', 'firm')));
  expect(t.control('c', { type: 'accept' }).accepted).toBe(false);
  t.ok(t.control('b', { type: 'accept' }));
  const withdraw = (actor: string) =>
    t.material(
      {
        type: 'withdraw',
        id: 'stock',
        expectedRevision: t.w.materials!.stocks.stock!.revision,
        recipientId: actor,
        items: { Wood: 1 },
      },
      actor,
    );
  expect(withdraw('a').accepted).toBe(false);
  expect(withdraw('c').accepted).toBe(false);
  const withdrawal = withdraw('b');
  if (!withdrawal.accepted || withdrawal.events[0]?.type !== 'ResidentMaterialsCommitted')
    throw Error('expected withdrawal');
  const withdrawalEvent = withdrawal.events[0],
    beforeWithdrawal = t.w;
  const forged = {
    ...withdrawalEvent,
    payload: {
      ...withdrawalEvent.payload,
      events: withdrawalEvent.payload.events.map((e) => {
        if (e.type !== 'MaterialReceiptRecorded' || !e.receipt.principalAuthorization) return e;
        const proof = e.receipt.principalAuthorization;
        return {
          ...e,
          receipt: {
            ...e.receipt,
            principalAuthorization: {
              ...proof,
              request: {
                ...proof.request,
                operation: {
                  ...proof.request.operation,
                  arguments: { ...proof.request.operation.arguments, items: { Wood: 2 } },
                },
              },
            },
          },
        };
      }),
    },
  };
  expect(() => t.commit([forged])).toThrow('material-principal-withdrawal-mismatch');
  expect(t.w).toBe(beforeWithdrawal);
  t.ok(withdrawal);
  expect(t.w.agents.b!.inventory.Wood).toBe(9);
  expect(t.w.materials!.stocks.stock!.inventory.Wood).toBe(7);
  t.ok(
    t.material(
      {
        type: 'configure-stock',
        id: 'stock',
        expectedRevision: t.w.materials!.stocks.stock!.revision,
        contributors: ['b'],
        readers: ['c'],
      },
      'b',
    ),
  );
  t.ok(
    t.material(
      {
        type: 'create-production',
        id: 'job',
        stockId: 'stock',
        expectedRevision: t.w.materials!.stocks.stock!.revision,
        recipeId: 'boards',
        quantity: 2,
        productName: '板',
        description: '生产安排由经理提出，劳动本人开始',
        workers: ['c'],
      },
      'b',
    ),
  );
  expect(t.w.materials!.productions.job!.held).toEqual({ Wood: 4 });
  expect(t.w.activityTimeByAgent.c).toBeUndefined();
  const pendingOldManagerWithdrawal = withdraw('b');
  if (!pendingOldManagerWithdrawal.accepted) throw Error('expected old manager authorization');
  const control = (
    actor: string,
    command: Parameters<typeof enterpriseControlEvent>[0]['command'],
  ) =>
    enterpriseControlEvent({
      ...t.context(actor),
      enterpriseId: 'firm',
      command,
      authorize: () => undefined,
      available: () => true,
    });
  t.ok(
    control('b', {
      type: 'offer',
      expectedVersion: 1,
      target: { kind: 'resident', id: 'c' },
      expiresAt: 10000,
      terms: '经营权移交',
    }),
  );
  t.ok(control('c', { type: 'accept', expectedVersion: 2 }));
  expect(() => t.commit(pendingOldManagerWithdrawal.events)).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(withdraw('b').accepted).toBe(false);
  t.ok(withdraw('c'));
  const last = t.events.at(-1)!;
  if (last.type !== 'ResidentMaterialsCommitted') throw Error('expected material event');
  expect(last.payload.events.find((e) => e.type === 'MaterialReceiptRecorded')).toMatchObject({
    receipt: {
      principalAuthorization: {
        principal: { kind: 'enterprise', id: 'firm' },
        source: { managementVersion: 3 },
      },
    },
  });
  expect(t.w.enterprises.firm!.ownershipShares).toEqual({ b: 1 });
  t.replay();
});

test('public acceptance consumes the actual independently approved proposal atomically and never gives the executor personal custody', () => {
  const t = fixture();
  t.enable();
  t.ok(t.control('a', offer('public', 'town')));
  expect(t.control('b', { type: 'accept' }).accepted).toBe(false);
  t.approve(t.request({ type: 'accept' }));
  const before = t.w;
  const d = t.publicCommand({ type: 'execute', id: 'p', expectedRevision: t.publicRev() }, 'c');
  if (
    !d.accepted ||
    d.events[0]?.type !== 'ResidentPublicGovernanceCommitted' ||
    !d.events[0].payload.principalChange
  )
    throw Error(JSON.stringify(d));
  const event = d.events[0],
    change = event.payload.principalChange!;
  expect(() =>
    t.commit([
      {
        ...event,
        payload: {
          ...event.payload,
          principalChange: {
            ...change,
            control: { ...change.control, controller: { kind: 'resident', id: 'c' } },
          },
        },
      },
    ]),
  ).toThrow();
  expect(t.w).toBe(before);
  t.ok(d);
  expect(t.w.publicGovernance!.authority.proposals.p!.status).toBe('executed');
  expect(t.w.materials!.stocks.stock!.control.controller).toEqual({ kind: 'public', id: 'town' });
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.treasury).toBe(before.treasury);
  expect(
    t.publicCommand({ type: 'execute', id: 'p', expectedRevision: t.publicRev() }, 'c').accepted,
  ).toBe(false);
  expect(
    t.material(
      {
        type: 'withdraw',
        id: 'stock',
        expectedRevision: t.w.materials!.stocks.stock!.revision,
        recipientId: 'c',
        items: { Wood: 1 },
      },
      'c',
    ).accepted,
  ).toBe(false);
  t.replay();
});

test('resource revision conflicts retain public approval and funds; unsupported resource domains and forged direct public commits fail', () => {
  const t = fixture();
  t.enable();
  t.ok(t.control('a', offer('public', 'town')));
  t.approve(t.request({ type: 'accept' }));
  const valid = t.publicCommand({ type: 'execute', id: 'p', expectedRevision: t.publicRev() }, 'b');
  if (
    !valid.accepted ||
    valid.events[0]?.type !== 'ResidentPublicGovernanceCommitted' ||
    !valid.events[0].payload.principalChange
  )
    throw Error('expected public transition');
  const e = valid.events[0];
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      type: 'ResidentResourcePrincipalControlCommitted',
      payload: { actorId: 'b', change: e.payload.principalChange! },
    }),
  ).toThrow('world-principal-authority-source-mismatch');
  t.ok(
    t.material(
      {
        type: 'deposit',
        id: 'stock',
        expectedRevision: t.w.materials!.stocks.stock!.revision,
        items: { Wood: 1 },
      },
      'a',
    ),
  );
  const before = t.w;
  expect(
    t.publicCommand({ type: 'execute', id: 'p', expectedRevision: t.publicRev() }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'material-stock-revision-conflict' });
  expect(t.w).toBe(before);
  expect(t.w.publicGovernance!.authority.proposals.p!.status).toBe('approved');
  expect(
    residentPrincipalControlEvent({
      ...t.context(),
      request: { ...t.request({ type: 'cancel' }), resourceKind: 'premises' },
    }),
  ).toMatchObject({ accepted: false, reason: 'principal-resource-kind-not-connected' });
  t.replay();
});

test('public material operations bind actual executor and quantities, consume only successful effects and cannot compel personal work', () => {
  const t = fixture();
  t.enable();
  t.ok(t.control('a', offer('public', 'town')));
  t.approve(t.request({ type: 'accept' }));
  t.ok(t.publicCommand({ type: 'execute', id: 'p', expectedRevision: t.publicRev() }, 'a'));
  const stock = () => t.w.materials!.stocks.stock!;
  const withdrawal = materialOperationRequest(stock(), {
    type: 'withdraw',
    id: 'stock',
    expectedRevision: stock().revision,
    recipientId: 'b',
    items: { Wood: 2 },
  });
  t.approve(withdrawal, 'q');
  const before = t.w;
  expect(
    t.publicCommand({ type: 'execute', id: 'q', expectedRevision: t.publicRev('q') }, 'c'),
  ).toMatchObject({ accepted: false, reason: 'material-recipient-must-execute' });
  expect(t.w).toBe(before);
  const d = t.publicCommand({ type: 'execute', id: 'q', expectedRevision: t.publicRev('q') }, 'b');
  if (
    !d.accepted ||
    d.events[0]?.type !== 'ResidentPublicGovernanceCommitted' ||
    !d.events[0].payload.materialCommit
  )
    throw Error(JSON.stringify(d));
  const event = d.events[0];
  expect(() =>
    applyWorldEvent(t.w, {
      ...event,
      type: 'ResidentMaterialsCommitted',
      payload: event.payload.materialCommit!,
    }),
  ).toThrow('world-principal-operation-source-mismatch');
  t.ok(d);
  expect(t.w.materials!.stocks.stock!.inventory).toEqual({ Wood: 6 });
  expect(t.w.agents.b!.inventory.Wood).toBe(10);
  expect(t.w.treasury).toBe(before.treasury);
  expect(t.w.publicGovernance!.authority.proposals.q!.status).toBe('executed');
  const configuration = materialOperationRequest(stock(), {
    type: 'configure-stock',
    id: 'stock',
    expectedRevision: stock().revision,
    contributors: ['c'],
    readers: ['b'],
  });
  t.approve(configuration, 'configure');
  t.ok(
    t.publicCommand(
      { type: 'execute', id: 'configure', expectedRevision: t.publicRev('configure') },
      'c',
    ),
  );
  expect(stock().contributors).toEqual(['c']);
  expect(stock().control.controller).toEqual({ kind: 'public', id: 'town' });
  const personal = materialOperationRequest(stock(), {
    type: 'start-production',
    id: 'job',
    expectedRevision: 1,
    until: 10000,
  });
  t.approve(personal, 'body');
  const beforeBody = t.w;
  expect(
    t.publicCommand({ type: 'execute', id: 'body', expectedRevision: t.publicRev('body') }, 'a'),
  ).toMatchObject({ accepted: false, reason: 'principal-material-operation-not-supported' });
  expect(t.w).toBe(beforeBody);
  expect(t.w.publicGovernance!.authority.proposals.body!.status).toBe('approved');
  const close = materialOperationRequest(stock(), {
    type: 'close-stock',
    id: 'stock',
    expectedRevision: stock().revision,
  });
  t.approve(close, 'close');
  expect(
    t.publicCommand({ type: 'execute', id: 'close', expectedRevision: t.publicRev('close') }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'material-stock-unsettled' });
  expect(t.w.publicGovernance!.authority.proposals.close!.status).toBe('approved');
  t.replay();
});

test('cash-only enterprise closure cannot strand a controlled stock and succeeds after independent asset handover', () => {
  const t = fixture();
  t.enable();
  t.ok(t.control('a', offer('enterprise', 'firm')));
  t.ok(t.control('b', { type: 'accept' }));
  const close = () =>
    dispatchWorldCommand({
      projection: t.w,
      nextSequence: t.events.length + 1,
      command: createCommandEnvelope({
        id: 'close-firm',
        simulationId: 'principal-test',
        source: 'agent-runtime',
        actorId: asAgentId('b'),
        type: 'AgentCloseEnterprise',
        payload: { enterpriseId: 'firm' },
        issuedAt: t.w.clock.now,
      }),
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 10,
        laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
        criticalThresholds: { energy: 0, health: 0 },
        enterprise: {
          policyVersion: 'enterprise-v1',
          minimumInitialCapital: 1,
          maximumInitialCapital: 10000,
          maximumEmployees: 10,
        },
      },
    });
  expect(close().find((e) => e.type === 'ActionRejected')?.payload.reason).toBe(
    'enterprise-resource-estate-unsettled',
  );
  const held = t.w;
  t.ok(
    t.control('b', {
      type: 'offer',
      target: { kind: 'resident', id: 'c' },
      expiresAt: 10000,
      terms: '先处理实际资产',
    }),
  );
  t.ok(t.control('c', { type: 'accept' }));
  const closing = close(),
    event = closing.find((e) => e.type === 'EnterpriseClosed');
  if (!event) throw Error('expected closure');
  expect(() => applyWorldEvent(held, event)).toThrow('enterprise-resource-estate-unsettled');
  t.commit(closing);
  expect(t.w.enterprises.firm!.status).toBe('closed');
  expect(t.w.materials!.stocks.stock!.inventory).toEqual({ Wood: 8 });
  expect(t.w.materials!.stocks.stock!.control.controller).toEqual({ kind: 'resident', id: 'c' });
  t.replay();
});
