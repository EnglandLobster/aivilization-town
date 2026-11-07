import { decodeMaterialCommand } from '@aivilization/world';
import { ToolRefusal } from './arguments';
export function parseMaterialCommand(name: string, arguments_: Record<string, unknown>) {
  try {
    return decodeMaterialCommand(name, arguments_);
  } catch (error) {
    throw new ToolRefusal(error instanceof Error ? error.message : 'invalid-material-command');
  }
}
