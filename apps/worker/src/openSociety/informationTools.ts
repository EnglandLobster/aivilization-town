import {
  canReadSpace,
  communicationBlocked,
  applyDistributionEvent,
  recordDocumentPublication,
  type DistributionEvent,
  decideInformationCommand,
  documentKey,
  indexInformationDocuments,
  DOCUMENT_INDEX_VERSION,
  type InformationCommand,
} from '@aivilization/information';
import type {
  OpenSocietyEffects,
  OpenSocietyManifest,
  OpenSocietyState,
  ResidentExperience,
} from './types';
import { numberArg, pageItems, stringArg, stringArrayArg, ToolRefusal } from './arguments';
import { digest } from './journal';

export type ToolExecution = { readonly data: unknown; readonly effects: OpenSocietyEffects };
export function executeInformationTool(input: {
  state: OpenSocietyState;
  manifest: OpenSocietyManifest;
  actorId: string;
  requestId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
}): ToolExecution {
  const { state, manifest, actorId, requestId, name, args } = input;
  const info = state.information;
  const at = state.world.clock.now;
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const visible = (spaceId: string) => {
    const space = info.spaces[spaceId];
    return space !== undefined && canReadSpace(space, actorId);
  };
  if (name === 'files.index') {
    const filter: Record<string, string> = {};
    for (const key of ['spaceId', 'prefix', 'authorId', 'tag', 'relatedTo', 'query'])
      if (args[key] !== undefined) filter[key] = stringArg(args, key);
    if (filter.spaceId !== undefined && !visible(filter.spaceId))
      throw new ToolRefusal('not-found');
    return result({
      indexVersion: DOCUMENT_INDEX_VERSION,
      ...pageItems(indexInformationDocuments(info, actorId, filter), args),
    });
  }
  if (name === 'spaces.list') {
    const query = stringArg(args, 'query').toLocaleLowerCase();
    return result(
      pageItems(
        Object.values(info.spaces).filter(
          (space) =>
            canReadSpace(space, actorId) &&
            `${space.id} ${space.title}`.toLocaleLowerCase().includes(query),
        ),
        args,
      ),
    );
  }
  if (name === 'files.read' || name === 'files.history') {
    const spaceId = stringArg(args, 'spaceId');
    if (!visible(spaceId)) throw new ToolRefusal('not-found');
    const id = documentKey(spaceId, stringArg(args, 'path'));
    const document = info.documents[id];
    if (document === undefined || (document.deleted && name === 'files.read'))
      throw new ToolRefusal('not-found');
    return result(name === 'files.history' ? pageItems(info.history[id] ?? [], args) : document);
  }
  if (name === 'files.list' || name === 'files.search') {
    const spaceId = stringArg(args, 'spaceId');
    if (spaceId && !visible(spaceId)) throw new ToolRefusal('not-found');
    const query = stringArg(args, 'query').toLocaleLowerCase();
    const documents = Object.values(info.documents).filter(
      (doc) =>
        !doc.deleted &&
        visible(doc.spaceId) &&
        (!spaceId || doc.spaceId === spaceId) &&
        `${doc.path} ${doc.content}`.toLocaleLowerCase().includes(query),
    );
    return result(
      pageItems(
        documents.map((doc) => ({
          ...doc,
          content: doc.content.slice(0, 400),
          expandedBy: 'files.read',
        })),
        args,
      ),
    );
  }
  if (name === 'messages.list') {
    const direction = stringArg(args, 'direction', 'both');
    const messages = Object.values(info.messages).filter(
      (message) =>
        (direction !== 'outgoing' && message.recipientId === actorId) ||
        (direction !== 'incoming' && message.senderId === actorId),
    );
    return result(
      pageItems(
        [...messages].reverse().map((message) => ({
          ...message,
          content: message.content.slice(0, 400),
          provenance: 'message-claim',
          expandedBy: 'messages.read',
        })),
        args,
      ),
    );
  }
  let command: InformationCommand;
  const commonDocument = { spaceId: stringArg(args, 'spaceId'), path: stringArg(args, 'path') };
  const metadata = {
    ...(args.title === undefined ? {} : { title: stringArg(args, 'title') }),
    ...(args.tags === undefined ? {} : { tags: stringArrayArg(args, 'tags') }),
    ...(args.relatedTo === undefined ? {} : { relatedTo: stringArg(args, 'relatedTo') }),
  };
  switch (name) {
    case 'spaces.create':
      command = {
        type: 'space.create',
        id: stringArg(args, 'id'),
        title: stringArg(args, 'title'),
        visibility: stringArg(args, 'visibility') as 'public' | 'private',
        posting: stringArg(args, 'posting') as 'owner' | 'members' | 'everyone',
        members: stringArrayArg(args, 'members'),
      };
      break;
    case 'files.create':
      command = {
        type: 'file.create',
        ...commonDocument,
        content: stringArg(args, 'content'),
        ...metadata,
      };
      break;
    case 'files.update':
      command = {
        type: 'file.update',
        ...metadata,
        ...commonDocument,
        content: stringArg(args, 'content'),
        expectedRevision: numberArg(args, 'expectedRevision'),
      };
      break;
    case 'files.delete':
      command = {
        type: 'file.delete',
        ...commonDocument,
        expectedRevision: numberArg(args, 'expectedRevision'),
      };
      break;
    case 'messages.send':
      if (communicationBlocked(state.communication, stringArg(args, 'recipientId'), actorId))
        throw new ToolRefusal('communication-blocked');
      command = {
        type: 'message.send',
        id: `msg-${digest([actorId, requestId]).slice(0, 24)}`,
        recipientId: stringArg(args, 'recipientId'),
        content: stringArg(args, 'content'),
      };
      break;
    case 'messages.read':
      command = { type: 'message.read', id: stringArg(args, 'id') };
      break;
    default:
      throw new ToolRefusal('unknown-information-tool');
  }
  const decision = decideInformationCommand({
    state: info,
    actorId,
    at,
    command,
    policy: manifest.informationPolicy,
    agentExists: (id) => state.world.agents[id] !== undefined,
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  const distributionEvents: DistributionEvent[] = [];
  let distribution = state.distribution;
  if (distribution !== undefined)
    for (const event of decision.events) {
      if (event.type !== 'DocumentCreated' && event.type !== 'DocumentUpdated') continue;
      const publication = recordDocumentPublication(distribution, event.document);
      distributionEvents.push(publication);
      distribution = applyDistributionEvent(distribution, publication);
    }
  const experiences: ResidentExperience[] = [];
  const residents = [];
  const sent = decision.events.find((event) => event.type === 'MessageSent');
  if (sent?.type === 'MessageSent') {
    const message = sent.message;
    const receiver = state.residents[message.recipientId];
    if (receiver !== undefined)
      residents.push({
        ...receiver,
        ...(state.communication?.preferences[message.recipientId]?.directWake === false
          ? {}
          : { nextWakeAt: at, wakeReason: `message:${message.id}` }),
        unreadMessageIds: [...receiver.unreadMessageIds, message.id],
      });
    for (const ownerId of [...new Set([actorId, message.recipientId])])
      experiences.push({
        id: `experience-${message.id}-${ownerId}`,
        ownerId,
        at,
        kind: 'message',
        summary: `${actorId} said to ${message.recipientId}: ${message.content}`,
        sourceIds: [message.id],
        people: [actorId, message.recipientId],
        provenance: 'message-claim',
      });
  }
  if (command.type === 'message.read') {
    const resident = state.residents[actorId];
    if (resident !== undefined)
      residents.push({
        ...resident,
        unreadMessageIds: resident.unreadMessageIds.filter((id) => id !== command.id),
      });
  }
  const event = decision.events[0];
  const data =
    event === undefined
      ? command.type === 'message.read'
        ? info.messages[command.id]
        : { unchanged: true }
      : 'space' in event
        ? event.space
        : 'document' in event
          ? event.document
          : event.message;
  return {
    data,
    effects: {
      informationEvents: decision.events,
      experiences,
      residents,
      ...(distributionEvents.length === 0 ? {} : { distributionEvents }),
    },
  };
}
