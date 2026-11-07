import { tool, text, integer, choice, page } from './capabilitySchema';
export const LABOR_TERMS_TOOLS = [
  tool(
    'business.labor-terms',
    'Read only your labor offers or enterprises you control. Amount and reference duration are explicit; a quote is not work or earned money.',
    false,
    { enterpriseId: text('Enterprise ID', 96), id: text('Optional offer ID', 96), ...page },
    ['enterpriseId'],
  ),
  tool(
    'business.change-labor-terms',
    'Offer or withdraw as the actual employer; accept/decline only as the named employee. Amount is integer millionths of currency. Collective employers use the exact principals.operate request; nobody can accept for an employee.',
    true,
    {
      enterpriseId: text('Enterprise ID', 96),
      operation: choice(['offer', 'accept', 'decline', 'withdraw']),
      id: text('Immutable offer ID', 96),
      employeeId: text('Actual employee for offer', 96),
      wageMicros: integer('Gross amount in millionths of currency'),
      referenceMs: integer('Time corresponding to the quoted amount'),
      validUntil: integer('Absolute simulation expiry'),
      expectedRevision: integer('Exact current offer revision for response/withdrawal'),
    },
    ['enterpriseId', 'operation', 'id'],
  ),
];
