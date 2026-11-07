import {
  assertPrincipalControlRequest,
  assertPrincipalOperationRequest,
  type PrincipalValue,
} from '@aivilization/authority';
import {
  assertValidTaxPolicy,
  assertValidPublicBudgetPolicy,
  assertPublicEmploymentTerms,
  assertPublicHousingTerms,
} from '@aivilization/society';
import {
  PUBLIC_GOVERNANCE_POLICY,
  PUBLIC_EMPLOYMENT_GRANT,
  PUBLIC_HOUSING_GRANT,
  PUBLIC_RESOURCE_CUSTODY_GRANT,
  PUBLIC_RESOURCE_SALES_GRANT,
  PUBLIC_RESOURCE_SALES_GRANT_V2,
  PUBLIC_PERIODIC_OBLIGATIONS_GRANT,
  PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT,
  PUBLIC_PRINCIPAL_PERMITS_GRANT,
  PUBLIC_PRINCIPAL_TRADE_GRANT,
  PUBLIC_CONSTRUCTION_TRADE_GRANT,
  PUBLIC_VEHICLE_PRINCIPALS_GRANT,
  PUBLIC_SERVICE_PRINCIPALS_GRANT,
  PUBLIC_SERVICE_CREATION_GRANT,
  PUBLIC_PROCUREMENT_GRANT,
  PUBLIC_GOODS_PROCUREMENT_GRANT,
  type PublicAction,
  type PublicJurisdictionGrant,
  type PublicProcedure,
} from './model';
export const publicId = (s: string) =>
  typeof s === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(s) &&
  !['constructor', '__proto__', 'prototype'].includes(s);
export const publicTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
export const publicText = (s: string, max = 4000) =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const isArray = (value: unknown): boolean => Array.isArray(value);
function require(condition: boolean): asserts condition {
  if (!condition) throw Error('invalid-public-governance');
}
function ids(values: readonly string[]) {
  require(
    isArray(values) &&
      values.length > 0 &&
      values.length <= PUBLIC_GOVERNANCE_POLICY.maxElectors &&
      values.every(publicId) &&
      new Set(values).size === values.length,
  );
}
function keys(o: object, required: readonly string[], optional: readonly string[] = []) {
  require(!!o && typeof o === 'object' && !isArray(o));
  require(
    required.every((k) => Object.hasOwn(o, k)) &&
      Object.keys(o).every((k) => [...required, ...optional].includes(k)),
  );
}
export function assertPublicGrant(grant: PublicJurisdictionGrant) {
  keys(
    grant,
    ['id', 'source', 'residents', 'actions'],
    [
      'procurement',
      'goodsProcurement',
      'employment',
      'housing',
      'resourceCustody',
      'construction',
      'principalPermits',
      'principalTrade',
      'constructionTrade',
      'resourceSales',
      'periodicObligations',
      'vehicles',
      'services',
      'serviceCreation',
    ],
  );
  if (grant.procurement) require(publicEqual(grant.procurement, PUBLIC_PROCUREMENT_GRANT));
  require(grant.actions.includes('fund-service') === !!grant.procurement);
  if (grant.goodsProcurement)
    require(
      !!grant.procurement && publicEqual(grant.goodsProcurement, PUBLIC_GOODS_PROCUREMENT_GRANT),
    );
  require(grant.actions.includes('fund-goods') === !!grant.goodsProcurement);
  if (grant.principalPermits)
    require(
      !!grant.construction && publicEqual(grant.principalPermits, PUBLIC_PRINCIPAL_PERMITS_GRANT),
    );
  if (grant.resourceSales)
    require(
      !!grant.construction &&
        (publicEqual(grant.resourceSales, PUBLIC_RESOURCE_SALES_GRANT) ||
          (!!grant.vehicles && publicEqual(grant.resourceSales, PUBLIC_RESOURCE_SALES_GRANT_V2))),
    );
  if (grant.constructionTrade)
    require(
      !!grant.construction && publicEqual(grant.constructionTrade, PUBLIC_CONSTRUCTION_TRADE_GRANT),
    );
  if (grant.principalTrade)
    require(
      !!grant.principalPermits && publicEqual(grant.principalTrade, PUBLIC_PRINCIPAL_TRADE_GRANT),
    );
  if (grant.periodicObligations)
    require(publicEqual(grant.periodicObligations, PUBLIC_PERIODIC_OBLIGATIONS_GRANT));
  if (grant.construction)
    require(
      !!grant.resourceCustody &&
        publicEqual(grant.construction, PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT),
    );
  if (grant.resourceCustody)
    require(publicEqual(grant.resourceCustody, PUBLIC_RESOURCE_CUSTODY_GRANT));
  if (grant.services) require(publicEqual(grant.services, PUBLIC_SERVICE_PRINCIPALS_GRANT));
  if (grant.serviceCreation)
    require(!!grant.services && publicEqual(grant.serviceCreation, PUBLIC_SERVICE_CREATION_GRANT));
  if (grant.vehicles) require(publicEqual(grant.vehicles, PUBLIC_VEHICLE_PRINCIPALS_GRANT));
  require(
    grant.actions.includes('control-resource') ===
      !!(grant.resourceCustody || grant.vehicles || grant.services),
  );
  require(
    grant.actions.includes('manage-resource') ===
      !!(grant.resourceCustody || grant.vehicles || grant.services || grant.periodicObligations),
  );
  if (grant.housing) require(publicEqual(grant.housing, PUBLIC_HOUSING_GRANT));
  require(grant.actions.includes('set-housing') === !!grant.housing);
  if (grant.employment) require(publicEqual(grant.employment, PUBLIC_EMPLOYMENT_GRANT));
  require(grant.actions.includes('set-employment') === !!grant.employment);
  require(publicId(grant.id));
  ids(grant.residents);
  keys(grant.source, ['kind', 'version', 'description']);
  require(
    grant.source.kind === 'explicit-scenario-grant' &&
      publicId(grant.source.version) &&
      publicText(grant.source.description),
  );
  require(
    isArray(grant.actions) &&
      grant.actions.length > 0 &&
      new Set(grant.actions).size === grant.actions.length &&
      grant.actions.every((a) =>
        [
          'set-employment',
          'set-housing',
          'control-resource',
          'manage-resource',
          'set-tax',
          'set-budget',
          'set-subsidy',
          'set-procedure',
          'invalidate-decision',
          'fund-service',
          'fund-goods',
        ].includes(a),
      ),
  );
}
export function assertPublicProcedure(p: PublicProcedure, grant: PublicJurisdictionGrant) {
  keys(p, [
    'electorate',
    'minimumTurnout',
    'minimumYes',
    'allowVoteChanges',
    'minimumVotingMs',
    'maximumVotingMs',
    'executionWindowMs',
    'executors',
  ]);
  ids(p.electorate);
  require(p.electorate.every((a) => grant.residents.includes(a)));
  require(
    [p.minimumTurnout, p.minimumYes].every(
      (n) => Number.isSafeInteger(n) && n >= 1 && n <= p.electorate.length,
    ),
  );
  require(typeof p.allowVoteChanges === 'boolean');
  require(
    [p.minimumVotingMs, p.maximumVotingMs, p.executionWindowMs].every(
      (n) => publicTime(n) && n >= 1,
    ),
  );
  require(
    p.minimumVotingMs <= p.maximumVotingMs &&
      p.maximumVotingMs <= PUBLIC_GOVERNANCE_POLICY.maxVotingMs &&
      p.executionWindowMs <= PUBLIC_GOVERNANCE_POLICY.maxExecutionMs,
  );
  if (p.executors !== 'electorate') {
    ids(p.executors);
    require(p.executors.every((a) => p.electorate.includes(a)));
  }
}
export function assertPublicAction(a: PublicAction, grant: PublicJurisdictionGrant) {
  require(grant.actions.includes(a.kind) && publicTime(a.expectedRevision));
  if (a.kind === 'control-resource' || a.kind === 'manage-resource') {
    keys(a, ['kind', 'expectedRevision', 'request']);
    require(
      !!(
        grant.resourceCustody ||
        grant.vehicles ||
        grant.services ||
        (a.kind === 'manage-resource' && grant.periodicObligations)
      ) && a.expectedRevision >= 1,
    );
    if (a.kind === 'control-resource') assertPrincipalControlRequest(a.request);
    else assertPrincipalOperationRequest(a.request);
    require(
      a.expectedRevision === a.request.resourceRevision &&
        (!!grant.resourceCustody?.resourceKinds.some((k) => k === a.request.resourceKind) ||
          !!grant.vehicles?.resourceKinds.some((k) => k === a.request.resourceKind) ||
          !!grant.services?.resourceKinds.some((k) => k === a.request.resourceKind) ||
          (a.kind === 'manage-resource' &&
            (!!grant.serviceCreation?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.construction?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.principalPermits?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.principalTrade?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.constructionTrade?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.resourceSales?.resourceKinds.some((k) => k === a.request.resourceKind) ||
              !!grant.periodicObligations?.resourceKinds.some(
                (k) => k === a.request.resourceKind,
              )))),
    );
    if (
      a.kind === 'manage-resource' &&
      (a.request.resourceKind === 'construction-order' ||
        a.request.operation.capability.startsWith('construction-trades.'))
    ) {
      const scope = grant.constructionTrade;
      require(!!scope && scope.capabilities.some((k) => k === a.request.operation.capability));
      require(
        a.request.resourceKind ===
          (a.request.operation.capability === 'construction-trades.offer'
            ? 'construction-project'
            : 'construction-order'),
      );
    }
    if (a.kind === 'manage-resource' && a.request.resourceKind === 'resource-sale')
      require(
        [
          'resource-sales.offer',
          'resource-sales.accept',
          'resource-sales.withdraw',
          'resource-sales.decline',
        ].includes(a.request.operation.capability),
      );
    if (a.kind === 'manage-resource' && a.request.resourceKind === 'periodic-obligation') {
      const scope = grant.periodicObligations,
        args = a.request.operation.arguments,
        terms = args.terms;
      require(
        !!scope &&
          scope.capabilities.some((k) => k === a.request.operation.capability) &&
          typeof args.maximumTotalMicros === 'number' &&
          Number.isSafeInteger(args.maximumTotalMicros) &&
          args.maximumTotalMicros > 0 &&
          args.maximumTotalMicros <= scope.maximumTotalMicros &&
          !!terms &&
          typeof terms === 'object' &&
          !Array.isArray(terms),
      );
      const periods = (terms as Readonly<Record<string, PrincipalValue>>).periods;
      require(
        typeof periods === 'number' &&
          Number.isSafeInteger(periods) &&
          periods >= 1 &&
          periods <= scope.maximumPeriods,
      );
    }
    return;
  }
  if (a.kind === 'fund-goods') {
    keys(a, ['kind', 'expectedRevision', 'orderId', 'amount']);
    require(!!grant.goodsProcurement && publicId(a.orderId) && a.expectedRevision >= 1);
    require(
      Number.isFinite(a.amount) &&
        a.amount > 0 &&
        Number.isSafeInteger(Math.round(a.amount * 1e6)) &&
        Math.abs(Math.round(a.amount * 1e6) / 1e6 - a.amount) <= 1e-10,
    );
    return;
  }
  if (a.kind === 'fund-service') {
    keys(a, ['kind', 'expectedRevision', 'engagementId', 'maximumCharge']);
    require(!!grant.procurement && publicId(a.engagementId) && a.expectedRevision >= 1);
    require(
      Number.isFinite(a.maximumCharge) &&
        a.maximumCharge >= 0 &&
        Number.isSafeInteger(Math.round(a.maximumCharge * 1e6)) &&
        Math.abs(Math.round(a.maximumCharge * 1e6) / 1e6 - a.maximumCharge) <= 1e-10,
    );
    return;
  }
  if (a.kind === 'invalidate-decision') {
    keys(a, ['kind', 'expectedRevision', 'proposalId', 'reason']);
    require(publicId(a.proposalId) && publicText(a.reason));
    return;
  }
  keys(a, ['kind', 'expectedRevision', 'terms']);
  if (a.kind === 'set-housing') {
    require(!!grant.housing && a.expectedRevision >= 1);
    assertPublicHousingTerms(a.terms);
    return;
  }
  if (a.kind === 'set-employment') {
    require(!!grant.employment && a.expectedRevision >= 1);
    assertPublicEmploymentTerms(a.terms);
    return;
  }
  if (a.kind === 'set-procedure') {
    assertPublicProcedure(a.terms, grant);
    return;
  }
  if (a.kind === 'set-tax') {
    keys(a.terms, ['neutralRate', 'incomeTaxBrackets', 'tradeTaxRate'], ['dividendTaxRate']);
    require(
      isArray(a.terms.incomeTaxBrackets) &&
        a.terms.incomeTaxBrackets.length > 0 &&
        a.terms.incomeTaxBrackets.length <= 32,
    );
    for (const b of a.terms.incomeTaxBrackets) keys(b, ['upToAmount', 'rate']);
    assertValidTaxPolicy({
      ...a.terms,
      policyVersion: 'public-tax-v1',
      source: 'public-procedure',
    });
    return;
  }
  if (a.kind === 'set-budget') {
    require(a.terms.cadenceMs >= PUBLIC_GOVERNANCE_POLICY.minimumBudgetCadenceMs);
    keys(a.terms, ['cadenceMs', 'minimumTreasuryReserve', 'allocations']);
    require(
      isArray(a.terms.allocations) &&
        a.terms.allocations.length <= 32 &&
        publicTime(a.terms.cadenceMs),
    );
    for (const b of a.terms.allocations) {
      keys(b, ['service', 'amountPerCadence']);
      require(publicId(b.service));
    }
    assertValidPublicBudgetPolicy({ ...a.terms, policyVersion: 'public-budget-v1' });
    return;
  }
  require(a.kind === 'set-subsidy');
  keys(a.terms, ['minimumBalance', 'maxSubsidy']);
  require([a.terms.minimumBalance, a.terms.maxSubsidy].every((n) => Number.isFinite(n) && n >= 0));
}
export function publicEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => publicEqual(v, b[i]))
    );
  const x = Object.entries(a).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const y = Object.entries(b).sort(([a], [b]) => a.localeCompare(b, 'en'));
  return (
    x.length === y.length && x.every(([k, v], i) => k === y[i]![0] && publicEqual(v, y[i]![1]))
  );
}
