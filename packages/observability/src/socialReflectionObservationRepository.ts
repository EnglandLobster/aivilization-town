import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SocialReflectionObservationSource = 'memory-consolidation';

export type SocialReflectionObservation = {
  readonly observationId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly reflectionId: string;
  readonly agentId: string;
  readonly targetAgentId: string;
  readonly statement: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
  readonly generatedAt: number;
  readonly tags: readonly string[];
  readonly source: SocialReflectionObservationSource;
};

export type SocialReflectionObservationQuery = {
  readonly simulationId: string;
  readonly observationId?: string;
  readonly partitionKey?: string;
  readonly agentId?: string;
  readonly targetAgentId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type SocialReflectionObservationRepository = {
  readonly record: (observations: readonly SocialReflectionObservation[]) => Promise<void>;
  readonly get: (observationId: string) => Promise<SocialReflectionObservation | undefined>;
  readonly query: (
    query: SocialReflectionObservationQuery,
  ) => Promise<SocialReflectionObservation[]>;
};

export class InMemorySocialReflectionObservationRepository implements SocialReflectionObservationRepository {
  private readonly observationsById = new Map<string, SocialReflectionObservation>();

  record(observations: readonly SocialReflectionObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      for (const observation of observations) {
        const clone = cloneObservation(observation);
        if (!this.observationsById.has(clone.observationId)) {
          this.observationsById.set(clone.observationId, clone);
        }
      }
    });
  }

  get(observationId: string): Promise<SocialReflectionObservation | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(observationId, 'observationId');
      const observation = this.observationsById.get(observationId);
      return observation === undefined ? undefined : cloneObservation(observation);
    });
  }

  query(query: SocialReflectionObservationQuery): Promise<SocialReflectionObservation[]> {
    return Promise.resolve().then(() =>
      queryObservations([...this.observationsById.values()], query),
    );
  }
}

export class FileSocialReflectionObservationRepository implements SocialReflectionObservationRepository {
  private readonly observationsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.observationsPath = join(input.rootDir, 'social-reflection-observations.jsonl');
    ensureFile(this.observationsPath, input.rootDir);
  }

  record(observations: readonly SocialReflectionObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      const existingIds = new Set(
        readJsonLines<SocialReflectionObservation>(this.observationsPath).map(
          (observation) => observation.observationId,
        ),
      );
      const newObservations: SocialReflectionObservation[] = [];
      for (const observation of observations) {
        const clone = cloneObservation(observation);
        if (!existingIds.has(clone.observationId)) {
          existingIds.add(clone.observationId);
          newObservations.push(clone);
        }
      }
      appendJsonLines(this.observationsPath, newObservations);
    });
  }

  get(observationId: string): Promise<SocialReflectionObservation | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(observationId, 'observationId');
      const observation = readJsonLines<SocialReflectionObservation>(this.observationsPath).find(
        (candidate) => candidate.observationId === observationId,
      );
      return observation === undefined ? undefined : cloneObservation(observation);
    });
  }

  query(query: SocialReflectionObservationQuery): Promise<SocialReflectionObservation[]> {
    return Promise.resolve().then(() =>
      queryObservations(readJsonLines<SocialReflectionObservation>(this.observationsPath), query),
    );
  }
}

function queryObservations(
  observations: readonly SocialReflectionObservation[],
  query: SocialReflectionObservationQuery,
): SocialReflectionObservation[] {
  assertValidQuery(query);
  return observations
    .filter((observation) => observation.simulationId === query.simulationId)
    .filter(
      (observation) =>
        query.observationId === undefined || observation.observationId === query.observationId,
    )
    .filter(
      (observation) =>
        query.partitionKey === undefined || observation.partitionKey === query.partitionKey,
    )
    .filter((observation) => query.agentId === undefined || observation.agentId === query.agentId)
    .filter(
      (observation) =>
        query.targetAgentId === undefined || observation.targetAgentId === query.targetAgentId,
    )
    .filter(
      (observation) =>
        query.fromGeneratedAt === undefined || observation.generatedAt >= query.fromGeneratedAt,
    )
    .filter(
      (observation) =>
        query.toGeneratedAt === undefined || observation.generatedAt <= query.toGeneratedAt,
    )
    .sort(compareObservationChronological)
    .slice(0, query.limit)
    .map((observation) => cloneObservation(observation));
}

function cloneObservation(observation: SocialReflectionObservation): SocialReflectionObservation {
  assertValidObservation(observation);
  return {
    observationId: observation.observationId,
    simulationId: observation.simulationId,
    partitionKey: observation.partitionKey,
    reflectionId: observation.reflectionId,
    agentId: observation.agentId,
    targetAgentId: observation.targetAgentId,
    statement: observation.statement,
    relationDelta: observation.relationDelta,
    attitudeDelta: observation.attitudeDelta,
    confidence: observation.confidence,
    evidenceRecordIds: [...observation.evidenceRecordIds],
    generatedAt: observation.generatedAt,
    tags: [...observation.tags],
    source: observation.source,
  };
}

function compareObservationChronological(
  left: SocialReflectionObservation,
  right: SocialReflectionObservation,
): number {
  if (left.generatedAt !== right.generatedAt) {
    return left.generatedAt - right.generatedAt;
  }
  if (left.agentId !== right.agentId) {
    return left.agentId.localeCompare(right.agentId);
  }
  if (left.targetAgentId !== right.targetAgentId) {
    return left.targetAgentId.localeCompare(right.targetAgentId);
  }
  return left.observationId.localeCompare(right.observationId);
}

function assertValidObservation(observation: SocialReflectionObservation): void {
  assertNonEmpty(observation.observationId, 'observationId');
  assertNonEmpty(observation.simulationId, 'simulationId');
  assertNonEmpty(observation.partitionKey, 'partitionKey');
  assertNonEmpty(observation.reflectionId, 'reflectionId');
  assertNonEmpty(observation.agentId, 'agentId');
  assertNonEmpty(observation.targetAgentId, 'targetAgentId');
  assertNonEmpty(observation.statement, 'statement');
  assertFinite(observation.relationDelta, 'relationDelta');
  assertFinite(observation.attitudeDelta, 'attitudeDelta');
  assertFinite(observation.confidence, 'confidence');
  assertFinite(observation.generatedAt, 'generatedAt');
  if (observation.source !== 'memory-consolidation') {
    throw new Error('source must be memory-consolidation');
  }
  if (observation.evidenceRecordIds.length === 0) {
    throw new Error('evidenceRecordIds must not be empty');
  }
  for (const evidenceRecordId of observation.evidenceRecordIds) {
    assertNonEmpty(evidenceRecordId, 'evidenceRecordId');
  }
  for (const tag of observation.tags) {
    assertNonEmpty(tag, 'tag');
  }
}

function assertValidQuery(query: SocialReflectionObservationQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.observationId !== undefined) {
    assertNonEmpty(query.observationId, 'observationId');
  }
  if (query.partitionKey !== undefined) {
    assertNonEmpty(query.partitionKey, 'partitionKey');
  }
  if (query.agentId !== undefined) {
    assertNonEmpty(query.agentId, 'agentId');
  }
  if (query.targetAgentId !== undefined) {
    assertNonEmpty(query.targetAgentId, 'targetAgentId');
  }
  assertOptionalFinite(query.fromGeneratedAt, 'fromGeneratedAt');
  assertOptionalFinite(query.toGeneratedAt, 'toGeneratedAt');
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new Error('limit must be a positive integer');
  }
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

function assertOptionalFinite(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertFinite(value, name);
  }
}
