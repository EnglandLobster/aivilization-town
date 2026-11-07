import { createHash, randomUUID } from 'node:crypto';
import { cliOverview, groupPlain } from './cliGuide';
import type { OpenToolDefinition } from '@aivilization/agent-runtime';
import { parseCapabilityFlags } from '@aivilization/worker';
import { CLI_GROUPS, RESIDENT_COMMANDS, RESIDENT_CLI_VERSION, commandHelp } from './cliCatalog';
import { residentCliContext } from './cliContext';
import { residentSkillPages } from './residentSkill';
import { residentCliResult } from './cliResult';
import { DISCOVERY_HELP, findResidentCapabilities } from './capabilityDiscovery';
import { townRequest, townConnectionFromEnvironment, type TownConnection } from './townConnection';

export type CliOutput = { readonly exitCode: number; readonly output: string };
const output = (value: unknown, exitCode = 0): CliOutput => ({
  exitCode,
  output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
});
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected-object');
  return value as Record<string, unknown>;
};
export async function parseCliFlags(
  definition: OpenToolDefinition,
  flags: readonly string[],
  readStdin?: () => Promise<string>,
) {
  let requestId: string | undefined;
  let contentStdin = false;
  const rest: string[] = [];
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index]!;
    if (flag === '--content-stdin') {
      if (
        contentStdin ||
        rest.includes('--content') ||
        definition.inputSchema.properties.content === undefined
      )
        throw new Error('invalid-content-stdin');
      contentStdin = true;
      continue;
    }
    if (flag === '--request-id') {
      const value = flags[++index];
      if (value === undefined) throw new Error(`missing-value:${flag}`);
      if (requestId !== undefined || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))
        throw new Error('invalid-request-id');
      requestId = value;
      continue;
    }
    rest.push(flag);
    if (flag.startsWith('--') && index + 1 < flags.length) rest.push(flags[++index]!);
  }
  if (contentStdin && readStdin === undefined) throw new Error('stdin-not-available-use-content');
  const args = parseCapabilityFlags(definition, rest, {
    ...(contentStdin ? { preset: { content: await readStdin!() } } : {}),
  });
  return { args, requestId: requestId ?? randomUUID() };
}

async function invoke(
  connection: TownConnection,
  definition: OpenToolDefinition,
  flags: readonly string[],
  stdin?: () => Promise<string>,
): Promise<CliOutput> {
  const { args, requestId } = await parseCliFlags(definition, flags, stdin);
  try {
    const result = object(
      await townRequest(connection, '/invoke', {
        name: definition.name,
        arguments: args,
        requestId,
      }),
    );
    return output(
      { ...residentCliResult(definition.name, result), requestId },
      result.ok === false ? 1 : 0,
    );
  } catch (error) {
    return output(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'transport-error',
        requestId,
        outcome: 'unknown-check-and-retry-identical-request',
      },
      2,
    );
  }
}

const APPS_HELP = `town apps                         Installed applications and channels
town apps list --channel shops [--query text] [--tag tag] [--author-id id] [--related-to id] [--offset n] [--limit n]
town apps read --channel shops --path posts/filename.md
town apps publish --channel shops --content 'original text' [--title title] [--tags tag ...] [--related-to id] [--request-id id]
Channels: use short name (shops) or installed space ID (app-shops). No summaries or automatic settlement.
Publish preserves your original text. Reply by publishing with --related-to. See town wiki apps/index.md.
Edit/delete/history: town files <operation> --space-id app-shops --path ... (see --help).`;

async function appsCli(
  argv: readonly string[],
  connection: TownConnection,
  stdin?: () => Promise<string>,
): Promise<CliOutput> {
  if (argv.length === 1 && argv[0] === '--help') return output(APPS_HELP);
  const context = object(await townRequest(connection, '/context'));
  if (argv.length === 0)
    return output(
      context.publicServices ?? {
        apps: [],
        note: 'No city apps installed. You may create information spaces.',
      },
    );
  const [operation, ...flags] = argv;
  if (!['list', 'read', 'publish'].includes(operation!)) throw new Error('unknown-app-operation');
  if (flags.length === 1 && flags[0] === '--help') return output(APPS_HELP);
  const index = flags.indexOf('--channel');
  const channel = flags[index + 1];
  if (index < 0 || channel === undefined || flags.lastIndexOf('--channel') !== index)
    throw new Error('one-channel-required');
  const spaceId = channel.startsWith('app-') ? channel : `app-${channel}`;
  const services = object(context.publicServices ?? {});
  const apps = Array.isArray(services.apps) ? services.apps : [];
  const installed = apps.some((app: unknown) => {
    const channels = object(app).channels;
    return (
      Array.isArray(channels) && channels.some((item: unknown) => object(item).spaceId === spaceId)
    );
  });
  if (!installed) throw new Error('app-channel-not-installed');
  const rest = [...flags.slice(0, index), ...flags.slice(index + 2)];
  const capability =
    operation === 'list' ? 'files.index' : operation === 'read' ? 'files.read' : 'files.create';
  const definition = RESIDENT_COMMANDS.find(
    (command) => command.definition.name === capability,
  )!.definition;
  // Alias callers cannot override generated scope/path and escape into another channel.
  if (
    rest.includes('--space-id') ||
    (operation !== 'read' && rest.includes('--path')) ||
    rest.includes('--prefix')
  )
    throw new Error('app-scope-is-fixed');
  if (operation === 'publish') {
    const requestIndex = rest.indexOf('--request-id');
    const requestId = requestIndex < 0 ? randomUUID() : rest[requestIndex + 1];
    if (requestId === undefined) throw new Error('missing-request-id');
    if (requestIndex < 0) rest.push('--request-id', requestId);
    const identity = object(context.identity);
    const path = `posts/${String(identity.id)}-${createHash('sha256').update(requestId).digest('hex').slice(0, 24)}.md`;
    rest.push('--path', path);
  }
  if (operation === 'list') rest.push('--prefix', 'posts/');
  return invoke(connection, definition, ['--space-id', spaceId, ...rest], stdin);
}

export async function runResidentCli(
  argv: readonly string[],
  connection?: TownConnection,
  stdin?: () => Promise<string>,
): Promise<CliOutput> {
  const connected = () => connection ?? townConnectionFromEnvironment();
  let errorHelp = 'town help';
  try {
    if (argv.length === 1 && argv[0] === '--version') return output(RESIDENT_CLI_VERSION);
    if (argv[0] === 'find')
      return output(
        argv.length === 1 || (argv.length === 2 && argv[1] === '--help')
          ? DISCOVERY_HELP
          : findResidentCapabilities(argv.slice(1)),
      );
    if (argv.length === 2 && argv[0] === 'help' && argv[1] === 'find')
      return output(DISCOVERY_HELP);
    if (argv[0] === 'wiki') {
      if (argv.length > 2) throw new Error('expected-one-wiki-page');
      const page = argv[1] ?? 'SKILL.md';
      const pages = residentSkillPages();
      if (!Object.hasOwn(pages, page)) throw new Error('unknown-wiki-page');
      return output(pages[page]);
    }
    if (argv[0] === 'context') {
      if (argv.length !== 1) throw new Error('context-takes-no-arguments');
      return output(residentCliContext(await townRequest(connected(), '/context')));
    }
    if (argv[0] === 'apps' && (argv[1] === '--help' || (argv.length === 3 && argv[2] === '--help')))
      return output(APPS_HELP);
    if (argv[0] === 'apps') return await appsCli(argv.slice(1), connected(), stdin);
    if (argv.length === 0 || (argv.length === 1 && ['--help', 'help'].includes(argv[0]!)))
      return output(
        `town — resident CLI\nNavigation: town context | town wiki | town apps | town find '<keywords>'\n${cliOverview()}\nUse town find to search references, town help <group>, then town <group> <operation> --help.\nOne command per execution; no shell operators. Text is quoted; arrays repeat flags.\n${RESIDENT_COMMANDS.length} documented capabilities; current availability and permission depend on your world. Intentions are yours.`,
      );
    const parts = argv[0] === 'help' ? argv.slice(1) : argv;
    const group = parts[0]!;
    if (CLI_GROUPS.includes(group)) errorHelp = `town help ${group}`;
    if (
      CLI_GROUPS.includes(group) &&
      (parts.length === 1 || (parts.length === 2 && parts[1] === '--help'))
    )
      return output(
        [
          ...(groupPlain(group) === undefined ? [] : [`${group}: ${groupPlain(group)}`]),
          ...RESIDENT_COMMANDS.filter((command) => command.route.startsWith(`${group} `)).map(
            (command) => `town ${command.route} — ${command.definition.description}`,
          ),
        ].join('\n'),
      );
    const command = RESIDENT_COMMANDS.find((item) => item.route === `${parts[0]} ${parts[1]}`);
    if (command === undefined) throw new Error('unknown-command-use-town-help');
    errorHelp = `town ${command.route} --help`;
    if ((parts.length === 3 && parts[2] === '--help') || (argv[0] === 'help' && parts.length === 2))
      return output(commandHelp(command));
    if (argv[0] === 'help') throw new Error('invalid-help-arguments');
    return await invoke(connected(), command.definition, parts.slice(2), stdin);
  } catch (error) {
    return output(
      { ok: false, error: error instanceof Error ? error.message : 'cli-error', help: errorHelp },
      2,
    );
  }
}
