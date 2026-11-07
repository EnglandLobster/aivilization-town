import { tool, text, page } from './capabilitySchema';
export const PERIODIC_TOOLS = [
  tool(
    'obligations.list',
    'List finite payment agreements visible to current actual parties. A promise, actual payment and bodily or resource performance are different facts.',
    false,
    { ...page },
    [],
  ),
  tool(
    'obligations.read',
    'Expand one original finite agreement and a bounded page of paid, owed or waived periods. Current versions give exact principal operation templates.',
    false,
    { id: text('Existing agreement ID', 60), ...page },
    ['id'],
  ),
  tool(
    'obligations.prepare',
    'Prepare an exact finite offer operation from your chosen immutable terms and actual account principals. Does not reserve money, obtain agreement or create a lease, loan or service.',
    false,
    {
      command: {
        type: 'object' as const,
        description:
          'Closed offer command: type=offer,id,title,terms,payer/revenue {sector,id},amount,firstDueAt,periodMs,periods,acceptBy',
      },
    },
    ['command'],
  ),
] as const;
