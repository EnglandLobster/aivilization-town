import { tool, text, integer, page } from './capabilitySchema';
export const HOUSING_OCCUPANCY_TOOLS = [
  tool(
    'housing.occupancy',
    'Read your registered residence, actual location, physical availability and current use permission separately. Continued occupation is not ownership or an unlimited permit. Personal rights references are paginated. When physical-housing-rest is explicitly enabled, expand your actual rest structure source and policy separately from registered residence and rights.',
    false,
    { ...page },
    [],
  ),
  tool(
    'housing.leave',
    'Personally relinquish your exact registered residence and release its registration capacity. This does not move your body, end leases or permits, return deposits, erase debts or alter your service standard. Use each contract and travel action separately.',
    true,
    {
      expectedResidenceId: text('Exact currently registered residence ID', 200),
      expectedRevision: integer('Observed personal occupancy revision'),
    },
  ),
];
