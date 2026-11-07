import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { residentSkillPages } from './residentSkill';

const root = fileURLToPath(new URL('../skills/town-resident/', import.meta.url));
// The directory is fully generated: clear it so pages of removed commands do not linger.
rmSync(root, { recursive: true, force: true });
for (const [path, content] of Object.entries(residentSkillPages())) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
