import { tool, page } from './capabilitySchema';
/** Where people can live. Other everyday-life institutions are left to residents to build. */
export const LIFE_TOOLS = [
  tool(
    'housing.list',
    'Read actual residential locations and public capacity; listings are not ownership titles.',
    false,
    { ...page },
    [],
  ),
];
