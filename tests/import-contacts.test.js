import test from "node:test";
import assert from "node:assert/strict";
import { addGroup, addTemplate, addCampaign, upsertContact } from "../src/domain.js";
import { previewCampaign } from "../src/campaigns.js";
import { commitContactImport, previewContactImport } from "../src/importContacts.js";
import { emptyState } from "../src/store.js";

const actor = { id: "admin", role: "admin" };

test("previewContactImport validates CSV rows and detects duplicates", () => {
  const state = emptyState();
  upsertContact(state, { name: "Existing", phone: "+420777000000" }, actor);

  const preview = previewContactImport(state, `name,phone,email,marketingConsent,consentSource,city
Jana,+420777123456,jana@example.cz,yes,web,Praha
Bad,777,nope,yes,web,Brno
Duplicate,+420777123456,dup@example.cz,no,web,Plzen
Existing,+420777000000,existing@example.cz,yes,web,Ostrava`);

  assert.equal(preview.totalRows, 4);
  assert.equal(preview.valid.length, 1);
  assert.equal(preview.invalid.length, 3);
  assert.deepEqual(preview.summary, {
    totalRows: 4,
    valid: 1,
    invalid: 3,
    duplicatesInFile: 1,
    duplicatesExisting: 1
  });
  assert.equal(preview.valid[0].contact.fields.city, "Praha");
});

test("commitContactImport creates contacts and an optional group", () => {
  const state = emptyState();
  const result = commitContactImport(state, {
    csv: `name,phone,email,marketingConsent,consentSource
Jana,+420777123456,jana@example.cz,yes,web
Petr,+420777222333,petr@example.cz,no,manual`,
    groupName: "Import Praha"
  }, actor);

  assert.equal(result.createdContacts.length, 2);
  assert.equal(result.group.name, "Import Praha");
  assert.equal(result.group.contactIds.length, 2);
  assert.equal(state.contacts[0].marketingConsent, true);
  assert.equal(state.contacts[1].marketingConsent, false);
});

test("previewCampaign renders messages and skip reasons without queueing", () => {
  const state = emptyState();
  const allowed = upsertContact(state, {
    name: "Allowed",
    phone: "+420777111111",
    marketingConsent: true,
    fields: { city: "Praha" }
  }, actor);
  const noConsent = upsertContact(state, {
    name: "No Consent",
    phone: "+420777222222",
    marketingConsent: false
  }, actor);
  const blacklisted = upsertContact(state, {
    name: "Blocked",
    phone: "+420777333333",
    marketingConsent: true
  }, actor);
  state.blacklist.push(blacklisted.phone);
  const group = addGroup(state, { name: "Group", contactIds: [allowed.id, noConsent.id, blacklisted.id] }, actor);
  const template = addTemplate(state, { name: "Template", kind: "campaign", body: "Ahoj {{name}} {{fields.city}}" }, actor);
  const campaign = addCampaign(state, { name: "Campaign", groupId: group.id, templateId: template.id }, actor);

  const preview = previewCampaign(state, campaign.id);

  assert.equal(preview.recipients.length, 1);
  assert.equal(preview.recipients[0].text, "Ahoj Allowed Praha");
  assert.equal(preview.skipped.length, 2);
  assert.deepEqual(preview.summary, {
    totalContacts: 3,
    sendable: 1,
    skipped: 2,
    missingConsent: 1,
    blacklisted: 1
  });
  assert.equal(state.messages.length, 0);
});
