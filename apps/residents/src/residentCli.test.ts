import { posix } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  OPEN_SOCIETY_TOOLS,
  createOpenSocietyManifest,
  RESIDENT_CLI_VERSION,
  RESIDENT_SKILL_VERSION,
} from '@aivilization/worker';
import { RESIDENT_COMMANDS, flagName, commandHelp } from './cliCatalog';
import { parseResidentCommand } from './commandLine';
import { parseCliFlags, runResidentCli } from './residentCli';
import { residentSkillPages } from './residentSkill';
import { residentCliContext } from './cliContext';
import { residentCliResult } from './cliResult';

const connection = { endpoint: 'http://127.0.0.1:12345', token: 'test-resident-token' };
afterEach(() => vi.unstubAllGlobals());

test('all registered capabilities have unique executable CLI routes with typed HTTP arguments', async () => {
  expect(RESIDENT_COMMANDS).toHaveLength(237);
  expect(new Set(RESIDENT_COMMANDS.map((command) => command.route)).size).toBe(
    OPEN_SOCIETY_TOOLS.length,
  );
  const received: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('expected-string-body');
      received.push(JSON.parse(init.body) as unknown);
      return Promise.resolve(Response.json({ ok: true, revision: 1, simulationTime: 0 }));
    }),
  );
  for (const { route, definition } of RESIDENT_COMMANDS) {
    const args: Record<string, unknown> = {};
    const flags: string[] = [];
    for (const name of definition.inputSchema.required) {
      const property = definition.inputSchema.properties[name]!;
      const value =
        property.type === 'array'
          ? ['a', 'b']
          : property.type === 'object'
            ? { literal: '原文 $ 不执行' }
            : property.type === 'boolean'
              ? true
              : ['number', 'integer'].includes(property.type)
                ? (property.minimum ?? 0)
                : (property.enum?.[0] ?? 'literal');
      args[name] = value;
      for (const item of Array.isArray(value) ? value : [value])
        flags.push(
          `--${flagName(name)}`,
          typeof item === 'object' ? JSON.stringify(item) : String(item),
        );
    }
    const result = await runResidentCli(
      [...route.split(' '), ...flags, '--request-id', 'route-test'],
      connection,
    );
    expect(result.exitCode, route).toBe(0);
    expect(received.at(-1)).toEqual({
      name: definition.name,
      arguments: args,
      requestId: 'route-test',
    });
  }
});

test('structured CLI parameters preserve JSON and refuse invalid objects without shell evaluation', async () => {
  const definition = RESIDENT_COMMANDS.find(
    (c) => c.definition.name === 'records.append',
  )!.definition;
  const values = { note: '原文 $(whoami); $HOME', amount: 5 };
  const argv = parseResidentCommand(
    `town records append --register-id journal --values '${JSON.stringify(values)}'`,
  );
  expect((await parseCliFlags(definition, argv.slice(2))).args.values).toEqual(values);
  for (const invalid of ['null', '[]', '{broken'])
    await expect(
      parseCliFlags(definition, ['--register-id', 'journal', '--values', invalid]),
    ).rejects.toThrow();
});

test.each([
  'whoami',
  'node --version',
  'TOWN_RESIDENT_TOKEN=other town context',
  'town context; whoami',
  'town context && town context',
  'town context | cat',
  'town context > /tmp/escape',
  'town context\nwhoami',
  'town context $(whoami)',
  'town context `whoami`',
  'town files create --content "$HOME"',
  'town files create --content "$(whoami)"',
  "town files create --content 'unclosed",
  '/bin/sh -c town',
  'town context < /etc/passwd',
])('command executor rejects unsupported host execution: %s', (command) => {
  expect(() => parseResidentCommand(command)).toThrow();
});

test('quoted originals are literal and preserve whitespace, multiline content and escaped quotes', () => {
  const original = '  原文\n$(whoami); `cat` $HOME && <tag> \\n "他说" \'结束\'  ';
  const quoted = `'${original.replaceAll("'", "'\\''")}'`;
  expect(parseResidentCommand(`town files create --content ${quoted}`)).toEqual([
    'files',
    'create',
    '--content',
    original,
  ]);
  expect(parseResidentCommand('town files create --content "a\\nb"')).toEqual([
    'files',
    'create',
    '--content',
    'a\\nb',
  ]);
});

test('invalid flags, bounds, duplicates and booleans are rejected before dispatch', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const args of [
    ['bank', 'borrow', '--amount', 'NaN'],
    ['bank', 'borrow', '--amount', 'Infinity'],
    ['bank', 'borrow', '--amount', '-1'],
    ['bank', 'borrow', '--amount', ''],
    ['bank', 'borrow', '--amount', '1', '--amount', '2'],
    ['bank', 'borrow', '--amount', '1', '--actor-id', 'other'],
    ['files', 'read', '--space-id', 'x'],
    ['schedule', 'list', '--limit', '31'],
    ['schedule', 'list', '--offset', '0.5'],
  ])
    expect((await runResidentCli(args, connection)).exitCode).toBe(2);
  expect(fetch).not.toHaveBeenCalled();
  const cognition = RESIDENT_COMMANDS.find(
    (command) => command.route === 'cognition update',
  )!.definition;
  const flags = [
    '--key',
    'belief',
    '--kind',
    'belief',
    '--statement',
    'maybe',
    '--confidence',
    '0.5',
    '--expected-revision',
    '0',
    '--active',
    'false',
  ];
  expect((await parseCliFlags(cognition, flags)).args).toMatchObject({
    active: false,
    evidenceIds: [],
  });
  await expect(parseCliFlags(cognition, [...flags.slice(0, -1), 'yes'])).rejects.toThrow(
    'invalid-boolean',
  );
});

test('transport uncertainty returns the idempotency key instead of inventing success', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('timeout'))),
  );
  const result = await runResidentCli(
    ['bank', 'deposit', '--amount', '1', '--request-id', 'uncertain'],
    connection,
  );
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.output)).toMatchObject({
    ok: false,
    requestId: 'uncertain',
    outcome: 'unknown-check-and-retry-identical-request',
  });
});

test('Skill links resolve, every capability has documentation, and pages are bounded', async () => {
  const pages = residentSkillPages();
  expect(pages['SKILL.md']!.length).toBeLessThan(2000);
  for (const [path, page] of Object.entries(pages)) {
    expect(page.length, path).toBeLessThan(18_000);
    for (const link of page.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const resolved = posix.normalize(posix.join(posix.dirname(path), link[1]!));
      expect(Object.hasOwn(pages, resolved), `${path} -> ${resolved}`).toBe(true);
    }
  }
  for (const { route } of RESIDENT_COMMANDS)
    expect(pages[`commands/${route.split(' ')[0]}.md`]).toContain(`town ${route}`);
  expect((await runResidentCli(['wiki', '../../credentials.json'], connection)).exitCode).toBe(2);
  expect((await runResidentCli(['wiki', 'apps/shops.md'], connection)).output).toContain(
    'town apps publish',
  );
});

test('context replaces interface hints without rewriting resident original text', () => {
  const original = '我在旧记录里写过 files.create 和 town_invoke';
  const context = residentCliContext({
    capabilities: ['files'],
    contract: ['old'],
    cognition: { items: [{ statement: original, expandedBy: 'cognition.list' }] },
    memories: { items: [{ summary: original }] },
    publicServices: { readWith: 'files.read' },
  });
  expect(context).not.toHaveProperty('capabilities');
  expect(context.cognition.items[0]).toEqual({
    statement: original,
    expandedBy: 'town cognition list',
  });
  expect(context.memories).toMatchObject({ items: [{ summary: original }] });
  expect(context.publicServices).toMatchObject({ browsePostsWith: 'town files index' });
  expect(RESIDENT_COMMANDS.some((command) => command.route === 'files index')).toBe(true);
});

test('result navigation becomes executable CLI arguments without interpreting originals', () => {
  const item = {
    spaceId: 'app-shops',
    path: 'posts/test.md',
    title: 'files.read',
    read: { capability: 'files.read', arguments: {} },
  };
  expect(residentCliResult('files.index', { ok: true, data: { items: [item] } })).toMatchObject({
    data: {
      items: [
        {
          title: 'files.read',
          read: {
            command: 'town',
            argv: ['files', 'read', '--space-id', 'app-shops', '--path', 'posts/test.md'],
          },
        },
      ],
    },
  });
  const document = {
    ok: true,
    data: { content: 'files.read', items: [{ expandedBy: 'made-up-original' }] },
  };
  expect(residentCliResult('files.read', document)).toBe(document);
});

test('new manifest and generated Skill share the actual adapter version contract', () => {
  const manifest = createOpenSocietyManifest({ count: 1 });
  expect(manifest.provenance.residentSkill).toBe(RESIDENT_SKILL_VERSION);
  expect(manifest.provenance.transport).toBe(RESIDENT_CLI_VERSION);
  expect(residentSkillPages()['SKILL.md']).toContain(RESIDENT_SKILL_VERSION);
});

test('array help explains omission while CLI preserves an explicitly empty string as an item', async () => {
  const c = RESIDENT_COMMANDS.find((c) => c.route === 'cognition update')!;
  expect(commandHelp(c)).toContain('--evidence-ids <array> (optional flag; omitted means [])');
  const flags = [
    '--key',
    'goal',
    '--kind',
    'goal',
    '--statement',
    'An independent goal',
    '--confidence',
    '0.7',
    '--expected-revision',
    '0',
    '--active',
    'true',
  ];
  expect((await parseCliFlags(c.definition, flags)).args.evidenceIds).toEqual([]);
  expect(
    (await parseCliFlags(c.definition, [...flags, '--evidence-ids', ''])).args.evidenceIds,
  ).toEqual(['']);
});

test('production requires explicit workers rather than help promising that an empty worker list works', async () => {
  for (const operation of ['gather', 'create']) {
    const c = RESIDENT_COMMANDS.find((c) => c.route === `production ${operation}`)!;
    expect(commandHelp(c)).toContain('--workers <array> (required)');
    expect(commandHelp(c)).toContain('minItems=1');
    const flags = [
      '--id',
      'batch',
      '--stock-id',
      'stock',
      '--expected-revision',
      '1',
      '--quantity',
      '1',
      '--product-name',
      'Food',
      '--description',
      'My purpose',
      ...(operation === 'gather'
        ? ['--source-id', 'source-apple', '--source-revision', '1']
        : ['--recipe-id', 'bread']),
    ];
    await expect(parseCliFlags(c.definition, flags)).rejects.toThrow('missing-argument:workers');
    expect(
      (await parseCliFlags(c.definition, [...flags, '--workers', 'resident-001'])).args.workers,
    ).toEqual(['resident-001']);
  }
});

test('every known command gives an executable local repair entry without sending invalid input', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const command of RESIDENT_COMMANDS) {
    const result = await runResidentCli(
      [...command.route.split(' '), '--not-a-real-option', 'x'],
      connection,
    );
    expect(result.exitCode).toBe(2);
    const error = JSON.parse(result.output) as { error: string; help: string };
    expect(error.error).toBe('unknown-flag:--not-a-real-option');
    expect(error.help).toBe(`town ${command.route} --help`);
    const expanded = await runResidentCli(parseResidentCommand(error.help));
    expect(expanded.exitCode).toBe(0);
    expect(expanded.output).toBe(commandHelp(command));
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('unknown operations use only a registered group repair entry and never invent commands', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const [args, help] of [
    [['files', 'invented'], 'town help files'],
    [['invented', 'operation'], 'town help'],
    [['messages', 'read', 'positional-id'], 'town messages read --help'],
  ] as const) {
    const rejected = await runResidentCli(args, connection);
    expect(rejected.exitCode).toBe(2);
    expect(JSON.parse(rejected.output)).toMatchObject({ ok: false, help });
    expect((await runResidentCli(parseResidentCommand(help))).exitCode).toBe(0);
  }
  expect(fetch).not.toHaveBeenCalled();
});
