#!/usr/bin/env node
import { runResidentCli } from './residentCli';

try {
  const result = await runResidentCli(process.argv.slice(2), undefined, async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > 32_000) throw new Error('stdin-too-large');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString('utf8');
  });
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'cli-start-failed' })}\n`,
  );
  process.exitCode = 2;
}
