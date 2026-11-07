import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export type CanonicalSourceRetirement = {
  readonly version: 'canonical-source-retirement-v1';
  readonly sourceRoot: string;
  readonly sourceTreeSha256: string;
  readonly simulationId: string;
  readonly targetRoot: string;
  readonly targetManifestSha256: string;
};

function syncOwnershipPath(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Cooperative local-filesystem admission, not a fence against legacy/direct storage writers. */
export function acquireCanonicalRuntimeOwnership(root: string, mode: 'writer' | 'archive') {
  mkdirSync(root, { recursive: true });
  const canonicalRoot = realpathSync(root);
  // Outside the runtime tree: acquiring ownership must not change archived world bytes.
  const control = join(dirname(canonicalRoot), `.${basename(canonicalRoot)}.canonical-ownership`);
  mkdirSync(control, { recursive: true, mode: 0o700 });
  const gate = join(control, 'gate');
  const exclusive = join(control, 'archive.json');
  const writers = join(control, 'writers');
  const retirement = join(control, 'retired.json');
  const token = randomUUID();
  const record = JSON.stringify({
    version: 'canonical-runtime-ownership-v1',
    root: canonicalRoot,
    mode,
    token,
    pid: process.pid,
  });
  const guarded = <T>(operation: () => T): T => {
    try {
      mkdirSync(gate, { mode: 0o700 });
    } catch (error) {
      throw new Error('canonical-ownership-gate-unavailable', { cause: error });
    }
    try {
      return operation();
    } finally {
      rmdirSync(gate);
    }
  };
  const path = guarded(() => {
    if (mode === 'writer' && existsSync(retirement)) throw new Error('canonical-source-retired');
    mkdirSync(writers, { recursive: true, mode: 0o700 });
    if (existsSync(exclusive)) throw new Error('canonical-archive-owns-source');
    if (mode === 'archive' && readdirSync(writers).length)
      throw new Error('canonical-writers-active-or-unrecovered');
    const file = mode === 'archive' ? exclusive : join(writers, `${token}.json`);
    writeFileSync(file, record, { flag: 'wx', mode: 0o600 });
    syncOwnershipPath(file);
    syncOwnershipPath(dirname(file));
    syncOwnershipPath(control);
    return file;
  });
  let released = false;
  return {
    root: canonicalRoot,
    recordPath: path,
    /** Called by the migration coordinator after validation, before target publication.
     * Binding a target is not validation or activation of that target. Never revives the source.
     */
    retire(
      input: Omit<CanonicalSourceRetirement, 'version' | 'sourceRoot'>,
    ): CanonicalSourceRetirement {
      return guarded(() => {
        if (mode !== 'archive' || released)
          throw new Error('canonical-retirement-exclusive-owner-required');
        if (readFileSync(path, 'utf8') !== record)
          throw new Error('canonical-ownership-record-changed');
        if (readdirSync(writers).length) throw new Error('canonical-writers-active-or-unrecovered');
        if (
          !/^[a-f0-9]{64}$/.test(input.sourceTreeSha256) ||
          !/^[a-f0-9]{64}$/.test(input.targetManifestSha256) ||
          !input.simulationId.trim() ||
          !isAbsolute(input.targetRoot)
        )
          throw new Error('canonical-retirement-binding-invalid');
        const requested = resolve(input.targetRoot);
        const targetRoot = existsSync(requested)
          ? realpathSync(requested)
          : join(realpathSync(dirname(requested)), basename(requested));
        const contains = (parent: string, child: string) => {
          const rel = relative(parent, child);
          return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
        };
        if (contains(canonicalRoot, targetRoot) || contains(targetRoot, canonicalRoot))
          throw new Error('canonical-retirement-roots-overlap');
        const binding: CanonicalSourceRetirement = {
          version: 'canonical-source-retirement-v1',
          sourceRoot: canonicalRoot,
          simulationId: input.simulationId,
          sourceTreeSha256: input.sourceTreeSha256,
          targetRoot,
          targetManifestSha256: input.targetManifestSha256,
        };
        if (existsSync(retirement)) {
          const stored: unknown = JSON.parse(readFileSync(retirement, 'utf8'));
          if (!isDeepStrictEqual(stored, binding))
            throw new Error('canonical-retirement-binding-conflict');
        } else {
          // Any interrupted/partial marker remains a writer fence; never silently replace it.
          writeFileSync(retirement, JSON.stringify(binding) + '\n', { flag: 'wx', mode: 0o600 });
        }
        syncOwnershipPath(retirement);
        syncOwnershipPath(control);
        return binding;
      });
    },
    release(): void {
      if (released) return;
      guarded(() => {
        if (readFileSync(path, 'utf8') !== record)
          throw new Error('canonical-ownership-record-changed');
        unlinkSync(path);
        syncOwnershipPath(dirname(path));
        released = true;
      });
    },
  };
}
