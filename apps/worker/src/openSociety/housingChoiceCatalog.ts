import { tool, integer, page } from './capabilitySchema';
export const HOUSING_CHOICE_TOOLS = [
  tool(
    'housing.standard',
    'Read your personal housing-service standard, actual residence, current upkeep source and supported choices. A personal tier is not a building or ownership title.',
    false,
    { ...page },
    [],
  ),
  tool(
    'housing.lower',
    'Personally select a lower supported housing-service standard when no physical activity is active. Future upkeep uses that standard; no refund, debt cancellation, relocation, construction or private lease change occurs.',
    true,
    {
      targetTier: integer('Lower supported tier'),
      expectedRevision: integer('Exact observed personal standard revision'),
    },
  ),
];
