import crypto from "node:crypto";
import { event, normalizePhone } from "./store.js";

export const ROLES = ["admin", "operator", "viewer"];

export function createContact(input, now = new Date()) {
  const name = stringField(input.name, "name");
  const phone = normalizePhone(input.phone);
  return {
    id: crypto.randomUUID(),
    name,
    phone,
    email: optionalString(input.email),
    fields: plainObject(input.fields),
    marketingConsent: Boolean(input.marketingConsent),
    consentSource: optionalString(input.consentSource),
    consentAt: input.marketingConsent ? now.toISOString() : null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createGroup(input, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    name: stringField(input.name, "name"),
    description: optionalString(input.description),
    contactIds: uniqueStrings(input.contactIds),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createTemplate(input, now = new Date()) {
  const body = stringField(input.body, "body");
  if (body.length > 918) throw new Error("template body is too long");
  return {
    id: crypto.randomUUID(),
    name: stringField(input.name, "name"),
    kind: input.kind === "campaign" ? "campaign" : "service",
    body,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createCampaign(input, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    name: stringField(input.name, "name"),
    groupId: stringField(input.groupId, "groupId"),
    templateId: stringField(input.templateId, "templateId"),
    status: "draft",
    queuedMessageIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    queuedAt: null
  };
}

export function audit(state, actor, action, details = {}, now = new Date()) {
  const item = {
    id: crypto.randomUUID(),
    actorUserId: actor?.id || null,
    actorRole: actor?.role || null,
    action,
    details,
    createdAt: now.toISOString()
  };
  state.audit.push(item);
  return item;
}

export function upsertContact(state, input, actor, now = new Date()) {
  const existing = input.id ? state.contacts.find((contact) => contact.id === input.id) : null;
  if (existing) {
    existing.name = stringField(input.name ?? existing.name, "name");
    existing.phone = normalizePhone(input.phone ?? existing.phone);
    existing.email = optionalString(input.email ?? existing.email);
    existing.fields = plainObject(input.fields ?? existing.fields);
    if (input.marketingConsent !== undefined) {
      existing.marketingConsent = Boolean(input.marketingConsent);
      existing.consentAt = existing.marketingConsent ? now.toISOString() : null;
    }
    existing.consentSource = optionalString(input.consentSource ?? existing.consentSource);
    existing.updatedAt = now.toISOString();
    audit(state, actor, "contact.updated", { contactId: existing.id }, now);
    return existing;
  }

  const contact = createContact(input, now);
  if (state.contacts.some((item) => item.phone === contact.phone)) {
    throw new Error("contact phone already exists");
  }
  state.contacts.push(contact);
  audit(state, actor, "contact.created", { contactId: contact.id }, now);
  return contact;
}

export function addGroup(state, input, actor, now = new Date()) {
  const group = createGroup(input, now);
  ensureContactsExist(state, group.contactIds);
  state.groups.push(group);
  audit(state, actor, "group.created", { groupId: group.id }, now);
  return group;
}

export function addTemplate(state, input, actor, now = new Date()) {
  const template = createTemplate(input, now);
  state.templates.push(template);
  audit(state, actor, "template.created", { templateId: template.id }, now);
  return template;
}

export function addCampaign(state, input, actor, now = new Date()) {
  if (!state.groups.some((group) => group.id === input.groupId)) throw new Error("group not found");
  if (!state.templates.some((template) => template.id === input.templateId)) throw new Error("template not found");
  const campaign = createCampaign(input, now);
  state.campaigns.push(campaign);
  audit(state, actor, "campaign.created", { campaignId: campaign.id }, now);
  return campaign;
}

export function appendEvent(state, type, messageId, details, now = new Date()) {
  const item = event(type, messageId, details, now);
  state.events.push(item);
  return item;
}

export function cancelMessage(state, messageId, actor, now = new Date()) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) throw new Error("message not found");
  if (!["queued", "retry"].includes(message.status)) throw new Error("message cannot be cancelled");
  message.status = "cancelled";
  message.updatedAt = now.toISOString();
  audit(state, actor, "message.cancelled", { messageId }, now);
  appendEvent(state, "cancelled", messageId, {}, now);
  return message;
}

export function renderTemplate(body, contact) {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    if (key === "name") return contact.name;
    if (key === "phone") return contact.phone;
    if (key.startsWith("fields.")) return String(contact.fields[key.slice(7)] ?? "");
    return "";
  });
}

function ensureContactsExist(state, contactIds) {
  const known = new Set(state.contacts.map((contact) => contact.id));
  for (const id of contactIds) {
    if (!known.has(id)) throw new Error(`contact not found: ${id}`);
  }
}

function stringField(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item)).filter(Boolean))];
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}
