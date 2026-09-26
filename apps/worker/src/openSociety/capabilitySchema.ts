import type { OpenToolDefinition, OpenToolProperty } from '@aivilization/agent-runtime';

export const text = (description: string, maxLength = 8000): OpenToolProperty => ({
  type: 'string',
  description,
  maxLength,
});
export const number = (description: string, minimum = 0): OpenToolProperty => ({
  type: 'number',
  description,
  minimum,
  maximum: 1_000_000,
});
export const integer = (
  description: string,
  maximum = Number.MAX_SAFE_INTEGER,
): OpenToolProperty => ({
  type: 'integer',
  description,
  minimum: 0,
  maximum,
});
export const choice = (values: readonly string[]): OpenToolProperty => ({
  type: 'string',
  enum: values,
});
export const strings: OpenToolProperty = { type: 'array', items: { type: 'string' } };
export function tool(
  name: string,
  description: string,
  mutates: boolean,
  properties: Record<string, OpenToolProperty>,
  required: readonly string[] = Object.keys(properties),
): OpenToolDefinition {
  return {
    name,
    category: name.split('.')[0]!,
    description,
    mutates,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  };
}
export const page = {
  offset: integer('Pagination offset'),
  limit: { ...integer('Page size', 30), minimum: 1 },
};
