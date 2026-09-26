import { canReadSpace, type InformationDocument, type InformationState } from './model';
import {
  assertDistributionPolicy,
  emptyDistributionState,
  subscriptionKey,
  type DistributionCommand,
  type DistributionDecision,
  type DistributionEvent,
  type DistributionState,
} from './distributionModel';
import { isSubscribedPublication, visiblePublicationSource } from './distributionRead';

export function decideDistributionCommand(input: {
  readonly state: DistributionState;
  readonly information: InformationState;
  readonly actorId: string;
  readonly at: number;
  readonly command: DistributionCommand;
  readonly actorExists: (id: string) => boolean;
}): DistributionDecision {
  const { state, information, actorId, at, command } = input;
  assertDistributionPolicy(state.policy);
  const reject = (reason: string): DistributionDecision => ({ accepted: false, reason });
  const accept = (...events: DistributionEvent[]): DistributionDecision => ({
    accepted: true,
    events,
  });
  if (!input.actorExists(actorId) || !Number.isSafeInteger(at) || at < 0)
    return reject('invalid-actor-or-time');
  if (command.type === 'subscription.follow' || command.type === 'subscription.unfollow') {
    if (!['author', 'space'].includes(command.kind)) return reject('invalid-subscription-kind');
    const key = subscriptionKey(command.kind, command.targetId);
    const existing = state.subscriptions[actorId]?.[key];
    const active = command.type === 'subscription.follow';
    if (active) {
      if (command.kind === 'author') {
        if (!input.actorExists(command.targetId)) return reject('target-not-found');
        if (command.targetId === actorId) return reject('cannot-follow-self');
      } else {
        const space = information.spaces[command.targetId];
        if (space === undefined || !canReadSpace(space, actorId)) return reject('target-not-found');
      }
      if (existing?.active) return accept();
      if (
        Object.values(state.subscriptions[actorId] ?? {}).filter((item) => item.active).length >=
        state.policy.maxSubscriptions
      )
        return reject('subscription-limit');
    } else if (existing === undefined || !existing.active) return accept();
    return accept({
      type: 'SubscriptionChanged',
      subscription: {
        ownerId: actorId,
        kind: command.kind,
        targetId: command.targetId,
        active,
        revision: (existing?.revision ?? 0) + 1,
        sinceSequence: state.sequence,
        updatedAt: at,
      },
    });
  }
  if (command.type === 'publication.share') {
    if (!Number.isSafeInteger(command.revision) || command.revision < 1)
      return reject('invalid-document-revision');
    if (
      command.comment !== undefined &&
      (typeof command.comment !== 'string' ||
        command.comment.length > state.policy.maxCommentLength)
    )
      return reject('invalid-comment-length');
    const publication = {
      id: `publication-${state.sequence + 1}`,
      sequence: state.sequence + 1,
      publisherId: actorId,
      documentId: command.documentId,
      documentRevision: command.revision,
      kind: 'shared' as const,
      at,
      ...(command.comment === undefined ? {} : { comment: command.comment }),
    };
    const source = visiblePublicationSource(information, actorId, publication);
    if (source === undefined) return reject('source-not-found');
    if (information.spaces[source.spaceId]?.visibility !== 'public')
      return reject('private-source-cannot-be-shared');
    return accept({ type: 'PublicationRecorded', publication });
  }
  if (command.type === 'notification.read') {
    const publication = state.publications[command.activityId];
    const source =
      publication === undefined
        ? undefined
        : visiblePublicationSource(information, actorId, publication);
    if (
      publication === undefined ||
      source === undefined ||
      !isSubscribedPublication(state, actorId, publication, source)
    )
      return reject('notification-not-found');
    if (Object.hasOwn(state.readByOwner[actorId] ?? {}, publication.id)) return accept();
    return accept({ type: 'PublicationRead', ownerId: actorId, activityId: publication.id, at });
  }
  return reject('unknown-distribution-command');
}

/** Called only for accepted resident document events; publication is persisted in the same transaction. */
export function recordDocumentPublication(
  state: DistributionState,
  document: InformationDocument,
): DistributionEvent {
  return {
    type: 'PublicationRecorded',
    publication: {
      id: `publication-${state.sequence + 1}`,
      sequence: state.sequence + 1,
      publisherId: document.authorId,
      documentId: document.id,
      documentRevision: document.revision,
      kind: document.revision === 1 ? 'published' : 'revised',
      at: document.updatedAt,
    },
  };
}

export function applyDistributionEvent(
  state: DistributionState | undefined,
  event: DistributionEvent,
): DistributionState {
  if (event.type === 'DistributionEnabled') {
    if (state !== undefined) throw new Error('distribution-already-enabled');
    return emptyDistributionState(event.policy);
  }
  if (state === undefined) throw new Error('distribution-not-enabled');
  switch (event.type) {
    case 'SubscriptionChanged': {
      const subscription = event.subscription;
      const key = subscriptionKey(subscription.kind, subscription.targetId);
      if (
        subscription.revision !==
        (state.subscriptions[subscription.ownerId]?.[key]?.revision ?? 0) + 1
      )
        throw new Error('subscription-revision-gap');
      return {
        ...state,
        subscriptions: {
          ...state.subscriptions,
          [subscription.ownerId]: {
            ...state.subscriptions[subscription.ownerId],
            [key]: subscription,
          },
        },
      };
    }
    case 'PublicationRecorded':
      if (
        event.publication.sequence !== state.sequence + 1 ||
        state.publications[event.publication.id] !== undefined
      )
        throw new Error('publication-sequence-conflict');
      return {
        ...state,
        sequence: event.publication.sequence,
        publications: { ...state.publications, [event.publication.id]: event.publication },
      };
    case 'PublicationRead':
      return {
        ...state,
        readByOwner: {
          ...state.readByOwner,
          [event.ownerId]: {
            ...state.readByOwner[event.ownerId],
            [event.activityId]: event.at,
          },
        },
      };
  }
}
