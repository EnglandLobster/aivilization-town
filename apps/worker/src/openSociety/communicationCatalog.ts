import { tool, text, integer, page } from './capabilitySchema';
const groupId = text('Group ID', 96),
  id = text('Record ID', 96),
  expectedRevision = integer('Current group revision');
export const COMMUNICATION_TOOLS = [
  tool(
    'notifications.settings',
    'Read your current message wake and subscription context preferences.',
    false,
    {},
  ),
  tool('groups.create', 'Create a group with only yourself as initial member.', true, {
    id,
    title: text('Original title', 120),
  }),
  tool('groups.list', 'List groups you belong to.', false, { ...page }, []),
  tool(
    'groups.invitations',
    'Read invitations addressed to you and applications to your groups.',
    false,
    { ...page },
    [],
  ),
  tool('groups.invite', 'Invite a resident; they must independently accept.', true, {
    groupId,
    residentId: text('Resident ID', 96),
  }),
  tool('groups.join-request', 'Request membership; owner must approve.', true, { groupId }),
  ...['accept', 'reject'].map((op) =>
    tool(`groups.${op}`, 'Respond to an invitation (invitee) or application (owner).', true, {
      id,
      expectedRevision,
    }),
  ),
  tool('groups.transfer', 'Transfer ownership to an existing member.', true, {
    groupId,
    targetId: text('Member ID', 96),
    expectedRevision,
  }),
  ...['leave', 'close'].map((op) =>
    tool(
      `groups.${op}`,
      'Leave as member or close as owner. History retains original authors.',
      true,
      { groupId, expectedRevision },
    ),
  ),
  ...['members', 'messages'].map((op) =>
    tool(`groups.${op}`, 'Read a group you currently belong to.', false, { groupId, ...page }, [
      'groupId',
    ]),
  ),
  tool('groups.send', 'Send your original message as a current member.', true, {
    groupId,
    content: text('Original message'),
  }),
  ...['add', 'remove'].map((op) =>
    tool(
      `blocks.${op}`,
      'Control messages/invitations from another resident without changing anyone’s feelings.',
      true,
      { targetId: text('Resident ID', 96) },
    ),
  ),
  tool('blocks.list', 'Read your own blocked residents.', false, { ...page }, []),
  tool(
    'notifications.configure',
    'Set private-message wake and subscription context preferences. No automatic group wake.',
    true,
    { directWake: { type: 'boolean' }, subscriptionContext: { type: 'boolean' } },
  ),
];
