import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { startResidentSocietyDaemon } from '@aivilization/residents';

export const RESIDENT_SOCIETY_CLI_HELP = `resident-society --root DIR [--port 4320] [--model PROVIDER/MODEL] [--timeout 180000] [--max-opportunities N]
Runs autonomous OpenCode residents through the original identity-bound town CLI and complete society journal.
DIR must already contain an explicitly initialized open society manifest; canonical data is never implicitly migrated.
No task/story is injected. Provider failure stops this process for inspection. SIGINT/SIGTERM stops the provider before releasing the writer.
The existing canonical planner remains the default without the resident-society subcommand.
This is single-writer daemon integration, not multi-host partition support.
`;
export function resolveResidentSocietyCli(argv: readonly string[]) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      port: { type: 'string', default: '4320' },
      model: { type: 'string', default: 'opencode-go/deepseek-v4.1-flash' },
      timeout: { type: 'string', default: '180000' },
      'max-opportunities': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (positionals.length) throw Error('unexpected-resident-society-argument');
  if (values.help) return { help: true as const };
  if (!values.root?.trim()) throw Error('resident-society-root-required');
  const integer = (s: string, min: number, max: number) => {
    if (!/^\d+$/.test(s)) throw Error('invalid-resident-society-integer');
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw Error('invalid-resident-society-integer');
    return n;
  };
  return {
    help: false as const,
    options: {
      root: resolve(values.root),
      model: values.model,
      port: integer(values.port, 0, 65535),
      timeoutMs: integer(values.timeout, 1000, 600000),
      ...(values['max-opportunities'] === undefined
        ? {}
        : { maxOpportunities: integer(values['max-opportunities'], 1, 1000000) }),
    },
  };
}
export async function runResidentSocietyCli(argv: readonly string[]) {
  const config = resolveResidentSocietyCli(argv);
  if (config.help) {
    console.log(RESIDENT_SOCIETY_CLI_HELP);
    return;
  }
  const application = await startResidentSocietyDaemon({
    ...config.options,
    onProgress: (event) => console.log(JSON.stringify({ event: 'resident-opportunity', ...event })),
  });
  const stop = () => {
    void application.stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log(
      JSON.stringify({
        event: 'resident-society-started',
        version: application.version,
        url: application.url,
        root: config.options.root,
      }),
    );
    const outcome = await application.done;
    console.log(JSON.stringify({ event: 'resident-society-finished', ...outcome }));
    if (outcome.status === 'provider-error') process.exitCode = 1;
  } finally {
    try {
      await application.stop();
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
