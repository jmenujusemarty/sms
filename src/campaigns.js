import { audit, appendEvent, renderTemplate } from "./domain.js";
import { createMessage } from "./store.js";

export function queueCampaign(state, campaignId, actor, now = new Date()) {
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  if (!campaign) throw new Error("campaign not found");
  if (campaign.status !== "draft") throw new Error("campaign is not draft");

  const group = state.groups.find((item) => item.id === campaign.groupId);
  const template = state.templates.find((item) => item.id === campaign.templateId);
  if (!group || !template) throw new Error("campaign references missing group or template");

  const contacts = group.contactIds
    .map((id) => state.contacts.find((contact) => contact.id === id))
    .filter(Boolean);

  const skipped = [];
  const queued = [];

  for (const contact of contacts) {
    if (!contact.marketingConsent) {
      skipped.push({ contactId: contact.id, reason: "missing marketing consent" });
      continue;
    }
    if (state.blacklist.includes(contact.phone)) {
      skipped.push({ contactId: contact.id, reason: "blacklisted" });
      continue;
    }

    const message = createMessage({
      to: contact.phone,
      text: renderTemplate(template.body, contact),
      kind: "campaign"
    }, now);
    message.campaignId = campaign.id;
    message.contactId = contact.id;
    state.messages.push(message);
    campaign.queuedMessageIds.push(message.id);
    queued.push(message);
    appendEvent(state, "queued", message.id, { kind: "campaign", campaignId: campaign.id }, now);
  }

  campaign.status = "queued";
  campaign.queuedAt = now.toISOString();
  campaign.updatedAt = now.toISOString();
  audit(state, actor, "campaign.queued", { campaignId, queued: queued.length, skipped: skipped.length }, now);

  return { campaign, queued, skipped };
}
