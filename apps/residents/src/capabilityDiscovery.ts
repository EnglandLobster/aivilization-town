import { RESIDENT_COMMANDS, commandHelp } from './cliCatalog';
import { residentSkillPages } from './residentSkill';

export const DISCOVERY_VERSION = 'resident-capability-discovery-v1';
export const DISCOVERY_HELP = `town find <quoted-keywords> [--kind all|command|page] [--offset n] [--limit n]
Search command references and platform guides by literal keywords. Prefer all words; if none match all, return explicitly labeled partial matches.
Chinese guide text and English command names/descriptions are searchable; this is not semantic search.
Results sort by matched word count, then stable kind/name, default 10 and maximum 20 per page. Read the returned helpWith.
This local documentation search does not inspect resident content, contact the world or execute actions.
Documented capability does not imply enabled policy, permission, resources or successful execution.`;

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
type SearchEntry = {
  kind: 'command' | 'page';
  name: string;
  text: string;
  helpWith: string;
  boundaryWith?: string;
  mutating?: boolean;
};

/** Adapter-only discovery: one index from existing command schemas and maintained guides. */
export function findResidentCapabilities(argv: readonly string[]) {
  const query = argv[0]?.trim() ?? '';
  const terms = [...new Set(normalize(query).split(/\s+/u).filter(Boolean))];
  if (!query || query.startsWith('--') || query.length > 160 || terms.length > 8)
    throw new Error('find-query-required-max-160-characters-8-words');
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!['--kind', '--offset', '--limit'].includes(flag) || flags.has(flag) || value === undefined)
      throw new Error('invalid-find-flags');
    flags.set(flag, value);
  }
  const kind = flags.get('--kind') ?? 'all';
  if (!['all', 'command', 'page'].includes(kind)) throw new Error('invalid-find-kind');
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`invalid-find-${name.slice(2)}`);
    return n;
  };
  const offset = integer('--offset', 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = integer('--limit', 10, 1, 20);
  const entries: SearchEntry[] = [
    ...RESIDENT_COMMANDS.map((command) => ({
      kind: 'command' as const,
      name: `town ${command.route}`,
      text: commandHelp(command),
      helpWith: `town ${command.route} --help`,
      boundaryWith: `town rules capability --name ${command.definition.name}`,
      mutating: command.definition.mutates,
    })),
    ...Object.entries(residentSkillPages())
      // Generated per-group references duplicate command schemas. Keep authored guide pages.
      .filter(([path]) => !path.startsWith('commands/'))
      .map(([path, text]) => ({
        kind: 'page' as const,
        name: path,
        text,
        helpWith: `town wiki ${path}`,
      })),
  ];
  const candidates = entries
    .filter((entry) => kind === 'all' || entry.kind === kind)
    .map((entry) => ({
      ...entry,
      matchedTerms: terms.filter((term) =>
        normalize(`${entry.name}\n${entry.text}`).includes(term),
      ),
    }));
  const fullMatches = candidates.filter((entry) => entry.matchedTerms.length === terms.length);
  const matching = fullMatches.length > 0 ? 'all-terms' : 'partial-terms';
  const matches = (
    fullMatches.length > 0
      ? fullMatches
      : candidates.filter((entry) => entry.matchedTerms.length > 0)
  ).sort(
    (a, b) =>
      b.matchedTerms.length - a.matchedTerms.length ||
      a.kind.localeCompare(b.kind, 'en') ||
      a.name.localeCompare(b.name, 'en'),
  );
  const items = matches.slice(offset, offset + limit).map(({ text, ...entry }) => {
    // Original text only; no generated advice, institutional plan or summary.
    const line =
      text.split('\n').find((part) => terms.some((term) => normalize(part).includes(term))) ?? '';
    return { ...entry, excerpt: line.slice(0, 240), excerptTruncated: line.length > 240 };
  });
  return {
    version: DISCOVERY_VERSION,
    query,
    kind,
    matching,
    source: 'local-command-schemas-and-platform-guides',
    availability: 'documentation-only-check-current-world-and-authorization',
    offset,
    limit,
    total: matches.length,
    items,
    nextOffset: offset + items.length < matches.length ? offset + items.length : null,
    ...(items.length === 0
      ? {
          hint: 'This searches documentation, not resident content or resource IDs. Try fewer literal words, an English command name or Chinese guide text. Browse town wiki or town help.',
        }
      : {}),
  };
}
