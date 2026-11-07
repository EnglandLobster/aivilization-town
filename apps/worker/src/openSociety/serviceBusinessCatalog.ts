import { tool, text, integer, choice, page } from './capabilitySchema';
const enterpriseId = text('Enterprise whose actual account or employment is involved', 96),
  serviceId = text('Existing immutable service agreement ID', 96);
export const SERVICE_BUSINESS_TOOLS = [
  tool(
    'business.authorize-service',
    'Current enterprise owner independently authorizes the exact service revision, actual account roles and optional employee wage. No payment, attendance or patient consent is created.',
    true,
    {
      enterpriseId,
      serviceId,
      expectedServiceRevision: integer('Current service revision'),
      wageBasis: choice(['none', 'attendance', 'effective-service']),
    },
  ),
  tool(
    'business.revoke-service',
    'Owner revokes an unused service financial authorization before funding. Existing work, payments and wages cannot be erased.',
    true,
    {
      enterpriseId,
      serviceId,
      expectedServiceRevision: integer('Current service revision'),
      expectedAuthorizationRevision: integer('Current enterprise service authorization revision'),
    },
  ),
  tool(
    'business.services',
    'List your own enterprise financial authorizations or your own service employment. This does not disclose other employees wages or patient bodies.',
    false,
    { enterpriseId, ...page },
    [],
  ),
  tool(
    'business.service',
    'Read exact service account permission, financial source and your authorized wage terms. Company owner or the named employee only; no patient bodily data.',
    false,
    { enterpriseId, serviceId },
  ),
];
