import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const MESSAGE_KINDS = new Set(["service", "campaign"]);
export const SCHEMA_VERSION = 1;
const COLLECTIONS = ["users", "sessions", "apiTokens", "contacts", "groups", "templates", "campaigns", "messages", "blacklist", "events", "audit"];

export async function createStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (filePath.endsWith(".json")) return createJsonStore(filePath);
  return createSqliteStore(filePath);
}

function createSqliteStore(filePath) {
  const db = new DatabaseSync(filePath);
  migrate(db);

  return {
    filePath,
    kind: "sqlite",
    async read() {
      return readSqliteState(db);
    },
    async write(state) {
      writeSqliteState(db, normalizeState(state));
      return normalizeState(state);
    },
    async mutate(fn) {
      return withStoreLock(db, async () => {
        const state = readSqliteState(db);
        const result = await fn(state);
        writeSqliteState(db, state);
        return result;
      }, { returnLocked: false });
    },
    async tryLock(name, ttlMs, fn) {
      return withNamedLock(db, name, ttlMs, fn);
    },
    async importJson(jsonPath, { force = false } = {}) {
      if (!existsSync(jsonPath)) return { imported: false, reason: "json file not found" };
      const current = readSqliteState(db);
      const hasData = COLLECTIONS.some((key) => current[key].length > 0);
      if (hasData && !force) return { imported: false, reason: "database is not empty" };
      const raw = JSON.parse(await readFile(jsonPath, "utf8"));
      const imported = mergeImportState(current, raw);
      writeSqliteState(db, imported);
      return { imported: true };
    },
    async exportJson(outputPath = `${filePath}.${new Date().toISOString().replaceAll(":", "-")}.backup.json`) {
      const state = readSqliteState(db);
      await writeFile(outputPath, `${JSON.stringify(state, null, 2)}\n`);
      return {
        path: outputPath,
        messages: state.messages.length,
        contacts: state.contacts.length,
        campaigns: state.campaigns.length,
        audit: state.audit.length
      };
    },
    close() {
      db.close();
    }
  };
}

function createJsonStore(filePath) {
  return {
    filePath,
    kind: "json",
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
    },
    async tryLock(_name, _ttlMs, fn) {
      return fn();
    },
    async importJson(jsonPath, { force = false } = {}) {
      const current = await this.read();
      const hasData = COLLECTIONS.some((key) => current[key].length > 0);
      if (hasData && !force) return { imported: false, reason: "store is not empty" };
      const raw = JSON.parse(await readFile(jsonPath, "utf8"));
      await this.write(mergeImportState(current, raw));
      return { imported: true };
    },
    async exportJson(outputPath = `${filePath}.${new Date().toISOString().replaceAll(":", "-")}.backup.json`) {
      const state = await this.read();
      await writeFile(outputPath, `${JSON.stringify(state, null, 2)}\n`);
      return {
        path: outputPath,
        messages: state.messages.length,
        contacts: state.contacts.length,
        campaigns: state.campaigns.length,
        audit: state.audit.length
      };
    }
  };
}

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
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

function migrate(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_items (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  const current = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
  if (!current) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)").run(String(SCHEMA_VERSION));
  }
}

function readSqliteState(db) {
  const state = emptyState();
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
  state.schemaVersion = Number(version?.value || SCHEMA_VERSION);
  const rows = db.prepare("SELECT collection, data FROM collection_items ORDER BY rowid ASC").all();
  for (const row of rows) {
    if (!Array.isArray(state[row.collection])) continue;
    state[row.collection].push(JSON.parse(row.data));
  }
  return state;
}

function writeSqliteState(db, state) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM collection_items").run();
    const insert = db.prepare("INSERT INTO collection_items (collection, id, data) VALUES (?, ?, ?)");
    for (const collection of COLLECTIONS) {
      for (const item of state[collection]) {
        const id = itemId(collection, item);
        insert.run(collection, id, JSON.stringify(item));
      }
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)").run(String(SCHEMA_VERSION));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function withStoreLock(db, fn) {
  return withNamedLock(db, "store-write", 30000, fn, { returnLocked: false });
}

async function withNamedLock(db, name, ttlMs, fn, options = { returnLocked: true }) {
  const owner = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.prepare("DELETE FROM locks WHERE name = ? AND expires_at < ?").run(name, now.toISOString());
  try {
    db.prepare("INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)").run(name, owner, expiresAt);
  } catch {
    if (options.returnLocked === false) throw new Error(`lock unavailable: ${name}`);
    return { locked: true };
  }

  try {
    return await fn();
  } finally {
    db.prepare("DELETE FROM locks WHERE name = ? AND owner = ?").run(name, owner);
  }
}

function itemId(collection, item) {
  if (collection === "blacklist") return item;
  return item.id || crypto.randomUUID();
}

function normalizeState(raw) {
  const base = emptyState();
  for (const key of COLLECTIONS) {
    base[key] = Array.isArray(raw?.[key]) ? raw[key] : base[key];
  }
  return base;
}

function mergeImportState(current, raw) {
  const imported = normalizeState(raw);
  for (const key of ["users", "sessions", "apiTokens"]) {
    if (!Array.isArray(raw?.[key]) || raw[key].length === 0) imported[key] = current[key];
  }
  return imported;
}
