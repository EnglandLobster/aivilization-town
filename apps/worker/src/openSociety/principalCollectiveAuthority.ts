import {
  authorizeCollectiveResourceExecution,
  collectiveOperable,
  type CollectiveEvent,
} from '@aivilization/collaboration';
import { enterpriseController } from '@aivilization/enterprise';
import { publicEqual } from '@aivilization/governance';
import type { PrincipalAuthorization, PrincipalRequest } from '@aivilization/authority';
import type { PrincipalCollectivePort, WorldEvent } from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyEffects } from './types';

/** Construction binds an already-approved decision; replay additionally requires its exact atomic consumption. */
export function principalCollectiveAuthority(
  state: OpenSocietyState,
  options: {
    decisionId?: string;
    consumed?: readonly CollectiveEvent[];
  } = {},
): PrincipalCollectivePort {
  return {
    available: (id) =>
      !!state.collectives?.charters[id] && collectiveOperable(state.collectives.charters[id]),
    authorize: (input) => {
      const s = state.collectives,
        id = input.decisionId ?? options.decisionId;
      if (!s || !id || (options.decisionId && id !== options.decisionId)) return undefined;
      const decision = s.decisions[id],
        charter = s.charters[input.collectiveId];
      if (!decision || !charter) return undefined;
      const principal = input.principal;
      if (principal.kind === 'collective') {
        if (principal.id !== input.collectiveId) return undefined;
      } else if (principal.kind === 'enterprise') {
        const e = state.world.enterprises[principal.id],
          controller = e && enterpriseController(e);
        if (controller?.kind !== 'collective' || controller.id !== input.collectiveId)
          return undefined;
      } else return undefined;
      const proof = authorizeCollectiveResourceExecution({
        state: s,
        actorId: input.actorId,
        id,
        expectedRevision: decision.revision,
        at: state.world.clock.now,
      });
      if (
        !proof.accepted ||
        proof.collectiveId !== input.collectiveId ||
        proof.action.capability !==
          ('operation' in input.request ? 'principals.operate' : 'principals.control') ||
        proof.action.resourceId !== input.request.resourceId ||
        !publicEqual(proof.action.arguments, { request: input.request })
      )
        return undefined;
      if (options.consumed) {
        const matching = options.consumed.filter(
          (e) => e.type === 'CollectiveDecisionChanged' && e.decision.id === id,
        );
        if (matching.length !== 1 || !publicEqual(matching[0], proof.event)) return undefined;
      }
      return { decisionId: id, charterVersion: charter.version };
    },
  };
}
function proofs(e: WorldEvent): readonly PrincipalAuthorization<PrincipalRequest>[] {
  if (e.type === 'ResidentResourcePrincipalControlCommitted')
    return [e.payload.change.control.authorization];
  if (e.type === 'ResidentPremisesCommitted')
    return e.payload.events.flatMap((v) =>
      v.type === 'PremisesPrincipalOperationRecorded' ? [v.receipt.authorization] : [],
    );
  if (e.type === 'ResidentMaterialsCommitted')
    return e.payload.events.flatMap((v) =>
      v.type === 'MaterialReceiptRecorded' && v.receipt.principalAuthorization
        ? [v.receipt.principalAuthorization]
        : [],
    );
  return [];
}
export function principalReplayAuthority(
  state: OpenSocietyState,
  effects: OpenSocietyEffects,
): PrincipalCollectivePort {
  const ids = new Set(
    (effects.worldEvents ?? [])
      .flatMap(proofs)
      .flatMap((p) =>
        p.source.kind === 'collective'
          ? [p.source.decisionId]
          : p.source.kind === 'enterprise' && p.source.managementDecisionId
            ? [p.source.managementDecisionId]
            : [],
      ),
  );
  for (const e of effects.collectiveEvents ?? []) {
    if (
      e.type !== 'CollectiveDecisionChanged' ||
      e.decision.status !== 'executed' ||
      e.decision.action.kind !== 'resource' ||
      !e.decision.action.capability.startsWith('principals.')
    )
      continue;
    if (!ids.has(e.decision.id))
      throw Error('principal-collective-consumption-needs-resource-effect');
  }
  return principalCollectiveAuthority(state, { consumed: effects.collectiveEvents ?? [] });
}
