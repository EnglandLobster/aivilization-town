import type { PrincipalRequest, ResourcePrincipal } from '@aivilization/authority';

/** Read-only application port. The outer transaction owns the collective registry and exact consumption. */
export type PrincipalCollectivePort = {
  readonly available: (collectiveId: string) => boolean;
  readonly authorize: (input: {
    readonly collectiveId: string;
    readonly principal: ResourcePrincipal;
    readonly actorId: string;
    readonly request: PrincipalRequest;
    /** Replay asks for the recorded decision, never substitutes another currently valid decision. */
    readonly decisionId?: string;
  }) => { readonly decisionId: string; readonly charterVersion: number } | undefined;
};
