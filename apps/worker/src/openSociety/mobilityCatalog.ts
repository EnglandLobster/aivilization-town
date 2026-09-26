import { choice, integer, page, text, tool } from './capabilitySchema';
const id = text('Record ID', 96),
  revision = integer('Expected current revision'),
  expiresAt = integer('Simulation deadline in milliseconds');
export const MOBILITY_TOOLS = [
  tool(
    'vehicles.list',
    'List vehicles you own or may drive; registration never creates a vehicle.',
    false,
    { ...page },
    [],
  ),
  tool(
    'vehicles.read',
    'Read an owned or authorized vehicle, location and current journey.',
    false,
    { id },
  ),
  ...(['authorize', 'revoke'] as const).map((operation) =>
    tool(
      `vehicles.${operation}`,
      'Owner grants/revokes driving permission while vehicle has no active ride or journey.',
      true,
      { id, residentId: text('Resident ID', 96), expectedRevision: revision },
    ),
  ),
  tool(
    'drivers.register',
    'Register yourself using an owned or authorized real vehicle; initially offline.',
    true,
    { vehicleId: id },
  ),
  tool(
    'drivers.online',
    'Become available for voluntary quotations. No automatic dispatch.',
    true,
    {},
  ),
  tool('drivers.offline', 'Stop new offers; accepted rides remain your commitments.', true, {}),
  tool(
    'drivers.list',
    'List your registration and public online authorized drivers.',
    false,
    { ...page },
    [],
  ),
  tool(
    'rides.request',
    'Publish your own single-person trip from your real current location.',
    true,
    { id, destinationId: id, expiresAt },
  ),
  tool(
    'rides.list',
    'Browse open requests or your own rides, without recommendation ranking.',
    false,
    { scope: choice(['mine', 'open']), ...page },
    [],
  ),
  tool('rides.read', 'Read a public open request or your own accepted ride.', false, { id }),
  tool(
    'rides.quote',
    'Online driver voluntarily offers a fixed total fare for one request.',
    true,
    { id, rideId: id, fare: { ...integer('Fixed positive fare', 10000), minimum: 1 }, expiresAt },
  ),
  tool(
    'rides.quotes',
    'Read quotes for your request, or only your own quotes as a driver.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool('rides.withdraw', 'Withdraw your unaccepted quote.', true, {
    id,
    expectedRevision: revision,
  }),
  tool('rides.book', 'Rider selects a quote and escrows its fixed fare atomically.', true, {
    id,
    quoteId: id,
    expectedRevision: revision,
  }),
  tool(
    'rides.pickup',
    'Driver at the vehicle starts real pickup travel, or becomes ready if already there.',
    true,
    { id, expectedRevision: revision },
  ),
  tool(
    'rides.board',
    'Rider boards at actual pickup; both parties start the same real journey.',
    true,
    { id, expectedRevision: revision },
  ),
  tool(
    'rides.cancel',
    'Either party may cancel before passenger departure with a full refund; a moving pickup vehicle still completes its leg.',
    true,
    { id, expectedRevision: revision },
  ),
];
