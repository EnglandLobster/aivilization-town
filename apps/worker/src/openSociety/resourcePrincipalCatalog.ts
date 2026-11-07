import { tool, text, choice, page } from './capabilitySchema';
const request = {
  type: 'object' as const,
  description:
    'Exact JSON request: resourceKind,resourceId,resourceRevision,controlVersion, plus command for custody or operation for an administrative action. Read principals read first.',
};
export const RESOURCE_PRINCIPAL_TOOLS = [
  tool(
    'principals.list',
    'List visible stock, explicitly enabled service/vehicle, construction project and building principal metadata. Enterprise, collective and public custody are distinct from the resident executing an operation.',
    false,
    { ...page },
    [],
  ),
  tool(
    'principals.read',
    'Read exact resource versions, existing custody, materials, construction or premises facts and permissions. Includes operation and independent governance entrypoints.',
    false,
    {
      kind: choice([
        'stock',
        'resource-sale',
        'periodic-obligation',
        'service',
        'service-directory',
        'vehicle',
        'premises',
        'construction-site',
        'construction-project',
        'construction-order',
      ]),
      id: text('Existing resource ID', 96),
    },
  ),
  tool(
    'principals.control',
    'Offer, independently accept or cancel exact stock, explicitly enabled service/vehicle or building custody. Current enterprise managers can act for the firm; collective/public subjects require independently approved decisions. Does not move materials or change permissions.',
    true,
    { request },
  ),
  tool(
    'principals.operate',
    'Apply one exact administrative stock or explicitly enabled finite payment obligation, paid resource/control exchange, service creation/reopening/independent consent/supply relationship, vehicle/construction/premises command or exact construction order under current principal authority. Does not compel another person to work. Collective/public operations use their exact decision execution.',
    true,
    { request },
  ),
];
