import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { RESIDENT_CLI_VERSION } from './cliCatalog';
import {
  legacyProviderWorkspaceId,
  preserveResidentProviderWorkspace,
  residentProviderSession,
} from './providerWorkspace';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'provider-workspace-'));
  roots.push(root);
  const source = join(root, 'native'),
    target = join(root, 'compute');
  mkdirSync(source);
  mkdirSync(target);
  const bytes = JSON.stringify(
    { version: RESIDENT_CLI_VERSION, sessionId: 'real-session' },
    null,
    2,
  );
  for (const dir of [source, target]) writeFileSync(join(dir, 'cli-session.json'), bytes);
  return { source, target, bytes };
}
test('legacy native identity survives an explicit evidence relocation without modifying source history; retry preserves proof', () => {
  const t = fixture();
  const old = residentProviderSession(t.source, 'real-session');
  expect(old.workspaceId).toBe(legacyProviderWorkspaceId(t.source));
  expect(residentProviderSession(t.target, 'real-session').workspaceId).not.toBe(old.workspaceId);
  const proof = preserveResidentProviderWorkspace(t.source, t.target, 'real-session');
  expect(residentProviderSession(t.target, 'real-session')).toEqual(old);
  expect(readFileSync(join(t.source, 'cli-session.json'), 'utf8')).toBe(t.bytes);
  const saved = readFileSync(join(t.target, proof.proofName));
  expect(JSON.parse(saved.toString()) as unknown).toMatchObject({
    originalMarkerUtf8: t.bytes,
    workspaceId: old.workspaceId,
  });
  expect(preserveResidentProviderWorkspace(t.source, t.target, 'real-session')).toEqual(proof);
  expect(readFileSync(join(t.target, proof.proofName))).toEqual(saved);
});
test('unproven session, mismatched target and invalid workspace cannot redirect a resumed provider', () => {
  const t = fixture();
  expect(residentProviderSession(t.source, 'other')).toEqual({
    workspaceId: legacyProviderWorkspaceId(t.source),
  });
  expect(() => preserveResidentProviderWorkspace(t.source, t.target, 'other')).toThrow(
    'provider-handoff-session-mismatch',
  );
  expect(readdirSync(t.target)).toEqual(['cli-session.json']);
  writeFileSync(
    join(t.target, 'cli-session.json'),
    JSON.stringify({
      version: RESIDENT_CLI_VERSION,
      sessionId: 'real-session',
      workspaceId: '../escape',
    }),
  );
  expect(() => residentProviderSession(t.target, 'real-session')).toThrow(
    'invalid-provider-workspace-id',
  );
  expect(() => preserveResidentProviderWorkspace(t.source, t.target, 'real-session')).toThrow(
    'invalid-provider-workspace-id',
  );
  expect(readFileSync(join(t.source, 'cli-session.json'), 'utf8')).toBe(t.bytes);
});
