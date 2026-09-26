import type { OpenToolDefinition } from '@aivilization/agent-runtime';
import { choice, integer, page, text, tool } from './capabilitySchema';

const target = {
  kind: choice(['author', 'space']),
  targetId: text('Existing author or readable space ID', 96),
};
const activity = { id: text('Publication/activity ID', 96) };
export const DISTRIBUTION_TOOLS: readonly OpenToolDefinition[] = [
  tool(
    'subscriptions.follow',
    'Follow an author or subscribe to a readable space from now on. This does not create friendship or change beliefs.',
    true,
    target,
  ),
  tool(
    'subscriptions.unfollow',
    'Stop a subscription. Following again starts with future publications only.',
    true,
    target,
  ),
  tool(
    'subscriptions.list',
    'List only your own subscriptions, including inactive entries.',
    false,
    page,
    [],
  ),
  tool(
    'feed.list',
    'Read metadata of future publications from your subscribed sources, newest sequence first. No summaries, ranking or implicit read receipt.',
    false,
    page,
    [],
  ),
  tool(
    'feed.read',
    'Read a publication and the exact referenced original document version. Current permissions and source deletion still apply; does not mark a notification read.',
    false,
    activity,
  ),
  tool(
    'feed.share',
    'Share a public original document version with your optional unmodified comment. Private sources cannot be reshared. Your followers see your publication.',
    true,
    {
      documentId: text('Source document ID', 340),
      revision: { ...integer('Exact source revision'), minimum: 1 },
      comment: text('Your own original comment, never summarized', 2000),
    },
    ['documentId', 'revision'],
  ),
  tool(
    'notifications.list',
    'List your subscription notifications. Unread only by default. Does not wake you or change your plan.',
    false,
    { unreadOnly: { type: 'boolean' }, ...page },
    [],
  ),
  tool(
    'notifications.read',
    'Read the pinned original and acknowledge only your own subscription notification. Repeated acknowledgement is idempotent.',
    true,
    activity,
  ),
];
