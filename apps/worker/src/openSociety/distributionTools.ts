import {
  applyDistributionEvent,
  communicationBlocked,
  decideDistributionCommand,
  listDistributionFeed,
  readDistributionPublication,
  subscriptionKey,
  type DistributionCommand,
} from '@aivilization/information';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { numberArg, pageItems, stringArg, ToolRefusal } from './arguments';

export function executeDistributionTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  const distribution = state.distribution;
  if (distribution === undefined) throw new ToolRefusal('distribution-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'subscriptions.list')
    return result(
      pageItems(
        Object.values(distribution.subscriptions[actorId] ?? {}).sort((a, b) =>
          `${a.kind}:${a.targetId}`.localeCompare(`${b.kind}:${b.targetId}`, 'en'),
        ),
        args,
      ),
    );
  if (name === 'feed.list' || name === 'notifications.list')
    return result(
      pageItems(
        listDistributionFeed(
          distribution,
          state.information,
          actorId,
          name === 'notifications.list' && args.unreadOnly !== false,
        ).filter((p) => !communicationBlocked(state.communication, actorId, p.publisherId)),
        args,
      ),
    );
  const id = stringArg(args, 'id');
  if (name === 'feed.read') {
    const data = readDistributionPublication(distribution, state.information, actorId, id);
    if (data === undefined) throw new ToolRefusal('publication-not-found');
    return result(data);
  }
  let command: DistributionCommand;
  if (name === 'subscriptions.follow' || name === 'subscriptions.unfollow') {
    const kind = stringArg(args, 'kind');
    if (kind !== 'author' && kind !== 'space') throw new ToolRefusal('invalid-subscription-kind');
    command = {
      type: name === 'subscriptions.follow' ? 'subscription.follow' : 'subscription.unfollow',
      kind,
      targetId: stringArg(args, 'targetId'),
    };
  } else if (name === 'feed.share')
    command = {
      type: 'publication.share',
      documentId: stringArg(args, 'documentId'),
      revision: numberArg(args, 'revision'),
      ...(args.comment === undefined ? {} : { comment: stringArg(args, 'comment') }),
    };
  else if (name === 'notifications.read') command = { type: 'notification.read', activityId: id };
  else throw new ToolRefusal('unknown-distribution-capability');
  const decision = decideDistributionCommand({
    state: distribution,
    information: state.information,
    actorId,
    at: state.world.clock.now,
    command,
    actorExists: (target) => Object.hasOwn(state.residents, target),
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  const after = decision.events.reduce(applyDistributionEvent, distribution);
  const publication = decision.events.find((event) => event.type === 'PublicationRecorded');
  const data =
    command.type === 'notification.read'
      ? readDistributionPublication(after, state.information, actorId, id)
      : publication?.type === 'PublicationRecorded'
        ? readDistributionPublication(after, state.information, actorId, publication.publication.id)
        : {
            unchanged: decision.events.length === 0,
            ...(command.type === 'subscription.follow' || command.type === 'subscription.unfollow'
              ? {
                  subscription:
                    after.subscriptions[actorId]?.[
                      subscriptionKey(command.kind, command.targetId)
                    ] ?? null,
                }
              : {}),
          };
  return { data, effects: { distributionEvents: decision.events } };
}
