import test from "node:test";
import assert from "node:assert/strict";
import { addCampaign, addGroup, addTemplate, upsertContact } from "../src/domain.js";
import { queueCampaign } from "../src/campaigns.js";
import { emptyState } from "../src/store.js";

const actor = { id: "admin", role: "admin" };

test("queueCampaign queues only consented contacts", () => {
  const state = emptyState();
  const allowed = upsertContact(state, {
    name: "Allowed",
    phone: "+420777111111",
    marketingConsent: true
  }, actor);
  const skipped = upsertContact(state, {
    name: "Skipped",
    phone: "+420777222222",
    marketingConsent: false
  }, actor);
  const group = addGroup(state, {
    name: "Group",
    contactIds: [allowed.id, skipped.id]
  }, actor);
  const template = addTemplate(state, {
    name: "Campaign",
    kind: "campaign",
    body: "Ahoj {{name}}"
  }, actor);
  const campaign = addCampaign(state, {
    name: "May",
    groupId: group.id,
    templateId: template.id
  }, actor);

  const result = queueCampaign(state, campaign.id, actor);
  assert.equal(result.queued.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(state.messages[0].text, "Ahoj Allowed");
  assert.equal(state.messages[0].campaignId, campaign.id);
});
