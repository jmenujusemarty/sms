import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const MESSAGE_KINDS = new Set(["service", "campaign"]);

export async function createStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  return {
    filePath,
    async read() {
      try {
        const raw = await readFile(filePath, "utf8");
        return normalizeState(JSON.parse(raw));
      } catch (error) {
        if (error.code === "ENOENT") return emptyState();
        throw error;
      }
    },
    async write(state) {
      const normalized = normalizeState(state);
      await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
      return normalized;
    },
    async mutate(fn) {
      const state = await this.read();
      const result = await fn(state);
      await this.write(state);
      return result;
    }
  };
}

export function emptyState() {
  return {
    users: [],
    sessions: [],
    apiTokens: [],
    contacts: [],
    groups: [],
    templates: [],
    campaigns: [],
    messages: [],
    blacklist: [],
    events: [],
    audit: []
  };
}

export function normalizePhone(phone) {
  if (typeof phone !== "string") throw new Error("phone must be a string");
  const compact = phone.replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(compact)) {
    throw new Error("phone must be in international format, for example +420777123456");
  }
  return compact;
}

export function normalizeKind(kind) {
  const normalized = kind || "service";
  if (!MESSAGE_KINDS.has(normalized)) {
    throw new Error("kind must be service or campaign");
  }
  return normalized;
}

export function createMessage(input, now = new Date()) {
  const text = String(input.text || "").trim();
  if (text.length === 0) throw new Error("text is required");
  if (text.length > 918) throw new Error("text is too long for a safe SMS batch");

  return {
    id: crypto.randomUUID(),
    to: normalizePhone(input.to),
    text,
    kind: normalizeKind(input.kind),
    status: "queued",
    attempts: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextAttemptAt: now.toISOString(),
    lastError: null
  };
}

export async function enqueueMessage(store, input, now = new Date()) {
  const message = createMessage(input, now);
  await store.mutate((state) => {
    state.messages.push(message);
    state.events.push(event("queued", message.id, { kind: message.kind }, now));
  });
  return message;
}

export async function addToBlacklist(store, phone, reason = "manual", now = new Date()) {
  const normalized = normalizePhone(phone);
  await store.mutate((state) => {
    if (!state.blacklist.includes(normalized)) state.blacklist.push(normalized);
    state.events.push(event("blacklisted", null, { phone: normalized, reason }, now));
  });
  return { phone: normalized, reason };
}

export function event(type, messageId, details = {}, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    type,
    messageId,
    details,
    createdAt: now.toISOString()
  };
}

function normalizeState(raw) {
  const base = emptyState();
  for (const key of Object.keys(base)) {
    base[key] = Array.isArray(raw?.[key]) ? raw[key] : base[key];
  }
  return base;
}
