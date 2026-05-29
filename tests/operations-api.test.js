import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

test("operations API exposes safe settings and metrics", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const settings = await request(server.url, "/api/settings", { token });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.sender, "dry-run");
    assert.equal(settings.body.adminPassword, undefined);

    const metrics = await request(server.url, "/api/metrics", { token });
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.limits.serviceDailyLimit, 300);
  } finally {
    await server.close();
  }
});

test("operator can cancel queued messages", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const created = await request(server.url, "/api/messages", {
      method: "POST",
      token,
      body: { to: "+420777123456", text: "Cancel me", kind: "service" }
    });

    const cancelled = await request(server.url, `/api/messages/${created.body.message.id}/cancel`, {
      method: "POST",
      token
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.message.status, "cancelled");
  } finally {
    await server.close();
  }
});

test("admin can create and revoke API tokens", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const created = await request(server.url, "/api/tokens", {
      method: "POST",
      token,
      body: { name: "Integration" }
    });
    assert.equal(created.status, 201);
    assert.match(created.body.token, /^[a-f0-9]{64}$/);

    const revoked = await request(server.url, `/api/tokens/${created.body.record.id}/revoke`, {
      method: "POST",
      token
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.record.active, false);
  } finally {
    await server.close();
  }
});

test("admin can import legacy JSON and export compliance data", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-ops-import-"));
  const legacyJsonFile = path.join(dir, "queue.json");
  await writeFile(legacyJsonFile, JSON.stringify({
    blacklist: ["+420777999999"],
    audit: [{ id: "a1", action: "legacy", createdAt: "2026-05-29T00:00:00.000Z" }]
  }));
  const server = await testServer({ legacyJsonFile });
  try {
    const token = await login(server.url);
    const imported = await request(server.url, "/api/import/json", {
      method: "POST",
      token,
      body: { force: true }
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported, true);

    const blacklist = await request(server.url, "/api/exports/blacklist", { token });
    assert.equal(blacklist.status, 200);
    assert.deepEqual(blacklist.body.blacklist, ["+420777999999"]);

    const audit = await request(server.url, "/api/exports/audit", { token });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.audit.some((item) => item.action === "legacy"));
  } finally {
    await server.close();
  }
});

async function testServer(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-ops-api-"));
  const server = await createServer({
    dataFile: path.join(dir, "sms-bridge.sqlite"),
    sender: "dry-run",
    quietHoursStart: "00:00",
    quietHoursEnd: "00:00",
    ...overrides
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
