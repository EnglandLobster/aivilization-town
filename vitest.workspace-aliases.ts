import { fileURLToPath } from 'node:url';

const workspaceRoot = new URL('./', import.meta.url);

export const workspaceAliases = {
  '@aivilization/agent-runtime': fileURLToPath(
    new URL('packages/agent-runtime/src/index.ts', workspaceRoot),
  ),
  '@aivilization/content': fileURLToPath(new URL('packages/content/src/index.ts', workspaceRoot)),
  '@aivilization/economy': fileURLToPath(new URL('packages/economy/src/index.ts', workspaceRoot)),
  '@aivilization/llm': fileURLToPath(new URL('packages/llm/src/index.ts', workspaceRoot)),
  '@aivilization/memory': fileURLToPath(new URL('packages/memory/src/index.ts', workspaceRoot)),
  '@aivilization/observability': fileURLToPath(
    new URL('packages/observability/src/index.ts', workspaceRoot),
  ),
  '@aivilization/sim-core': fileURLToPath(new URL('packages/sim-core/src/index.ts', workspaceRoot)),
  '@aivilization/society': fileURLToPath(new URL('packages/society/src/index.ts', workspaceRoot)),
  '@aivilization/world': fileURLToPath(new URL('packages/world/src/index.ts', workspaceRoot)),
} as const;
