import { createHash } from 'node:crypto';

export function stableJson(value: unknown): string {
  if (value === undefined) throw new Error('undefined-journal-value');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}
export function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
