let token = localStorage.getItem("smsBridgeToken") || "";

const $ = (selector) => document.querySelector(selector);

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formData(event.target);
  const result = await api("/api/login", { method: "POST", body: data, auth: false });
  token = result.token;
  localStorage.setItem("smsBridgeToken", token);
  note(`Logged in as ${result.user.email}`, true);
  await refreshAll();
});

$("#refresh").addEventListener("click", refreshAll);
$("#dispatch").addEventListener("click", async () => {
  const result = await api("/api/dispatch", { method: "POST" });
  note(`Dispatch result: ${result.status}`, result.status !== "failed");
  await refreshAll();
});
$("#preview-import").addEventListener("click", async () => {
  const data = formData($("#import-form"));
  const result = await api("/api/import/contacts/preview", { method: "POST", body: { csv: data.csv } });
  renderImportPreview(result);
});

bindForm("#contact-form", "/api/contacts", (data) => ({
  ...data,
  marketingConsent: Boolean(data.marketingConsent)
}));
bindForm("#template-form", "/api/templates");
bindForm("#group-form", "/api/groups", (data) => ({
  ...data,
  contactIds: selectedValues("#group-contacts")
}));
bindForm("#campaign-form", "/api/campaigns");
bindForm("#message-form", "/api/messages");
bindForm("#blacklist-form", "/api/blacklist");
bindForm("#token-form", "/api/tokens", (data) => ({ name: data.name }));
bindForm("#import-form", "/api/import/contacts/commit", (data) => ({
  csv: data.csv,
  groupName: data.groupName
}));

async function refreshAll() {
  const [status, settings, metrics, contacts, groups, templates, campaigns, messages, blacklist, tokens, audit] = await Promise.all([
    api("/api/status"),
    api("/api/settings"),
    api("/api/metrics"),
    api("/api/contacts"),
    api("/api/groups"),
    api("/api/templates"),
    api("/api/campaigns"),
    api("/api/messages"),
    api("/api/blacklist"),
    api("/api/tokens").catch(() => ({ tokens: [] })),
    api("/api/audit").catch(() => ({ audit: [] }))
  ]);

  renderMetrics(status.totals, status.byStatus, metrics.queue);
  renderSettings(settings);
  renderTable("#contacts-list", contacts.contacts, ["id", "name", "phone", "marketingConsent"]);
  renderTable("#groups-list", groups.groups, ["id", "name", "contactIds"]);
  renderTable("#templates-list", templates.templates, ["id", "name", "kind", "body"]);
  fillSelect("#group-contacts", contacts.contacts, "id", (contact) => `${contact.name} ${contact.phone}`);
  fillSelect("#campaign-group", groups.groups, "id", (group) => group.name);
  fillSelect("#campaign-template", templates.templates.filter((template) => template.kind === "campaign"), "id", (template) => template.name);
  renderCampaigns(campaigns.campaigns);
  renderMessages(messages.messages);
  renderTable("#blacklist-list", blacklist.blacklist.map((phone) => ({ phone })), ["phone"]);
  renderTokens(tokens.tokens);
  renderTable("#audit-list", audit.audit, ["createdAt", "action", "actorRole", "details"]);
}

function renderImportPreview(result) {
  const rows = [
    { metric: "Rows", value: result.summary.totalRows },
    { metric: "Valid", value: result.summary.valid },
    { metric: "Invalid", value: result.summary.invalid },
    { metric: "Duplicates in file", value: result.summary.duplicatesInFile },
    { metric: "Existing phones", value: result.summary.duplicatesExisting }
  ];
  const invalidRows = result.invalid.map((item) => ({
    row: item.rowNumber,
    phone: item.contact.phone || "",
    errors: item.errors.join(", ")
  }));
  $("#import-preview").innerHTML = tableHtml(rows, ["metric", "value"]) +
    (invalidRows.length ? tableHtml(invalidRows, ["row", "phone", "errors"]) : "<p class=\"eyebrow\">Ready to import</p>");
}

function renderMetrics(totals, byStatus, queue) {
  const items = [
    ["Contacts", totals.contacts],
    ["Campaigns", totals.campaigns],
    ["Messages", totals.messages],
    ["Queued", byStatus.queued || 0],
    ["Sent", byStatus.sent || 0],
    ["Failed", byStatus.retry || 0],
    ["Blacklist", totals.blacklist],
    ["Audit", totals.audit],
    ["Next retry", queue?.nextRetryAt || "none"]
  ];
  $("#metrics").innerHTML = items.map(([label, value]) => (
    `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`
  )).join("");
}

function renderSettings(settings) {
  const rows = [
    { key: "Sender", value: settings.sender },
    { key: "DB", value: settings.dataFile },
    { key: "Quiet hours", value: `${settings.quietHoursStart} - ${settings.quietHoursEnd}` },
    { key: "Service limit", value: settings.serviceDailyLimit },
    { key: "Campaign limit", value: settings.campaignDailyLimit },
    { key: "Max attempts", value: settings.maxAttempts }
  ];
  renderTable("#settings-list", rows, ["key", "value"]);
}

function renderCampaigns(campaigns) {
  const rows = campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    queued: campaign.queuedMessageIds.length,
    action: `<button data-preview-campaign="${campaign.id}">Preview</button> ${campaign.status === "draft" ? `<button data-queue="${campaign.id}">Queue</button>` : ""}`
  }));
  renderTable("#campaigns-list", rows, ["id", "name", "status", "queued", "action"], false);
  document.querySelectorAll("[data-preview-campaign]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/campaigns/${button.dataset.previewCampaign}/preview`);
      renderCampaignPreview(result);
    });
  });
  document.querySelectorAll("[data-queue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/campaigns/${button.dataset.queue}/queue`, { method: "POST" });
      note(`Queued ${result.queued.length}, skipped ${result.skipped.length}`, true);
      await refreshAll();
    });
  });
}

function renderCampaignPreview(result) {
  const summaryRows = [
    { metric: "Contacts", value: result.summary.totalContacts },
    { metric: "Sendable", value: result.summary.sendable },
    { metric: "Skipped", value: result.summary.skipped },
    { metric: "Missing consent", value: result.summary.missingConsent },
    { metric: "Blacklisted", value: result.summary.blacklisted }
  ];
  const sampleRows = result.recipients.map((recipient) => ({
    name: recipient.name,
    phone: recipient.phone,
    text: recipient.text
  }));
  const skippedRows = result.skipped.map((item) => ({
    phone: item.phone,
    reason: item.reason
  }));
  $("#campaign-preview").innerHTML = "<h3>Campaign preview</h3>" +
    tableHtml(summaryRows, ["metric", "value"]) +
    (sampleRows.length ? tableHtml(sampleRows, ["name", "phone", "text"]) : "<p class=\"eyebrow\">No sendable recipients</p>") +
    (skippedRows.length ? tableHtml(skippedRows, ["phone", "reason"]) : "");
}

function renderMessages(messages) {
  const rows = messages.map((message) => ({
    id: message.id,
    to: message.to,
    kind: message.kind,
    status: message.status,
    lastError: message.lastError || "",
    action: ["queued", "retry"].includes(message.status) ? `<button data-cancel="${message.id}">Cancel</button>` : ""
  }));
  renderTable("#messages-list", rows, ["id", "to", "kind", "status", "lastError", "action"], false);
  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/messages/${button.dataset.cancel}/cancel`, { method: "POST" });
      note(`Cancelled ${result.message.id}`, true);
      await refreshAll();
    });
  });
}

function renderTokens(tokens) {
  const rows = tokens.map((tokenRecord) => ({
    id: tokenRecord.id,
    name: tokenRecord.name,
    active: tokenRecord.active,
    lastUsedAt: tokenRecord.lastUsedAt || "",
    action: tokenRecord.active ? `<button data-revoke="${tokenRecord.id}">Revoke</button>` : ""
  }));
  renderTable("#tokens-list", rows, ["id", "name", "active", "lastUsedAt", "action"], false);
  document.querySelectorAll("[data-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/tokens/${button.dataset.revoke}/revoke`, { method: "POST" });
      note("Token revoked.", true);
      await refreshAll();
    });
  });
}

function renderTable(selector, rows, columns, escape = true) {
  if (!rows.length) {
    $(selector).innerHTML = "<p class=\"eyebrow\">No records</p>";
    return;
  }
  $(selector).innerHTML = tableHtml(rows, columns, escape);
}

function tableHtml(rows, columns, escape = true) {
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows.map((row) => {
    return `<tr>${columns.map((column) => {
      const raw = row[column];
      const value = typeof raw === "object" ? JSON.stringify(raw) : raw ?? "";
      return `<td>${escape ? escapeHtml(value) : value}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function bindForm(selector, url, transform = (data) => data) {
  $(selector).addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(url, { method: "POST", body: transform(formData(event.target)) });
    event.target.reset();
    note(`Saved ${Object.keys(result)[0]}`, true);
    await refreshAll();
  });
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.auth !== false && token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) {
    note(body.error || "Request failed", false);
    throw new Error(body.error || "Request failed");
  }
  return body;
}

function formData(form) {
  const data = {};
  for (const element of new FormData(form).entries()) data[element[0]] = element[1];
  for (const checkbox of form.querySelectorAll("input[type=checkbox]")) {
    data[checkbox.name] = checkbox.checked;
  }
  return data;
}

function selectedValues(selector) {
  return [...document.querySelector(selector).selectedOptions].map((option) => option.value);
}

function fillSelect(selector, rows, valueKey, labelFn) {
  const select = document.querySelector(selector);
  const selected = new Set([...select.selectedOptions].map((option) => option.value));
  select.innerHTML = rows.map((row) => {
    const value = row[valueKey];
    const label = labelFn(row);
    const isSelected = selected.has(value) ? " selected" : "";
    return `<option value="${escapeHtml(value)}"${isSelected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function note(message, ok) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.toggle("ok", ok);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (token) {
  refreshAll().then(() => note("Session restored.", true)).catch(() => note("Login required.", false));
}
