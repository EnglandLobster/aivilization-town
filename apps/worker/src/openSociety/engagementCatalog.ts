import { tool, text, integer, number, strings, page, choice } from './capabilitySchema';
import { RESIDENT_SERVICE_EFFECT_MODELS } from '@aivilization/society';
const id = text('Exact engagement ID', 60),
  expectedRevision = integer('Current immutable agreement state revision');
export const ENGAGEMENT_TOOLS = [
  tool(
    'engagements.models',
    'Read registered physical effects, real input requirements and bounds. Names and reviews cannot add effects or qualifications.',
    false,
    {},
    [],
  ),
  tool(
    'engagements.facilities',
    'Discover actual care/teaching stations and their declared physical source. A name is not physical supply.',
    false,
    { ...page },
    [],
  ),
  tool(
    'engagements.list',
    'List your visible private service agreements and openly published public-treasury procurement agreements. Other private agreements remain hidden.',
    false,
    { ...page },
    [],
  ),
  tool(
    'engagements.read',
    'Read the exact service agreement, own consent/participation, measured progress, escrow and exit state.',
    false,
    { id },
  ),
  tool(
    'engagements.ledger',
    'Read measured original service settlements; other people bodily state is redacted.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'engagements.offer',
    'Propose immutable service terms and voluntary participants. Treasury payer requires explicit public procurement mode: terms, named parties and financial/time ledger become public; bodily details remain private. This creates no consent, payment or work.',
    true,
    {
      id,
      controllerKind: choice(['resident', 'collective']),
      controllerId: text('Resource controller ID', 96),
      title: text('Original service name', 120),
      terms: text('Original service terms', 8000),
      locationId: text('Actual location', 200),
      providerId: text('Named provider', 96),
      recipientId: text('Named recipient', 96),
      payerSector: choice(['agent', 'collective', 'enterprise', 'treasury']),
      payerId: text('Actual payer account', 96),
      revenueSector: choice(['agent', 'collective', 'enterprise']),
      revenueId: text('Revenue account; enterprise needs its own independent authorization', 96),
      providerShareBps: integer('Provider share: 0 to 10000 basis points', 10000),
      pricePerHour: number('Price in currency per hour; up to six decimal places'),
      modelId: choice(Object.keys(RESIDENT_SERVICE_EFFECT_MODELS)),
      maxDurationMs: integer('Maximum actual overlapping service time in milliseconds', 28800000),
      startAt: integer('Earliest simulation timestamp'),
      endAt: integer('Final simulation timestamp'),
      reservationRefs: strings,
    },
  ),
  ...['accept', 'fund', 'cancel', 'leave'].map((op) =>
    tool(
      `engagements.${op}`,
      {
        accept:
          'Recipient alone accepts these immutable terms; resources bind but nobody is forced to participate.',
        fund: 'Private authorized payer escrows the price after recipient consent. Treasury funding uses governance propose/execute fund-service instead; payment cannot start anybody body.',
        cancel:
          'A participant or current agreement controller ends future service; measured work settles and unearned money/materials return.',
        leave:
          'Personally leave your participation; actual service stops and both matching time reservations release.',
      }[op]!,
      true,
      { id, expectedRevision },
    ),
  ),
  tool(
    'engagements.start',
    'Personally reserve your own actual presence until the chosen time. Both named people must independently start, be present and fit the physical facility.',
    true,
    {
      id,
      expectedRevision,
      until: integer('Your chosen end time, within the agreement window'),
      expectedEmploymentRevision: integer(
        'Provider accepts exact current enterprise service authorization revision; read engagements read or business service first',
      ),
    },
    ['id', 'expectedRevision', 'until'],
  ),
];
