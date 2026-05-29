# Full SMS Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the macOS SMS bridge into a multi-user backend with authenticated API, campaign operations, compliance controls, audit logs, and a static admin UI.

**Architecture:** Keep the current dependency-free Node.js stack and JSON storage, but split business logic into focused modules. The HTTP server serves both API routes and static admin assets; the dispatcher continues to use the sender abstraction and now records campaign/contact metadata.

**Tech Stack:** Node.js built-ins, `node:test`, JSON file persistence, static HTML/CSS/JS admin UI, macOS `osascript` sender adapter.

---

## Chunk 1: Backend Domain And Auth

### Task 1: State Model

**Files:**
- Modify: `src/store.js`
- Create: `src/domain.js`
- Test: `tests/domain.test.js`

- [x] Add users, contacts, groups, templates, campaigns, sessions, audit logs, and API tokens to state.
- [x] Keep backwards compatibility with existing `messages`, `blacklist`, and `events`.
- [x] Add entity creation helpers with validation.

### Task 2: Auth And Access Control

**Files:**
- Create: `src/auth.js`
- Test: `tests/auth.test.js`

- [x] Hash passwords with Node crypto.
- [x] Bootstrap an admin user from env or defaults.
- [x] Support login sessions and bearer API tokens.
- [x] Add role checks for admin/operator/viewer.

## Chunk 2: API

### Task 3: HTTP Server Refactor

**Files:**
- Modify: `src/server.js`
- Test: `tests/api.test.js`

- [x] Add route helper, JSON body parser, auth context, and audit wrapping.
- [x] Preserve existing `/health`, `/messages`, `/dispatch`, `/status`, `/blacklist`.
- [x] Add `/api/login`, `/api/me`, `/api/users`, `/api/contacts`, `/api/groups`, `/api/templates`, `/api/campaigns`, `/api/audit`.

### Task 4: Campaign Queueing

**Files:**
- Create: `src/campaigns.js`
- Modify: `src/server.js`
- Test: `tests/campaigns.test.js`

- [x] Create campaigns from groups and templates.
- [x] Render template variables from contact fields.
- [x] Queue campaign messages only for contacts with marketing consent.
- [x] Skip blacklisted contacts.

## Chunk 3: Admin UI And Verification

### Task 5: Static Admin UI

**Files:**
- Create: `public/admin.html`
- Create: `public/styles.css`
- Create: `public/admin.js`

- [x] Build a restrained operator workspace: nav, metrics, queue, contacts, campaigns, templates, audit.
- [x] Use token login and API calls.
- [x] Keep the UI functional without a frontend build step.

### Task 6: Docs And Tests

**Files:**
- Modify: `README.md`
- Test: all `tests/*.test.js`

- [x] Document default admin credentials, API token, and real sender switch.
- [x] Run `npm test`.
- [x] Start server and verify `/health` plus `/admin`.
