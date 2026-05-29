import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

test("API queues and dispatches a dry-run service message", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const created = await request(server.url, "/messages", {
      method: "POST",
      token,
      body: {
        to: "+420777123456",
        text: "Servisni test",
        kind: "service"
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.message.status, "queued");

    const dispatched = await request(server.url, "/dispatch", { method: "POST", token });
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.status, "sent");
    assert.equal(dispatched.body.message.provider, "dry-run");

    const status = await request(server.url, "/status", { token });
    assert.equal(status.body.byStatus.sent, 1);
  } finally {
    await server.close();
  }
});

test("API rejects invalid phone numbers", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const created = await request(server.url, "/messages", {
      method: "POST",
      token,
      body: {
        to: "777123456",
        text: "Bad",
        kind: "service"
      }
    });

    assert.equal(created.status, 400);
    assert.match(created.body.error, /international format/);
  } finally {
    await server.close();
  }
});

test("API requires auth for status", async () => {
  const server = await testServer();
  try {
    const status = await request(server.url, "/api/status");
    assert.equal(status.status, 401);
  } finally {
    await server.close();
  }
});

test("API creates contacts after login", async () => {
  const server = await testServer();
  try {
    const token = await login(server.url);
    const created = await request(server.url, "/api/contacts", {
      method: "POST",
      token,
      body: {
        name: "Jana",
        phone: "+420777123456",
        marketingConsent: true
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.contact.name, "Jana");
  } finally {
    await server.close();
  }
});

async function testServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-api-"));
  const server = await createServer({
    dataFile: path.join(dir, "queue.json"),
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

async function login(baseUrl) {
  const response = await request(baseUrl, "/api/login", {
    method: "POST",
    body: {
      email: "admin@example.local",
      password: "ChangeMe123!"
    }
  });
  assert.equal(response.status, 200);
  return response.body.token;
}
