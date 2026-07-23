import {
  createPaperMatureMarketDatasetArtifact,
  preparePaperMatureMarketDatasetStreaming,
  savePreparedPaperMatureMarketDataset,
  type FilePaperMatureMarketDatasetRepository,
  type MarketObservationRepository,
  type PaperMatureMarketDatasetArtifactInput,
  type PaperMatureMarketDatasetBundle,
  type PaperMatureMarketSourceLedgerFile,
  type PaperMatureMarketDatasetArtifact,
  type MarketTradeObservation,
} from '@aivilization/observability';

export type RunWorkerPaperMatureMarketDatasetExtractionInput = {
  readonly run: PaperMatureMarketDatasetArtifactInput['run'];
  readonly sources: readonly {
    readonly partitionKey: string;
    readonly marketObservationRepository: MarketObservationRepository;
    readonly readLedgerFileProvenance: () =>
      | PaperMatureMarketSourceLedgerFile
      | Promise<PaperMatureMarketSourceLedgerFile>;
  }[];
  readonly artifactRepository: Pick<FilePaperMatureMarketDatasetRepository, 'save'>;
  readonly policy?: PaperMatureMarketDatasetArtifactInput['policy'];
};

/**
 * Freezes one mature market dataset from every manifest-declared partition of
 * an already durable source run. Each ledger is hashed before and after the
 * parallel repository snapshot; any change fails closed before the versioned
 * maturity policy can persist an immutable selected block.
 */
export async function runWorkerPaperMatureMarketDatasetExtraction(
  input: RunWorkerPaperMatureMarketDatasetExtractionInput,
): Promise<PaperMatureMarketDatasetBundle> {
  const ledgerFilesBeforeQuery = await Promise.all(
    input.sources.map(async (source) => source.readLedgerFileProvenance()),
  );
  const observationsBySource = await Promise.all(
    input.sources.map((source) =>
      source.marketObservationRepository.queryTrades({
        simulationId: input.run.simulationId,
        fromObservedAt: input.run.collectionWindowStartedAt,
        toObservedAt: input.run.collectionWindowEndedAt,
      }),
    ),
  );
  const ledgerFilesAfterQuery = await Promise.all(
    input.sources.map(async (source) => source.readLedgerFileProvenance()),
  );
  input.sources.forEach((source, index) => {
    if (
      !sameLedgerFile(
        ledgerFilesBeforeQuery[index]!,
        ledgerFilesAfterQuery[index]!,
      )
    ) {
      throw new Error(
        `paper mature market source ${source.partitionKey} changed during extraction`,
      );
    }
  });
  const bundle = createPaperMatureMarketDatasetArtifact({
    run: input.run,
    sources: input.sources.map((source, index) => ({
      partitionKey: source.partitionKey,
      ledgerFile: ledgerFilesBeforeQuery[index]!,
      trades: observationsBySource[index]!.filter(
        (observation) => observation.observedAt < input.run.collectionWindowEndedAt,
      ),
    })),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  });
  await input.artifactRepository.save(bundle);
  return bundle;
}

export type RunWorkerPaperMatureMarketDatasetStreamingExtractionInput = {
  readonly run: PaperMatureMarketDatasetArtifactInput['run'];
  readonly sources: readonly {
    readonly partitionKey: string;
    readonly openTrades: () => AsyncIterable<MarketTradeObservation>;
    readonly readLedgerFileProvenance: () =>
      | PaperMatureMarketSourceLedgerFile
      | Promise<PaperMatureMarketSourceLedgerFile>;
  }[];
  readonly artifactRootDir: string;
  readonly stagingDir: string;
  readonly policy?: PaperMatureMarketDatasetArtifactInput['policy'];
};

/**
 * Bounded-memory evidence path used by the canonical file CLI. The source
 * hashes are frozen once, then rechecked between both streaming passes and
 * after selection before the immutable artifact is committed.
 */
export async function runWorkerPaperMatureMarketDatasetStreamingExtraction(
  input: RunWorkerPaperMatureMarketDatasetStreamingExtractionInput,
): Promise<PaperMatureMarketDatasetArtifact> {
  const baseline = await Promise.all(
    input.sources.map(async (source) => source.readLedgerFileProvenance()),
  );
  const assertSourceSnapshot = async (): Promise<void> => {
    const current = await Promise.all(
      input.sources.map(async (source) => source.readLedgerFileProvenance()),
    );
    input.sources.forEach((source, index) => {
      if (!sameLedgerFile(baseline[index]!, current[index]!)) {
        throw new Error(
          `paper mature market source ${source.partitionKey} changed during extraction`,
        );
      }
    });
  };
  const prepared = await preparePaperMatureMarketDatasetStreaming({
    run: input.run,
    sources: input.sources.map((source, index) => ({
      partitionKey: source.partitionKey,
      ledgerFile: baseline[index]!,
      openTrades: source.openTrades,
    })),
    stagingDir: input.stagingDir,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    assertSourceSnapshot,
  });
  return savePreparedPaperMatureMarketDataset({
    rootDir: input.artifactRootDir,
    prepared,
  });
}

function sameLedgerFile(
  left: PaperMatureMarketSourceLedgerFile,
  right: PaperMatureMarketSourceLedgerFile,
): boolean {
  return (
    left.filename === right.filename &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256
  );
}
