import type { AgentCycleTrace } from '@aivilization/observability';
import { existsSync, readFileSync } from 'node:fs';
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

export function createTownWebAssets(): readonly TownWebAsset[] {
  const html = readWebAsset('index.html');
  const css = readWebAsset('app.css');
  const javascript = readWebAsset('app.js');
  const townMap = readBinaryWebAsset('assets/town-map.png');
  return [
    {
      path: '/',
      contentType: 'text/html; charset=utf-8',
      body: html,
      cacheControl: 'no-store',
    },
    {
      path: '/ui',
      contentType: 'text/html; charset=utf-8',
      body: html,
      cacheControl: 'no-store',
    },
    {
      path: '/ui/app.css',
      contentType: 'text/css; charset=utf-8',
      body: css,
      cacheControl: 'no-cache',
    },
    {
      path: '/ui/app.js',
      contentType: 'text/javascript; charset=utf-8',
      body: javascript,
      cacheControl: 'no-cache',
    },
    {
      path: '/ui/assets/town-map.png',
      contentType: 'image/png',
      body: townMap,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  ];
}

function readWebAsset(fileName: string): string {
  return readFileSync(resolveWebAsset(fileName), 'utf8');
}

function readBinaryWebAsset(fileName: string): Uint8Array {
  return readFileSync(resolveWebAsset(fileName));
}

function resolveWebAsset(fileName: string): string {
  const candidates = [
    new URL(`./${fileName}`, import.meta.url),
    new URL(`../public/${fileName}`, import.meta.url),
  ];
  const asset = candidates.find((candidate) => existsSync(candidate));
  if (asset === undefined) {
    throw new Error(`town web asset not found: ${fileName}`);
  }
  return fileURLToPath(asset);
}
