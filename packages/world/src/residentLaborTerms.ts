import {
  applyEnterpriseDomainEvent,
  decideEnterpriseLaborTerms,
  ENTERPRISE_LABOR_TERMS_POLICY,
  enterpriseControlVersion,
  type EnterpriseLaborTermsCommand,
  type EnterpriseLaborTermsEvent,
  type EnterpriseState,
} from '@aivilization/enterprise';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  samePrincipalRequest,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  authorizeWorldPrincipalOperation,
  assertWorldPrincipalOperationSource,
} from './resourcePrincipalAuthority';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { AGREED_LABOR_SOURCE } from './laborCompensationSource';
export type ResidentLaborTermsPayload = {
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly command: EnterpriseLaborTermsCommand;
  readonly events: readonly EnterpriseLaborTermsEvent[];
  readonly authorization?: PrincipalAuthorization<PrincipalOperationRequest>;
};
export function parseEnterpriseLaborCommand(v: unknown): EnterpriseLaborTermsCommand {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    !('type' in v) ||
    !('id' in v) ||
    typeof v.id !== 'string'
  )
    throw Error('invalid-labor-terms-command');
  if (
    v.type === 'offer' &&
    Object.keys(v).sort().join(',') === 'employeeId,id,referenceMs,type,validUntil,wageMicros' &&
    'employeeId' in v &&
    typeof v.employeeId === 'string' &&
    'wageMicros' in v &&
    typeof v.wageMicros === 'number' &&
    'referenceMs' in v &&
    typeof v.referenceMs === 'number' &&
    'validUntil' in v &&
    typeof v.validUntil === 'number'
  )
    return {
      type: v.type,
      id: v.id,
      employeeId: v.employeeId,
      wageMicros: v.wageMicros,
      referenceMs: v.referenceMs,
      validUntil: v.validUntil,
    };
  if (
    ['accept', 'decline', 'withdraw'].includes(String(v.type)) &&
    Object.keys(v).sort().join(',') === 'expectedRevision,id,type' &&
    'expectedRevision' in v &&
    typeof v.expectedRevision === 'number'
  )
    return {
      type: v.type as 'accept' | 'decline' | 'withdraw',
      id: v.id,
      expectedRevision: v.expectedRevision,
    };
  throw Error('invalid-labor-terms-command');
}
export function laborTermsOperationRequest(
  e: EnterpriseState,
  command: EnterpriseLaborTermsCommand,
): PrincipalOperationRequest {
  return {
    resourceKind: 'enterprise-labor-terms',
    resourceId: e.enterpriseId,
    resourceRevision: e.laborTerms?.revision ?? 1,
    controlVersion: enterpriseControlVersion(e),
    operation: {
      capability: 'business.change-labor-terms',
      arguments: { command: structuredClone(command) },
    },
  };
}
export function residentLaborTermsEvent(input: {
  projection: WorldProjection;
  actorId: string;
  enterpriseId: string;
  command: EnterpriseLaborTermsCommand;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  collective?: PrincipalCollectivePort;
  expectedRequest?: PrincipalOperationRequest;
}) {
  try {
    const w = input.projection;
    let enterprise = w.enterprises[input.enterpriseId];
    if (
      !enterprise ||
      !w.agents[input.actorId] ||
      w.residentLabor?.configuration.compensationSource !== AGREED_LABOR_SOURCE
    )
      throw Error('agreed-labor-not-enabled-or-source-missing');
    const request = laborTermsOperationRequest(enterprise, input.command);
    if (input.expectedRequest && !samePrincipalRequest(request, input.expectedRequest))
      throw Error('labor-terms-request-stale');
    const managed = input.command.type === 'offer' || input.command.type === 'withdraw';
    const authorization = managed
      ? authorizeWorldPrincipalOperation(
          w,
          input.actorId,
          { kind: 'enterprise', id: input.enterpriseId },
          request,
          undefined,
          input.collective,
        )
      : undefined;
    if (managed && !authorization) throw Error('labor-offer-employer-authority-required');
    const events: EnterpriseLaborTermsEvent[] = [];
    if (!enterprise.laborTerms) {
      const event: EnterpriseLaborTermsEvent = {
        type: 'EnterpriseLaborTermsEnabled',
        at: w.clock.now,
        policyVersion: ENTERPRISE_LABOR_TERMS_POLICY.version,
      };
      events.push(event);
      enterprise = applyEnterpriseDomainEvent(enterprise, event);
    }
    const d = decideEnterpriseLaborTerms({
      enterprise,
      actorId: input.actorId,
      at: w.clock.now,
      command: input.command,
      ...(authorization
        ? {
            authorize: () =>
              authorization.source.kind === 'enterprise' &&
              authorization.source.managementDecisionId
                ? { actorId: input.actorId, decisionId: authorization.source.managementDecisionId }
                : undefined,
          }
        : {}),
    });
    if (!d.accepted) return d;
    events.push(d.event);
    const event = createEventEnvelope({
      id: `${input.requestId}:labor-terms`,
      simulationId: input.simulationId,
      sequence: input.nextSequence,
      occurredAt: w.clock.now,
      type: 'ResidentLaborTermsCommitted' as const,
      payload: {
        actorId: input.actorId,
        enterpriseId: input.enterpriseId,
        command: input.command,
        events,
        ...(authorization ? { authorization } : {}),
      },
    });
    applyResidentLaborTermsProjection(w, event, input.collective);
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-labor-terms-operation',
    };
  }
}
export function applyResidentLaborTermsProjection(
  w: WorldProjection,
  event: WorldEvent,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (event.type !== 'ResidentLaborTermsCommitted') return undefined;
  const p = event.payload;
  let enterprise = w.enterprises[p.enterpriseId];
  if (
    !enterprise ||
    !w.agents[p.actorId] ||
    w.residentLabor?.configuration.compensationSource !== AGREED_LABOR_SOURCE ||
    event.occurredAt !== w.clock.now ||
    p.events.length < 1 ||
    p.events.length > 2
  )
    throw Error('invalid-labor-terms-world-source');
  const command = parseEnterpriseLaborCommand(p.command);
  const managed = command.type === 'offer' || command.type === 'withdraw';
  if (managed) {
    if (
      !p.authorization ||
      p.authorization.actorId !== p.actorId ||
      p.authorization.principal.kind !== 'enterprise' ||
      p.authorization.principal.id !== p.enterpriseId ||
      !samePrincipalRequest(
        p.authorization.request,
        laborTermsOperationRequest(enterprise, command),
      )
    )
      throw Error('labor-terms-authorization-source-mismatch');
    assertWorldPrincipalOperationSource(w, p.authorization, undefined, collective);
  } else if (p.authorization) throw Error('labor-terms-personal-consent-required');
  for (const [i, e] of p.events.entries()) {
    if (e.type === 'EnterpriseLaborTermsEnabled') {
      if (i !== 0 || p.events.length !== 2 || command.type !== 'offer' || e.at !== w.clock.now)
        throw Error('unrelated-labor-terms-activation');
    } else {
      const o = e.offer;
      if (managed) {
        const authority = command.type === 'offer' ? o.authority : e.authority;
        const proof = p.authorization;
        if (
          !authority ||
          !proof ||
          proof.source.kind !== 'enterprise' ||
          authority.decisionId !== (proof.source.managementDecisionId ?? undefined)
        )
          throw Error('labor-terms-management-proof-mismatch');
      }
      if (
        i !== p.events.length - 1 ||
        e.actorId !== p.actorId ||
        o.updatedAt !== w.clock.now ||
        o.id !== command.id ||
        o.status !==
          (command.type === 'offer'
            ? 'offered'
            : command.type === 'accept'
              ? 'accepted'
              : command.type === 'decline'
                ? 'declined'
                : 'withdrawn') ||
        !w.agents[o.employeeId]
      )
        throw Error('labor-terms-command-effect-mismatch');
      if (command.type === 'offer') {
        if (
          o.employeeId !== command.employeeId ||
          o.wageMicros !== command.wageMicros ||
          o.referenceMs !== command.referenceMs ||
          o.validUntil !== command.validUntil
        )
          throw Error('labor-terms-command-effect-mismatch');
      } else if (enterprise.laborTerms?.offers[command.id]?.revision !== command.expectedRevision)
        throw Error('labor-offer-revision-conflict');
    }
    enterprise = applyEnterpriseDomainEvent(enterprise, e);
  }
  return { ...w, enterprises: { ...w.enterprises, [enterprise.enterpriseId]: enterprise } };
}
