import { publicPremisesOperation } from './publicPremisesOperation';
import type { ResidentPremisesPayload, PremisesAuthorization } from './residentPremises';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { publicMaterialOperation } from './publicMaterialOperation';
import type { ResidentMaterialsPayload } from './residentMaterials';
import { decideWorldPrincipalControl } from './resourcePrincipals';
import type { PrincipalControlChanged } from '@aivilization/authority';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PUBLIC_GOVERNANCE_POLICY,
  createPublicGovernanceState,
  decidePublicCommand,
  preparePublicExecution,
  completePublicExecution,
  type PublicJurisdictionGrant,
  type PublicProcedure,
  type PublicCommand,
} from '@aivilization/governance';
import {
  enactPublicHousing,
  type PublicHousingChanged,
  schedulePublicEmployment,
  type PublicEmploymentChanged,
  assertValidTownGovernancePolicy,
  decideGovernanceChange,
  createInitialTownGovernanceState,
  type TownGovernancePolicy,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
import type { WorldEvent, GovernancePolicyChangedPayload } from './events';
import { publicPolicyCommand } from './publicPolicyAction';
import type { Controller } from '@aivilization/authority';

type Context = {
  readonly collective?: PrincipalCollectivePort;
  readonly premisesAuthorization?: PremisesAuthorization;
  readonly controllerAvailable?: (controller: Controller) => boolean;
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
};
const no = (reason: string) => ({ accepted: false as const, reason });
export function enableResidentPublicGovernanceEvent(
  input: Omit<Context, 'actorId'> & {
    grant: PublicJurisdictionGrant;
    procedure: PublicProcedure;
    institutionPolicy: TownGovernancePolicy;
  },
): WorldEvent {
  if (input.projection.publicGovernance) throw Error('public-governance-already-enabled');
  if (input.grant.residents.some((id) => !input.projection.agents[id]))
    throw Error('public-grant-resident-not-in-world');
  createPublicGovernanceState(input.grant, input.procedure);
  assertValidTownGovernancePolicy(input.institutionPolicy);
  return createEventEnvelope({
    id: `${input.requestId}:public-enabled`,
    simulationId: input.simulationId,
    type: 'ResidentPublicGovernanceEnabled',
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    payload: {
      policy: PUBLIC_GOVERNANCE_POLICY,
      grant: structuredClone(input.grant),
      procedure: structuredClone(input.procedure),
      institutionPolicy: structuredClone(input.institutionPolicy),
    },
  });
}
export function residentPublicGovernanceCommand(
  input: Context & {
    command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number };
  },
):
  | { readonly accepted: true; readonly events: readonly WorldEvent[] }
  | { readonly accepted: false; readonly reason: string } {
  const state = input.projection.publicGovernance;
  if (!state) return no('public-governance-not-enabled');
  if (!input.projection.agents[input.actorId]) return no('known-public-resident-required');
  const at = input.projection.clock.now,
    c = input.command,
    eventId = `${input.requestId}:public`;
  let principalChange: PrincipalControlChanged | undefined;
  let materialCommit: ResidentMaterialsPayload | undefined;
  let premisesCommit: ResidentPremisesPayload | undefined;
  let change: GovernancePolicyChangedPayload | undefined;
  let housingChange: PublicHousingChanged | undefined;
  let employmentChange: PublicEmploymentChanged | undefined;
  if (c.type !== 'execute') {
    const d = decidePublicCommand(state.authority, input.actorId, at, c);
    if (!d.accepted) return d;
    return {
      accepted: true as const,
      events: [
        createEventEnvelope({
          id: eventId,
          simulationId: input.simulationId,
          type: 'ResidentPublicGovernanceCommitted' as const,
          sequence: input.nextSequence,
          occurredAt: at,
          payload: { policyVersion: PUBLIC_GOVERNANCE_POLICY.version, events: d.events },
        }),
      ],
    };
  }
  const ready = preparePublicExecution(
    state.authority,
    input.actorId,
    at,
    c.id,
    c.expectedRevision,
  );
  if (!ready.accepted) return ready;
  if (ready.action.kind === 'manage-resource') {
    if (ready.action.request.resourceKind === 'stock') {
      const d = publicMaterialOperation({ ...input, proposal: ready.proposal });
      if (!d.accepted) return d;
      materialCommit = d.commit;
    } else {
      const d = publicPremisesOperation({ ...input, proposal: ready.proposal });
      if (!d.accepted) return d;
      premisesCommit = d.commit;
    }
  }
  if (ready.action.kind === 'control-resource') {
    const d = decideWorldPrincipalControl({
      ...input,
      request: ready.action.request,
      publicExecution: { proposalId: c.id, proposalRevision: c.expectedRevision },
    });
    if (!d.accepted) return d;
    if (
      d.change.control.authorization.source.kind !== 'public' ||
      d.change.control.authorization.source.proposalId !== c.id
    )
      return no('public-principal-source-required');
    principalChange = d.change;
  }
  if (ready.action.kind === 'set-housing') {
    if (!input.projection.publicHousing) return no('public-housing-not-enabled');
    try {
      housingChange = enactPublicHousing({
        state: input.projection.publicHousing,
        at,
        expectedRevision: ready.action.expectedRevision,
        terms: ready.action.terms,
        source: {
          kind: 'public-decision',
          proposalId: ready.proposal.id,
          actorId: input.actorId,
          procedureRevision: ready.proposal.procedureRevision,
        },
      });
    } catch (error) {
      return no(error instanceof Error ? error.message : 'invalid-public-housing-change');
    }
  }
  if (ready.action.kind === 'set-employment') {
    if (!input.projection.publicEmployment) return no('public-employment-not-enabled');
    try {
      employmentChange = schedulePublicEmployment({
        state: input.projection.publicEmployment,
        at,
        expectedRevision: ready.action.expectedRevision,
        terms: ready.action.terms,
        source: {
          kind: 'public-decision',
          proposalId: ready.proposal.id,
          actorId: input.actorId,
          procedureRevision: ready.proposal.procedureRevision,
        },
      });
    } catch (error) {
      return no(error instanceof Error ? error.message : 'invalid-public-employment-change');
    }
  }
  const command = publicPolicyCommand(state.authority.grant.id, ready.proposal, input.actorId);
  if (command) {
    const d = decideGovernanceChange({
      state: input.projection.governance ?? createInitialTownGovernanceState(),
      command,
      policy: state.institutionPolicy,
    });
    if (d.status === 'rejected') return no(d.reason);
    const { type, ...fact } = d.event;
    void type;
    change = { ...fact, changedAt: at };
  }
  const complete = completePublicExecution(
    state.authority,
    input.actorId,
    at,
    c.id,
    c.expectedRevision,
    [eventId],
  );
  if (!complete.accepted) return complete;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: eventId,
        simulationId: input.simulationId,
        type: 'ResidentPublicGovernanceCommitted' as const,
        sequence: input.nextSequence,
        occurredAt: at,
        payload: {
          policyVersion: PUBLIC_GOVERNANCE_POLICY.version,
          events: complete.events,
          ...(principalChange ? { principalChange } : {}),
          ...(materialCommit ? { materialCommit } : {}),
          ...(premisesCommit ? { premisesCommit } : {}),
          ...(change ? { policyChange: change } : {}),
          ...(housingChange ? { housingChange } : {}),
          ...(employmentChange ? { employmentChange } : {}),
        },
      }),
    ],
  };
}
