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

bindForm("#contact-form", "/api/contacts", (data) => ({
  ...data,
  marketingConsent: Boolean(data.marketingConsent)
}));
bindForm("#template-form", "/api/templates");
bindForm("#group-form", "/api/groups", (data) => ({
  ...data,
  contactIds: data.contactIds ? data.contactIds.split(",").map((item) => item.trim()).filter(Boolean) : []
}));
bindForm("#campaign-form", "/api/campaigns");
bindForm("#message-form", "/api/messages");

async function refreshAll() {
  const [status, contacts, groups, templates, campaigns, messages, audit] = await Promise.all([
    api("/api/status"),
    api("/api/contacts"),
    api("/api/groups"),
    api("/api/templates"),
    api("/api/campaigns"),
    api("/api/messages"),
    api("/api/audit").catch(() => ({ audit: [] }))
  ]);

  renderMetrics(status.totals, status.byStatus);
  renderTable("#contacts-list", contacts.contacts, ["id", "name", "phone", "marketingConsent"]);
  renderTable("#groups-list", groups.groups, ["id", "name", "contactIds"]);
  renderTable("#templates-list", templates.templates, ["id", "name", "kind", "body"]);
  renderCampaigns(campaigns.campaigns);
  renderTable("#messages-list", messages.messages, ["id", "to", "kind", "status", "lastError"]);
  renderTable("#audit-list", audit.audit, ["createdAt", "action", "actorRole", "details"]);
}

function renderMetrics(totals, byStatus) {
  const items = [
    ["Contacts", totals.contacts],
    ["Campaigns", totals.campaigns],
    ["Messages", totals.messages],
    ["Queued", byStatus.queued || 0],
    ["Sent", byStatus.sent || 0],
    ["Failed", byStatus.retry || 0],
    ["Blacklist", totals.blacklist],
    ["Audit", totals.audit]
  ];
  $("#metrics").innerHTML = items.map(([label, value]) => (
    `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`
  )).join("");
}

function renderCampaigns(campaigns) {
  const rows = campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    queued: campaign.queuedMessageIds.length,
    action: campaign.status === "draft" ? `<button data-queue="${campaign.id}">Queue</button>` : ""
  }));
  renderTable("#campaigns-list", rows, ["id", "name", "status", "queued", "action"], false);
  document.querySelectorAll("[data-queue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/campaigns/${button.dataset.queue}/queue`, { method: "POST" });
      note(`Queued ${result.queued.length}, skipped ${result.skipped.length}`, true);
      await refreshAll();
    });
  });
}

function renderTable(selector, rows, columns, escape = true) {
  if (!rows.length) {
    $(selector).innerHTML = "<p class=\"eyebrow\">No records</p>";
    return;
  }
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows.map((row) => {
    return `<tr>${columns.map((column) => {
      const raw = row[column];
      const value = typeof raw === "object" ? JSON.stringify(raw) : raw ?? "";
      return `<td>${escape ? escapeHtml(value) : value}</td>`;
    }).join("")}</tr>`;
  }).join("");
  $(selector).innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
