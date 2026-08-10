import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createGitWorkspaceFingerprint,
  resolveLocalRuntimeTownSourceRevision,
} from './localRuntimeTownSourceRevision';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('local runtime town source revision', () => {
  test('content-addresses tracked and untracked nonignored source while excluding ignored runtime data', () => {
    const root = createGitRepository();
    const clean = resolveLocalRuntimeTownSourceRevision({ env: {}, cwd: root });
    expect(clean).toMatchObject({ dirty: false });
    expect(clean.workspaceFingerprint).toBeUndefined();

    writeFileSync(join(root, 'tracked.txt'), 'tracked-v2\n');
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v1\n');
    mkdirSync(join(root, '.runtime'));
    writeFileSync(join(root, '.runtime', 'ignored.txt'), 'ignored-v1\n');

    const first = resolveLocalRuntimeTownSourceRevision({ env: {}, cwd: join(root, 'nested') });
    const repeated = createGitWorkspaceFingerprint(root);
    expect(first).toMatchObject({
      commit: clean.commit,
      dirty: true,
      workspaceFingerprint: repeated,
    });

    writeFileSync(join(root, '.runtime', 'ignored.txt'), 'ignored-v2\n');
    expect(createGitWorkspaceFingerprint(root)).toEqual(repeated);

    writeFileSync(join(root, 'untracked.txt'), 'untracked-v2\n');
    expect(createGitWorkspaceFingerprint(root).sha256).not.toBe(repeated.sha256);
  });

  test('requires a packaged workspace fingerprint for dirty source metadata', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    expect(() =>
      resolveLocalRuntimeTownSourceRevision({
        cwd: '/workspace',
        env: { AIVILIZATION_COMMIT: commit, AIVILIZATION_SOURCE_DIRTY: 'true' },
      }),
    ).toThrow('requires a content-addressed workspaceFingerprint');

    expect(
      resolveLocalRuntimeTownSourceRevision({
        cwd: '/workspace',
        env: {
          AIVILIZATION_COMMIT: commit,
          AIVILIZATION_SOURCE_DIRTY: 'true',
          AIVILIZATION_SOURCE_WORKSPACE_SHA256: 'a'.repeat(64),
          AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT: '17',
        },
      }),
    ).toMatchObject({
      commit,
      dirty: true,
      workspaceFingerprint: {
        policyVersion: 'git-workspace-fingerprint-v1',
        sha256: `sha256:${'a'.repeat(64)}`,
        pathCount: 17,
      },
    });
  });
});

function createGitRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-source-revision-'));
  roots.push(root);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, '.gitignore'), '.runtime/\n');
  writeFileSync(join(root, 'tracked.txt'), 'tracked-v1\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'source-revision@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Source Revision Test'], { cwd: root });
  execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}
