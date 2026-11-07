import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import {
  SUPPORTED_OPENCODE_VERSION,
  assertCompatibleOpenCode,
  pinnedOpenCodeExecutable,
  residentOpenCodeExecutable,
} from './openCodeExecutable';

test('the pinned OpenCode release is installed with the package and is the default', () => {
  const pinned = pinnedOpenCodeExecutable();
  expect(pinned).toBeDefined();
  expect(execFileSync(pinned!, ['--version'], { encoding: 'utf8' }).trim()).toBe(
    SUPPORTED_OPENCODE_VERSION,
  );
  expect(residentOpenCodeExecutable()).toBe(pinned);
  expect(residentOpenCodeExecutable('/explicit/opencode')).toBe('/explicit/opencode');
});

test('known-incompatible OpenCode releases are refused; fixtures are not', () => {
  expect(() => assertCompatibleOpenCode('2.0.29')).toThrow('unsupported-opencode-version:2.0.29');
  expect(() => assertCompatibleOpenCode('v3.1.0\n')).toThrow('unsupported-opencode-version');
  // The format the PATH OpenCode 2 actually prints.
  expect(() => assertCompatibleOpenCode('opencode v2.0.29')).toThrow(
    'unsupported-opencode-version:opencode v2.0.29',
  );
  for (const ok of ['1.18.31', '1.2.0', 'controlled-fixture', '1.18.31-fake'])
    expect(() => assertCompatibleOpenCode(ok)).not.toThrow();
});
