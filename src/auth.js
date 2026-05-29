import crypto from "node:crypto";
import { audit, ROLES } from "./domain.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const normalized = String(password || "");
  if (normalized.length < 8) throw new Error("password must have at least 8 characters");
  const hash = await pbkdf2(normalized, salt);
  return `pbkdf2$${salt}$${hash}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const expected = await pbkdf2(String(password || ""), parts[1]);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
}

export async function ensureBootstrapAdmin(state, config, now = new Date()) {
  if (state.users.length > 0) return null;
  const password = config.adminPassword || "ChangeMe123!";
  const user = {
    id: crypto.randomUUID(),
    email: config.adminEmail || "admin@example.local",
    name: "Admin",
    role: "admin",
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  state.users.push(user);
  if (config.devApiToken) {
    state.apiTokens.push(createApiTokenRecord(config.devApiToken, user.id, "Configured dev token", now));
  }
  audit(state, user, "auth.bootstrap_admin", { userId: user.id }, now);
  return user;
}

export async function createUser(state, input, actor, now = new Date()) {
  requireRole(actor, "admin");
  const email = normalizeEmail(input.email);
  if (state.users.some((user) => user.email === email)) throw new Error("email already exists");
  const role = input.role || "operator";
  if (!ROLES.includes(role)) throw new Error("invalid role");
  const user = {
    id: crypto.randomUUID(),
    email,
    name: String(input.name || email).trim(),
    role,
    passwordHash: await hashPassword(input.password || crypto.randomBytes(12).toString("hex")),
    active: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  state.users.push(user);
  audit(state, actor, "user.created", { userId: user.id, role }, now);
  return publicUser(user);
}

export function issueApiToken(state, input, actor, now = new Date()) {
  requireRole(actor, "admin");
  const token = crypto.randomBytes(32).toString("hex");
  const record = createApiTokenRecord(token, actor.id, String(input.name || "API token").trim(), now);
  state.apiTokens.push(record);
  audit(state, actor, "token.created", { tokenId: record.id, name: record.name }, now);
  return { token, record: publicApiToken(record) };
}

export function revokeApiToken(state, tokenId, actor, now = new Date()) {
  requireRole(actor, "admin");
  const record = state.apiTokens.find((item) => item.id === tokenId);
  if (!record) throw new Error("token not found");
  record.active = false;
  record.revokedAt = now.toISOString();
  audit(state, actor, "token.revoked", { tokenId }, now);
  return publicApiToken(record);
}

export async function login(state, email, password, now = new Date()) {
  const user = state.users.find((item) => item.email === normalizeEmail(email) && item.active);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("invalid credentials");
  }
  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    token: crypto.randomBytes(32).toString("hex"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  };
  state.sessions.push(session);
  audit(state, user, "auth.login", { sessionId: session.id }, now);
  return { token: session.token, user: publicUser(user), expiresAt: session.expiresAt };
}

export function authenticate(state, authHeader, now = new Date()) {
  const token = parseBearer(authHeader);
  if (!token) return null;

  const session = state.sessions.find((item) => item.token === token && new Date(item.expiresAt) > now);
  if (session) return publicUser(state.users.find((user) => user.id === session.userId && user.active));

  const apiToken = state.apiTokens.find((item) => item.tokenHash === sha256(token) && item.active);
  if (apiToken) return publicUser(state.users.find((user) => user.id === apiToken.userId && user.active));

  return null;
}

export function requireRole(actor, minimumRole) {
  if (!actor) throw new Error("authentication required");
  if (roleRank(actor.role) > roleRank(minimumRole)) throw new Error("forbidden");
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active
  };
}

export function publicApiToken(record) {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    active: record.active,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt || null,
    lastUsedAt: record.lastUsedAt || null
  };
}

export function createApiTokenRecord(token, userId, name, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    userId,
    name,
    tokenHash: sha256(token),
    active: true,
    createdAt: now.toISOString()
  };
}

function parseBearer(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  return match ? match[1].trim() : null;
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error("valid email is required");
  return normalized;
}

function roleRank(role) {
  const rank = { admin: 0, operator: 1, viewer: 2 };
  return rank[role] ?? 99;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pbkdf2(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 120000, 32, "sha256", (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
}
