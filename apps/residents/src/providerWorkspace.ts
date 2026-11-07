import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RESIDENT_CLI_VERSION } from './cliCatalog';
import { writeDurableComputeRecord } from './durableComputeRecord';

/** Legacy derivation must remain exact: this was the provider's actual --dir identity. */
export function legacyProviderWorkspaceId(directory: string): string {
  return createHash('sha256')
    .update(`${RESIDENT_CLI_VERSION}:${directory}`)
    .digest('hex')
    .slice(0, 32);
}
type Marker = { version: typeof RESIDENT_CLI_VERSION; sessionId: string; workspaceId?: string };
function marker(value: unknown): Marker | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== RESIDENT_CLI_VERSION ||
    !('sessionId' in value) ||
    typeof value.sessionId !== 'string'
  )
    return;
  if ('workspaceId' in value) {
    if (typeof value.workspaceId !== 'string' || !/^[a-f0-9]{32}$/.test(value.workspaceId))
      throw Error('invalid-provider-workspace-id');
    return {
      version: RESIDENT_CLI_VERSION,
      sessionId: value.sessionId,
      workspaceId: value.workspaceId,
    };
  }
  return { version: RESIDENT_CLI_VERSION, sessionId: value.sessionId };
}
/** A caller's session ID alone never proves transport provenance. */
export function residentProviderSession(
  directory: string,
  expectedSessionId?: string,
): { workspaceId: string; sessionId?: string } {
  const fallback = { workspaceId: legacyProviderWorkspaceId(directory) };
  const path = join(directory, 'cli-session.json');
  if (!expectedSessionId || !existsSync(path)) return fallback;
  const saved = marker(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!saved || saved.sessionId !== expectedSessionId) return fallback;
  return { workspaceId: saved.workspaceId ?? fallback.workspaceId, sessionId: saved.sessionId };
}

/** Explicit same-host evidence handoff. Does not copy or invent the provider's session database. */
export function preserveResidentProviderWorkspace(
  sourceDirectory: string,
  targetDirectory: string,
  expectedSessionId: string,
) {
  if (resolve(sourceDirectory) === resolve(targetDirectory))
    throw Error('distinct-provider-evidence-directories-required');
  const bytes = readFileSync(join(sourceDirectory, 'cli-session.json'));
  const original = marker(JSON.parse(bytes.toString('utf8')) as unknown);
  const target = marker(
    JSON.parse(readFileSync(join(targetDirectory, 'cli-session.json'), 'utf8')) as unknown,
  );
  if (
    !original ||
    !target ||
    original.sessionId !== expectedSessionId ||
    target.sessionId !== expectedSessionId
  )
    throw Error('provider-handoff-session-mismatch');
  const workspaceId = original.workspaceId ?? legacyProviderWorkspaceId(sourceDirectory);
  if (target.workspaceId && target.workspaceId !== workspaceId)
    throw Error('provider-handoff-workspace-mismatch');
  const proof = {
    version: 'resident-provider-workspace-handoff-v1',
    sourceDirectory,
    targetDirectory,
    sessionId: expectedSessionId,
    workspaceId,
    originalMarkerSha256: createHash('sha256').update(bytes).digest('hex'),
    originalMarkerUtf8: bytes.toString('utf8'),
  };
  const proofName = `provider-workspace-origin-${createHash('sha256').update(JSON.stringify(proof)).digest('hex').slice(0, 32)}.json`;
  const path = join(targetDirectory, proofName);
  if (existsSync(path)) {
    if (JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(proof))
      throw Error('provider-handoff-proof-conflict');
  } else writeDurableComputeRecord(path, proof);
  // Origin is durable first. A retry after interruption can finish the active marker without changing identity.
  writeDurableComputeRecord(join(targetDirectory, 'cli-session.json'), { ...target, workspaceId });
  return { workspaceId, proofName, originalMarkerSha256: proof.originalMarkerSha256 };
}
