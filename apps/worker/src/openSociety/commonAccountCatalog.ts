import { tool, text, integer, number, page } from './capabilitySchema';
const id = text('Exact common account ID', 96);
export const COMMON_ACCOUNT_TOOLS = [
  tool(
    'funds.open',
    'Current member opens an empty account controlled by an active collective. No money or individual withdrawal power is created.',
    true,
    {
      id,
      collectiveId: text('Controlling collective ID', 96),
      title: text('Original account title', 120),
    },
  ),
  tool(
    'funds.contribute',
    'Personally transfer your own actual funds to an open receiving account. This does not create shares, debt or voting rights.',
    true,
    {
      id,
      expectedRevision: integer('Current receiving-account revision'),
      amount: number('Positive finite contribution', 0),
      note: text('Your original transfer note', 2000),
    },
  ),
  tool(
    'funds.list',
    'List accounts of collectives you currently belong to, with authoritative balances.',
    false,
    { ...page },
    [],
  ),
  tool(
    'funds.read',
    'Read public receiving address, title, status and versions. Current controlling members also see actual balance.',
    false,
    { id },
  ),
  tool(
    'funds.ledger',
    'Current controlling members read exact balanced transfers and decision references, not informal record claims.',
    false,
    { id, ...page },
    ['id'],
  ),
];
