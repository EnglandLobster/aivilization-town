export const COLLABORATION_POLICY = {
  version: 'collaboration-v1',
  maxParticipants: 20,
  maxText: 8000,
} as const;
export type CollaborationPolicy = {
  version: 'collaboration-v1';
  maxParticipants: number;
  maxText: number;
};
export function assertCollaborationPolicy(p: CollaborationPolicy) {
  if (
    p.version !== 'collaboration-v1' ||
    [p.maxParticipants, p.maxText].some((n) => !Number.isSafeInteger(n) || n < 2)
  )
    throw new Error('invalid-collaboration-policy');
}
export type Proposal = {
  id: string;
  authorId: string;
  participants: readonly string[];
  terms: string;
  revision: number;
  termsRevision: number;
  consents: Readonly<Record<string, boolean>>;
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
  at: number;
  expiresAt: number;
};
export type CommitmentStatement = {
  id: string;
  proposalId: string;
  authorId: string;
  kind: 'fulfilled' | 'disputed' | 'released';
  content: string;
  at: number;
};
export type CollaborationState = {
  policy: CollaborationPolicy;
  proposals: Readonly<Record<string, Proposal>>;
  history: Readonly<Record<string, readonly Proposal[]>>;
  statements: Readonly<Record<string, CommitmentStatement>>;
};
export type CollaborationEvent =
  | { type: 'CollaborationEnabled'; policy: CollaborationPolicy }
  | { type: 'ProposalChanged'; proposal: Proposal }
  | { type: 'CommitmentStatementRecorded'; statement: CommitmentStatement };
export type CollaborationCommand =
  | {
      type: 'create';
      id: string;
      participants: readonly string[];
      terms: string;
      expiresAt: number;
    }
  | { type: 'revise'; id: string; expectedRevision: number; terms: string; expiresAt: number }
  | { type: 'respond'; id: string; expectedRevision: number; accept: boolean }
  | { type: 'withdraw'; id: string; expectedRevision: number }
  | {
      type: 'declare';
      id: string;
      proposalId: string;
      kind: CommitmentStatement['kind'];
      content: string;
    };
export function emptyCollaborationState(
  policy: CollaborationPolicy = COLLABORATION_POLICY,
): CollaborationState {
  assertCollaborationPolicy(policy);
  return { policy, proposals: {}, history: {}, statements: {} };
}
export function decideCollaboration(input: {
  state: CollaborationState;
  actorId: string;
  at: number;
  command: CollaborationCommand;
  exists: (id: string) => boolean;
}):
  | { accepted: true; events: readonly CollaborationEvent[] }
  | { accepted: false; reason: string } {
  const { state: s, actorId: a, at, command: c } = input;
  assertCollaborationPolicy(s.policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  const yes = (...events: CollaborationEvent[]) => ({ accepted: true as const, events });
  const text = (v: string) => v.trim().length > 0 && v.length <= s.policy.maxText;
  const future = (n: number) => Number.isSafeInteger(n) && n > at;
  if (!input.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) || c.id === 'constructor')
    return no('invalid-id');
  if (c.type === 'create') {
    const participants = [a, ...c.participants];
    if (
      Object.hasOwn(s.proposals, c.id) ||
      participants.length < 2 ||
      participants.length > s.policy.maxParticipants ||
      new Set(participants).size !== participants.length ||
      !participants.every(input.exists)
    )
      return no('invalid-participants-or-id');
    if (!text(c.terms) || !future(c.expiresAt)) return no('invalid-terms-or-expiry');
    return yes({
      type: 'ProposalChanged',
      proposal: {
        id: c.id,
        authorId: a,
        participants,
        terms: c.terms,
        revision: 1,
        termsRevision: 1,
        consents: { [a]: true },
        status: 'open',
        at,
        expiresAt: c.expiresAt,
      },
    });
  }
  const p = s.proposals[c.type === 'declare' ? c.proposalId : c.id];
  if (!p || !p.participants.includes(a)) return no('proposal-not-found');
  if (c.type === 'declare') {
    if (p.status !== 'accepted') return no('accepted-proposal-required');
    if (Object.hasOwn(s.statements, c.id) || !text(c.content)) return no('invalid-statement');
    return yes({
      type: 'CommitmentStatementRecorded',
      statement: { id: c.id, proposalId: p.id, authorId: a, kind: c.kind, content: c.content, at },
    });
  }
  if (p.revision !== c.expectedRevision) return no('revision-conflict');
  if (p.status !== 'open' || at >= p.expiresAt) return no('proposal-not-open');
  let next: Proposal = { ...p, revision: p.revision + 1 };
  if (c.type === 'revise') {
    if (p.authorId !== a) return no('author-required');
    if (!text(c.terms) || !future(c.expiresAt)) return no('invalid-terms-or-expiry');
    next = {
      ...next,
      terms: c.terms,
      expiresAt: c.expiresAt,
      termsRevision: p.termsRevision + 1,
      consents: { [a]: true },
    };
  } else if (c.type === 'withdraw') {
    if (p.authorId !== a) return no('author-required');
    next = { ...next, status: 'withdrawn' };
  } else {
    if (p.consents[a] === true && c.accept) return yes();
    const consents = { ...p.consents, [a]: c.accept };
    next = {
      ...next,
      consents,
      status: !c.accept
        ? 'rejected'
        : p.participants.every((id) => consents[id])
          ? 'accepted'
          : 'open',
    };
  }
  return yes({ type: 'ProposalChanged', proposal: next });
}
export function expireProposals(s: CollaborationState, at: number): CollaborationEvent[] {
  return Object.values(s.proposals)
    .filter((p) => p.status === 'open' && p.expiresAt <= at)
    .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id, 'en'))
    .map((p) => ({
      type: 'ProposalChanged',
      proposal: { ...p, status: 'expired', revision: p.revision + 1 },
    }));
}
export function applyCollaborationEvent(
  s: CollaborationState | undefined,
  e: CollaborationEvent,
): CollaborationState {
  if (e.type === 'CollaborationEnabled') {
    if (s) throw new Error('collaboration-already-enabled');
    return emptyCollaborationState(e.policy);
  }
  if (!s) throw new Error('collaboration-not-enabled');
  if (e.type === 'CommitmentStatementRecorded')
    return { ...s, statements: { ...s.statements, [e.statement.id]: e.statement } };
  if (e.proposal.revision !== (s.proposals[e.proposal.id]?.revision ?? 0) + 1)
    throw new Error('proposal-revision-gap');
  return {
    ...s,
    proposals: { ...s.proposals, [e.proposal.id]: e.proposal },
    history: { ...s.history, [e.proposal.id]: [...(s.history[e.proposal.id] ?? []), e.proposal] },
  };
}
