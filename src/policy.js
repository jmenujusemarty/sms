const BLOCKED_STATUSES = new Set(["sent", "blocked", "cancelled"]);

export function selectNextMessage(state, config, now = new Date()) {
  const sorted = [...state.messages]
    .filter((message) => message.status === "queued" || message.status === "retry")
    .sort((a, b) => priority(a) - priority(b) || new Date(a.createdAt) - new Date(b.createdAt));

  for (const message of sorted) {
    const decision = canSendMessage(state, message, config, now);
    if (decision.action === "blocked") return { message, decision };
    if (decision.allowed) return { message, decision };
  }

  return { message: null, decision: { allowed: false, reason: "no eligible messages" } };
}

export function canSendMessage(state, message, config, now = new Date()) {
  if (!message || BLOCKED_STATUSES.has(message.status)) return deny("message is not sendable");
  if (state.blacklist.includes(message.to)) return deny("recipient is blacklisted", "blocked");
  if (new Date(message.nextAttemptAt || message.createdAt) > now) return deny("message is waiting for retry");

  if (message.kind === "campaign" && !config.allowCampaignDuringQuietHours && isQuietHours(now, config)) {
    return deny("campaign quiet hours");
  }

  const dailyLimit = message.kind === "campaign" ? config.campaignDailyLimit : config.serviceDailyLimit;
  const sentToday = countSentToday(state, message.kind, now);
  if (sentToday >= dailyLimit) return deny("daily limit reached");

  const minGapSeconds = message.kind === "campaign" ? config.campaignMinGapSeconds : config.serviceMinGapSeconds;
  const lastSentAt = lastSentTime(state, message.kind);
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < minGapSeconds * 1000) {
    return deny("minimum gap not elapsed");
  }

  return { allowed: true };
}

export function countSentToday(state, kind, now = new Date()) {
  const today = isoDate(now);
  return state.messages.filter((message) => {
    return message.kind === kind && message.status === "sent" && isoDate(new Date(message.sentAt)) === today;
  }).length;
}

export function isQuietHours(now, config) {
  const current = minutes(now);
  const start = parseClock(config.quietHoursStart);
  const end = parseClock(config.quietHoursEnd);

  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function lastSentTime(state, kind) {
  const times = state.messages
    .filter((message) => message.kind === kind && message.status === "sent" && message.sentAt)
    .map((message) => new Date(message.sentAt).getTime())
    .filter((time) => !Number.isNaN(time));
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function priority(message) {
  return message.kind === "service" ? 0 : 1;
}

function deny(reason, action = "wait") {
  return { allowed: false, reason, action };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function minutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid clock value: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid clock value: ${value}`);
  return hour * 60 + minute;
}
