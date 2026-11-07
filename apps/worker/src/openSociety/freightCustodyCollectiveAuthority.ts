import {
  authorizeCollectiveResourceExecution,
  type CollectiveEvent,
} from '@aivilization/collaboration';
import { freightFactsEqual } from '@aivilization/logistics';
import type { FreightCustodyCollectivePort } from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyEffects } from './types';
import { freightCustodyArguments } from './freightCustodyCommands';

export function freightCustodyCollectiveAuthority(
  state: OpenSocietyState,
  consumed?: readonly CollectiveEvent[],
): FreightCustodyCollectivePort {
  return {
    authorize: (input) => {
      const s = state.collectives,
        d = input.decisionId && s?.decisions[input.decisionId];
      if (!s || !d || input.command.type === 'accept') return undefined;
      const proof = authorizeCollectiveResourceExecution({
        state: s,
        actorId: input.actorId,
        id: d.id,
        expectedRevision: d.revision,
        at: state.world.clock.now,
      });
      if (
        !proof.accepted ||
        proof.collectiveId !== input.collectiveId ||
        proof.action.capability !== 'freight.handoff' ||
        proof.action.resourceId !== input.freightId ||
        !freightFactsEqual(proof.action.arguments, freightCustodyArguments(input.command))
      )
        return undefined;
      if (consumed) {
        const matches = consumed.filter(
          (e) => e.type === 'CollectiveDecisionChanged' && e.decision.id === d.id,
        );
        if (matches.length !== 1 || !freightFactsEqual(matches[0], proof.event)) return undefined;
      }
      return { decisionId: d.id };
    },
    consentValid: (proposal, role) => {
      const c = proposal.consents[role],
        principal = proposal.principals[role];
      const d = c?.decisionId && state.collectives?.decisions[c.decisionId];
      const charter =
        principal.kind === 'collective' ? state.collectives?.charters[principal.id] : undefined;
      if (
        !c ||
        !d ||
        !charter ||
        charter.status !== 'active' ||
        d.charterVersion !== charter.version ||
        d.collectiveId !== charter.id ||
        d.status !== 'executed' ||
        d.executedBy !== c.actorId ||
        d.executedAt === undefined ||
        d.executedAt > proposal.at ||
        d.action.kind !== 'resource' ||
        d.action.capability !== 'freight.handoff' ||
        d.action.resourceId !== proposal.freightId
      )
        return false;
      const a = d.action.arguments;
      return (
        Number.isSafeInteger(a.expectedRevision) &&
        (a.expectedRevision as number) < proposal.revision &&
        freightFactsEqual(a, {
          action: 'consent',
          handoffId: proposal.id,
          expectedRevision: a.expectedRevision,
          role,
        })
      );
    },
  };
}
export function freightCustodyReplayAuthority(
  state: OpenSocietyState,
  effects: OpenSocietyEffects,
) {
  const references = (effects.worldEvents ?? []).flatMap((e) =>
    e.type === 'ResidentLogisticsCommitted' &&
    e.payload.custody?.type === 'handoff' &&
    e.payload.custody.authorization
      ? [e.payload.custody.authorization.decisionId]
      : [],
  );
  for (const e of effects.collectiveEvents ?? []) {
    if (
      e.type === 'CollectiveDecisionChanged' &&
      e.decision.status === 'executed' &&
      e.decision.action.kind === 'resource' &&
      e.decision.action.capability === 'freight.handoff' &&
      references.filter((id) => id === e.decision.id).length !== 1
    )
      throw Error('custody-collective-consumption-needs-exact-effect');
  }
  return freightCustodyCollectiveAuthority(state, effects.collectiveEvents ?? []);
}
