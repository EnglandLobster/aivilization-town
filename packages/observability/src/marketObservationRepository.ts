import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type MarketTradeObservation = {
  readonly observationId: string;
  readonly simulationId: string;
  readonly commodityId: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly side: 'buy' | 'sell';
  readonly observedAt: number;
  readonly price: number;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly effectivePrice?: number;
  readonly spotPriceBefore?: number;
  readonly spotPriceAfter?: number;
  readonly slippageRatio?: number;
  readonly invariantBefore?: number;
  readonly invariantAfter?: number;
};

export type MarketOhlcBar = {
  readonly barId: string;
  readonly simulationId: string;
  readonly commodityId: string;
  readonly intervalStartedAt: number;
  readonly intervalEndedAt: number;
  readonly openPrice: number;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly closePrice: number;
  readonly tradeCount: number;
  readonly commodityVolume: number;
  readonly currencyVolume: number;
};

export type MarketTradeObservationQuery = {
  readonly simulationId: string;
  readonly commodityId?: string;
  readonly fromObservedAt?: number;
  readonly toObservedAt?: number;
  readonly limit?: number;
};

export type MarketOhlcBarQuery = {
  readonly simulationId: string;
  readonly commodityId?: string;
  readonly fromIntervalStartedAt?: number;
  readonly toIntervalStartedAt?: number;
  readonly limit?: number;
};

export type MarketObservationRepository = {
  readonly recordTrades: (observations: readonly MarketTradeObservation[]) => Promise<void>;
  readonly recordOhlcBars: (bars: readonly MarketOhlcBar[]) => Promise<void>;
  readonly queryTrades: (
    query: MarketTradeObservationQuery,
  ) => Promise<MarketTradeObservation[]>;
  readonly queryOhlcBars: (query: MarketOhlcBarQuery) => Promise<MarketOhlcBar[]>;
};

export class InMemoryMarketObservationRepository implements MarketObservationRepository {
  private readonly tradesById = new Map<string, MarketTradeObservation>();
  private readonly ohlcBarsById = new Map<string, MarketOhlcBar>();

  recordTrades(observations: readonly MarketTradeObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      for (const observation of observations) {
        const clone = cloneTradeObservation(observation);
        if (!this.tradesById.has(clone.observationId)) {
          this.tradesById.set(clone.observationId, clone);
        }
      }
    });
  }

  recordOhlcBars(bars: readonly MarketOhlcBar[]): Promise<void> {
    return Promise.resolve().then(() => {
      for (const bar of bars) {
        const clone = cloneOhlcBar(bar);
        if (!this.ohlcBarsById.has(clone.barId)) {
          this.ohlcBarsById.set(clone.barId, clone);
        }
      }
    });
  }

  queryTrades(query: MarketTradeObservationQuery): Promise<MarketTradeObservation[]> {
    return Promise.resolve().then(() => queryTrades([...this.tradesById.values()], query));
  }

  queryOhlcBars(query: MarketOhlcBarQuery): Promise<MarketOhlcBar[]> {
    return Promise.resolve().then(() => queryOhlcBars([...this.ohlcBarsById.values()], query));
  }
}

export class FileMarketObservationRepository implements MarketObservationRepository {
  private readonly tradesPath: string;
  private readonly ohlcBarsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tradesPath = join(input.rootDir, 'market-trade-observations.jsonl');
    this.ohlcBarsPath = join(input.rootDir, 'market-ohlc-bars.jsonl');
    ensureFile(this.tradesPath, input.rootDir);
    ensureFile(this.ohlcBarsPath, input.rootDir);
  }

  recordTrades(observations: readonly MarketTradeObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      const existingIds = new Set(
        readJsonLines<MarketTradeObservation>(this.tradesPath).map(
          (observation) => observation.observationId,
        ),
      );
      const newObservations: MarketTradeObservation[] = [];
      for (const observation of observations) {
        const clone = cloneTradeObservation(observation);
        if (!existingIds.has(clone.observationId)) {
          existingIds.add(clone.observationId);
          newObservations.push(clone);
        }
      }
      appendJsonLines(this.tradesPath, newObservations);
    });
  }

  recordOhlcBars(bars: readonly MarketOhlcBar[]): Promise<void> {
    return Promise.resolve().then(() => {
      const existingIds = new Set(
        readJsonLines<MarketOhlcBar>(this.ohlcBarsPath).map((bar) => bar.barId),
      );
      const newBars: MarketOhlcBar[] = [];
      for (const bar of bars) {
        const clone = cloneOhlcBar(bar);
        if (!existingIds.has(clone.barId)) {
          existingIds.add(clone.barId);
          newBars.push(clone);
        }
      }
      appendJsonLines(this.ohlcBarsPath, newBars);
    });
  }

  queryTrades(query: MarketTradeObservationQuery): Promise<MarketTradeObservation[]> {
    return Promise.resolve().then(() =>
      queryTrades(readJsonLines<MarketTradeObservation>(this.tradesPath), query),
    );
  }

  queryOhlcBars(query: MarketOhlcBarQuery): Promise<MarketOhlcBar[]> {
    return Promise.resolve().then(() =>
      queryOhlcBars(readJsonLines<MarketOhlcBar>(this.ohlcBarsPath), query),
    );
  }
}

function queryTrades(
  observations: readonly MarketTradeObservation[],
  query: MarketTradeObservationQuery,
): MarketTradeObservation[] {
  assertValidTradeQuery(query);
  return observations
    .filter((observation) => observation.simulationId === query.simulationId)
    .filter(
      (observation) => query.commodityId === undefined || observation.commodityId === query.commodityId,
    )
    .filter(
      (observation) =>
        query.fromObservedAt === undefined || observation.observedAt >= query.fromObservedAt,
    )
    .filter(
      (observation) =>
        query.toObservedAt === undefined || observation.observedAt <= query.toObservedAt,
    )
    .sort(compareTradeObservations)
    .slice(0, query.limit)
    .map((observation) => cloneTradeObservation(observation));
}

function queryOhlcBars(
  bars: readonly MarketOhlcBar[],
  query: MarketOhlcBarQuery,
): MarketOhlcBar[] {
  assertValidOhlcQuery(query);
  return bars
    .filter((bar) => bar.simulationId === query.simulationId)
    .filter((bar) => query.commodityId === undefined || bar.commodityId === query.commodityId)
    .filter(
      (bar) =>
        query.fromIntervalStartedAt === undefined ||
        bar.intervalStartedAt >= query.fromIntervalStartedAt,
    )
    .filter(
      (bar) =>
        query.toIntervalStartedAt === undefined ||
        bar.intervalStartedAt <= query.toIntervalStartedAt,
    )
    .sort(compareOhlcBars)
    .slice(0, query.limit)
    .map((bar) => cloneOhlcBar(bar));
}

function cloneTradeObservation(observation: MarketTradeObservation): MarketTradeObservation {
  assertValidTradeObservation(observation);
  return {
    observationId: observation.observationId,
    simulationId: observation.simulationId,
    commodityId: observation.commodityId,
    sourceEventId: observation.sourceEventId,
    sourceSequence: observation.sourceSequence,
    side: observation.side,
    observedAt: observation.observedAt,
    price: observation.price,
    commodityQuantity: observation.commodityQuantity,
    currencyQuantity: observation.currencyQuantity,
    ...(observation.effectivePrice === undefined
      ? {}
      : { effectivePrice: observation.effectivePrice }),
    ...(observation.spotPriceBefore === undefined
      ? {}
      : { spotPriceBefore: observation.spotPriceBefore }),
    ...(observation.spotPriceAfter === undefined
      ? {}
      : { spotPriceAfter: observation.spotPriceAfter }),
    ...(observation.slippageRatio === undefined
      ? {}
      : { slippageRatio: observation.slippageRatio }),
    ...(observation.invariantBefore === undefined
      ? {}
      : { invariantBefore: observation.invariantBefore }),
    ...(observation.invariantAfter === undefined
      ? {}
      : { invariantAfter: observation.invariantAfter }),
  };
}

function cloneOhlcBar(bar: MarketOhlcBar): MarketOhlcBar {
  assertValidOhlcBar(bar);
  return {
    barId: bar.barId,
    simulationId: bar.simulationId,
    commodityId: bar.commodityId,
    intervalStartedAt: bar.intervalStartedAt,
    intervalEndedAt: bar.intervalEndedAt,
    openPrice: bar.openPrice,
    highPrice: bar.highPrice,
    lowPrice: bar.lowPrice,
    closePrice: bar.closePrice,
    tradeCount: bar.tradeCount,
    commodityVolume: bar.commodityVolume,
    currencyVolume: bar.currencyVolume,
  };
}

function compareTradeObservations(
  left: MarketTradeObservation,
  right: MarketTradeObservation,
): number {
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  if (left.observedAt !== right.observedAt) {
    return left.observedAt - right.observedAt;
  }
  if (left.sourceSequence !== right.sourceSequence) {
    return left.sourceSequence - right.sourceSequence;
  }
  return left.observationId.localeCompare(right.observationId);
}

function compareOhlcBars(left: MarketOhlcBar, right: MarketOhlcBar): number {
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  if (left.intervalStartedAt !== right.intervalStartedAt) {
    return left.intervalStartedAt - right.intervalStartedAt;
  }
  return left.barId.localeCompare(right.barId);
}

function assertValidTradeObservation(observation: MarketTradeObservation): void {
  assertNonEmpty(observation.observationId, 'observationId');
  assertNonEmpty(observation.simulationId, 'simulationId');
  assertNonEmpty(observation.commodityId, 'commodityId');
  assertNonEmpty(observation.sourceEventId, 'sourceEventId');
  assertNonNegativeInteger(observation.sourceSequence, 'sourceSequence');
  if (observation.side !== 'buy' && observation.side !== 'sell') {
    throw new Error('side must be buy or sell');
  }
  assertFinite(observation.observedAt, 'observedAt');
  assertPositiveFinite(observation.price, 'price');
  assertPositiveFinite(observation.commodityQuantity, 'commodityQuantity');
  assertPositiveFinite(observation.currencyQuantity, 'currencyQuantity');
  assertOptionalFinite(observation.effectivePrice, 'effectivePrice');
  assertOptionalFinite(observation.spotPriceBefore, 'spotPriceBefore');
  assertOptionalFinite(observation.spotPriceAfter, 'spotPriceAfter');
  assertOptionalFinite(observation.slippageRatio, 'slippageRatio');
  assertOptionalFinite(observation.invariantBefore, 'invariantBefore');
  assertOptionalFinite(observation.invariantAfter, 'invariantAfter');
}

function assertValidOhlcBar(bar: MarketOhlcBar): void {
  assertNonEmpty(bar.barId, 'barId');
  assertNonEmpty(bar.simulationId, 'simulationId');
  assertNonEmpty(bar.commodityId, 'commodityId');
  assertFinite(bar.intervalStartedAt, 'intervalStartedAt');
  assertFinite(bar.intervalEndedAt, 'intervalEndedAt');
  if (bar.intervalEndedAt <= bar.intervalStartedAt) {
    throw new Error('intervalEndedAt must be greater than intervalStartedAt');
  }
  assertPositiveFinite(bar.openPrice, 'openPrice');
  assertPositiveFinite(bar.highPrice, 'highPrice');
  assertPositiveFinite(bar.lowPrice, 'lowPrice');
  assertPositiveFinite(bar.closePrice, 'closePrice');
  assertPositiveInteger(bar.tradeCount, 'tradeCount');
  assertPositiveFinite(bar.commodityVolume, 'commodityVolume');
  assertPositiveFinite(bar.currencyVolume, 'currencyVolume');
}

function assertValidTradeQuery(query: MarketTradeObservationQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.commodityId !== undefined) {
    assertNonEmpty(query.commodityId, 'commodityId');
  }
  assertOptionalFinite(query.fromObservedAt, 'fromObservedAt');
  assertOptionalFinite(query.toObservedAt, 'toObservedAt');
  assertOptionalPositiveInteger(query.limit, 'limit');
}

function assertValidOhlcQuery(query: MarketOhlcBarQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.commodityId !== undefined) {
    assertNonEmpty(query.commodityId, 'commodityId');
  }
  assertOptionalFinite(query.fromIntervalStartedAt, 'fromIntervalStartedAt');
  assertOptionalFinite(query.toIntervalStartedAt, 'toIntervalStartedAt');
  assertOptionalPositiveInteger(query.limit, 'limit');
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function assertOptionalFinite(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertOptionalPositiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertPositiveInteger(value, name);
  }
}
