import { expect, test } from 'vitest';
import { CLI_GROUPS, RESIDENT_COMMANDS } from './cliCatalog';
import {
  CLI_GUIDE_AREAS,
  EVERYDAY_COMMANDS,
  capabilityIndexPage,
  cliOverview,
  groupPlain,
} from './cliGuide';
import { runResidentCli } from './residentCli';

test('every CLI group has exactly one plain description and every everyday command exists', () => {
  const described = CLI_GUIDE_AREAS.flatMap((area) => area.groups.map((g) => g.group));
  expect([...described].sort()).toEqual([...CLI_GROUPS].sort());
  expect(new Set(described).size).toBe(described.length);
  const routes = new Set(RESIDENT_COMMANDS.map((command) => command.route));
  for (const { route } of EVERYDAY_COMMANDS) expect(routes, route).toContain(route);
  for (const group of CLI_GROUPS) expect(groupPlain(group)).toBeTruthy();
});

test('town help shows groups by area with their purpose and stays compact', async () => {
  const result = await runResidentCli(['help'], { endpoint: 'http://127.0.0.1:1', token: 't' });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(cliOverview());
  expect(result.output).toContain('town business found — 开一家公司');
  expect(result.output.length).toBeLessThan(4000);
  const business = await runResidentCli(['help', 'business'], {
    endpoint: 'http://127.0.0.1:1',
    token: 't',
  });
  expect(business.output.split('\n')[0]).toBe(`business: ${groupPlain('business')}`);
  expect(capabilityIndexPage()).toContain('## 组织与公共事务');
});
