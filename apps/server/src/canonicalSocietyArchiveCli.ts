import { exportCanonicalSocietyArchive } from './canonicalSocietyArchive';
export const CANONICAL_SOCIETY_ARCHIVE_HELP = `export-society-source --source DIR --target NEW_DIR --confirm-source-stopped
Preserve a complete offline canonical source tree with hashes. Stop confirmation is an operator declaration,
not proof of a writer fence. This archive is not a runnable migrated society; source data is never rewritten.`;
export function runCanonicalSocietyArchiveCli(args: readonly string[]) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(CANONICAL_SOCIETY_ARCHIVE_HELP);
    return;
  }
  const options = new Map<string, string>();
  let confirmed = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--confirm-source-stopped' && !confirmed) {
      confirmed = true;
      continue;
    }
    if ((key !== '--source' && key !== '--target') || options.has(key))
      throw Error('invalid-source-archive-option');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw Error('source-archive-option-value-required');
    options.set(key, value);
  }
  const sourceRoot = options.get('--source'),
    targetRoot = options.get('--target');
  if (!confirmed || !sourceRoot || !targetRoot)
    throw Error('source-target-and-stop-declaration-required');
  const result = exportCanonicalSocietyArchive({
    sourceRoot,
    targetRoot,
    sourceWriterConfirmedStopped: true,
  });
  console.log(
    JSON.stringify({
      version: result.version,
      sourceRoot: result.sourceRoot,
      sourceTreeSha256: result.sourceTreeSha256,
      entries: result.entries.length,
      stopEvidence: result.stopEvidence,
      purpose: result.purpose,
    }),
  );
}
