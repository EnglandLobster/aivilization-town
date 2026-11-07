import { afterEach, expect, test, vi } from 'vitest';
import { findResidentCapabilities } from './capabilityDiscovery';
import { runResidentCli } from './residentCli';

afterEach(() => vi.unstubAllGlobals());

test('offline keyword discovery finds actual commands, parameters and Chinese authored guides', async () => {
  const fetch = vi.fn(() => {
    throw new Error('discovery-must-not-use-network');
  });
  vi.stubGlobal('fetch', fetch);
  const commands = findResidentCapabilities(['records append', '--kind', 'command']);
  expect(commands.items).toContainEqual(
    expect.objectContaining({ name: 'town records append', mutating: true }),
  );
  expect(
    findResidentCapabilities(['expected-revision', '--kind', 'command']).total,
  ).toBeGreaterThan(0);
  const pages = findResidentCapabilities(['共同记录', '--kind', 'page']);
  expect(pages.total).toBeGreaterThan(0);
  expect(pages.items.every((i) => i.kind === 'page' && !i.name.startsWith('commands/'))).toBe(true);
  for (const item of [...commands.items, ...pages.items]) {
    const help = await runResidentCli(item.helpWith.split(' ').slice(1));
    expect(help.exitCode, item.helpWith).toBe(0);
    expect(help.output.length).toBeGreaterThan(0);
  }
  const result = await runResidentCli(['find', 'records append']);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.output)).toMatchObject({
    availability: 'documentation-only-check-current-world-and-authorization',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test('bounded pages cover every result exactly once in stable order', () => {
  const names: string[] = [];
  let offset: number | null = 0;
  const first = findResidentCapabilities(['town', '--limit', '7']);
  while (offset !== null) {
    const page = findResidentCapabilities(['town', '--limit', '7', '--offset', String(offset)]);
    expect(page.items.length).toBeLessThanOrEqual(7);
    expect(page.items.every((i) => i.excerpt.length <= 240)).toBe(true);
    names.push(...page.items.map((i) => `${i.kind}:${i.name}`));
    offset = page.nextOffset;
  }
  expect(names.length).toBe(first.total);
  expect(new Set(names).size).toBe(first.total);
  expect(findResidentCapabilities(['ＴＯＷＮ', '--limit', '7'])).toEqual({
    ...first,
    query: 'ＴＯＷＮ',
  });
  expect(findResidentCapabilities(['town', '--offset', String(first.total)]).items).toEqual([]);
});

test('a real model over-specific query returns transparent partial matches instead of an empty catalogue', () => {
  const result = findResidentCapabilities([
    'shared record book field permission',
    '--kind',
    'command',
  ]);
  expect(result.matching).toBe('partial-terms');
  expect(result.items).toContainEqual(expect.objectContaining({ name: 'town registers create' }));
  expect(result.items.every((i) => i.matchedTerms.length > 0 && i.matchedTerms.length < 5)).toBe(
    true,
  );
  const exact = findResidentCapabilities(['registers create', '--kind', 'command']);
  expect(exact.matching).toBe('all-terms');
  expect(exact.items.every((i) => i.matchedTerms.length === 2)).toBe(true);
});

test('no match stays empty rather than inventing a capability or executing query text', async () => {
  const result = await runResidentCli(['find', 'nonexistent-capability-9891 $(whoami)']);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.output)).toMatchObject({ total: 0, items: [], nextOffset: null });
  expect((await runResidentCli(['help', 'find'])).output).toContain('documentation');
  expect((await runResidentCli([])).output).toContain('town find');
});

test('invalid discovery arguments reject before lookup or transport', async () => {
  for (const args of [
    [''],
    ['a'.repeat(161)],
    ['a b c d e f g h i'],
    ['town', '--limit', '21'],
    ['town', '--limit', '0'],
    ['town', '--offset', '-1'],
    ['town', '--offset', '1.5'],
    ['town', '--offset', '9007199254740992'],
    ['town', '--kind', 'resident'],
    ['town', '--limit'],
    ['town', '--limit', '2', '--limit', '3'],
    ['town', '--actor-id', 'other'],
  ]) {
    const result = await runResidentCli(['find', ...args]);
    expect(result.exitCode, JSON.stringify(args)).toBe(2);
  }
});
