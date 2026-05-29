import test from "node:test";
import assert from "node:assert/strict";
import { canSendMessage, isQuietHours, selectNextMessage } from "../src/policy.js";
import { loadConfig } from "../src/config.js";

const baseConfig = loadConfig({
  serviceDailyLimit: 2,
  campaignDailyLimit: 1,
  serviceMinGapSeconds: 10,
  campaignMinGapSeconds: 60,
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00"
});

test("service messages take priority over campaign messages", () => {
  const now = new Date("2026-05-29T10:00:00.000Z");
  const state = {
    blacklist: [],
    messages: [
      queued("campaign", "+420777000001", "2026-05-29T09:00:00.000Z"),
      queued("service", "+420777000002", "2026-05-29T09:30:00.000Z")
    ]
  };

  const result = selectNextMessage(state, baseConfig, now);
  assert.equal(result.message.kind, "service");
});

test("blacklisted recipient is blocked", () => {
  const message = queued("service", "+420777000001");
  const decision = canSendMessage({ blacklist: [message.to], messages: [message] }, message, baseConfig);
  assert.equal(decision.allowed, false);
  assert.equal(decision.action, "blocked");
});

test("campaign messages respect quiet hours", () => {
  const now = new Date("2026-05-29T22:15:00.000Z");
  assert.equal(isQuietHours(now, baseConfig), true);

  const message = queued("campaign", "+420777000001");
  const decision = canSendMessage({ blacklist: [], messages: [message] }, message, baseConfig, now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "campaign quiet hours");
});

test("daily campaign limit is enforced", () => {
  const now = new Date("2026-05-29T10:00:00.000Z");
  const message = queued("campaign", "+420777000002");
  const sent = {
    ...queued("campaign", "+420777000001"),
    status: "sent",
    sentAt: "2026-05-29T09:00:00.000Z"
  };
  const decision = canSendMessage({ blacklist: [], messages: [sent, message] }, message, baseConfig, now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "daily limit reached");
});

function queued(kind, to, createdAt = "2026-05-29T09:00:00.000Z") {
  return {
    id: `${kind}-${to}`,
    to,
    text: "hello",
    kind,
    status: "queued",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    nextAttemptAt: createdAt
  };
}

