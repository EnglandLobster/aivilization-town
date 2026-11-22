import {
  PUBLIC_GOVERNANCE_POLICY,
  type PublicGovernanceState,
  type PublicJurisdictionGrant,
  type PublicProcedure,
  type PublicCommand,
  type PublicDecision,
  type PublicProposal,
  type PublicGovernanceEvent,
} from './model';
import {
  assertPublicAction,
  assertPublicGrant,
  assertPublicProcedure,
  publicEqual,
  publicId,
  publicText,
  publicTime,
} from './validation';
const no = (reason: string): PublicDecision => ({ accepted: false, reason });
const yes = (...events: PublicGovernanceEvent[]): PublicDecision => ({
  accepted: true,
  events: structuredClone(events),
});

/** Trusted scenario grant only; resident adapters must never expose this as a resident command. */
export function createPublicGovernanceState(
  grant: PublicJurisdictionGrant,
  procedure: PublicProcedure,
): PublicGovernanceState {
  assertPublicGrant(grant);
  assertPublicProcedure(procedure, grant);
  return {
    policy: { ...PUBLIC_GOVERNANCE_POLICY },
    grant: structuredClone(grant),
    procedure: structuredClone(procedure),
    procedureRevision: 1,
    proposals: {},
    objections: {},
  };
}
export function decidePublicCommand(
  s: PublicGovernanceState,
  actorId: string,
  at: number,
  c: PublicCommand,
): PublicDecision {
  if (!publicTime(at) || !publicId(actorId) || !s.grant.residents.includes(actorId))
    return no('public-resident-required');
  if (!publicId(c.id)) return no('invalid-public-id');
  if (c.type === 'propose') {
    if (!s.procedure.electorate.includes(actorId)) return no('public-proposer-not-eligible');
    if (c.expectedProcedureRevision !== s.procedureRevision)
      return no('public-procedure-revision-conflict');
    if (Object.hasOwn(s.proposals, c.id)) return no('public-proposal-id-exists');
    if (Object.keys(s.proposals).length >= s.policy.maxProposals)
      return no('public-proposal-limit');
    try {
      assertPublicAction(c.action, s.grant);
    } catch {
      return no('public-action-outside-grant-or-invalid');
    }
    if (
      !publicText(c.text) ||
      !publicTime(c.closesAt) ||
      c.closesAt - at < s.procedure.minimumVotingMs ||
      c.closesAt - at > s.procedure.maximumVotingMs ||
      !publicTime(c.closesAt + s.procedure.executionWindowMs)
    )
      return no('invalid-public-voting-window');
    if (c.action.kind === 'set-procedure' && c.action.expectedRevision !== s.procedureRevision)
      return no('public-procedure-revision-conflict');
    if (c.action.kind === 'invalidate-decision') {
      const target = s.proposals[c.action.proposalId];
      if (!target || target.status !== 'approved' || target.revision !== c.action.expectedRevision)
        return no('public-invalidation-target-not-current');
    }
    const proposal: PublicProposal = {
      id: c.id,
      revision: 1,
      authorId: actorId,
      text: c.text,
      action: structuredClone(c.action),
      procedureRevision: s.procedureRevision,
      procedure: structuredClone(s.procedure),
      createdAt: at,
      closesAt: c.closesAt,
      expiresAt: c.closesAt + s.procedure.executionWindowMs,
      votes: {},
      voteChanges: {},
      status: 'voting',
    };
    return yes({ type: 'PublicProposalOpened', proposal });
  }
  if (c.type === 'object') {
    if (!publicId(c.proposalId) || at < (s.proposals[c.proposalId]?.createdAt ?? Infinity))
      return no('public-objection-needs-existing-proposal-and-text');
    if (!s.proposals[c.proposalId] || !publicText(c.text))
      return no('public-objection-needs-existing-proposal-and-text');
    if (Object.hasOwn(s.objections, c.id)) return no('public-objection-id-exists');
    if (Object.keys(s.objections).length >= s.policy.maxProposals)
      return no('public-objection-limit');
    return yes({
      type: 'PublicObjectionRecorded',
      objection: { id: c.id, proposalId: c.proposalId, actorId, text: c.text, at },
    });
  }
  const p = s.proposals[c.id];
  if (!p) return no('public-proposal-not-found');
  if (p.revision !== c.expectedRevision) return no('public-proposal-revision-conflict');
  if (at < p.createdAt) return no('invalid-public-time');
  if (p.status !== 'voting') return no('public-voting-closed');
  if (c.type === 'withdraw') {
    if (actorId !== p.authorId) return no('public-author-required');
    if (at >= p.closesAt) return no('public-withdrawal-deadline-passed');
    return yes({
      type: 'PublicProposalWithdrawn',
      proposalId: p.id,
      previousRevision: p.revision,
      actorId,
      at,
    });
  }
  if (c.type === 'vote') {
    if (at < (p.votes[actorId]?.at ?? p.createdAt)) return no('invalid-public-time');
    if (!p.procedure.electorate.includes(actorId)) return no('public-voter-not-eligible');
    if (at >= p.closesAt) return no('public-voting-deadline-passed');
    if (!['yes', 'no', 'abstain'].includes(c.choice)) return no('invalid-public-vote');
    if (p.votes[actorId] && !p.procedure.allowVoteChanges) return no('public-vote-change-disabled');
    if ((p.voteChanges[actorId] ?? 0) >= s.policy.maxVoteChanges)
      return no('public-vote-change-limit');
    return yes({
      type: 'PublicVoteRecorded',
      proposalId: p.id,
      previousRevision: p.revision,
      vote: { actorId, choice: c.choice, at },
    });
  }
  if (at < p.closesAt) return no('public-voting-still-open');
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const v of Object.values(p.votes)) counts[v.choice]++;
  return yes({
    type: 'PublicBallotClosed',
    proposalId: p.id,
    previousRevision: p.revision,
    actorId,
    at,
    approved:
      counts.yes + counts.no + counts.abstain >= p.procedure.minimumTurnout &&
      counts.yes >= p.procedure.minimumYes,
    counts,
  });
}

/** No effects yet: application must check current target revision and commit its real effect atomically with completion. */
export function preparePublicExecution(
  s: PublicGovernanceState,
  actorId: string,
  at: number,
  id: string,
  expectedRevision: number,
) {
  const p = s.proposals[id];
  const rejected = (reason: string) => ({ accepted: false as const, reason });
  if (!p || p.revision !== expectedRevision) return rejected('public-proposal-revision-conflict');
  if (!publicTime(at) || at < (p.closedAt ?? p.closesAt) || at >= p.expiresAt)
    return rejected('public-decision-outside-execution-window');
  if (p.status !== 'approved') return rejected('public-decision-not-approved');
  if (p.procedureRevision !== s.procedureRevision)
    return rejected('public-decision-procedure-superseded');
  const executors =
    p.procedure.executors === 'electorate' ? p.procedure.electorate : p.procedure.executors;
  if (!executors.includes(actorId)) return rejected('public-executor-not-authorized');
  return {
    accepted: true as const,
    proposal: structuredClone(p),
    action: structuredClone(p.action),
  };
}
export function completePublicExecution(
  s: PublicGovernanceState,
  actorId: string,
  at: number,
  id: string,
  expectedRevision: number,
  effectIds: readonly string[],
): PublicDecision {
  const ready = preparePublicExecution(s, actorId, at, id, expectedRevision);
  if (!ready.accepted) return ready;
  if (
    !effectIds.length ||
    effectIds.length > 32 ||
    new Set(effectIds).size !== effectIds.length ||
    !effectIds.every(publicId)
  )
    return no('public-execution-effects-required');
  const a = ready.action;
  const effects: PublicGovernanceEvent[] = [
    {
      type: 'PublicDecisionExecuted',
      proposalId: id,
      previousRevision: expectedRevision,
      actorId,
      at,
      effectIds,
    },
  ];
  if (a.kind === 'set-procedure') {
    if (a.expectedRevision !== s.procedureRevision) return no('public-procedure-revision-conflict');
    if (publicEqual(a.terms, s.procedure)) return no('public-procedure-unchanged');
    effects.push({
      type: 'PublicProcedureChanged',
      proposalId: id,
      previousRevision: s.procedureRevision,
      procedure: a.terms,
    });
  }
  if (a.kind === 'invalidate-decision') {
    const target = s.proposals[a.proposalId];
    if (!target || target.status !== 'approved' || target.revision !== a.expectedRevision)
      return no('public-invalidation-target-not-current');
    effects.push({
      type: 'PublicDecisionInvalidated',
      proposalId: target.id,
      previousRevision: target.revision,
      byProposalId: id,
    });
  }
  return yes(...effects);
}
