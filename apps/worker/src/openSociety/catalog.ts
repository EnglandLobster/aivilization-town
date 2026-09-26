import { MOBILITY_TOOLS } from './mobilityCatalog';
import { LIFE_TOOLS } from './lifeCatalog';
import { SERVICES_TOOLS } from './servicesCatalog';
import { COMMERCE_TOOLS } from './commerceCatalog';
import { COLLABORATION_TOOLS } from './collaborationCatalog';
import type { OpenToolDefinition, OpenToolProperty } from '@aivilization/agent-runtime';
import type { CoreCommandType } from '@aivilization/sim-core';
import { DOCUMENT_METADATA_POLICY } from '@aivilization/information';
export const OPEN_CAPABILITY_CATALOG_VERSION = 'open-capabilities-v7';

import { text, number, integer, choice, strings, tool, page } from './capabilitySchema';
export { text, tool } from './capabilitySchema';
import { COMMUNICATION_TOOLS } from './communicationCatalog';
import { DISTRIBUTION_TOOLS } from './distributionCatalog';

const document = { spaceId: text('Space ID', 96), path: text('Relative document path', 240) };
const metadata = {
  title: text(
    'Your own title; never automatically summarized',
    DOCUMENT_METADATA_POLICY.maxTitleLength,
  ),
  tags: {
    ...strings,
    description: `Up to ${DOCUMENT_METADATA_POLICY.maxTags} author-supplied tags, each at most ${DOCUMENT_METADATA_POLICY.maxTagLength} characters`,
  },
  relatedTo: text(
    'Author-supplied related location, enterprise or document ID; not verification',
    DOCUMENT_METADATA_POLICY.maxRelatedToLength,
  ),
};
export const OPEN_INFORMATION_TOOLS: readonly OpenToolDefinition[] = [
  tool(
    'files.index',
    'Browse original document metadata only, without body summaries or ranking. Read chosen originals with files.read. In city apps use prefix posts/ to see resident posts.',
    false,
    {
      spaceId: document.spaceId,
      prefix: text('Path prefix, such as posts/', 240),
      authorId: text('Author ID', 96),
      tag: text('Exact author-supplied tag', 40),
      relatedTo: metadata.relatedTo,
      query: text('Search metadata only', 300),
      ...page,
    },
    [],
  ),
  tool(
    'world.observe',
    'Read your own state, current location/people, public destinations, local market, rules, or your running action. Others private state is not visible.',
    false,
    {
      view: choice(['self', 'location', 'locations', 'market', 'rules', 'action', 'enterprises']),
      section: text('Optional rule group to expand', 100),
      ...page,
    },
    ['view'],
  ),
  tool(
    'memory.search',
    'Search your complete experience archive. Narrow by text, person or simulation time; results link to original records.',
    false,
    {
      query: text('Words to search', 300),
      personId: text('Related person', 96),
      after: integer('Exclusive earliest observation time'),
      before: integer('Exclusive latest observation time'),
      sourceId: text('Exact document, message or event source ID', 240),
      locationId: text('Observed location ID', 96),
      ...page,
    },
    [],
  ),
  tool(
    'memory.read',
    'Read one of your experiences including event sources. Another resident memory is private.',
    false,
    { id: text('Experience ID', 200) },
  ),
  tool(
    'cognition.list',
    'Read your personal beliefs, goals, notes and self-understanding. These are your interpretations, not world facts.',
    false,
    {
      kind: choice(['belief', 'goal', 'note', 'self']),
      active: { type: 'boolean' },
      personId: text('Related resident', 96),
      ...page,
    },
    [],
  ),
  tool(
    'cognition.update',
    'Create or revise your own belief, goal, note or self-description. expectedRevision=0 creates. Evidence may be empty for new ideas; cited memories must be yours.',
    true,
    {
      key: text('Stable entry key', 96),
      kind: choice(['belief', 'goal', 'note', 'self']),
      statement: text('Your interpretation or intention'),
      confidence: { ...number('Your confidence'), maximum: 1 },
      evidenceIds: strings,
      expectedRevision: integer('Current revision, 0 for creation'),
      active: { type: 'boolean' },
      pinned: {
        type: 'boolean',
        description: 'Keep in your own context; optional, preserved on update',
      },
      people: { ...strings, description: 'People this personal interpretation concerns' },
    },
    ['key', 'kind', 'statement', 'confidence', 'evidenceIds', 'expectedRevision', 'active'],
  ),
  tool(
    'spaces.list',
    'Discover public spaces and private spaces you may access.',
    false,
    { query: text('Search title', 200), ...page },
    [],
  ),
  tool(
    'spaces.create',
    'Create an information space. You own it. Public means readable; posting controls who can create their own documents.',
    true,
    {
      id: text('Unique space ID', 96),
      title: text('Human readable title', 120),
      visibility: choice(['public', 'private']),
      posting: choice(['owner', 'members', 'everyone']),
      members: strings,
    },
    ['id', 'title', 'visibility', 'posting'],
  ),
  tool(
    'files.create',
    'Create your own document in a space allowing you to contribute. Writing a claim does not execute an economic or physical action.',
    true,
    { ...document, content: text('Document content'), ...metadata },
    ['spaceId', 'path', 'content'],
  ),
  tool('files.read', 'Read a visible document and its current revision.', false, document),
  tool(
    'files.list',
    'List visible documents in a space. Deleted entries are omitted.',
    false,
    { spaceId: document.spaceId, ...page },
    ['spaceId'],
  ),
  tool(
    'files.search',
    'Search the contents and paths of documents you may read. It does not search private spaces belonging to others.',
    false,
    { query: text('Search words', 300), spaceId: document.spaceId, ...page },
    ['query'],
  ),
  tool(
    'files.update',
    'Revise your document using its current revision. Space ownership does not let you impersonate another author.',
    true,
    {
      ...document,
      content: text('Replacement content'),
      expectedRevision: integer('Current revision'),
      ...metadata,
    },
    ['spaceId', 'path', 'content', 'expectedRevision'],
  ),
  tool(
    'files.delete',
    'Tombstone your document, or moderate a document in your space. History remains visible to authorized readers.',
    true,
    { ...document, expectedRevision: integer('Current revision') },
  ),
  tool(
    'files.history',
    'Read version history, including deletions, of a visible document.',
    false,
    { ...document, ...page },
    ['spaceId', 'path'],
  ),
  tool(
    'messages.send',
    'Send your own message to another resident. Delivery does not imply agreement or a response; the receiver decides independently.',
    true,
    { recipientId: text('Resident ID', 96), content: text('Your message') },
  ),
  tool(
    'messages.list',
    'List only messages you sent or received, with read state and previews. Use messages.read for the full message and read acknowledgement.',
    false,
    { direction: choice(['incoming', 'outgoing', 'both']), ...page },
    [],
  ),
  tool(
    'messages.read',
    'Read a message you sent or received, marking it read if you are the recipient.',
    true,
    { id: text('Message ID', 96) },
  ),
  tool(
    'schedule.wait',
    'End this opportunity and wait until a future simulation time or an incoming event. Record a short handoff; no world clock is changed.',
    true,
    {
      until: integer('Future simulation timestamp'),
      summary: text('What you want to remember next time', 2000),
    },
  ),
  tool('schedule.remind', 'Set yourself a reminder at a future simulation timestamp.', true, {
    id: text('Your reminder ID', 96),
    at: integer('Future simulation timestamp'),
    text: text('Reminder', 2000),
  }),
  tool(
    'schedule.configure',
    'Choose your own background free-activity interval. Explicit waits and reminders remain separate; no mandatory routine.',
    true,
    { freeActivityIntervalMs: { ...integer('Simulation milliseconds', 86400000), minimum: 60000 } },
  ),
  tool(
    'schedule.list',
    'List your reminders, including completed/cancelled reminders.',
    false,
    { ...page },
    [],
  ),
  tool('schedule.cancel', 'Cancel one of your outstanding reminders.', true, {
    id: text('Your reminder ID', 96),
  }),
];

export type WorldToolDefinition = OpenToolDefinition & { readonly commandType: CoreCommandType };
function world(
  name: string,
  commandType: CoreCommandType,
  description: string,
  properties: Record<string, OpenToolProperty>,
  required?: readonly string[],
): WorldToolDefinition {
  return { ...tool(`world.${name}`, description, true, properties, required), commandType };
}
const duration = {
  durationSeconds: { ...number('Duration in simulated seconds', 1), maximum: 28_800 },
};
const commodity = {
  commodityName: text('Commodity name', 100),
  quantity: number('Positive quantity', 0.000001),
};
const enterprise = { enterpriseId: text('Enterprise ID', 96) };
export const OPEN_WORLD_TOOLS: readonly WorldToolDefinition[] = [
  world(
    'move',
    'AgentMoveTo',
    'Travel to a known location. World checks route/capacity and returns a journey, not immediate arrival. Observe action status and wait for arrival.',
    { targetLocationId: text('Destination ID', 96), reason: text('Your reason', 300) },
    ['targetLocationId'],
  ),
  world(
    'eat',
    'AgentEat',
    'Eat food you own. World determines nutrition and resource consumption.',
    commodity,
  ),
  world(
    'consume',
    'AgentConsume',
    'Use a consumable or durable good you own under existing rules.',
    commodity,
  ),
  world(
    'sleep',
    'AgentSleep',
    'Sleep for a duration; world enforces location, time and physiological recovery.',
    duration,
  ),
  world(
    'doctor',
    'AgentSeeDoctor',
    'Seek medical treatment. World determines eligibility and price.',
    duration,
  ),
  world(
    'study',
    'AgentStudy',
    'Study at an appropriate facility. Education rate and eligibility are authoritative.',
    duration,
  ),
  world(
    'trade',
    'AgentTrade',
    'Buy or sell in your currently accessible market. Prices, slippage, inventory and balance are checked by the world.',
    { ...commodity, side: choice(['buy', 'sell']), enterpriseId: enterprise.enterpriseId },
    ['commodityName', 'quantity', 'side'],
  ),
  world(
    'work',
    'AgentWork',
    'Work in an occupation you hold. Wages, labor cost, location and employment are authoritative.',
    {
      occupationName: text('Occupation', 100),
      laborSeconds: { ...number('Labor seconds', 1), maximum: 28_800 },
      enterpriseId: enterprise.enterpriseId,
    },
    ['occupationName', 'laborSeconds'],
  ),
  world(
    'produce',
    'AgentProduce',
    'Produce a commodity with real inputs, qualifications and time. Missing resources cause rejection.',
    {
      ...commodity,
      availableLaborSeconds: { ...number('Labor seconds', 1), maximum: 28_800 },
      enterpriseId: enterprise.enterpriseId,
    },
    ['commodityName', 'quantity', 'availableLaborSeconds'],
  ),
  world(
    'apply_job',
    'AgentApplyJob',
    'Apply for an occupation; eligibility and hiring are checked by the world.',
    { occupationName: text('Occupation', 100) },
  ),
  world(
    'give',
    'AgentGiveResource',
    'Give a commodity you own to another resident under world rules.',
    { ...commodity, targetAgentId: text('Recipient ID', 96), note: text('Your note', 300) },
    ['commodityName', 'quantity', 'targetAgentId'],
  ),
  world(
    'found_enterprise',
    'AgentFoundEnterprise',
    'Found an enterprise using your own funds. This is a request, not permission to create money or employees.',
    {
      ...enterprise,
      name: text('Enterprise name', 120),
      occupationName: text('Occupation', 100),
      initialCapital: number('Capital', 0.01),
      maxEmployees: { ...integer('Capacity', 1000), minimum: 1 },
    },
  ),
  world(
    'join_enterprise',
    'AgentJoinEnterprise',
    'Apply to join an enterprise under hiring rules.',
    enterprise,
  ),
  world(
    'leave_enterprise',
    'AgentLeaveEnterprise',
    'Leave an enterprise you currently work for.',
    enterprise,
  ),
  world(
    'fund_enterprise',
    'AgentFundEnterprise',
    'Transfer your money into an enterprise under ownership rules.',
    { ...enterprise, amount: number('Amount', 0.01) },
  ),
  world(
    'close_enterprise',
    'AgentCloseEnterprise',
    'Request closure of an enterprise you control.',
    enterprise,
  ),
  world(
    'post_job',
    'AgentSetEnterpriseJobPosting',
    'Set a hiring offer for an enterprise you control.',
    { ...enterprise, wageOffer: number('Wage'), openSlots: integer('Open positions', 1000) },
  ),
  world('deposit', 'AgentDeposit', 'Deposit your money into the town bank.', {
    amount: number('Amount', 0.01),
  }),
  world('withdraw', 'AgentWithdraw', 'Withdraw from your bank deposit.', {
    amount: number('Amount', 0.01),
  }),
  world('borrow', 'AgentRequestLoan', 'Request a bank loan subject to credit and reserve rules.', {
    amount: number('Amount', 0.01),
  }),
  world(
    'export',
    'AgentExportCommodity',
    'Export goods through the external market under world rules.',
    { ...commodity, asEnterpriseId: enterprise.enterpriseId },
    ['commodityName', 'quantity'],
  ),
  world(
    'import',
    'AgentImportCommodity',
    'Import goods through the external market under world rules.',
    { ...commodity, asEnterpriseId: enterprise.enterpriseId },
    ['commodityName', 'quantity'],
  ),
  world(
    'upgrade_home',
    'AgentUpgradeResidentialTier',
    'Request a housing tier upgrade; world calculates costs and eligibility.',
    { targetResidentialTier: { ...integer('Target housing tier', 20), minimum: 1 } },
  ),
  world(
    'choose_residence',
    'AgentChooseResidence',
    'Choose a residence under available housing rules.',
    { locationId: text('Residence location ID', 96) },
  ),
  world(
    'build_housing',
    'AgentBuildHousing',
    'Request construction at a location, subject to resources and world policy.',
    { locationId: text('Location ID', 96) },
  ),
  world(
    'apply_exam',
    'AgentApplyEducationExam',
    'Apply to an education examination; world controls qualifications and admission.',
    { targetLevel: { ...integer('Target level', 5), minimum: 1 } },
  ),
  world(
    'raise_petition',
    'AgentRaisePetition',
    'Publish a petition under existing collective-action rules.',
    { topic: text('Topic', 100), statement: text('Original statement', 1000) },
  ),
  world('sign_petition', 'AgentSignPetition', 'Sign an existing petition as yourself.', {
    petitionId: text('Petition ID', 200),
  }),
  world(
    'post_bulletin',
    'AgentPostBulletin',
    'Publish a public bulletin under existing authority rules.',
    { title: text('Title', 200), body: text('Original body', 2000) },
  ),
  world(
    'raise_matter',
    'AgentRaiseMatter',
    'Raise a real help request in the existing social-matters domain.',
    {
      topic: text('Topic', 200),
      statement: text('Original statement', 2000),
      expiresInMs: integer('Lifetime in simulation milliseconds'),
    },
    ['topic', 'statement'],
  ),
  world('respond_matter', 'AgentRespondMatter', 'Personally respond to a public matter.', {
    matterId: text('Matter ID', 200),
    decision: choice(['accept', 'reject', 'defer', 'withdraw']),
  }),
  world('assign_matter', 'AgentAssignMatter', 'Assign your matter to a consenting responder.', {
    matterId: text('Matter ID', 200),
    assigneeAgentId: text('Resident', 96),
  }),
  world(
    'close_matter',
    'AgentCloseMatter',
    'Request closure; the existing world validates evidence.',
    { matterId: text('Matter ID', 200), outcome: choice(['fulfilled', 'breached', 'withdrawn']) },
  ),
];
export const OPEN_SOCIETY_TOOLS: readonly OpenToolDefinition[] = [
  ...OPEN_INFORMATION_TOOLS,
  ...DISTRIBUTION_TOOLS,
  ...COMMUNICATION_TOOLS,
  ...COLLABORATION_TOOLS,
  ...COMMERCE_TOOLS,
  ...SERVICES_TOOLS,
  ...LIFE_TOOLS,
  ...MOBILITY_TOOLS,
  ...OPEN_WORLD_TOOLS,
];
