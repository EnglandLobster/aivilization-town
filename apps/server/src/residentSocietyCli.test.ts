import { expect, test } from 'vitest';
import { resolveResidentSocietyCli } from './residentSocietyCli';
test('explicit resident mode requires existing root and rejects unknown/canonical flags and invalid budgets', () => {
  expect(resolveResidentSocietyCli(['--help'])).toEqual({ help: true });
  expect(
    resolveResidentSocietyCli([
      '--root',
      '/tmp/example',
      '--port',
      '0',
      '--max-opportunities',
      '2',
    ]),
  ).toMatchObject({ help: false, options: { root: '/tmp/example', port: 0, maxOpportunities: 2 } });
  for (const args of [
    [],
    ['--root', '/tmp/a', '--port', '-1'],
    ['--root', '/tmp/a', '--max-opportunities', '0'],
    ['--root', '/tmp/a', '--planner-variant', 'default'],
  ])
    expect(() => resolveResidentSocietyCli(args)).toThrow();
});
