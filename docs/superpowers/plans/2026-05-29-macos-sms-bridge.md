# macOS SMS Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MVP that queues service and campaign SMS messages and sends them through macOS Messages.app via an iPhone, with safe throttling and a dry-run default.

**Architecture:** A dependency-free Node.js service exposes a small HTTP API and persists queue state to JSON on disk. A dispatcher applies policy limits, then calls either a dry-run sender or a macOS Messages sender implemented with AppleScript through `osascript`.

**Tech Stack:** Node.js built-ins, `node:test`, macOS `osascript`, JSON file storage.

---

## Chunk 1: MVP

### Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `README.md`

- [x] Create scripts for tests, server, and dispatcher.
- [x] Define environment-driven config with safe defaults.
- [x] Document setup assumptions.

### Task 2: Queue And Policy

**Files:**
- Create: `src/store.js`
- Create: `src/policy.js`
- Test: `tests/policy.test.js`
- Test: `tests/store.test.js`

- [x] Persist messages in JSON.
- [x] Support service and campaign queues.
- [x] Enforce per-kind rate limits, daily limits, quiet hours, and STOP blacklist.

### Task 3: Sender Adapters

**Files:**
- Create: `src/senders/dryRun.js`
- Create: `src/senders/messagesApp.js`
- Create: `src/senders/index.js`

- [x] Dry-run sender logs without sending.
- [x] Messages.app sender uses `osascript`.
- [x] Sender mode is explicit via config.

### Task 4: API And Dispatcher

**Files:**
- Create: `src/server.js`
- Create: `src/dispatcher.js`
- Test: `tests/api.test.js`

- [x] Add HTTP endpoints for enqueue, status, blacklist, and dispatch tick.
- [x] Add one-shot and loop dispatcher modes.
- [x] Return clear statuses for queued, sent, blocked, and failed messages.

### Task 5: Verification

**Files:**
- Modify: `README.md`

- [x] Run `npm test`.
- [x] Start local server in dry-run mode.
- [x] Verify health endpoint.
