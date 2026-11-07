import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { OpenSocietyRuntime } from '@aivilization/worker';
import { acquireCanonicalRuntimeOwnership } from './canonicalRuntimeOwnership';
import {
  assertCanonicalSourceMatchesArchive,
  verifyCanonicalSocietyArchive,
} from './canonicalSocietyArchive';
import { readCanonicalSocietySource } from './canonicalSocietySource';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function sync(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function overlaps(a: string, b: string) {
  const rel = relative(a, b);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
}
/** Stop declaration covers external/legacy writers; ownership fences cooperating formal writers.
 * Publishes the validated continuation, not a claim all future social policies are enabled.
 */
export async function publishCanonicalSocietyCutover(
  input: Parameters<typeof readCanonicalSocietySource>[0] & {
    readonly targetRoot: string;
    readonly sourceWriterConfirmedStopped: true;
  },
) {
  if (input.sourceWriterConfirmedStopped !== true)
    throw new Error('source-stop-declaration-required');
  const archiveRoot = realpathSync(input.archiveRoot);
  const archive = verifyCanonicalSocietyArchive(archiveRoot);
  // Retiring the whole runtime root cannot silently strand a second simulation.
  const simulations = archive.entries
    .filter((e) => e.kind === 'directory' && /^simulations\/[^/]+$/.test(e.path))
    .map((e) => e.path);
  const authorities = archive.entries
    .filter(
      (e) => e.kind === 'file' && /^simulation-wide-authority\/[^/]+\/state.json$/.test(e.path),
    )
    .map((e) => e.path);
  if (
    !isDeepStrictEqual(simulations, [`simulations/${encodeURIComponent(input.simulationId)}`]) ||
    !isDeepStrictEqual(authorities, [
      `simulation-wide-authority/${encodeURIComponent(input.simulationId)}/state.json`,
    ])
  )
    throw new Error('canonical-cutover-multi-simulation-unmapped');
  const requested = resolve(input.targetRoot);
  const missing: string[] = [];
  let parent = dirname(requested);
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    parent = dirname(parent);
  }
  const target = join(realpathSync(parent), ...missing, basename(requested));
  for (const original of [archive.sourceRoot, archiveRoot])
    if (overlaps(original, target) || overlaps(target, original))
      throw new Error('canonical-cutover-roots-overlap');
  const ownership = acquireCanonicalRuntimeOwnership(archive.sourceRoot, 'archive');
  let lock: string | undefined;
  let staging: string | undefined;
  try {
    assertCanonicalSourceMatchesArchive(ownership.root, archive);
    mkdirSync(dirname(target), { recursive: true });
    const lockPath = `${target}.cutover-lock`;
    mkdirSync(lockPath, { mode: 0o700 });
    lock = lockPath;
    if (
      existsSync(target) &&
      (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink())
    )
      throw new Error('canonical-cutover-target-invalid');
    const loaded = await readCanonicalSocietySource({ ...input, archiveRoot });
    if (loaded.candidate.status !== 'candidate')
      throw new Error(
        `canonical-cutover-boundary-blocked:${JSON.stringify(loaded.candidate.issues)}`,
      );
    if (!isDeepStrictEqual(loaded.source.archive, archive))
      throw new Error('canonical-cutover-archive-changed');
    staging = mkdtempSync(join(dirname(target), `.${basename(target)}.cutover-`));
    const runtime = new OpenSocietyRuntime(staging, loaded.candidate.manifest);
    try {
      if (
        runtime.journal.commitCount ||
        !isDeepStrictEqual(runtime.state.world, loaded.candidate.manifest.initialWorld)
      )
        throw new Error('canonical-cutover-initialization-created-facts');
    } finally {
      runtime.close();
    }
    const targetManifestSha256 = hash(readFileSync(join(staging, 'manifest.json')));
    const receipt = {
      version: 'canonical-society-cutover-v1' as const,
      sourceRoot: ownership.root,
      sourceTreeSha256: archive.sourceTreeSha256,
      archiveRoot,
      simulationId: input.simulationId,
      targetRoot: target,
      targetManifestSha256,
      runManifestId: loaded.source.runManifestId,
      sourceRevision: loaded.source.sourceRevision,
      consumerIds: loaded.source.consumerIds,
      continuationVersion: loaded.candidate.version,
    };
    const alreadyPublished = existsSync(target);
    if (alreadyPublished) {
      // A retry may encounter new target facts. Never rewrite its manifest or journal.
      const existing: unknown = JSON.parse(readFileSync(join(target, 'migration.json'), 'utf8'));
      if (
        !isDeepStrictEqual(existing, receipt) ||
        hash(readFileSync(join(target, 'manifest.json'))) !== targetManifestSha256
      )
        throw new Error('canonical-cutover-target-conflict');
    }
    writeFileSync(join(staging, 'migration.json'), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    sync(join(staging, 'migration.json'));
    sync(join(staging, 'manifest.json'));
    sync(staging);
    assertCanonicalSourceMatchesArchive(ownership.root, archive);
    // Durable source retirement precedes target publication. Failure never revives the source.
    ownership.retire({
      sourceTreeSha256: archive.sourceTreeSha256,
      simulationId: input.simulationId,
      targetRoot: target,
      targetManifestSha256,
    });
    if (alreadyPublished) return { ...receipt, status: 'already-published' as const };
    if (existsSync(target)) throw new Error('canonical-cutover-target-appeared');
    renameSync(staging, target);
    staging = undefined;
    sync(dirname(target));
    return { ...receipt, status: 'published' as const };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    if (lock) rmSync(lock, { recursive: true });
    ownership.release();
  }
}
