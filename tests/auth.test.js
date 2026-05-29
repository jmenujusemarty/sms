import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, ensureBootstrapAdmin, hashPassword, login, verifyPassword } from "../src/auth.js";
import { emptyState } from "../src/store.js";

test("hashPassword verifies matching password and rejects wrong password", async () => {
  const hash = await hashPassword("ChangeMe123!");
  assert.equal(await verifyPassword("ChangeMe123!", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("bootstrap admin creates default admin and API token", async () => {
  const state = emptyState();
  const user = await ensureBootstrapAdmin(state, {
    adminEmail: "admin@example.local",
    adminPassword: "ChangeMe123!",
    devApiToken: "test-dev-token"
  });

  assert.equal(user.email, "admin@example.local");
  assert.equal(state.users.length, 1);
  assert.equal(state.apiTokens.length, 1);
});

test("login creates session usable by bearer auth", async () => {
  const state = emptyState();
  await ensureBootstrapAdmin(state, {
    adminEmail: "admin@example.local",
    adminPassword: "ChangeMe123!"
  });

  const result = await login(state, "admin@example.local", "ChangeMe123!");
  const actor = authenticate(state, `Bearer ${result.token}`);
  assert.equal(actor.email, "admin@example.local");
  assert.equal(actor.role, "admin");
});
