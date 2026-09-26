export function describePulseRecord(record: Record<string, unknown>): {
  icon: string;
  text: string;
};
export function computeActivityBubbles(
  activities: Record<string, unknown>,
  nowMs: number,
): Record<string, string>;
export function computeConversationLinks(
  records: Record<string, unknown>[],
  nowMs: number,
): { conversationId: string; participantAgentIds: string[]; topic: string; age01: number }[];
