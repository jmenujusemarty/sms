import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

test("contacts import API previews and commits CSV into a group", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const csv = `name,phone,email,marketingConsent,consentSource
Jana,+420777123456,jana@example.cz,yes,web
Petr,+420777222333,petr@example.cz,no,manual`;

    const preview = await request(server.url, "/api/import/contacts/preview", {
      method: "POST",
      token,
      body: { csv }
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.valid, 2);

    const committed = await request(server.url, "/api/import/contacts/commit", {
      method: "POST",
      token,
      body: { csv, groupName: "CSV Import" }
    });
    assert.equal(committed.status, 201);
    assert.equal(committed.body.createdContacts.length, 2);
    assert.equal(committed.body.group.name, "CSV Import");
  } finally {
    await server.close();
  }
});

test("campaign preview API shows sendable and skipped recipients", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const importResult = await request(server.url, "/api/import/contacts/commit", {
      method: "POST",
      token,
      body: {
        groupName: "Campaign group",
        csv: `name,phone,marketingConsent
Jana,+420777123456,yes
Petr,+420777222333,no`
      }
    });
    const template = await request(server.url, "/api/templates", {
      method: "POST",
      token,
      body: { name: "Promo", kind: "campaign", body: "Ahoj {{name}}" }
    });
    const campaign = await request(server.url, "/api/campaigns", {
      method: "POST",
      token,
      body: {
        name: "Preview campaign",
        groupId: importResult.body.group.id,
        templateId: template.body.template.id
      }
    });

    const preview = await request(server.url, `/api/campaigns/${campaign.body.campaign.id}/preview`, { token });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.sendable, 1);
    assert.equal(preview.body.summary.missingConsent, 1);
    assert.equal(preview.body.recipients[0].text, "Ahoj Jana");
  } finally {
    await server.close();
  }
});

async function testServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-import-api-"));
  const server = await createServer({
    dataFile: path.join(dir, "sms-bridge.sqlite"),
    sender: "dry-run",
    quietHoursStart: "00:00",
    quietHoursEnd: "00:00"
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function login(baseUrl) {
  const response = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { email: "admin@example.local", password: "ChangeMe123!" }
  });
  return response.body.token;
}

async function request(baseUrl, pathName, options = {}) {
  const headers = {};
  if (options.body) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return {
    status: response.status,
    body: await response.json()
  };
}
