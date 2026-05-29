import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { addToBlacklist, createStore, enqueueMessage } from "./store.js";
import { createSender } from "./senders/index.js";
import { dispatchOnce } from "./dispatcher.js";
import { addCampaign, addGroup, addTemplate, audit, cancelMessage, upsertContact } from "./domain.js";
import { authenticate, createUser, ensureBootstrapAdmin, issueApiToken, login, publicApiToken, publicUser, requireRole, revokeApiToken } from "./auth.js";
import { queueCampaign } from "./campaigns.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

export async function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = await createStore(config.dataFile);
  const sender = createSender(config);
  await store.mutate((state) => ensureBootstrapAdmin(state, config));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const state = await store.read();
      const actor = authenticate(state, req.headers.authorization);

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, sender: sender.name });
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
        return staticFile(res, "admin.html", "text/html; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname.startsWith("/public/")) {
        return staticFile(res, url.pathname.slice("/public/".length), contentType(url.pathname));
      }

      if (req.method === "POST" && url.pathname === "/api/login") {
        const body = await readJson(req);
        const result = await store.mutate((current) => login(current, body.email, body.password));
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/me") {
        requireRole(actor, "viewer");
        return json(res, 200, { user: actor });
      }

      if (req.method === "GET" && (url.pathname === "/status" || url.pathname === "/api/status")) {
        requireRole(actor, "viewer");
        const current = await store.read();
        return json(res, 200, summarize(current));
      }

      if (req.method === "GET" && url.pathname === "/api/settings") {
        requireRole(actor, "viewer");
        return json(res, 200, safeSettings(config, sender.name));
      }

      if (req.method === "GET" && url.pathname === "/api/metrics") {
        requireRole(actor, "viewer");
        const current = await store.read();
        return json(res, 200, metrics(current, config));
      }

      if (req.method === "GET" && url.pathname === "/api/users") {
        requireRole(actor, "admin");
        return json(res, 200, { users: state.users.map(publicUser) });
      }

      if (req.method === "POST" && url.pathname === "/api/users") {
        const body = await readJson(req);
        const user = await store.mutate((current) => createUser(current, body, actor));
        return json(res, 201, { user });
      }

      if (req.method === "GET" && url.pathname === "/api/tokens") {
        requireRole(actor, "admin");
        return json(res, 200, { tokens: state.apiTokens.map(publicApiToken) });
      }

      if (req.method === "POST" && url.pathname === "/api/tokens") {
        requireRole(actor, "admin");
        const body = await readJson(req);
        const result = await store.mutate((current) => issueApiToken(current, body, actor));
        return json(res, 201, result);
      }

      const tokenRevokeMatch = /^\/api\/tokens\/([^/]+)\/revoke$/.exec(url.pathname);
      if (req.method === "POST" && tokenRevokeMatch) {
        requireRole(actor, "admin");
        const record = await store.mutate((current) => revokeApiToken(current, tokenRevokeMatch[1], actor));
        return json(res, 200, { record });
      }

      if (req.method === "GET" && url.pathname === "/api/contacts") {
        requireRole(actor, "viewer");
        return json(res, 200, { contacts: state.contacts });
      }

      if (req.method === "POST" && url.pathname === "/api/contacts") {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const contact = await store.mutate((current) => upsertContact(current, body, actor));
        return json(res, 201, { contact });
      }

      if (req.method === "GET" && url.pathname === "/api/groups") {
        requireRole(actor, "viewer");
        return json(res, 200, { groups: state.groups });
      }

      if (req.method === "POST" && url.pathname === "/api/groups") {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const group = await store.mutate((current) => addGroup(current, body, actor));
        return json(res, 201, { group });
      }

      if (req.method === "GET" && url.pathname === "/api/templates") {
        requireRole(actor, "viewer");
        return json(res, 200, { templates: state.templates });
      }

      if (req.method === "POST" && url.pathname === "/api/templates") {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const template = await store.mutate((current) => addTemplate(current, body, actor));
        return json(res, 201, { template });
      }

      if (req.method === "GET" && url.pathname === "/api/campaigns") {
        requireRole(actor, "viewer");
        return json(res, 200, { campaigns: state.campaigns });
      }

      if (req.method === "POST" && url.pathname === "/api/campaigns") {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const campaign = await store.mutate((current) => addCampaign(current, body, actor));
        return json(res, 201, { campaign });
      }

      const queueMatch = /^\/api\/campaigns\/([^/]+)\/queue$/.exec(url.pathname);
      if (req.method === "POST" && queueMatch) {
        requireRole(actor, "operator");
        const result = await store.mutate((current) => queueCampaign(current, queueMatch[1], actor));
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/messages") {
        requireRole(actor, "viewer");
        return json(res, 200, { messages: state.messages.slice(-250).reverse() });
      }

      const cancelMatch = /^\/api\/messages\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelMatch) {
        requireRole(actor, "operator");
        const message = await store.mutate((current) => cancelMessage(current, cancelMatch[1], actor));
        return json(res, 200, { message });
      }

      if (req.method === "POST" && (url.pathname === "/messages" || url.pathname === "/api/messages")) {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const message = await enqueueMessage(store, body);
        await store.mutate((current) => audit(current, actor, "message.queued", { messageId: message.id, kind: message.kind }));
        return json(res, 201, { message });
      }

      if (req.method === "GET" && url.pathname === "/api/blacklist") {
        requireRole(actor, "viewer");
        return json(res, 200, { blacklist: state.blacklist });
      }

      if (req.method === "POST" && (url.pathname === "/blacklist" || url.pathname === "/api/blacklist")) {
        requireRole(actor, "operator");
        const body = await readJson(req);
        const result = await addToBlacklist(store, body.phone, body.reason);
        await store.mutate((current) => audit(current, actor, "blacklist.added", result));
        return json(res, 201, result);
      }

      if (req.method === "POST" && (url.pathname === "/dispatch" || url.pathname === "/api/dispatch")) {
        requireRole(actor, "operator");
        const result = await dispatchOnce({ store, sender, config });
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/audit") {
        requireRole(actor, "admin");
        return json(res, 200, { audit: state.audit.slice(-250).reverse() });
      }

      if (req.method === "POST" && url.pathname === "/api/import/json") {
        requireRole(actor, "admin");
        const body = await readJson(req);
        const result = await store.importJson(config.legacyJsonFile, { force: Boolean(body.force) });
        await store.mutate((current) => audit(current, actor, "import.json", result));
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/exports/blacklist") {
        requireRole(actor, "admin");
        return json(res, 200, { exportedAt: new Date().toISOString(), blacklist: state.blacklist });
      }

      if (req.method === "GET" && url.pathname === "/api/exports/audit") {
        requireRole(actor, "admin");
        return json(res, 200, { exportedAt: new Date().toISOString(), audit: state.audit });
      }

      return json(res, 404, { error: "not found" });
    } catch (error) {
      return json(res, httpStatus(error), { error: error.message });
    }
  });
}

function safeSettings(config, senderName) {
  return {
    host: config.host,
    port: config.port,
    sender: senderName,
    dataFile: config.dataFile,
    legacyJsonFile: config.legacyJsonFile,
    serviceDailyLimit: config.serviceDailyLimit,
    campaignDailyLimit: config.campaignDailyLimit,
    serviceMinGapSeconds: config.serviceMinGapSeconds,
    campaignMinGapSeconds: config.campaignMinGapSeconds,
    quietHoursStart: config.quietHoursStart,
    quietHoursEnd: config.quietHoursEnd,
    allowCampaignDuringQuietHours: config.allowCampaignDuringQuietHours,
    maxAttempts: config.maxAttempts,
    dispatchIntervalMs: config.dispatchIntervalMs
  };
}

function metrics(state, config) {
  const summary = summarize(state);
  const retryMessages = state.messages.filter((message) => message.status === "retry");
  const failedMessages = state.messages.filter((message) => message.status === "failed");
  return {
    ...summary,
    limits: {
      serviceDailyLimit: config.serviceDailyLimit,
      campaignDailyLimit: config.campaignDailyLimit,
      serviceMinGapSeconds: config.serviceMinGapSeconds,
      campaignMinGapSeconds: config.campaignMinGapSeconds,
      maxAttempts: config.maxAttempts
    },
    queue: {
      retry: retryMessages.length,
      failed: failedMessages.length,
      nextRetryAt: retryMessages.map((message) => message.nextAttemptAt).filter(Boolean).sort()[0] || null
    }
  };
}

function summarize(state) {
  const byStatus = {};
  const byKind = {};

  for (const message of state.messages) {
    byStatus[message.status] = (byStatus[message.status] || 0) + 1;
    byKind[message.kind] = (byKind[message.kind] || 0) + 1;
  }

  return {
    totals: {
      users: state.users.length,
      contacts: state.contacts.length,
      groups: state.groups.length,
      templates: state.templates.length,
      campaigns: state.campaigns.length,
      messages: state.messages.length,
      blacklist: state.blacklist.length,
      events: state.events.length,
      audit: state.audit.length
    },
    byStatus,
    byKind,
    recentEvents: state.events.slice(-10),
    recentAudit: state.audit.slice(-10)
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function staticFile(res, fileName, type) {
  if (fileName.includes("..")) return json(res, 400, { error: "bad path" });
  try {
    const data = await readFile(path.join(publicDir, fileName));
    res.writeHead(200, {
      "content-type": type,
      "content-length": data.length
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "not found" });
    throw error;
  }
}

function contentType(urlPath) {
  if (urlPath.endsWith(".css")) return "text/css; charset=utf-8";
  if (urlPath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function json(res, statusCode, payload) {
  const raw = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw)
  });
  res.end(raw);
}

function httpStatus(error) {
  if (error.message === "authentication required") return 401;
  if (error.message === "forbidden") return 403;
  if (error.message === "invalid credentials") return 401;
  return 400;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = await createServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`macOS SMS bridge listening on http://${config.host}:${config.port} sender=${config.sender}`);
  });
}
