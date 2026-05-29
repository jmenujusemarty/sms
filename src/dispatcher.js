import { loadConfig } from "./config.js";
import { event, createStore } from "./store.js";
import { selectNextMessage } from "./policy.js";
import { createSender } from "./senders/index.js";

export async function dispatchOnce({ store, sender, config, now = new Date() }) {
  const lockedResult = await store.tryLock?.("dispatcher", config.dispatchLockMs || 60000, async () => {
    return dispatchWithLock({ store, sender, config, now });
  });
  if (lockedResult?.locked) return { status: "locked" };
  return lockedResult;
}

async function dispatchWithLock({ store, sender, config, now }) {
  return store.mutate(async (state) => {
    const { message, decision } = selectNextMessage(state, config, now);
    if (!message) return { status: "idle", decision };

    if (decision.action === "blocked") {
      message.status = "blocked";
      message.updatedAt = now.toISOString();
      message.lastError = decision.reason;
      state.events.push(event("blocked", message.id, { reason: decision.reason }, now));
      return { status: "blocked", message };
    }

    try {
      message.status = "sending";
      message.attempts += 1;
      message.updatedAt = now.toISOString();
      const result = await sender.send(message);
      const sentAt = new Date();
      message.status = "sent";
      message.sentAt = sentAt.toISOString();
      message.updatedAt = message.sentAt;
      message.provider = result.provider;
      message.providerMessageId = result.providerMessageId;
      message.lastError = null;
      state.events.push(event("sent", message.id, result, sentAt));
      return { status: "sent", message, result };
    } catch (error) {
      const retryAt = new Date(now.getTime() + retryDelayMs(message.attempts));
      message.status = message.attempts >= (config.maxAttempts || 3) ? "failed" : "retry";
      message.updatedAt = now.toISOString();
      message.nextAttemptAt = retryAt.toISOString();
      message.lastError = error.message;
      state.events.push(event("failed", message.id, { error: error.message, retryAt: retryAt.toISOString() }, now));
      return { status: message.status === "failed" ? "failed" : "retry", message, error: error.message };
    }
  });
}

export async function recoverStaleSending(store, now = new Date(), staleMs = 10 * 60 * 1000) {
  return store.mutate((state) => {
    let recovered = 0;
    for (const message of state.messages) {
      if (message.status !== "sending") continue;
      const updatedAt = new Date(message.updatedAt || message.createdAt);
      if (now.getTime() - updatedAt.getTime() < staleMs) continue;
      message.status = "retry";
      message.nextAttemptAt = now.toISOString();
      message.updatedAt = now.toISOString();
      message.lastError = "Recovered stale sending message after restart";
      state.events.push(event("recovered", message.id, { reason: "stale sending" }, now));
      recovered += 1;
    }
    return { recovered };
  });
}

export async function createRuntime(overrides = {}) {
  const config = loadConfig(overrides);
  const store = await createStore(config.dataFile);
  const sender = createSender(config);
  return { config, store, sender };
}

function retryDelayMs(attempts) {
  return Math.min(30 * 60 * 1000, 2 ** Math.max(0, attempts - 1) * 60 * 1000);
}

async function main() {
  const runtime = await createRuntime();
  const args = new Set(process.argv.slice(2));

  if (args.has("--loop")) {
    console.log(`dispatcher started sender=${runtime.sender.name} interval=${runtime.config.dispatchIntervalMs}ms`);
    await recoverStaleSending(runtime.store, new Date(), runtime.config.sendingStaleMs);
    while (true) {
      const result = await dispatchOnce(runtime);
      console.log(JSON.stringify(result));
      await sleep(runtime.config.dispatchIntervalMs);
    }
  }

  const result = await dispatchOnce(runtime);
  console.log(JSON.stringify(result, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
