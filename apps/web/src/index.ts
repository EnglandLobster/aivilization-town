import type { AgentCycleTrace } from '@aivilization/observability';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export type TownWebAsset = {
  readonly path: string;
  readonly contentType: string;
  readonly body: string | Uint8Array;
  readonly cacheControl: string;
};
export type WebInspectionPanelContract = {
  readonly selectedTrace?: AgentCycleTrace;
  readonly showsPlannerInternals: true;
};
/** Production and tests serve the same Vite output through the same-origin gateway. */
export function createTownWebAssets(): readonly TownWebAsset[] {
  const directory = [
    new URL('./client/', import.meta.url),
    new URL('../dist/client/', import.meta.url),
  ].find((candidate) => existsSync(new URL('index.html', candidate)));
  if (!directory)
    throw new Error('Town client is not built. Run pnpm --filter @aivilization/web build.');
  const root = fileURLToPath(directory),
    html = readFileSync(new URL('index.html', directory), 'utf8');
  return [
    ...['/', '/ui', '/ui/'].map((path) => ({
      path,
      contentType: 'text/html; charset=utf-8',
      body: html,
      cacheControl: 'no-store',
    })),
    ...readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile())
      .flatMap((file) => {
        const name = relative(root, join(file.parentPath, file.name)).replaceAll('\\', '/');
        // Internal manifests and source maps are not application routes.
        if (!name.startsWith('assets/') || name.endsWith('.map')) return [];
        const extension = name.slice(name.lastIndexOf('.'));
        const types: Record<string, string> = {
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        };
        return [
          {
            path: `/ui/${name}`,
            contentType: types[extension] ?? 'application/octet-stream',
            body: readFileSync(join(root, name)),
            cacheControl: 'public, max-age=31536000, immutable',
          },
        ];
      }),
  ];
}
