import { executeCollectiveResource, validateCollectiveResourceAction } from './collectiveResources';
import {
  canReadCollective,
  canReadCollectiveDecision,
  collectiveOperable,
  collectiveTally,
  decideCollective,
  type CollectiveCommand,
} from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, stringArg, numberArg, booleanArg, pageItems } from './arguments';
import { objectArg } from './sharedRecordTools';
export function executeCollectiveTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.collectives;
  if (!s) throw new ToolRefusal('collectives-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} }),
    id = stringArg(args, 'id');
  const order = <T extends { id: string }>(items: T[]) =>
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (name === 'collectives.list')
    return result(
      pageItems(
        order(Object.values(s.charters).filter((c) => canReadCollective(c, actorId))).map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          revision: c.revision,
          version: c.version,
          operable: collectiveOperable(c),
          readWith: `town collectives read --id ${c.id}`,
        })),
        args,
      ),
    );
  if (name === 'collectives.read' || name === 'collectives.history') {
    const c = Object.hasOwn(s.charters, id) ? s.charters[id] : undefined;
    if (!c || !canReadCollective(c, actorId)) throw new ToolRefusal('collective-not-found');
    return result(
      name === 'collectives.read'
        ? { ...c, operable: collectiveOperable(c), provenance: 'resident-authored-charter' }
        : pageItems(
            (s.charterHistory[id] ?? []).filter((v) => canReadCollective(v, actorId)),
            args,
          ),
    );
  }
  if (name === 'collectives.decisions') {
    const cid = stringArg(args, 'collectiveId'),
      c = Object.hasOwn(s.charters, cid) ? s.charters[cid] : undefined,
      ds = order(
        Object.values(s.decisions).filter(
          (d) => d.collectiveId === cid && canReadCollectiveDecision(s, d, actorId),
        ),
      );
    if (!c || (!canReadCollective(c, actorId) && !ds.length))
      throw new ToolRefusal('collective-not-found');
    return result(
      pageItems(
        ds.map((d) => ({
          id: d.id,
          collectiveId: d.collectiveId,
          authorId: d.authorId,
          charterVersion: d.charterVersion,
          status: d.status,
          revision: d.revision,
          closesAt: d.closesAt,
          executeBefore: d.executeBefore,
          tally: collectiveTally(d),
          readWith: `town collectives decision --id ${d.id}`,
        })),
        args,
      ),
    );
  }
  if (name === 'collectives.decision') {
    const d = Object.hasOwn(s.decisions, id) ? s.decisions[id] : undefined;
    if (!d || !canReadCollectiveDecision(s, d, actorId))
      throw new ToolRefusal('decision-not-found');
    return result({
      ...d,
      tally: collectiveTally(d),
      provenance: 'resident-proposal-and-individual-votes',
    });
  }
  if (name === 'collectives.execute' && s.decisions[id]?.action.kind === 'resource')
    return executeCollectiveResource(
      state,
      manifest,
      actorId,
      id,
      numberArg(args, 'expectedRevision'),
      requestId,
    );
  let command: CollectiveCommand;
  if (name === 'collectives.create')
    command = {
      type: 'create',
      id,
      configuration: objectArg(args, 'configuration'),
      expiresAt: numberArg(args, 'expiresAt'),
    };
  else if (name === 'collectives.propose')
    command = {
      type: 'propose',
      id,
      collectiveId: stringArg(args, 'collectiveId'),
      expectedVersion: numberArg(args, 'expectedVersion'),
      terms: stringArg(args, 'terms'),
      action: objectArg(args, 'action'),
      closesAt: numberArg(args, 'closesAt'),
      executeBefore: numberArg(args, 'executeBefore'),
    };
  else if (name === 'collectives.respond' || name === 'collectives.join')
    command = {
      type: name === 'collectives.respond' ? 'respond' : 'join',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      accept: booleanArg(args, 'accept'),
    };
  else if (name === 'collectives.vote')
    command = {
      type: 'vote',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      vote: stringArg(args, 'vote') as 'yes' | 'no' | 'abstain',
    };
  else if (
    name === 'collectives.withdraw' ||
    name === 'collectives.leave' ||
    name === 'collectives.decide' ||
    name === 'collectives.execute'
  )
    command = {
      type: name.slice(12) as 'withdraw' | 'leave' | 'decide' | 'execute',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
    };
  else throw new ToolRefusal('unknown-collective-command');
  const d = decideCollective({
    state: s,
    actorId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.world.agents, id),
    validateResource: (collectiveId, action) =>
      validateCollectiveResourceAction(state, manifest, collectiveId, action),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: d.events.map((e) =>
      e.type === 'CollectiveCharterChanged'
        ? e.charter
        : e.type === 'CollectiveDecisionChanged'
          ? e.decision
          : null,
    ),
    effects: { collectiveEvents: d.events },
  };
}
