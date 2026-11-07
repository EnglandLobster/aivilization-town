import {
  assertCollectivesPolicy,
  canReadCollective,
  canReadCollectiveDecision,
  collectiveId,
  collectiveOperable,
  collectiveText,
  emptyCollectivesState,
  parseCollectiveAction,
  parseCollectiveConfiguration,
  type CollectiveCharter,
  type CollectiveConfiguration,
  type CollectiveCommand,
  type CollectiveDecision,
  type CollectiveEvent,
  type CollectiveResourceAction,
  type CollectiveResult,
  type CollectivesState,
} from './collectiveModel';
const no = (reason: string): CollectiveResult => ({ accepted: false, reason });
const yes = (...events: CollectiveEvent[]): CollectiveResult => ({ accepted: true, events });
const charterEvent = (charter: CollectiveCharter): CollectiveEvent => ({
  type: 'CollectiveCharterChanged',
  charter,
});
const decisionEvent = (decision: CollectiveDecision): CollectiveEvent => ({
  type: 'CollectiveDecisionChanged',
  decision,
});
export function collectiveTally(d: CollectiveDecision) {
  const votes = d.voters.map((id) => d.votes[id]).filter((v) => v !== undefined);
  const yes = votes.filter((v) => v === 'yes').length;
  return {
    responses: votes.length,
    yes,
    no: votes.filter((v) => v === 'no').length,
    abstain: votes.filter((v) => v === 'abstain').length,
    passed: votes.length >= d.quorum && yes >= d.threshold,
  };
}
export function settleCollectiveDecision(
  d: CollectiveDecision,
  at: number,
): CollectiveDecision | undefined {
  if (d.status !== 'open') return undefined;
  const tally = collectiveTally(d);
  if (
    at < d.closesAt &&
    (d.timing === 'deadline' || (!tally.passed && tally.responses !== d.voters.length))
  )
    return undefined;
  return {
    ...d,
    status: tally.passed ? 'passed' : 'rejected',
    decidedAt: Math.min(at, d.closesAt),
    revision: d.revision + 1,
  };
}
export function collectiveExecutionRefusal(
  s: CollectivesState,
  d: CollectiveDecision,
  actorId: string,
  at: number,
): string | undefined {
  const c = s.charters[d.collectiveId];
  if (!c || c.status !== 'active') return 'collective-not-active';
  if (!c.members.includes(actorId) && !d.voters.includes(actorId))
    return 'collective-participant-required';
  if (d.status !== 'passed') return 'passed-decision-required';
  if (at >= d.executeBefore) return 'decision-execution-expired';
  if (c.version !== d.charterVersion) return 'collective-authority-version-changed';
  return undefined;
}
export function consumedCollectiveDecision(
  d: CollectiveDecision,
  actorId: string,
  at: number,
): CollectiveEvent {
  return decisionEvent({
    ...d,
    status: 'executed',
    revision: d.revision + 1,
    executedAt: at,
    executedBy: actorId,
  });
}
/** Only returns a proposed consumption event; the application commits it with the resource effect. */
export function authorizeCollectiveResourceExecution(input: {
  state: CollectivesState;
  actorId: string;
  id: string;
  expectedRevision: number;
  at: number;
}):
  | { accepted: false; reason: string }
  | {
      accepted: true;
      collectiveId: string;
      action: CollectiveResourceAction;
      event: CollectiveEvent;
    } {
  const { state: s, actorId, id, expectedRevision, at } = input;
  const d = collectiveId(id) && Object.hasOwn(s.decisions, id) ? s.decisions[id] : undefined;
  if (!d || !canReadCollectiveDecision(s, d, actorId))
    return { accepted: false, reason: 'decision-not-found' };
  if (d.revision !== expectedRevision) return { accepted: false, reason: 'revision-conflict' };
  if (!Number.isSafeInteger(at) || at < 0) return { accepted: false, reason: 'invalid-time' };
  const reason = collectiveExecutionRefusal(s, d, actorId, at);
  if (reason) return { accepted: false, reason };
  if (d.action.kind !== 'resource')
    return { accepted: false, reason: 'resource-decision-required' };
  return {
    accepted: true,
    collectiveId: d.collectiveId,
    action: d.action,
    event: consumedCollectiveDecision(d, actorId, at),
  };
}
export function decideCollective(input: {
  state: CollectivesState;
  actorId: string;
  at: number;
  command: CollectiveCommand;
  exists: (id: string) => boolean;
  validateResource?: (collectiveId: string, action: CollectiveResourceAction) => string | undefined;
}): CollectiveResult {
  const { state: s, actorId: a, at, command: cmd } = input;
  assertCollectivesPolicy(s.policy);
  if (!collectiveId(a) || !input.exists(a) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-actor-or-time');
  if (!collectiveId(cmd.id)) return no('invalid-id');
  const authority = s.charters[cmd.type === 'propose' ? cmd.collectiveId : cmd.id];
  const decision = s.decisions[cmd.id];
  if (
    (authority &&
      (!Number.isSafeInteger(authority.revision + 1) ||
        !Number.isSafeInteger(authority.version + 1))) ||
    (decision && !Number.isSafeInteger(decision.revision + 1))
  )
    return no('collective-version-exhausted');
  const readableConfiguration = (v: CollectiveConfiguration) =>
    JSON.stringify({
      ...v,
      consents: Object.fromEntries(
        v.members.map((id) => [
          id,
          { version: Number.MAX_SAFE_INTEGER, accepted: true, decisionId: 'x'.repeat(96) },
        ]),
      ),
    }).length +
      600 <=
    s.policy.maxObjectChars;
  const future = (t: number) =>
    Number.isSafeInteger(t) && t > at && t - at <= s.policy.maxHorizonMs;
  if (cmd.type === 'create') {
    if (Object.hasOwn(s.charters, cmd.id)) return no('collective-already-exists');
    if (
      Object.values(s.charters).filter((c) => c.founderId === a).length >=
      s.policy.maxCollectivesPerFounder
    )
      return no('collective-quota-exceeded');
    const config = parseCollectiveConfiguration(cmd.configuration, s.policy, input.exists);
    if (
      !config ||
      !config.members.includes(a) ||
      !future(cmd.expiresAt) ||
      !readableConfiguration(config)
    )
      return no('invalid-collective-configuration');
    return yes(
      charterEvent({
        ...config,
        id: cmd.id,
        founderId: a,
        revision: 1,
        version: 1,
        consents: { [a]: { version: 1, accepted: true } },
        status: config.members.length === 1 ? 'active' : 'pending',
        at,
        expiresAt: cmd.expiresAt,
      }),
    );
  }
  if (cmd.type === 'respond' || cmd.type === 'withdraw' || cmd.type === 'leave') {
    const c = s.charters[cmd.id];
    if (!c || !canReadCollective(c, a)) return no('collective-not-found');
    if (c.revision !== cmd.expectedRevision) return no('revision-conflict');
    if (cmd.type === 'leave') {
      if (c.status !== 'active' || !c.members.includes(a)) return no('active-membership-required');
      return yes(
        charterEvent({
          ...c,
          revision: c.revision + 1,
          version: c.version + 1,
          members: c.members.filter((id) => id !== a),
          voters: c.voters.filter((id) => id !== a),
        }),
      );
    }
    if (c.status !== 'pending' || at >= c.expiresAt) return no('collective-not-pending');
    if (cmd.type === 'withdraw') {
      if (c.founderId !== a) return no('founder-required');
      return yes(charterEvent({ ...c, status: 'withdrawn', revision: c.revision + 1 }));
    }
    if (typeof cmd.accept !== 'boolean' || !c.members.includes(a)) return no('invalid-consent');
    if (c.consents[a]?.accepted === cmd.accept) return yes();
    const consents = { ...c.consents, [a]: { version: c.version, accepted: cmd.accept } };
    return yes(
      charterEvent({
        ...c,
        consents,
        revision: c.revision + 1,
        status: !cmd.accept
          ? 'rejected'
          : c.members.every((id) => consents[id]?.accepted === true)
            ? 'active'
            : 'pending',
      }),
    );
  }
  if (cmd.type === 'propose') {
    if (!collectiveId(cmd.collectiveId)) return no('invalid-collective-id');
    const c = s.charters[cmd.collectiveId];
    if (!c || !c.members.includes(a)) return no('collective-not-found');
    if (c.version !== cmd.expectedVersion) return no('collective-version-conflict');
    if (!collectiveOperable(c)) return no('collective-procedure-suspended');
    if (Object.hasOwn(s.decisions, cmd.id)) return no('decision-already-exists');
    const previous = Object.values(s.decisions).filter((d) => d.collectiveId === c.id);
    if (
      previous.length >= s.policy.maxDecisions ||
      previous.filter((d) => d.status === 'open').length >= s.policy.maxOpenDecisions
    )
      return no('decision-quota-exceeded');
    if (
      !collectiveText(cmd.terms, s.policy.maxText) ||
      !future(cmd.closesAt) ||
      !future(cmd.executeBefore) ||
      cmd.executeBefore <= cmd.closesAt
    )
      return no('invalid-decision-terms-or-time');
    const action = parseCollectiveAction(cmd.action, s.policy, input.exists);
    if (!action || (action.kind === 'amend' && !readableConfiguration(action.configuration)))
      return no('invalid-collective-action');
    const allMembers = action.kind === 'amend' ? action.configuration.members : [];
    const futureSize =
      JSON.stringify({
        terms: cmd.terms,
        action,
        voters: c.voters,
        votes: Object.fromEntries(c.voters.map((id) => [id, 'abstain'])),
        invitedMembers: allMembers,
        joinConsents: Object.fromEntries(allMembers.map((id) => [id, false])),
      }).length + 2000;
    if (futureSize > s.policy.maxObjectChars) return no('collective-original-budget-exceeded');
    if (action.kind === 'resource') {
      if (!input.validateResource) return no('unsupported-collective-resource-action');
      const reason = input.validateResource(c.id, action);
      if (reason) return no(reason);
    }
    return yes(
      decisionEvent({
        id: cmd.id,
        collectiveId: c.id,
        authorId: a,
        terms: cmd.terms,
        action,
        charterVersion: c.version,
        voters: [...c.voters],
        threshold: c.threshold,
        quorum: c.quorum,
        timing: c.timing,
        revote: c.revote,
        votes: {},
        joinConsents: {},
        invitedMembers:
          action.kind === 'amend'
            ? action.configuration.members.filter((id) => !c.members.includes(id))
            : [],
        status: 'open',
        revision: 1,
        at,
        closesAt: cmd.closesAt,
        executeBefore: cmd.executeBefore,
      }),
    );
  }
  const d = s.decisions[cmd.id];
  if (!d || !canReadCollectiveDecision(s, d, a)) return no('decision-not-found');
  if (d.revision !== cmd.expectedRevision) return no('revision-conflict');
  if (cmd.type === 'vote') {
    if (!d.voters.includes(a)) return no('eligible-voter-required');
    if (d.status !== 'open' || at >= d.closesAt) return no('decision-not-open');
    if (!['yes', 'no', 'abstain'].includes(cmd.vote)) return no('invalid-vote');
    if (d.votes[a] === cmd.vote) return yes();
    if (d.votes[a] !== undefined && !d.revote) return no('vote-change-not-permitted');
    return yes(
      decisionEvent({ ...d, votes: { ...d.votes, [a]: cmd.vote }, revision: d.revision + 1 }),
    );
  }
  if (cmd.type === 'decide') {
    const settled = settleCollectiveDecision(d, at);
    return settled ? yes(decisionEvent(settled)) : no('decision-not-ready');
  }
  if (cmd.type === 'join') {
    if (d.action.kind !== 'amend' || !d.invitedMembers.includes(a))
      return no('invited-member-required');
    const reason = collectiveExecutionRefusal(s, d, d.authorId, at);
    if (reason) return no(reason);
    if (typeof cmd.accept !== 'boolean') return no('invalid-consent');
    if (d.joinConsents[a] === cmd.accept) return yes();
    return yes(
      decisionEvent({
        ...d,
        joinConsents: { ...d.joinConsents, [a]: cmd.accept },
        status: cmd.accept ? 'passed' : 'rejected',
        revision: d.revision + 1,
      }),
    );
  }
  const reason = collectiveExecutionRefusal(s, d, a, at);
  if (reason) return no(reason);
  if (d.action.kind === 'statement') return no('statement-has-no-resource-effect');
  if (d.action.kind === 'resource') return no('resource-execution-requires-application');
  if (!d.invitedMembers.every((id) => d.joinConsents[id] === true))
    return no('new-member-consent-required');
  const c = s.charters[d.collectiveId]!;
  return yes(
    charterEvent({
      ...c,
      ...d.action.configuration,
      revision: c.revision + 1,
      version: c.version + 1,
      authorityDecisionId: d.id,
      // Existing member authority derives from the old charter decision, not forged new signatures.
      consents: Object.fromEntries(
        Object.entries(c.consents)
          .filter(
            ([id]) => d.action.kind === 'amend' && d.action.configuration.members.includes(id),
          )
          .concat(
            Object.entries(d.joinConsents).map(([id, accepted]) => [
              id,
              { accepted, version: c.version + 1, decisionId: d.id },
            ]),
          ),
      ),
    }),
    consumedCollectiveDecision(d, a, at),
  );
}
export function applyCollectiveEvent(
  s: CollectivesState | undefined,
  e: CollectiveEvent,
): CollectivesState {
  if (e.type === 'CollectivesEnabled') {
    if (s) throw new Error('collectives-already-enabled');
    return emptyCollectivesState(e.policy);
  }
  if (!s) throw new Error('collectives-not-enabled');
  if (e.type === 'CollectiveCharterChanged') {
    const c = e.charter;
    if (c.revision !== (s.charters[c.id]?.revision ?? 0) + 1)
      throw new Error('collective-revision-gap');
    return {
      ...s,
      charters: { ...s.charters, [c.id]: c },
      charterHistory: { ...s.charterHistory, [c.id]: [...(s.charterHistory[c.id] ?? []), c] },
    };
  }
  const d = e.decision;
  if (d.revision !== (s.decisions[d.id]?.revision ?? 0) + 1)
    throw new Error('collective-decision-revision-gap');
  return {
    ...s,
    decisions: { ...s.decisions, [d.id]: d },
    decisionHistory: { ...s.decisionHistory, [d.id]: [...(s.decisionHistory[d.id] ?? []), d] },
  };
}
