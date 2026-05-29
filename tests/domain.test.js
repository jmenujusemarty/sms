import test from "node:test";
import assert from "node:assert/strict";
import { addGroup, addTemplate, renderTemplate, upsertContact } from "../src/domain.js";
import { emptyState } from "../src/store.js";

const actor = { id: "admin", role: "admin" };

test("upsertContact creates contact with marketing consent", () => {
  const state = emptyState();
  const contact = upsertContact(state, {
    name: "Jana",
    phone: "+420777123456",
    marketingConsent: true,
    consentSource: "web"
  }, actor);

  assert.equal(contact.marketingConsent, true);
  assert.equal(state.contacts.length, 1);
  assert.equal(state.audit[0].action, "contact.created");
});

test("group validates contact ids", () => {
  const state = emptyState();
  assert.throws(() => addGroup(state, { name: "Bad", contactIds: ["missing"] }, actor), /contact not found/);
});

test("template rendering supports contact fields", () => {
  const state = emptyState();
  const contact = upsertContact(state, {
    name: "Jana",
    phone: "+420777123456",
    fields: { city: "Praha" }
  }, actor);
  const template = addTemplate(state, {
    name: "Greeting",
    body: "Ahoj {{name}}, mesto {{fields.city}}"
  }, actor);

  assert.equal(renderTemplate(template.body, contact), "Ahoj Jana, mesto Praha");
});
