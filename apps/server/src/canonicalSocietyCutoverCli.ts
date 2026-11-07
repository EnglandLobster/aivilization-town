import { readFileSync } from 'node:fs';
import { publishCanonicalSocietyCutover } from './canonicalSocietyCutover';
export const CANONICAL_SOCIETY_CUTOVER_HELP = `migrate-society --archive DIR --target NEW_DIR --simulation ID --run-manifest ID --source-options FILE --confirm-source-stopped
Source options JSON contains explicit policyConfiguration and consumerIds. Validates the frozen source,
permanently retires its cooperating canonical writers, then publishes an initial society continuation.
Does not implicitly enable new social policies. Repeating the same binding preserves target facts.`;
export async function runCanonicalSocietyCutoverCli(args: readonly string[]) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(CANONICAL_SOCIETY_CUTOVER_HELP);
    return;
  }
  const keys = new Set([
    '--archive',
    '--target',
    '--simulation',
    '--run-manifest',
    '--source-options',
  ]);
  const options = new Map<string, string>();
  let confirmed = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--confirm-source-stopped' && !confirmed) {
      confirmed = true;
      continue;
    }
    if (!keys.has(key) || options.has(key)) throw new Error('invalid-society-cutover-option');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('society-cutover-option-value-required');
    options.set(key, value);
  }
  if (!confirmed || options.size !== keys.size)
    throw new Error('society-cutover-options-and-stop-declaration-required');
  const parsed: unknown = JSON.parse(readFileSync(options.get('--source-options')!, 'utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !('policyConfiguration' in parsed) ||
    !('consumerIds' in parsed) ||
    Object.keys(parsed).some((k) => k !== 'policyConfiguration' && k !== 'consumerIds') ||
    !parsed.policyConfiguration ||
    typeof parsed.policyConfiguration !== 'object' ||
    Array.isArray(parsed.policyConfiguration) ||
    !parsed.consumerIds ||
    typeof parsed.consumerIds !== 'object' ||
    Array.isArray(parsed.consumerIds) ||
    Object.values(parsed.consumerIds).some((v) => typeof v !== 'string' || !v.trim())
  )
    throw new Error('invalid-society-source-options');
  // Fixed envelope validated above; domain policy keys/values and recorded consumers are checked by the reader.
  const sourceOptions = parsed as Pick<
    Parameters<typeof publishCanonicalSocietyCutover>[0],
    'policyConfiguration' | 'consumerIds'
  >;
  const result = await publishCanonicalSocietyCutover({
    ...sourceOptions,
    archiveRoot: options.get('--archive')!,
    targetRoot: options.get('--target')!,
    simulationId: options.get('--simulation')!,
    runManifestId: options.get('--run-manifest')!,
    sourceWriterConfirmedStopped: true,
  });
  console.log(JSON.stringify(result));
}
