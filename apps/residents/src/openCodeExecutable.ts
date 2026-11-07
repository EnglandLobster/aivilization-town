import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The OpenCode release the resident driver is written against: its `run` flags (`--pure`,
 * `--dir`, `--agent`), JSON event format and model routing. It is a dependency of this package, so
 * a fresh clone runs residents with the same driver instead of whatever `opencode` is on PATH.
 * OpenCode 2 removed `--pure` and `--dir` and does not route the residents' model.
 */
export const SUPPORTED_OPENCODE_VERSION = '1.18.31';

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime === undefined;
}

/** Path of the pinned OpenCode binary for this platform, or undefined if it is not installed. */
export function pinnedOpenCodeExecutable(): string | undefined {
  try {
    const own = createRequire(import.meta.url);
    const launcher = createRequire(own.resolve('opencode-ai/package.json'));
    const os = process.platform === 'win32' ? 'windows' : process.platform;
    const base = `opencode-${os}-${process.arch}`;
    // Same preference as the package's own installer: native build, then the baseline-CPU build.
    const names = isMusl() ? [`${base}-musl`, `${base}-baseline-musl`] : [base, `${base}-baseline`];
    for (const name of names) {
      try {
        const bin = join(
          dirname(launcher.resolve(`${name}/package.json`)),
          'bin',
          process.platform === 'win32' ? 'opencode.exe' : 'opencode',
        );
        if (existsSync(bin)) return bin;
      } catch {
        // Not installed for this platform; try the next variant.
      }
    }
  } catch {
    // The dependency is not installed (e.g. a trimmed deployment); fall back to PATH.
  }
  return undefined;
}

/** The executable residents run: an explicit choice, else the pinned binary, else PATH. */
export function residentOpenCodeExecutable(explicit?: string): string {
  return explicit ?? pinnedOpenCodeExecutable() ?? 'opencode';
}

/**
 * Refuse OpenCode releases known not to work with this driver. Versions that do not parse (test
 * fixtures) are allowed; a major version of 2 or later is not.
 */
export function assertCompatibleOpenCode(version: string): void {
  // Releases print "1.18.31" or "opencode v2.0.29".
  const major = /(?:^|\s)v?(\d+)\.\d+/.exec(version.trim())?.[1];
  if (major !== undefined && Number(major) >= 2)
    throw new Error(
      `unsupported-opencode-version:${version.trim()} (residents need ${SUPPORTED_OPENCODE_VERSION}; pass --opencode or run pnpm install)`,
    );
}

/** Read and check the version of the executable residents will run; for preflight before a run. */
export function preflightOpenCode(explicit?: string): { executable: string; version: string } {
  const executable = residentOpenCodeExecutable(explicit);
  const version = execFileSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  assertCompatibleOpenCode(version);
  return { executable, version };
}
