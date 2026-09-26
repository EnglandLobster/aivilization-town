export const INFORMATION_POLICY_VERSION = 'information-space-v1';
export const DOCUMENT_METADATA_POLICY = {
  version: 'document-metadata-v1',
  maxTitleLength: 120,
  maxTags: 12,
  maxTagLength: 40,
  maxRelatedToLength: 160,
} as const;
export type InformationPolicy = {
  readonly version: typeof INFORMATION_POLICY_VERSION;
  readonly maxTextLength: number;
  readonly maxSpacesPerOwner: number;
  readonly maxDocumentsPerSpace: number;
};
export const DEFAULT_INFORMATION_POLICY: InformationPolicy = {
  version: INFORMATION_POLICY_VERSION,
  maxTextLength: 8_000,
  maxSpacesPerOwner: 30,
  maxDocumentsPerSpace: 1_000,
};
export type InformationSpace = {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: 'public' | 'private';
  readonly posting: 'owner' | 'members' | 'everyone';
  readonly members: readonly string[];
  readonly revision: number;
  readonly createdAt: number;
};
export type InformationDocument = {
  readonly id: string;
  readonly spaceId: string;
  readonly path: string;
  readonly authorId: string;
  readonly content: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deleted: boolean;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly relatedTo?: string;
};
export type InformationMessage = {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly content: string;
  readonly sentAt: number;
  readonly readAt?: number;
};
export type InformationState = {
  readonly spaces: Readonly<Record<string, InformationSpace>>;
  readonly documents: Readonly<Record<string, InformationDocument>>;
  readonly history: Readonly<Record<string, readonly InformationDocument[]>>;
  readonly messages: Readonly<Record<string, InformationMessage>>;
};
export function emptyInformationState(): InformationState {
  return { spaces: {}, documents: {}, history: {}, messages: {} };
}
export type InformationCommand =
  | {
      readonly type: 'space.create';
      readonly id: string;
      readonly title: string;
      readonly visibility: 'public' | 'private';
      readonly posting: 'owner' | 'members' | 'everyone';
      readonly members: readonly string[];
    }
  | {
      readonly type: 'file.create';
      readonly spaceId: string;
      readonly path: string;
      readonly content: string;
      readonly title?: string;
      readonly tags?: readonly string[];
      readonly relatedTo?: string;
    }
  | {
      readonly type: 'file.update';
      readonly spaceId: string;
      readonly path: string;
      readonly content: string;
      readonly expectedRevision: number;
      readonly title?: string;
      readonly tags?: readonly string[];
      readonly relatedTo?: string;
    }
  | {
      readonly type: 'file.delete';
      readonly spaceId: string;
      readonly path: string;
      readonly expectedRevision: number;
    }
  | {
      readonly type: 'message.send';
      readonly id: string;
      readonly recipientId: string;
      readonly content: string;
    }
  | { readonly type: 'message.read'; readonly id: string };
export type InformationEvent =
  | { readonly type: 'SpaceCreated'; readonly space: InformationSpace }
  | {
      readonly type: 'DocumentCreated' | 'DocumentUpdated' | 'DocumentDeleted';
      readonly document: InformationDocument;
    }
  | { readonly type: 'MessageSent' | 'MessageRead'; readonly message: InformationMessage };
export type InformationDecision =
  | { readonly accepted: true; readonly events: readonly InformationEvent[] }
  | { readonly accepted: false; readonly reason: string };

export function assertInformationPolicy(policy: InformationPolicy): void {
  if (
    policy.version !== INFORMATION_POLICY_VERSION ||
    [policy.maxTextLength, policy.maxSpacesPerOwner, policy.maxDocumentsPerSpace].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  ) {
    throw new Error('invalid-information-policy');
  }
}
export function validInformationId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value) && !Object.hasOwn(Object.prototype, value);
}
export function validDocumentPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    // eslint-disable-next-line no-control-regex -- logical paths must reject control characters
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}
export function documentKey(spaceId: string, path: string): string {
  return `${spaceId}/${path}`;
}
export function canReadSpace(space: InformationSpace, actorId: string): boolean {
  return (
    space.visibility === 'public' || space.ownerId === actorId || space.members.includes(actorId)
  );
}
export function canPostToSpace(space: InformationSpace, actorId: string): boolean {
  return (
    canReadSpace(space, actorId) &&
    (space.ownerId === actorId ||
      space.posting === 'everyone' ||
      (space.posting === 'members' && space.members.includes(actorId)))
  );
}
