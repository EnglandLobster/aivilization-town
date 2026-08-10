import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSourceWorkspaceFingerprint,
  type SourceRevision,
} from '@aivilization/sim-core';

export const LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION =
  'local-simulation-resolved-run-manifest-v1';

export type LocalSimulationRuntimeJsonPrimitive = string | number | boolean | null;

export type LocalSimulationRuntimeJsonValue =
  | LocalSimulationRuntimeJsonPrimitive
  | readonly LocalSimulationRuntimeJsonValue[]
  | LocalSimulationRuntimeJsonObject;

export type LocalSimulationRuntimeJsonObject = {
  readonly [key: string]: LocalSimulationRuntimeJsonValue;
};

export type LocalSimulationRuntimeResolvedRunManifestPayload = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION;
  readonly composition: LocalSimulationRuntimeJsonObject;
  readonly sourceRevision: SourceRevision;
  readonly seed: string;
  readonly scenario: LocalSimulationRuntimeJsonObject;
  readonly policies: LocalSimulationRuntimeJsonObject;
  readonly cognition: LocalSimulationRuntimeJsonObject;
  readonly memory: LocalSimulationRuntimeJsonObject;
  readonly observations: LocalSimulationRuntimeJsonObject;
  readonly validation: LocalSimulationRuntimeJsonObject;
  readonly runtime: LocalSimulationRuntimeJsonObject;
};

export type LocalSimulationRuntimeResolvedRunManifest = {
  readonly runManifestId: string;
  readonly contentHash: string;
  readonly payload: LocalSimulationRuntimeResolvedRunManifestPayload;
};

export type LocalSimulationRuntimeResolvedRunManifestRepository = {
  readonly save: (
    manifest: LocalSimulationRuntimeResolvedRunManifest,
  ) => Promise<LocalSimulationRuntimeResolvedRunManifest>;
  readonly get: (
    runManifestId: string,
  ) => Promise<LocalSimulationRuntimeResolvedRunManifest | undefined>;
};

const HASH_PREFIX = 'sha256:';
const MANIFEST_ID_PREFIX = 'resolved-run-manifest:';

export function createLocalSimulationRuntimeResolvedRunManifest(
  payload: LocalSimulationRuntimeResolvedRunManifestPayload,
): LocalSimulationRuntimeResolvedRunManifest {
  validatePayload(payload);
  const clonedPayload = clonePayload(payload);
  const contentHash = `${HASH_PREFIX}${createHash('sha256')
    .update(createCanonicalJson(clonedPayload))
    .digest('hex')}`;
  return {
    runManifestId: `${MANIFEST_ID_PREFIX}${contentHash}`,
    contentHash,
    payload: clonedPayload,
  };
}

export function createLocalSimulationRuntimeJsonObject(
  value: unknown,
  name: string,
): LocalSimulationRuntimeJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  validateJsonValue(value, name);
  return JSON.parse(JSON.stringify(value)) as LocalSimulationRuntimeJsonObject;
}

export class InMemoryLocalSimulationRuntimeResolvedRunManifestRepository implements LocalSimulationRuntimeResolvedRunManifestRepository {
  private readonly manifests = new Map<string, LocalSimulationRuntimeResolvedRunManifest>();

  save(
    manifest: LocalSimulationRuntimeResolvedRunManifest,
  ): Promise<LocalSimulationRuntimeResolvedRunManifest> {
    return Promise.resolve().then(() => {
      const validated = validateManifest(manifest);
      const existing = this.manifests.get(validated.runManifestId);
      if (existing !== undefined) {
        assertSameManifest(existing, validated);
        return cloneManifest(existing);
      }
      this.manifests.set(validated.runManifestId, validated);
      return cloneManifest(validated);
    });
  }

  get(runManifestId: string): Promise<LocalSimulationRuntimeResolvedRunManifest | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runManifestId, 'runManifestId');
      const manifest = this.manifests.get(runManifestId);
      return manifest === undefined ? undefined : cloneManifest(manifest);
    });
  }
}

export class FileLocalSimulationRuntimeResolvedRunManifestRepository implements LocalSimulationRuntimeResolvedRunManifestRepository {
  private readonly manifestsDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.manifestsDir = join(input.rootDir, 'resolved-run-manifests');
    mkdirSync(this.manifestsDir, { recursive: true });
  }

  save(
    manifest: LocalSimulationRuntimeResolvedRunManifest,
  ): Promise<LocalSimulationRuntimeResolvedRunManifest> {
    return Promise.resolve().then(() => {
      const validated = validateManifest(manifest);
      const path = this.resolveManifestPath(validated.runManifestId);
      if (existsSync(path)) {
        const existing = readManifest(path);
        assertSameManifest(existing, validated);
        return cloneManifest(existing);
      }
      try {
        writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (error) {
        if (!existsSync(path)) {
          throw error;
        }
        const existing = readManifest(path);
        assertSameManifest(existing, validated);
        return cloneManifest(existing);
      }
      return cloneManifest(validated);
    });
  }

  get(runManifestId: string): Promise<LocalSimulationRuntimeResolvedRunManifest | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runManifestId, 'runManifestId');
      const path = this.resolveManifestPath(runManifestId);
      return existsSync(path) ? readManifest(path) : undefined;
    });
  }

  private resolveManifestPath(runManifestId: string): string {
    return join(this.manifestsDir, `${extractManifestHash(runManifestId)}.json`);
  }
}

function validateManifest(manifest: unknown): LocalSimulationRuntimeResolvedRunManifest {
  if (!isPlainObject(manifest)) {
    throw new Error('resolved run manifest must be a plain JSON object');
  }
  const runManifestId = manifest.runManifestId;
  const contentHash = manifest.contentHash;
  if (typeof runManifestId !== 'string') {
    throw new Error('resolved run manifest runManifestId must be a string');
  }
  if (typeof contentHash !== 'string') {
    throw new Error('resolved run manifest contentHash must be a string');
  }
  validatePayload(manifest.payload);
  const canonical = createLocalSimulationRuntimeResolvedRunManifest(manifest.payload);
  if (runManifestId !== canonical.runManifestId) {
    throw new Error('runManifestId does not match resolved manifest payload');
  }
  if (contentHash !== canonical.contentHash) {
    throw new Error('contentHash does not match resolved manifest payload');
  }
  return canonical;
}

function validatePayload(
  payload: unknown,
): asserts payload is LocalSimulationRuntimeResolvedRunManifestPayload {
  if (!isPlainObject(payload)) {
    throw new Error('resolved run manifest payload must be a plain JSON object');
  }
  if (payload.schemaVersion !== LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION) {
    throw new Error('schemaVersion must equal local-simulation-resolved-run-manifest-v1');
  }
  if (!isPlainObject(payload.sourceRevision)) {
    throw new Error('sourceRevision must be a plain JSON object');
  }
  if (typeof payload.sourceRevision.commit !== 'string') {
    throw new Error('sourceRevision.commit must be a string');
  }
  assertNonEmpty(payload.sourceRevision.commit, 'sourceRevision.commit');
  if (typeof payload.sourceRevision.dirty !== 'boolean') {
    throw new Error('sourceRevision.dirty must be a boolean');
  }
  if (payload.sourceRevision.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      payload.sourceRevision.workspaceFingerprint,
      'sourceRevision.workspaceFingerprint',
    );
  }
  if (typeof payload.seed !== 'string') {
    throw new Error('seed must be a string');
  }
  assertNonEmpty(payload.seed, 'seed');
  for (const field of [
    'composition',
    'scenario',
    'policies',
    'cognition',
    'memory',
    'observations',
    'validation',
    'runtime',
  ] as const) {
    if (!isPlainObject(payload[field])) {
      throw new Error(`${field} must be a plain JSON object`);
    }
  }
  validateJsonValue(payload, 'payload');
}

function validateJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must not contain non-finite numbers`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new Error(`${path} must contain JSON values only`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON objects only`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNonEmpty(key, `${path} key`);
    validateJsonValue(entry, `${path}.${key}`);
  }
}

function createCanonicalJson(value: LocalSimulationRuntimeJsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map((entry) => createCanonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${createCanonicalJson(value[key] ?? null)}`)
    .join(',')}}`;
}

function isJsonArray(
  value: LocalSimulationRuntimeJsonValue,
): value is readonly LocalSimulationRuntimeJsonValue[] {
  return Array.isArray(value);
}

function extractManifestHash(runManifestId: string): string {
  assertNonEmpty(runManifestId, 'runManifestId');
  if (!runManifestId.startsWith(`${MANIFEST_ID_PREFIX}${HASH_PREFIX}`)) {
    throw new Error('runManifestId must use the resolved-run-manifest:sha256: prefix');
  }
  const hash = runManifestId.slice(`${MANIFEST_ID_PREFIX}${HASH_PREFIX}`.length);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('runManifestId must end with a 64-character lowercase SHA-256 hash');
  }
  return hash;
}

function readManifest(path: string): LocalSimulationRuntimeResolvedRunManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return validateManifest(parsed);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertSameManifest(
  left: LocalSimulationRuntimeResolvedRunManifest,
  right: LocalSimulationRuntimeResolvedRunManifest,
): void {
  if (createCanonicalJson(left.payload) !== createCanonicalJson(right.payload)) {
    throw new Error(`resolved run manifest collision for ${left.runManifestId}`);
  }
}

function clonePayload(
  payload: LocalSimulationRuntimeResolvedRunManifestPayload,
): LocalSimulationRuntimeResolvedRunManifestPayload {
  return JSON.parse(JSON.stringify(payload)) as LocalSimulationRuntimeResolvedRunManifestPayload;
}

function cloneManifest(
  manifest: LocalSimulationRuntimeResolvedRunManifest,
): LocalSimulationRuntimeResolvedRunManifest {
  return {
    runManifestId: manifest.runManifestId,
    contentHash: manifest.contentHash,
    payload: clonePayload(manifest.payload),
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
