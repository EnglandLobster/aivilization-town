import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseResidentCommand } from './commandLine';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '-c') throw new Error('expected-single-command');
  const argv = parseResidentCommand(args[1]!);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./town.js', import.meta.url)), ...argv],
    {
      shell: false,
      // CLI never inherits model/provider credentials or arbitrary executable hooks.
      env: {
        TOWN_ENDPOINT: process.env.TOWN_ENDPOINT,
        TOWN_RESIDENT_TOKEN: process.env.TOWN_RESIDENT_TOKEN,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  child.once('error', () => {
    process.stderr.write('town-cli-spawn-failed\n');
    process.exitCode = 2;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 2;
  });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'invalid-command' })}\n`,
  );
  process.exitCode = 2;
}
