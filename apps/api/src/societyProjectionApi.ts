type MaybePromise<TValue> = TValue | Promise<TValue>;

export type SocietyProjectionApiService<TProjection> = {
  readonly getSocietyProjection: (request: { readonly simulationId: string }) => Promise<TProjection>;
};

export function createSocietyProjectionApiService<TProjection>(input: {
  readonly projections: {
    readonly getProjection: (request: { readonly simulationId: string }) => MaybePromise<TProjection>;
  };
}): SocietyProjectionApiService<TProjection> {
  return {
    getSocietyProjection: async ({ simulationId }) => {
      const normalized = simulationId.trim();
      if (normalized.length === 0) throw new Error('simulationId must not be empty');
      return input.projections.getProjection({ simulationId: normalized });
    },
  };
}
