import { tool, text, integer, number, choice, strings, page } from './capabilitySchema';
const id = text('Record ID', 96),
  expectedRevision = integer('Current revision');
export const LIFE_TOOLS = [
  tool(
    'population.self',
    'Read your authoritative life stage and lifecycle facts. Initial residents are adults; family declarations do not create children.',
    false,
    {},
  ),
  tool(
    'households.propose',
    'Propose a family, guardianship/care or cohabitation link; other person must consent. No emotion is assigned.',
    true,
    {
      id,
      partnerId: text('Other resident', 96),
      kind: choice(['family', 'guardianship', 'cohabitation']),
      terms: text('Original terms'),
    },
  ),
  ...['accept', 'reject', 'end'].map((op) =>
    tool(
      `households.${op}`,
      'Personally accept/reject a proposed link, or end an active link. Cohabitation requires actual common residence.',
      true,
      { id, expectedRevision },
    ),
  ),
  tool('households.list', 'Read your own links.', false, { ...page }, []),
  tool(
    'care.request',
    'Request care for yourself from another resident at a real place for a duration.',
    true,
    {
      id,
      providerId: text('Provider', 96),
      locationId: text('Location', 96),
      description: text('Original request'),
      durationMs: { ...integer('Duration in simulation milliseconds', 86400000), minimum: 1 },
    },
  ),
  ...['accept', 'start', 'cancel'].map((op) =>
    tool(
      `care.${op}`,
      'Provider accepts then starts only with both people present and idle; care consumes both participants time.',
      true,
      { id, expectedRevision },
    ),
  ),
  tool('care.list', 'Read care tasks involving you.', false, { ...page }, []),
  ...['grant', 'revoke'].map((op) =>
    tool(`health.${op}`, 'Control access to your own health records.', true, {
      targetId: text('Resident', 96),
    }),
  ),
  tool(
    'health.record',
    'Append original notes, medication claims, follow-up or treatment evidence. Does not change body state. Treatment requires real world evidence.',
    true,
    {
      id,
      patientId: text('Patient ID', 96),
      kind: choice(['note', 'treatment', 'medication', 'follow-up']),
      content: text('Original health text'),
      sourceEventIds: strings,
    },
    ['id', 'patientId', 'kind', 'content'],
  ),
  tool(
    'health.records',
    'Read patient-authorized records. Revocation applies immediately.',
    false,
    { patientId: text('Patient ID', 96), ...page },
    ['patientId'],
  ),
  tool(
    'courses.assess',
    'Record teacher-authored assessment only after actual course attendance. Does not mint qualifications or education points.',
    true,
    { id, bookingId: text('Completed course booking', 96), content: text('Original assessment') },
  ),
  tool('courses.records', 'Read your assessments as teacher or learner.', false, { ...page }, []),
  tool(
    'leases.offer',
    'Offer cost-sharing of your actual residence to a named resident. No ownership of public land is created.',
    true,
    {
      id,
      tenantId: text('Tenant ID', 96),
      locationId: text('Your residential location', 96),
      terms: text('Original terms'),
      rent: number('Currency each simulation day'),
      deposit: number('Refundable deposit'),
      expiresAt: integer('Expiry simulation timestamp'),
    },
  ),
  ...['accept', 'end', 'pay'].map((op) =>
    tool(
      `leases.${op}`,
      'Accept personally with real capacity and money; end returns refundable deposit; pay clears arrears. Acceptance authorizes daily rent.',
      true,
      { id, expectedRevision },
    ),
  ),
  tool('leases.list', 'Read your own shared-residence leases.', false, { ...page }, []),
  tool(
    'housing.list',
    'Read actual residential locations and public capacity; listings are not ownership titles.',
    false,
    { ...page },
    [],
  ),
  tool(
    'civic.list',
    'Read existing public petitions, matters or conversation-derived commitments without duplicating their authority.',
    false,
    { kind: choice(['petitions', 'matters', 'commitments', 'bulletins']), ...page },
    ['kind'],
  ),
];
