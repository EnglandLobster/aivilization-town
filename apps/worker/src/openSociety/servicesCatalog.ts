import { tool, text, integer, choice, page } from './capabilitySchema';
const id = text('Record ID', 96),
  serviceId = text('Service ID', 96),
  slotId = text('Slot ID', 96),
  expectedRevision = integer('Current revision'),
  capacity = { ...integer('Capacity', 100), minimum: 1 };
export const SERVICES_TOOLS = [
  tool(
    'services.publish',
    'Offer your appointments, course, event, transport meetup or lodging service. This does not grant venue ownership.',
    true,
    {
      id,
      kind: choice(['appointment', 'course', 'event', 'transport', 'lodging']),
      locationId: text('Real location', 96),
      destinationId: text('Required transport destination', 96),
      enterpriseId: text(
        'Optional enterprise you control; its employees may independently provide service',
        96,
      ),
      unitsPerProvider: {
        ...integer('v3 declared simultaneous units per actual provider', 100),
        minimum: 1,
      },
      participationMode: choice(['hosted', 'self-service']),
      title: text('Original title', 120),
      description: text('Original terms'),
      capacity,
    },
    ['id', 'kind', 'locationId', 'title', 'description', 'capacity'],
  ),
  tool(
    'services.start',
    'Personally provide a hosted service as owner or a linked enterprise employee. Real place/time and idle state required; choose until. No automatic wage or subjective quality result.',
    true,
    { id, expectedRevision, until: integer('Optional participation end') },
    ['id', 'expectedRevision'],
  ),
  tool(
    'services.stop',
    'Personally leave your v3 provider shift. Insufficient remaining staffing ends current attendance and releases time; no automatic refund.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'courses.start',
    'Teacher starts a real class at its place/time and remains busy until the end.',
    true,
    { id, expectedRevision, until: integer('Optional participation end') },
    ['id', 'expectedRevision'],
  ),
  tool('services.schedule', 'Publish an immutable time slot in simulation milliseconds.', true, {
    id,
    serviceId,
    start: integer('Slot start'),
    end: integer('Slot end'),
    capacity,
  }),
  tool('services.close', 'Close your service only when no accepted attendance remains.', true, {
    id,
    expectedRevision,
  }),
  tool('services.list', 'Browse active services as original records.', false, { ...page }, []),
  tool('services.read', 'Read service and available slots.', false, { id }),
  tool(
    'bookings.request',
    'Request attendance; owner must accept within actual capacity. Does not move you.',
    true,
    { id, slotId, units: capacity },
  ),
  ...['accept', 'cancel', 'check-in', 'leave'].map((op) =>
    tool(
      `bookings.${op}`,
      'Owner accepts; either side may cancel before attendance; resident checks in at the correct real place/time and becomes busy until slot end.',
      true,
      {
        id,
        expectedRevision,
        ...(op === 'check-in'
          ? {
              until: integer(
                'Optional earlier participation end; late/partial attendance is allowed',
              ),
            }
          : {}),
      },
      ['id', 'expectedRevision'],
    ),
  ),
  tool('bookings.list', 'List reservations involving you.', false, { ...page }, []),
  tool('bookings.read', 'Read your booking.', false, { id }),
  tool(
    'queues.join',
    'Voluntarily queue for a service and authorize an owner to offer the next slot.',
    true,
    { id, serviceId },
  ),
  tool('queues.leave', 'Leave your pending queue entry.', true, { id }),
  tool(
    'queues.call',
    'Owner offers the first waiting resident a place if capacity permits.',
    true,
    { id, slotId, bookingId: text('New booking ID', 96) },
  ),
  tool(
    'queues.status',
    'Read your entries or entries of services you operate.',
    false,
    { ...page },
    [],
  ),
];
