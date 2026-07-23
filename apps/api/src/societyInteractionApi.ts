type MaybePromise<TValue> = TValue | Promise<TValue>;

export type SocietyInteractionConversationRequest = {
  readonly operationId: string;
  readonly simulationId: string;
  readonly initiatorAgentId: string;
  readonly targetAgentId: string;
  readonly topic: string;
  readonly turns: readonly {
    readonly speakerAgentId: string;
    readonly utterance: string;
    readonly intent?: string;
  }[];
  readonly issuedAt: number;
};

export type SocietyInteractionPort<TResult> = {
  readonly executeConversation: (
    request: SocietyInteractionConversationRequest,
  ) => MaybePromise<TResult>;
};

export type SocietyInteractionApiService<TResult> = {
  readonly executeSocietyConversation: (
    request: SocietyInteractionConversationRequest,
  ) => Promise<TResult>;
};

export function createSocietyInteractionApiService<TResult>(input: {
  readonly interactions: SocietyInteractionPort<TResult>;
}): SocietyInteractionApiService<TResult> {
  return {
    executeSocietyConversation: async (request) => input.interactions.executeConversation(request),
  };
}
