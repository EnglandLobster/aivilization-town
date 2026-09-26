import {
  assertInformationPolicy,
  DOCUMENT_METADATA_POLICY,
  canPostToSpace,
  canReadSpace,
  documentKey,
  validDocumentPath,
  validInformationId,
  type InformationCommand,
  type InformationDecision,
  type InformationEvent,
  type InformationPolicy,
  type InformationState,
} from './model';

export function decideInformationCommand(input: {
  readonly state: InformationState;
  readonly actorId: string;
  readonly at: number;
  readonly command: InformationCommand;
  readonly policy: InformationPolicy;
  readonly agentExists: (id: string) => boolean;
}): InformationDecision {
  const { state, actorId, at, command, policy } = input;
  assertInformationPolicy(policy);
  const reject = (reason: string): InformationDecision => ({ accepted: false, reason });
  const accept = (event: InformationEvent): InformationDecision => ({
    accepted: true,
    events: [event],
  });
  if (!Number.isSafeInteger(at) || at < 0 || !input.agentExists(actorId))
    return reject('invalid-actor-or-time');
  if (
    'content' in command &&
    (command.content.length === 0 || command.content.length > policy.maxTextLength)
  )
    return reject('invalid-content-length');
  switch (command.type) {
    case 'space.create': {
      if (
        !validInformationId(command.id) ||
        command.title.trim().length === 0 ||
        command.title.length > 120
      )
        return reject('invalid-space');
      if (
        !['public', 'private'].includes(command.visibility) ||
        !['owner', 'members', 'everyone'].includes(command.posting)
      )
        return reject('invalid-space-policy');
      if (state.spaces[command.id] !== undefined) return reject('space-id-unavailable');
      if (
        Object.values(state.spaces).filter((space) => space.ownerId === actorId).length >=
        policy.maxSpacesPerOwner
      )
        return reject('space-limit');
      if (command.members.length > 100 || command.members.some((id) => !input.agentExists(id)))
        return reject('invalid-members');
      return accept({
        type: 'SpaceCreated',
        space: {
          id: command.id,
          ownerId: actorId,
          title: command.title,
          visibility: command.visibility,
          posting: command.posting,
          members: [...new Set(command.members)].sort(),
          revision: 1,
          createdAt: at,
        },
      });
    }
    case 'file.create':
    case 'file.update':
    case 'file.delete': {
      const metadata =
        command.type === 'file.delete'
          ? {}
          : {
              ...(command.title === undefined ? {} : { title: command.title }),
              ...(command.tags === undefined ? {} : { tags: command.tags }),
              ...(command.relatedTo === undefined ? {} : { relatedTo: command.relatedTo }),
            };
      if (
        (metadata.title !== undefined &&
          (typeof metadata.title !== 'string' ||
            !metadata.title.trim() ||
            metadata.title.length > DOCUMENT_METADATA_POLICY.maxTitleLength)) ||
        (metadata.tags !== undefined &&
          (!Array.isArray(metadata.tags) ||
            metadata.tags.length > DOCUMENT_METADATA_POLICY.maxTags ||
            metadata.tags.some(
              (tag) =>
                typeof tag !== 'string' ||
                !tag.trim() ||
                tag.length > DOCUMENT_METADATA_POLICY.maxTagLength,
            ))) ||
        (metadata.relatedTo !== undefined &&
          (typeof metadata.relatedTo !== 'string' ||
            metadata.relatedTo.length > DOCUMENT_METADATA_POLICY.maxRelatedToLength))
      )
        return reject('invalid-document-metadata');
      if (!validInformationId(command.spaceId) || !validDocumentPath(command.path))
        return reject('invalid-path');
      const space = state.spaces[command.spaceId];
      if (space === undefined || !canReadSpace(space, actorId)) return reject('not-found');
      const id = documentKey(command.spaceId, command.path);
      const existing = state.documents[id];
      if (command.type === 'file.create') {
        if (!canPostToSpace(space, actorId)) return reject('permission-denied');
        if (existing !== undefined) return reject('path-unavailable');
        if (
          Object.values(state.documents).filter((doc) => doc.spaceId === space.id).length >=
          policy.maxDocumentsPerSpace
        )
          return reject('document-limit');
        return accept({
          type: 'DocumentCreated',
          document: {
            id,
            spaceId: space.id,
            path: command.path,
            authorId: actorId,
            content: command.content,
            ...metadata,
            revision: 1,
            createdAt: at,
            updatedAt: at,
            deleted: false,
          },
        });
      }
      if (existing === undefined || existing.deleted) return reject('not-found');
      if (
        existing.authorId !== actorId &&
        !(command.type === 'file.delete' && space.ownerId === actorId)
      )
        return reject('permission-denied');
      if (command.expectedRevision !== existing.revision) return reject('revision-conflict');
      return accept({
        type: command.type === 'file.delete' ? 'DocumentDeleted' : 'DocumentUpdated',
        document: {
          ...existing,
          ...metadata,
          revision: existing.revision + 1,
          updatedAt: at,
          content: command.type === 'file.update' ? command.content : existing.content,
          deleted: command.type === 'file.delete',
        },
      });
    }
    case 'message.send': {
      if (!validInformationId(command.id) || !input.agentExists(command.recipientId))
        return reject('invalid-recipient-or-id');
      if (state.messages[command.id] !== undefined) return reject('message-id-unavailable');
      return accept({
        type: 'MessageSent',
        message: {
          id: command.id,
          senderId: actorId,
          recipientId: command.recipientId,
          content: command.content,
          sentAt: at,
        },
      });
    }
    case 'message.read': {
      const message = state.messages[command.id];
      if (
        message === undefined ||
        (message.senderId !== actorId && message.recipientId !== actorId)
      )
        return reject('not-found');
      if (message.recipientId !== actorId || message.readAt !== undefined)
        return { accepted: true, events: [] };
      return accept({ type: 'MessageRead', message: { ...message, readAt: at } });
    }
  }
}

export function applyInformationEvent(
  state: InformationState,
  event: InformationEvent,
): InformationState {
  switch (event.type) {
    case 'SpaceCreated':
      return { ...state, spaces: { ...state.spaces, [event.space.id]: event.space } };
    case 'DocumentCreated':
    case 'DocumentUpdated':
    case 'DocumentDeleted':
      return {
        ...state,
        documents: { ...state.documents, [event.document.id]: event.document },
        history: {
          ...state.history,
          [event.document.id]: [...(state.history[event.document.id] ?? []), event.document],
        },
      };
    case 'MessageSent':
    case 'MessageRead':
      return { ...state, messages: { ...state.messages, [event.message.id]: event.message } };
  }
}
