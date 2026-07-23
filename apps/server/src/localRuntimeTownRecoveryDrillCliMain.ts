import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { resolveLocalRuntimeTownCliConfig } from './localRuntimeTownCli';
import { runLocalRuntimeTownRecoveryDrill } from './localRuntimeTownRecoveryDrill';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`Usage:
  pnpm --filter @aivilization/server recovery-drill
  pnpm --filter @aivilization/server recovery-drill -- \\
    --root-dir /path/to/non-production-copy --confirm-non-production-copy

Without --root-dir, the drill creates a new temporary durable root and preserves it for evidence.
An explicit root is rejected unless --confirm-non-production-copy is present. Never target a live root.
`);
} else {
  try {
    const options = parseOptions(argv);
    const rootDir =
      options.rootDir === undefined
        ? mkdtempSync(join(tmpdir(), 'aivilization-runtime-recovery-drill-'))
        : isAbsolute(options.rootDir)
          ? options.rootDir
          : resolve(process.cwd(), options.rootDir);
    if (options.rootDir !== undefined && !options.confirmNonProductionCopy) {
      throw new Error(
        '--root-dir requires --confirm-non-production-copy; recovery drills must never mutate a live root',
      );
    }
    const config = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--llm-mode',
        'deterministic',
        '--profile',
        'recovery-drill-25',
        '--root-dir',
        rootDir,
        '--port',
        '0',
      ],
    });
    const artifact = await runLocalRuntimeTownRecoveryDrill({
      rootDir,
      sourceRevision: config.sourceRevision,
    });
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseOptions(argv: readonly string[]): {
  readonly rootDir?: string;
  readonly confirmNonProductionCopy: boolean;
} {
  let rootDir: string | undefined;
  let confirmNonProductionCopy = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === '--') {
      continue;
    }
    if (token === '--confirm-non-production-copy') {
      confirmNonProductionCopy = true;
      continue;
    }
    if (token === '--root-dir' || token.startsWith('--root-dir=')) {
      if (rootDir !== undefined) {
        throw new Error('--root-dir cannot be repeated');
      }
      const inline = token.startsWith('--root-dir=')
        ? token.slice('--root-dir='.length)
        : undefined;
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
        throw new Error('--root-dir requires a non-empty value');
      }
      rootDir = value;
      if (inline === undefined) {
        index += 1;
      }
      continue;
    }
    throw new Error(`unknown recovery drill option ${token}`);
  }
  return {
    ...(rootDir === undefined ? {} : { rootDir }),
    confirmNonProductionCopy,
  };
}
