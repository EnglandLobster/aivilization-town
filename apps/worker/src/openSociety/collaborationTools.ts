import { decideCollaboration, type CollaborationCommand } from '@aivilization/collaboration';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { stringArg, stringArrayArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
export function executeCollaborationTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.collaboration;
  if (!s) throw new ToolRefusal('collaboration-not-enabled');
  const id = stringArg(args, 'id');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const visible = Object.values(s.proposals).filter((p) => p.participants.includes(actorId));
  if (name === 'proposals.list' || name === 'commitments.list')
    return result(
      pageItems(
        visible
          .filter((p) => name === 'proposals.list' || p.status === 'accepted')
          .map(({ terms, ...p }) => ({ ...p, termsLength: terms.length })),
        args,
      ),
    );
  if (name === 'proposals.read' || name === 'proposals.history' || name === 'commitments.read') {
    const p = s.proposals[id];
    if (!p?.participants.includes(actorId)) throw new ToolRefusal('proposal-not-found');
    return result(
      name === 'proposals.history'
        ? pageItems(s.history[id] ?? [], args)
        : { ...p, statements: Object.values(s.statements).filter((v) => v.proposalId === id) },
    );
  }
  let command: CollaborationCommand;
  const expectedRevision = numberArg(args, 'expectedRevision');
  if (name === 'proposals.create')
    command = {
      type: 'create',
      id,
      participants: stringArrayArg(args, 'participants'),
      terms: stringArg(args, 'terms'),
      expiresAt: numberArg(args, 'expiresAt'),
    };
  else if (name === 'proposals.revise')
    command = {
      type: 'revise',
      id,
      expectedRevision,
      terms: stringArg(args, 'terms'),
      expiresAt: numberArg(args, 'expiresAt'),
    };
  else if (name === 'proposals.respond')
    command = { type: 'respond', id, expectedRevision, accept: args.accept === true };
  else if (name === 'proposals.withdraw') command = { type: 'withdraw', id, expectedRevision };
  else if (name === 'commitments.declare')
    command = {
      type: 'declare',
      id: `statement-${digest([actorId, requestId]).slice(0, 24)}`,
      proposalId: id,
      kind: stringArg(args, 'kind') as 'fulfilled' | 'disputed' | 'released',
      content: stringArg(args, 'content'),
    };
  else throw new ToolRefusal('unknown-collaboration-command');
  const d = decideCollaboration({
    state: s,
    actorId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.residents, id),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: d.events.map((e) =>
      'proposal' in e ? e.proposal : 'statement' in e ? e.statement : null,
    ),
    effects: { collaborationEvents: d.events },
  };
}
