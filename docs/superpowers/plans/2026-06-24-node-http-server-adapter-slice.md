# Node HTTP Server Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Node `http` adapter that can expose the framework-agnostic town API handler through a real server listener.

**Architecture:** Keep `apps/api/src/httpApi.ts` as the framework-neutral routing boundary and add a small Node-only adapter beside it. The adapter converts `IncomingMessage` into `TownHttpApiRequest`, serializes `TownHttpApiResponse` back to `ServerResponse`, and shields invalid network input without importing worker or domain implementations. Future deployment entrypoints can compose local or distributed runtime services behind the same API handler.

**Tech Stack:** TypeScript, Vitest, Node built-in `http`, Node built-in `URL`, `@aivilization/api`.

---

## Scope

This slice adds:

- a Node request listener factory
- a Node server factory
- JSON body parsing for request bodies
- query-string normalization, including repeated query keys
- structured `400`, `405`, and `500` adapter-level JSON errors

It does not add a CLI executable, env config loader, auth, TLS, CORS, streaming, WebSockets, clustering, process supervision, or local runtime bootstrapping.

## File Structure

- Create `apps/api/src/nodeHttpServer.ts`: Node adapter and server factory.
- Create `apps/api/src/nodeHttpServer.test.ts`: actual Node server tests using ephemeral ports and `fetch`.
- Modify `apps/api/src/index.ts`: export the Node adapter.
- Create `docs/superpowers/plans/2026-06-24-node-http-server-adapter-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Node Adapter Tests

**Files:**

- Create: `apps/api/src/nodeHttpServer.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `createTownNodeHttpServer` starts a real server and forwards method, path, normalized query, and parsed JSON body to the injected `TownHttpApiHandler`.
- The adapter serializes handler status, headers, and JSON body to the client.
- Unsupported HTTP methods return `405` without invoking the handler.
- Invalid JSON request bodies return `400` without invoking the handler.
- Handler exceptions return `500` JSON responses.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/api test -- nodeHttpServer.test.ts
```

Expected: FAIL because `createTownNodeHttpServer` is not exported yet.

### Task 2: Node Adapter Implementation

**Files:**

- Create: `apps/api/src/nodeHttpServer.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Implement listener and server factory**

Add:

- `createTownNodeHttpRequestListener({ handler })`
- `createTownNodeHttpServer({ handler })`

The server factory should call Node's `createServer` with the listener.

- [x] **Step 2: Implement request conversion and response serialization**

Convert:

- Node method to `TownHttpMethod`; unsupported methods respond with `405`.
- URL path to `TownHttpApiRequest.path`.
- repeated query keys to string arrays and single query keys to strings.
- non-empty request bodies to parsed JSON; invalid JSON responds with `400`.
- handler response status, headers, and body to the Node response.
- unexpected handler errors to `500` JSON.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/api test -- nodeHttpServer.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-node-http-server-adapter-slice.md apps/api/src/index.ts apps/api/src/nodeHttpServer.ts apps/api/src/nodeHttpServer.test.ts
git commit -m "feat: add node http api server adapter"
```

## Self-Review

- Spec coverage: Adds a real backend server adapter for the external API surface without coupling server mechanics to simulation logic.
- Boundary review: Node-specific code lives in its own adapter file; the framework-neutral router and injected service contracts remain the stable API boundary.
- Placeholder scan: No deferred implementation markers should remain.
