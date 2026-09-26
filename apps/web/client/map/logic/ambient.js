/**
 * Ambient-life indicators for the living-town canvas (pure module).
 *
 * Maps authoritative projection slices onto small, honest ambient visuals:
 *
 * - `activityTimeByAgent` → per-agent activity bubbles (a sleeping Agent gets
 *   "z z", a working one a hammer glyph…). Only *ongoing* activities render
 *   (`now < availableAt`); travel is skipped because movement already shows it.
 * - `conversationRecords` → short-lived speech links between co-located
 *   participants, faded by `recordedAt` age within a sim-time window.
 * - `townPulse` → the town-news ticker: the most recent pulse records inside
 *   a recency window, newest first, with a deterministic fade by age.
 *
 * Every function is flag-aware: missing slices produce empty results.
 */

const ACTIVITY_ICON_KINDS = {
  sleep: 'zzz',
  education: 'book',
  labor: 'hammer',
  production: 'hammer',
  trade: 'coin',
  healthcare: 'cross',
};

/** Conversation links stay visible this long (simulation ms). */
export const CONVERSATION_WINDOW_MS = 300_000;
/** Pulse records stay on the ticker this long (simulation ms). */
export const PULSE_WINDOW_MS = 600_000;
/** Maximum ticker entries rendered at once. */
export const PULSE_TICKER_LIMIT = 3;

/**
 * Ongoing activity per agent. Returns `{ agentId: iconKind }`; activities
 * that already ended and unknown kinds are dropped.
 */
export function computeActivityBubbles(activityTimeByAgent, nowMs) {
  const bubbles = {};
  for (const entry of Object.values(activityTimeByAgent || {})) {
    if (!entry?.agentId) continue;
    const icon = ACTIVITY_ICON_KINDS[entry.activity];
    if (!icon) continue;
    const availableAt = Number(entry.availableAt);
    if (Number.isFinite(availableAt) && nowMs >= availableAt) continue;
    bubbles[entry.agentId] = icon;
  }
  return bubbles;
}

/**
 * Active conversations: latest record per conversationId whose `recordedAt`
 * is inside the window. Returns `[{ conversationId, participantAgentIds,
 * topic, age01 }]` sorted newest first.
 */
export function computeConversationLinks(
  conversationRecords,
  nowMs,
  windowMs = CONVERSATION_WINDOW_MS,
) {
  const byConversation = new Map();
  for (const record of asArray(conversationRecords)) {
    if (!record?.conversationId) continue;
    const recordedAt = Number(record.recordedAt);
    if (!Number.isFinite(recordedAt) || nowMs - recordedAt > windowMs) continue;
    const existing = byConversation.get(record.conversationId);
    if (!existing || recordedAt > existing.recordedAt) {
      byConversation.set(record.conversationId, { ...record, recordedAt });
    }
  }
  return [...byConversation.values()]
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .map((record) => ({
      conversationId: record.conversationId,
      participantAgentIds: [...(record.participantAgentIds || [])],
      topic: record.topic || '',
      age01: Math.min(1, Math.max(0, (nowMs - record.recordedAt) / windowMs)),
    }));
}

/**
 * Town-pulse ticker entries: newest `PULSE_TICKER_LIMIT` records inside the
 * recency window, newest first, each with `age01` for fading.
 */
export function computePulseTicker(townPulse, nowMs, windowMs = PULSE_WINDOW_MS) {
  return asArray(townPulse)
    .filter((record) => {
      const occurredAt = Number(record?.occurredAt);
      return Number.isFinite(occurredAt) && occurredAt <= nowMs && nowMs - occurredAt <= windowMs;
    })
    .sort((a, b) => (b.sequence || 0) - (a.sequence || 0))
    .slice(0, PULSE_TICKER_LIMIT)
    .map((record) => ({
      ...record,
      age01: Math.min(1, Math.max(0, (nowMs - record.occurredAt) / windowMs)),
    }));
}

const PULSE_ICONS = {
  death: '†',
  emigration: '→',
  arrival: '＋',
  'petition-threshold': '✉',
  'weather-change': '☂',
  'enterprise-founded': '▲',
  'enterprise-closed': '▼',
};

/** Human label + icon for one town-pulse record (unknown kinds fall back). */
export function describePulseRecord(record) {
  const kind = String(record?.kind || '');
  const subject = record?.subjectDisplayName || record?.subjectAgentId || '';
  switch (kind) {
    case 'death':
      return { icon: '†', text: subject ? `${subject} passed away` : 'A resident passed away' };
    case 'emigration':
      return { icon: '→', text: subject ? `${subject} left town` : 'A resident left town' };
    case 'arrival':
      return { icon: '＋', text: subject ? `${subject} arrived` : 'A new resident arrived' };
    case 'petition-threshold':
      return { icon: '✉', text: 'A petition reached its threshold' };
    case 'weather-change':
      return {
        icon: '☂',
        text: record?.detail ? `Weather: ${record.detail}` : 'The weather changed',
      };
    case 'enterprise-founded':
      return {
        icon: '▲',
        text: record?.subjectEnterpriseName
          ? `${record.subjectEnterpriseName} founded`
          : 'A new enterprise opened',
      };
    case 'enterprise-closed':
      return {
        icon: '▼',
        text: record?.subjectEnterpriseName
          ? `${record.subjectEnterpriseName} closed`
          : 'An enterprise closed',
      };
    default:
      return { icon: PULSE_ICONS[kind] || '·', text: record?.detail || kind || 'Town news' };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
