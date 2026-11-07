import { acquireCanonicalRuntimeOwnership } from './canonicalRuntimeOwnership';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const VERSION = 'canonical-society-source-archive-v1';
type Entry = {
  readonly path: string;
  readonly kind: 'directory' | 'file';
  readonly sha256?: string;
};
export type CanonicalSocietyArchive = {
  readonly version: typeof VERSION;
  readonly sourceRoot: string;
  readonly sourceTreeSha256: string;
  readonly entries: readonly Entry[];
  readonly stopEvidence: 'operator-declaration-only';
  readonly purpose: 'source-preservation-not-runnable-migration';
};
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function tree(root: string): Entry[] {
  const entries: Entry[] = [];
  const walk = (path: string) => {
    const stat = lstatSync(path);
    const name = relative(root, path).split(sep).join('/');
    if (stat.isSymbolicLink()) throw Error('source-archive-symlink-rejected');
    if (stat.isDirectory()) {
      if (name) entries.push({ path: name, kind: 'directory' });
      for (const child of readdirSync(path).sort()) walk(join(path, child));
    } else if (stat.isFile())
      entries.push({ path: name, kind: 'file', sha256: hash(readFileSync(path)) });
    else throw Error('source-archive-special-file-rejected');
  };
  walk(root);
  return entries;
}
function sync(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function inside(parent: string, child: string) {
  const r = relative(parent, child);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`));
}
/** Validate archived bytes only; this is not a writer fence or a domain replay verifier. */
export function verifyCanonicalSocietyArchive(root: string): CanonicalSocietyArchive {
  if (!lstatSync(join(root, 'archive.json')).isFile())
    throw Error('invalid-source-archive-metadata');
  // Untrusted file envelope: fixed fields and the complete entry list are checked below.
  const metadata = JSON.parse(
    readFileSync(join(root, 'archive.json'), 'utf8'),
  ) as CanonicalSocietyArchive;
  if (
    !metadata ||
    metadata.version !== VERSION ||
    typeof metadata.sourceRoot !== 'string' ||
    !isAbsolute(metadata.sourceRoot) ||
    metadata.stopEvidence !== 'operator-declaration-only' ||
    metadata.purpose !== 'source-preservation-not-runnable-migration'
  )
    throw Error('invalid-source-archive');
  const entries = tree(join(root, 'source'));
  if (
    !isDeepStrictEqual(entries, metadata.entries) ||
    hash(JSON.stringify(entries)) !== metadata.sourceTreeSha256
  )
    throw Error('source-archive-content-mismatch');
  if (!isDeepStrictEqual(readdirSync(root).sort(), ['archive.json', 'source']))
    throw Error('source-archive-unexpected-entry');
  return metadata;
}
/** Offline, whole-tree preservation. No policy changes, URI rewriting, state hydration or source writes. */
export function exportCanonicalSocietyArchive(input: {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly sourceWriterConfirmedStopped: true;
}): CanonicalSocietyArchive {
  if (input.sourceWriterConfirmedStopped !== true) throw Error('source-stop-declaration-required');
  const ownership = acquireCanonicalRuntimeOwnership(realpathSync(input.sourceRoot), 'archive');
  try {
    const source = realpathSync(input.sourceRoot);
    const requestedTarget = resolve(input.targetRoot);
    // Resolve parent aliases before creating anything, so a symlink cannot hide a nested destination.
    const missing: string[] = [];
    let parent = dirname(requestedTarget);
    while (!existsSync(parent)) {
      missing.unshift(basename(parent));
      parent = dirname(parent);
    }
    const target = join(realpathSync(parent), ...missing, basename(requestedTarget));
    if (inside(source, target) || inside(target, source))
      throw Error('source-archive-roots-overlap');
    if (!lstatSync(join(source, 'simulations')).isDirectory())
      throw Error('canonical-simulations-required');
    const entries = tree(source);
    const metadata: CanonicalSocietyArchive = {
      version: VERSION,
      sourceRoot: source,
      entries,
      sourceTreeSha256: hash(JSON.stringify(entries)),
      stopEvidence: 'operator-declaration-only',
      purpose: 'source-preservation-not-runnable-migration',
    };
    mkdirSync(dirname(target), { recursive: true });
    const lock = `${target}.export-lock`;
    mkdirSync(lock, { mode: 0o700 });
    let staging: string | undefined;
    try {
      if (existsSync(target)) {
        if (lstatSync(target).isSymbolicLink())
          throw Error('source-archive-target-symlink-rejected');
        const existing = verifyCanonicalSocietyArchive(target);
        if (!isDeepStrictEqual(existing, metadata)) throw Error('source-archive-source-changed');
        return existing;
      }
      staging = mkdtempSync(join(dirname(target), `.${basename(target)}.exporting-`));
      cpSync(source, join(staging, 'source'), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      if (
        !isDeepStrictEqual(tree(join(staging, 'source')), entries) ||
        !isDeepStrictEqual(tree(source), entries)
      )
        throw Error('source-changed-during-archive');
      writeFileSync(join(staging, 'archive.json'), JSON.stringify(metadata, null, 2) + '\n', {
        mode: 0o600,
      });
      verifyCanonicalSocietyArchive(staging);
      for (const entry of [...entries].reverse()) sync(join(staging, 'source', entry.path));
      sync(join(staging, 'source'));
      sync(join(staging, 'archive.json'));
      sync(staging);
      if (!isDeepStrictEqual(tree(source), entries)) throw Error('source-changed-during-archive');
      if (existsSync(target)) throw Error('source-archive-target-appeared');
      renameSync(staging, target);
      staging = undefined;
      sync(dirname(target));
      return metadata;
    } finally {
      if (staging) rmSync(staging, { recursive: true, force: true });
      rmSync(lock, { recursive: true });
    }
  } finally {
    ownership.release();
  }
}

/** Caller holds source ownership. Compare complete bytes, including unknown files, before cutover. */
export function assertCanonicalSourceMatchesArchive(
  sourceRoot: string,
  archive: CanonicalSocietyArchive,
): void {
  if (
    realpathSync(sourceRoot) !== archive.sourceRoot ||
    !isDeepStrictEqual(tree(sourceRoot), archive.entries)
  )
    throw new Error('canonical-cutover-source-changed');
}
