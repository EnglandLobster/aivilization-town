import { RESOURCE_PRINCIPAL_TOOLS } from './resourcePrincipalCatalog';
import { HOUSING_OCCUPANCY_TOOLS } from './housingOccupancyCatalog';
import { HOUSING_CHOICE_TOOLS } from './housingChoiceCatalog';
import { PREMISES_TOOLS } from './premisesCatalog';
import { MATERIAL_TOOLS } from './materialCatalog';
import { PUBLIC_GOVERNANCE_TOOLS } from './publicGovernanceCatalog';
import { RESOURCE_CONTROL_TOOLS } from './resourceControlCatalog';
import { COMMON_ACCOUNT_TOOLS } from './commonAccountCatalog';
import { COLLECTIVE_TOOLS } from './collectiveCatalog';
import { KERNEL_TOOLS } from './kernelCatalog';
import { LIFE_TOOLS } from './lifeCatalog';
import { COMMERCE_TOOLS } from './commerceCatalog';
import { COLLABORATION_TOOLS } from './collaborationCatalog';
import type { OpenToolDefinition, OpenToolProperty } from '@aivilization/agent-runtime';
import type { CoreCommandType } from '@aivilization/sim-core';
import { DOCUMENT_METADATA_POLICY } from '@aivilization/information';
export const OPEN_CAPABILITY_CATALOG_VERSION = 'open-capabilities-v69';

import { text, number, integer, choice, strings, tool, page } from './capabilitySchema';
export { text, tool } from './capabilitySchema';
import { COMMUNICATION_TOOLS } from './communicationCatalog';

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
    'Read your own state, location/people, public destinations, market, rules, running action, or fiscal tax/subsidy aggregates. Fiscal is a bounded historical subset, not a complete treasury ledger; use its cursor. Others private state is not visible.',
    false,
    {
      view: choice([
        'self',
        'location',
        'locations',
        'market',
        'rules',
        'action',
        'study',
        'qualifications',
        'labor',
        'enterprises',
        'fiscal',
      ]),
      section: text(
        'Rule group (index lists names), or your exact own session ID when view=study/labor',
        200,
      ),
      cursor: text(
        'Only view=fiscal: use its returned nextCursor for older facts; do not use section/offset/limit for this view.',
        160,
      ),
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
    id: text(
      'Your full reminder ID returned by remind/list, or the original local ID. Only your own reminder can be cancelled.',
      193,
    ),
  }),
  tool(
    'schedule.plan',
    'Queue up to eight of your own actions to be carried out one after another without a new opportunity per step. You are woken when the plan finishes, a step is refused, or a paced message arrives. Replaces your current plan. Each step is an ordinary authorized command.',
    true,
    {
      id: text('Your plan ID', 96),
      note: text('Why you are doing this, in your own words', 1000),
      steps: {
        ...strings,
        minItems: 1,
        maxItems: 8,
        description:
          "One town command per step, exactly as you would type it, e.g. 'town travel go --target-location-id workshop'. Only your own actions; plannable in your context lists which commands this town allows. Use --expected-revision current / --source-revision current for revisions you cannot know yet, and production start --until complete to work until the batch is done.",
      },
    },
  ),
  tool(
    'schedule.plan-cancel',
    'Stop your current plan before its next step. Steps already carried out stay done.',
    true,
    {},
    [],
  ),
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
    'stop_rest',
    'AgentStopRest',
    'Personally stop your active elapsed sleep. Read its id and revision with town city observe --view action. Only already elapsed recovery is retained; requires elapsed-rest policy.',
    {
      id: text('Your active rest session ID', 200),
      expectedRevision: number('Observed session revision', 1),
    },
  ),
  world(
    'study',
    'AgentStudy',
    'Study at an appropriate facility. Education rate and eligibility are authoritative.',
    duration,
  ),
  world(
    'stop_study',
    'AgentStopStudy',
    'Personally stop an active elapsed study session. Already earned learning remains; unspent tuition returns to its original payer. Requires the explicit elapsed-study mode; query own id/revision with town city observe --view action.',
    {
      id: text('Your active study session ID', 200),
      expectedRevision: number('Observed session revision', 1),
    },
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
    'Work in an occupation you hold. Explicit enterprise-labor mode earns wages and spends effort only over actual time, retains personal unpaid claims and permits early exit. Initial public work retains its recorded policy; inspect city observe --view rules --section labor.',
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
    'Legacy production, disabled when physicalProduction is enabled. In that mode use production recipes/create/start or sources list and production gather/start; actual labor is required.',
    {
      ...commodity,
      availableLaborSeconds: { ...number('Labor seconds', 1), maximum: 28_800 },
      enterpriseId: enterprise.enterpriseId,
    },
    ['commodityName', 'quantity', 'availableLaborSeconds'],
  ),
  world(
    'stop_work',
    'AgentStopWork',
    'Personally end active actual enterprise labor at its current revision; earned wages remain yours. Query city observe --view action for session revision.',
    {
      id: text('Own active labor session ID', 200),
      expectedRevision: integer('Current session revision'),
    },
  ),
  world(
    'claim_wage',
    'AgentClaimWage',
    'Collect only your own earned unpaid wage, including after leaving a firm. Use claim revision from city observe --view labor --section ID. Payment is limited by real employer cash and records withholding.',
    {
      id: text('Own labor session and claim ID', 200),
      expectedRevision: integer('Current claim revision'),
    },
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
    'layoff_employee',
    'AgentLayoffEnterpriseEmployee',
    'Current employer ends one employment. Actual work and personal earned wages remain; future associated labor stops.',
    { ...enterprise, employeeAgentId: text('Exact current employee ID', 96) },
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
];
export const OPEN_SOCIETY_TOOLS: readonly OpenToolDefinition[] = [
  ...PUBLIC_GOVERNANCE_TOOLS,
  ...HOUSING_CHOICE_TOOLS,
  ...HOUSING_OCCUPANCY_TOOLS,
  ...RESOURCE_PRINCIPAL_TOOLS,
  ...MATERIAL_TOOLS,
  ...PREMISES_TOOLS,
  ...KERNEL_TOOLS,
  ...RESOURCE_CONTROL_TOOLS,
  ...COLLECTIVE_TOOLS,
  ...COMMON_ACCOUNT_TOOLS,
  ...OPEN_INFORMATION_TOOLS,
  ...COMMUNICATION_TOOLS,
  ...COLLABORATION_TOOLS,
  ...COMMERCE_TOOLS,
  ...LIFE_TOOLS,
  ...OPEN_WORLD_TOOLS,
];
