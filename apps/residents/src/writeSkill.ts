import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { residentSkillPages } from './residentSkill';

const root = fileURLToPath(new URL('../skills/town-resident/', import.meta.url));
for (const [path, content] of Object.entries(residentSkillPages())) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
