import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ResidentCredentials = {
  readonly admin: string;
  readonly residents: Readonly<Record<string, string>>;
};
export function loadResidentCredentials(
  root: string,
  actorIds: readonly string[],
): ResidentCredentials {
  const path = join(root, 'credentials.json');
  if (existsSync(path)) {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      value === null ||
      typeof value !== 'object' ||
      !('admin' in value) ||
      typeof value.admin !== 'string' ||
      !('residents' in value) ||
      value.residents === null ||
      typeof value.residents !== 'object'
    )
      throw new Error('invalid-credentials');
    const residents = value.residents as Record<string, unknown>;
    if (
      actorIds.some((id) => typeof residents[id] !== 'string') ||
      new Set([value.admin, ...Object.values(residents)]).size !==
        Object.values(residents).length + 1
    )
      throw new Error('invalid-credentials');
    return value as ResidentCredentials;
  }
  const token = () => randomBytes(32).toString('hex');
  const credentials = {
    admin: token(),
    residents: Object.fromEntries(actorIds.map((id) => [id, token()])),
  };
  writeFileSync(path, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
  return credentials;
}
