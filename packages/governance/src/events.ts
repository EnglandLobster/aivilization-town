import type { PublicGovernanceState, PublicGovernanceEvent, PublicProposal } from './model';
import {
  assertPublicAction,
  assertPublicProcedure,
  publicEqual,
  publicId,
  publicText,
  publicTime,
} from './validation';
const fail = () => {
  throw Error('invalid-public-governance-event');
};
/** Apply final attributed facts. Never run a current ballot formula or execute a policy effect during replay. */
export function applyPublicGovernanceEvent(
  s: PublicGovernanceState,
  event: PublicGovernanceEvent,
): PublicGovernanceState {
  const e = structuredClone(event);
  if (e.type === 'PublicProposalOpened') {
    const p = e.proposal;
    assertPublicAction(p.action, s.grant);
    assertPublicProcedure(p.procedure, s.grant);
    if (
      !publicId(p.id) ||
      Object.hasOwn(s.proposals, p.id) ||
      p.revision !== 1 ||
      p.status !== 'voting' ||
      !publicText(p.text) ||
      !p.procedure.electorate.includes(p.authorId) ||
      p.procedureRevision !== s.procedureRevision ||
      !publicEqual(p.procedure, s.procedure) ||
      ![p.createdAt, p.closesAt, p.expiresAt].every(publicTime) ||
      p.closesAt <= p.createdAt ||
      p.expiresAt <= p.closesAt ||
      Object.keys(p.votes).length ||
      Object.keys(p.voteChanges).length ||
      Object.keys(s.proposals).length >= s.policy.maxProposals ||
      p.result ||
      p.closedAt !== undefined ||
      p.executedAt !== undefined ||
      p.effectIds ||
      p.invalidatedByProposal
    )
      fail();
    return { ...s, proposals: { ...s.proposals, [p.id]: p } };
  }
  if (e.type === 'PublicObjectionRecorded') {
    const o = e.objection;
    if (
      !publicId(o.id) ||
      Object.hasOwn(s.objections, o.id) ||
      !s.proposals[o.proposalId] ||
      !s.grant.residents.includes(o.actorId) ||
      !publicText(o.text) ||
      !publicTime(o.at) ||
      o.at < s.proposals[o.proposalId]!.createdAt ||
      Object.keys(s.objections).length >= s.policy.maxProposals
    )
      fail();
    return { ...s, objections: { ...s.objections, [o.id]: o } };
  }
  const p = s.proposals[e.proposalId];
  if (!p) return fail();
  if (e.type === 'PublicProcedureChanged') {
    if (
      e.previousRevision !== s.procedureRevision ||
      p.status !== 'executed' ||
      p.action.kind !== 'set-procedure' ||
      p.action.expectedRevision !== e.previousRevision ||
      !publicEqual(p.action.terms, e.procedure)
    )
      fail();
    assertPublicProcedure(e.procedure, s.grant);
    return { ...s, procedure: e.procedure, procedureRevision: e.previousRevision + 1 };
  }
  if (e.previousRevision !== p.revision) return fail();
  let next: PublicProposal;
  switch (e.type) {
    case 'PublicVoteRecorded': {
      const v = e.vote;
      if (
        p.status !== 'voting' ||
        !p.procedure.electorate.includes(v.actorId) ||
        !['yes', 'no', 'abstain'].includes(v.choice) ||
        !publicTime(v.at) ||
        v.at < p.createdAt ||
        v.at >= p.closesAt ||
        (p.votes[v.actorId] && (!p.procedure.allowVoteChanges || v.at < p.votes[v.actorId]!.at)) ||
        (p.voteChanges[v.actorId] ?? 0) >= s.policy.maxVoteChanges
      )
        return fail();
      next = {
        ...p,
        revision: p.revision + 1,
        votes: { ...p.votes, [v.actorId]: v },
        voteChanges: { ...p.voteChanges, [v.actorId]: (p.voteChanges[v.actorId] ?? 0) + 1 },
      };
      break;
    }
    case 'PublicBallotClosed': {
      const recorded = { yes: 0, no: 0, abstain: 0 };
      for (const v of Object.values(p.votes)) recorded[v.choice]++;
      if (
        p.status !== 'voting' ||
        !s.grant.residents.includes(e.actorId) ||
        !publicTime(e.at) ||
        e.at < p.closesAt ||
        !publicEqual(recorded, e.counts) ||
        typeof e.approved !== 'boolean'
      )
        return fail();
      next = {
        ...p,
        revision: p.revision + 1,
        status: e.approved ? 'approved' : 'rejected',
        closedAt: e.at,
        closedBy: e.actorId,
        result: e.counts,
      };
      break;
    }
    case 'PublicProposalWithdrawn':
      if (
        p.status !== 'voting' ||
        e.actorId !== p.authorId ||
        !publicTime(e.at) ||
        e.at < p.createdAt ||
        e.at >= p.closesAt
      )
        return fail();
      next = {
        ...p,
        revision: p.revision + 1,
        status: 'withdrawn',
        closedAt: e.at,
        closedBy: e.actorId,
      };
      break;
    case 'PublicDecisionExecuted': {
      const executors =
        p.procedure.executors === 'electorate' ? p.procedure.electorate : p.procedure.executors;
      if (
        p.status !== 'approved' ||
        !executors.includes(e.actorId) ||
        p.procedureRevision !== s.procedureRevision ||
        !publicTime(e.at) ||
        e.at < (p.closedAt ?? p.closesAt) ||
        e.at >= p.expiresAt ||
        !e.effectIds.length ||
        e.effectIds.length > 32 ||
        !e.effectIds.every(publicId) ||
        new Set(e.effectIds).size !== e.effectIds.length
      )
        return fail();
      next = {
        ...p,
        revision: p.revision + 1,
        status: 'executed',
        executedAt: e.at,
        executedBy: e.actorId,
        effectIds: e.effectIds,
      };
      break;
    }
    case 'PublicDecisionInvalidated': {
      const source = s.proposals[e.byProposalId];
      if (
        p.status !== 'approved' ||
        !source ||
        source.status !== 'executed' ||
        source.action.kind !== 'invalidate-decision' ||
        source.action.proposalId !== p.id ||
        source.action.expectedRevision !== p.revision
      )
        return fail();
      next = {
        ...p,
        revision: p.revision + 1,
        status: 'invalidated',
        invalidatedByProposal: source.id,
      };
      break;
    }
  }
  return { ...s, proposals: { ...s.proposals, [p.id]: next } };
}
