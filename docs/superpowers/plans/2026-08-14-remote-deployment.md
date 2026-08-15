# Pulse Remote Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach the Pulse dashboard from anywhere — full read access plus the ability to queue Claude jobs — while the local server stays the source of truth.

**Architecture:** The local server gains a `cloudsync` module that mirrors its own REST responses into Convex and polls a Convex job queue. Convex enforces GitHub auth on all user-facing functions and a shared key on agent-only ones. Vercel serves the existing SPA, which swaps its fetch layer for Convex calls when it detects it is not running on localhost.

**Tech Stack:** Node 24 (`node --test`), Convex 1.44 + `@convex-dev/auth`, React 19 + Vite 7 + Vitest, Vercel static hosting.

**Spec:** `docs/superpowers/specs/2026-08-14-remote-deployment-design.md`

## Global Constraints

- Local behaviour must be unchanged when cloud env vars are absent — sync is opt-in and fire-and-forget.
- Mirrored payloads must be **byte-identical** to the local REST responses; achieve this by fetching `http://127.0.0.1:<PORT>/api/...` from inside the server rather than rebuilding payloads.
- Never write `data/`, `.env*`, or account-scoped IDs to git.
- Agent-only Convex functions authenticate with `PULSE_AGENT_KEY`; user-facing ones use `requireUser` (GitHub allow-list via `ALLOWED_GITHUB_LOGINS`).
- Day-keyed snapshots cover a rolling window: `PULSE_SYNC_DAYS`, default 90.
- Server code is plain ESM JS + JSDoc, checked by `npm run check` (tsc). Convex code is TypeScript.
- Existing convex deployment is a **dev** deployment (`.env.local` → `CONVEX_DEPLOYMENT=dev:…`). Do not run `convex deploy` (prod) without explicit consent.

## File Structure

| Path | Responsibility |
|---|---|
| `convex/schema.ts` | Table + index definitions |
| `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` | Convex Auth (GitHub provider) |
| `convex/lib/guards.ts` | `requireUser`, `requireAgent` |
| `convex/sync.ts` | Agent-only writes: snapshots, sessions, prompts, journal, heartbeat |
| `convex/snapshots.ts`, `convex/sessions.ts`, `convex/prompts.ts`, `convex/journal.ts`, `convex/agentStatus.ts` | User-facing reads |
| `convex/jobs.ts` | `enqueue`/`list` (user) + `claimNext`/`update` (agent) |
| `server/lib/cloud/keys.js` | **Pure**: snapshot key ↔ REST path table, payload hashing |
| `server/lib/cloud/sync.js` | Sync loop, watermarks, batching |
| `server/lib/cloud/jobs.js` | Queue poller → existing `jobs.launch()` |
| `server/lib/cloud/index.js` | `createCloudSync()` wiring, started from `server/index.js` |
| `web/src/lib/source.ts` | **Pure**: mode detection + REST-path → Convex-call resolver |
| `web/src/lib/convexClient.ts` | Convex client singleton + call dispatch |
| `web/src/lib/api.ts` | Branches to Convex in cloud mode (signature unchanged) |
| `scripts/verify-cloud.mjs` | Deep-equals local REST vs Convex payloads |
| `vercel.json` | SPA rewrites + build config |

---

### Task 1: Repo hygiene, config extraction, GitHub push

**Files:**
- Modify: `package.json` (corrupted `convex` dep)
- Create: `server/lib/config-file.js`
- Modify: `server/lib/routines.js` (CLOUD_ENVIRONMENTS → config file)
- Test: `server/lib/config-file.test.js`

**Interfaces:**
- Produces: `readConfigFile(name, fallback)` — reads `data/<name>.json`, returns `fallback` when missing/invalid.

- [ ] **Step 1: Write the failing test**

```js
// server/lib/config-file.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfigFile } from './config-file.js';

test('returns fallback when the file is absent', () => {
  assert.deepEqual(readConfigFile('definitely-missing', { a: 1 }), { a: 1 });
});

test('returns fallback when the file is malformed', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { DATA_DIR } = await import('../config.js');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'broken.json'), '{ not json');
  assert.deepEqual(readConfigFile('broken', []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/lib/config-file.test.js`
Expected: FAIL — `Cannot find module './config-file.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/config-file.js
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

/** Read data/<name>.json, falling back when absent or malformed. */
export function readConfigFile(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/lib/config-file.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Move account-scoped IDs out of source**

In `server/lib/routines.js`, replace the hardcoded `CLOUD_ENVIRONMENTS` array with:

```js
import { readConfigFile } from './config-file.js';

// Cloud environments offered by the create form. Account-scoped IDs live in
// data/cloud-environments.json (git-ignored) so the repo stays generic.
export const CLOUD_ENVIRONMENTS = readConfigFile('cloud-environments', []);
```

Then write the current values to `data/cloud-environments.json` (git-ignored) so behaviour is unchanged:

```json
[
  { "id": "env_016MdUb4xBmGgCWdmwJhThCf", "name": "Default" },
  { "id": "env_012PNXSpbj6VfvX8FdfHv9ca", "name": "ChargeOps2" },
  { "id": "env_01MBH4ws6pH3DgGnPAhKVJiq", "name": "ChargeOps Website" },
  { "id": "env_01GzpGqWVF9k4Lngf6DusBGK", "name": "ChargeOps" },
  { "id": "env_01HrwrYDojapY12suDy61W6T", "name": "Prospector" },
  { "id": "env_01RFgtf9kbx7Hxwu2iHdqFf2", "name": "Environnement Cloud par défaut" }
]
```

- [ ] **Step 6: Fix the corrupted Convex dependency and install**

```bash
npm pkg set dependencies.convex="^1.44.0"
npm install
node -e "console.log(require('./node_modules/convex/package.json').version)"
```
Expected: prints a 1.44.x version.

- [ ] **Step 7: Verify nothing sensitive is staged**

```bash
git add -A
git status --short | grep -E "^\S+\s+(data/|\.env)" && echo "LEAK" || echo "clean"
npm run check
```
Expected: `clean`, and tsc exits 0.

- [ ] **Step 8: Commit and push to a new private repo**

```bash
git commit -m "chore: extract account-scoped config, fix convex dependency"
gh repo create pulse --private --source=. --remote=origin --push
gh repo view --json nameWithOwner,visibility
```
Expected: `{"nameWithOwner":"pldagenais/pulse","visibility":"PRIVATE"}`

---

### Task 2: Convex schema

**Files:**
- Create: `convex/schema.ts`

**Interfaces:**
- Produces: tables `snapshots`, `sessions`, `prompts`, `journal`, `jobs`, `agent` with the indexes named below. All later Convex tasks query through these exact index names.

- [ ] **Step 1: Write the schema**

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  snapshots: defineTable({
    key: v.string(),          // "overview:2026-08-14", "projects", "session:<id>"
    kind: v.string(),
    day: v.optional(v.string()),
    payload: v.any(),         // verbatim local REST response
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  sessions: defineTable({
    sessionId: v.string(),
    projectId: v.number(),
    projectName: v.string(),
    title: v.union(v.string(), v.null()),
    startedAt: v.union(v.number(), v.null()),
    claudeMs: v.number(),
    estCostUsd: v.union(v.number(), v.null()),
    promptCount: v.number(),
    payload: v.any(),         // full SessionSummary
    updatedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_startedAt", ["startedAt"]),

  prompts: defineTable({
    uuid: v.string(),
    sessionId: v.string(),
    projectId: v.number(),
    projectName: v.union(v.string(), v.null()),
    sessionTitle: v.union(v.string(), v.null()),
    ts: v.number(),
    kind: v.string(),
    text: v.string(),
    charCount: v.number(),
  })
    .index("by_uuid", ["uuid"])
    .index("by_ts", ["ts"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["projectId", "kind"],
    }),

  journal: defineTable({
    localId: v.number(),
    ts: v.number(),
    projectPath: v.union(v.string(), v.null()),
    projectName: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
    text: v.string(),
    source: v.string(),
  })
    .index("by_localId", ["localId"])
    .index("by_ts", ["ts"]),

  jobs: defineTable({
    kind: v.string(),         // "run" | "kill" | "summarize"
    status: v.string(),       // "queued" | "running" | "done" | "error"
    payload: v.any(),
    requestedBy: v.string(),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    localJobId: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    outputTail: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_status_createdAt", ["status", "createdAt"]),

  agent: defineTable({
    key: v.string(),          // always "status"
    lastHeartbeatAt: v.number(),
    version: v.string(),
    ingestPhase: v.string(),
    liveCount: v.number(),
    dbSessions: v.number(),
    syncedThrough: v.number(),
  }).index("by_key", ["key"]),
});
```

- [ ] **Step 2: Push the schema to the dev deployment**

Run: `npx convex dev --once`
Expected: "Convex functions ready" with no schema errors; `convex/_generated/dataModel.d.ts` now contains the table names.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc -p convex/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(convex): mirror schema for snapshots, sessions, prompts, jobs"
```

---

### Task 3: Auth + guards

**Prerequisite (user action, cannot be automated):** create a GitHub OAuth app at
`https://github.com/settings/developers` → "New OAuth App" with
Homepage `https://<vercel-domain>` and callback
`https://<convex-site-url>/api/auth/callback/github`, then supply the Client ID
and Client Secret. Store them with
`npx convex env set AUTH_GITHUB_ID <id>` and
`npx convex env set AUTH_GITHUB_SECRET <secret>`.

**Files:**
- Create: `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/lib/guards.ts`
- Test: `convex/lib/guards.test.ts`

**Interfaces:**
- Produces: `requireUser(ctx): Promise<string>` (returns GitHub login, throws otherwise); `requireAgent(key: string): void` (throws on mismatch); `isAllowed(login, allowList): boolean`.

- [ ] **Step 1: Install auth dependency**

```bash
npm install @convex-dev/auth @auth/core@0.37.0
```

- [ ] **Step 2: Write the failing test for the allow-list rule**

```ts
// convex/lib/guards.test.ts
import { describe, it, expect } from "vitest";
import { isAllowed } from "./guards";

describe("isAllowed", () => {
  it("accepts a login on the list, case-insensitively", () => {
    expect(isAllowed("PLDagenais", "pldagenais")).toBe(true);
  });
  it("rejects a login that is not listed", () => {
    expect(isAllowed("someone-else", "pldagenais")).toBe(false);
  });
  it("rejects everyone when the list is empty", () => {
    expect(isAllowed("pldagenais", "")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run convex/lib/guards.test.ts`
Expected: FAIL — cannot resolve `./guards`.

- [ ] **Step 4: Implement guards**

```ts
// convex/lib/guards.ts
import type { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/** Empty allow-list denies everyone — fail closed. */
export function isAllowed(login: string, allowList: string): boolean {
  const allowed = allowList
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(login.toLowerCase());
}

export async function requireUser(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const login =
    (identity.nickname as string | undefined) ??
    (identity.preferredUsername as string | undefined) ??
    "";
  if (!isAllowed(login, process.env.ALLOWED_GITHUB_LOGINS ?? "")) {
    throw new Error("Account not permitted");
  }
  return login;
}

/** Agent-only functions: the local server cannot perform an OAuth flow. */
export function requireAgent(key: string): void {
  const expected = process.env.PULSE_AGENT_KEY ?? "";
  if (!expected || key !== expected) throw new Error("Bad agent key");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/lib/guards.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire Convex Auth**

```ts
// convex/auth.ts
import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub],
});
```

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);
export default http;
```

```ts
// convex/auth.config.ts
export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }],
};
```

- [ ] **Step 7: Set the agent key and allow-list**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # copy output
npx convex env set PULSE_AGENT_KEY <generated>
npx convex env set ALLOWED_GITHUB_LOGINS pldagenais
npx convex env list
```
Expected: both variables listed.

- [ ] **Step 8: Commit**

```bash
git add convex/ package.json package-lock.json
git commit -m "feat(convex): GitHub auth with allow-list and agent-key guard"
```

---

### Task 4: Convex write functions (agent-facing)

**Files:**
- Create: `convex/sync.ts`

**Interfaces:**
- Produces mutations, all taking `agentKey: string` as their first argument:
  - `sync.putSnapshots({ agentKey, items: {key, kind, day?, payload, updatedAt}[] })`
  - `sync.putSessions({ agentKey, items: {...sessions fields}[] })`
  - `sync.putPrompts({ agentKey, items: {...prompts fields}[] })`
  - `sync.putJournal({ agentKey, items: {...journal fields}[] })`
  - `sync.heartbeat({ agentKey, version, ingestPhase, liveCount, dbSessions, syncedThrough })`
  - Each upserts by its natural key and returns `{ written: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// convex/sync.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const KEY = "test-agent-key";

test("putSnapshots upserts by key instead of duplicating", async () => {
  process.env.PULSE_AGENT_KEY = KEY;
  const t = convexTest(schema);
  const item = { key: "projects", kind: "projects", payload: [{ id: 1 }], updatedAt: 1 };

  await t.mutation(api.sync.putSnapshots, { agentKey: KEY, items: [item] });
  await t.mutation(api.sync.putSnapshots, {
    agentKey: KEY,
    items: [{ ...item, payload: [{ id: 2 }], updatedAt: 2 }],
  });

  const rows = await t.run(async (ctx) => ctx.db.query("snapshots").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].payload).toEqual([{ id: 2 }]);
});

test("putSnapshots rejects a bad agent key", async () => {
  process.env.PULSE_AGENT_KEY = KEY;
  const t = convexTest(schema);
  await expect(
    t.mutation(api.sync.putSnapshots, { agentKey: "wrong", items: [] }),
  ).rejects.toThrow(/agent key/i);
});
```

- [ ] **Step 2: Install the test harness and run to verify failure**

```bash
npm install -D convex-test vitest @edge-runtime/vm
npx vitest run convex/sync.test.ts
```
Expected: FAIL — `api.sync` undefined.

- [ ] **Step 3: Implement the sync mutations**

```ts
// convex/sync.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAgent } from "./lib/guards";

const snapshotItem = v.object({
  key: v.string(),
  kind: v.string(),
  day: v.optional(v.string()),
  payload: v.any(),
  updatedAt: v.number(),
});

export const putSnapshots = mutation({
  args: { agentKey: v.string(), items: v.array(snapshotItem) },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("snapshots")
        .withIndex("by_key", (q) => q.eq("key", item.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("snapshots", item);
    }
    return { written: items.length };
  },
});

export const putSessions = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        sessionId: v.string(),
        projectId: v.number(),
        projectName: v.string(),
        title: v.union(v.string(), v.null()),
        startedAt: v.union(v.number(), v.null()),
        claudeMs: v.number(),
        estCostUsd: v.union(v.number(), v.null()),
        promptCount: v.number(),
        payload: v.any(),
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", item.sessionId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("sessions", item);
    }
    return { written: items.length };
  },
});

export const putPrompts = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        uuid: v.string(),
        sessionId: v.string(),
        projectId: v.number(),
        projectName: v.union(v.string(), v.null()),
        sessionTitle: v.union(v.string(), v.null()),
        ts: v.number(),
        kind: v.string(),
        text: v.string(),
        charCount: v.number(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("prompts")
        .withIndex("by_uuid", (q) => q.eq("uuid", item.uuid))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("prompts", item);
    }
    return { written: items.length };
  },
});

export const putJournal = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        localId: v.number(),
        ts: v.number(),
        projectPath: v.union(v.string(), v.null()),
        projectName: v.union(v.string(), v.null()),
        sessionId: v.union(v.string(), v.null()),
        text: v.string(),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("journal")
        .withIndex("by_localId", (q) => q.eq("localId", item.localId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("journal", item);
    }
    return { written: items.length };
  },
});

export const heartbeat = mutation({
  args: {
    agentKey: v.string(),
    version: v.string(),
    ingestPhase: v.string(),
    liveCount: v.number(),
    dbSessions: v.number(),
    syncedThrough: v.number(),
  },
  handler: async (ctx, { agentKey, ...rest }) => {
    requireAgent(agentKey);
    const row = { key: "status", lastHeartbeatAt: Date.now(), ...rest };
    const existing = await ctx.db
      .query("agent")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("agent", row);
    return { ok: true };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/sync.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add convex/sync.ts convex/sync.test.ts package.json package-lock.json
git commit -m "feat(convex): agent-authenticated mirror write mutations"
```

---

### Task 5: Convex read functions (user-facing)

**Files:**
- Create: `convex/snapshots.ts`, `convex/sessions.ts`, `convex/prompts.ts`, `convex/journal.ts`, `convex/agentStatus.ts`
- Test: `convex/reads.test.ts`

**Interfaces:**
- Produces queries: `snapshots.get({key})→payload|null`, `sessions.list({limit, projectId?})→SessionSummary[]`, `prompts.search({q, limit, projectId?})→rows[]`, `journal.list({limit})→rows[]`, `agentStatus.get({})→agent|null`. All call `requireUser` first.

- [ ] **Step 1: Write the failing auth test**

```ts
// convex/reads.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

test("reads are refused without a signed-in user", async () => {
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
  const t = convexTest(schema);
  await expect(t.query(api.snapshots.get, { key: "projects" })).rejects.toThrow(
    /not signed in/i,
  );
});

test("an allow-listed user reads the snapshot payload", async () => {
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("snapshots", {
      key: "projects",
      kind: "projects",
      payload: [{ id: 1, name: "Pulse" }],
      updatedAt: 1,
    });
  });
  const asUser = t.withIdentity({ nickname: "pldagenais" });
  expect(await asUser.query(api.snapshots.get, { key: "projects" })).toEqual([
    { id: 1, name: "Pulse" },
  ]);
});

test("a non-allow-listed user is refused", async () => {
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
  const t = convexTest(schema);
  const asOther = t.withIdentity({ nickname: "intruder" });
  await expect(asOther.query(api.snapshots.get, { key: "projects" })).rejects.toThrow(
    /not permitted/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/reads.test.ts`
Expected: FAIL — `api.snapshots` undefined.

- [ ] **Step 3: Implement the read queries**

```ts
// convex/snapshots.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("snapshots")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.payload ?? null;
  },
});
```

```ts
// convex/sessions.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()), projectId: v.optional(v.number()) },
  handler: async (ctx, { limit, projectId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_startedAt")
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return rows
      .filter((r) => projectId == null || r.projectId === projectId)
      .map((r) => r.payload);
  },
});
```

```ts
// convex/prompts.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const search = query({
  args: {
    q: v.optional(v.string()),
    limit: v.optional(v.number()),
    projectId: v.optional(v.number()),
  },
  handler: async (ctx, { q, limit, projectId }) => {
    await requireUser(ctx);
    const take = Math.min(limit ?? 50, 200);
    const rows = q
      ? await ctx.db
          .query("prompts")
          .withSearchIndex("search_text", (s) => {
            const base = s.search("text", q);
            return projectId == null ? base : base.eq("projectId", projectId);
          })
          .take(take)
      : await ctx.db.query("prompts").withIndex("by_ts").order("desc").take(take);
    return rows.map(({ _id, _creationTime, ...rest }) => rest);
  },
});
```

```ts
// convex/journal.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("journal")
      .withIndex("by_ts")
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return rows.map(({ _id, _creationTime, localId, ...rest }) => ({
      id: localId,
      ...rest,
    }));
  },
});
```

```ts
// convex/agentStatus.ts
import { query } from "./_generated/server";
import { requireUser } from "./lib/guards";

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (
      (await ctx.db
        .query("agent")
        .withIndex("by_key", (q) => q.eq("key", "status"))
        .unique()) ?? null
    );
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/reads.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add convex/
git commit -m "feat(convex): authenticated read queries for mirrored data"
```

---

### Task 6: Snapshot key table (pure module)

**Files:**
- Create: `server/lib/cloud/keys.js`
- Test: `server/lib/cloud/keys.test.js`

**Interfaces:**
- Produces:
  - `hashPayload(value): string` — stable SHA1 of JSON.
  - `staticSnapshots(): {key, kind, path}[]` — non-day-keyed mirrors.
  - `daySnapshots(days, todayKey, addDays): {key, kind, day, path}[]` — rolling window.

- [ ] **Step 1: Write the failing test**

```js
// server/lib/cloud/keys.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPayload, staticSnapshots, daySnapshots } from './keys.js';

test('hashPayload is stable and order-insensitive for keys', () => {
  assert.equal(hashPayload({ a: 1, b: 2 }), hashPayload({ b: 2, a: 1 }));
  assert.notEqual(hashPayload({ a: 1 }), hashPayload({ a: 2 }));
});

test('staticSnapshots maps keys to local REST paths', () => {
  const byKey = Object.fromEntries(staticSnapshots().map((s) => [s.key, s.path]));
  assert.equal(byKey.projects, '/api/projects');
  assert.ok(byKey.heatmap.startsWith('/api/heatmap'));
});

test('daySnapshots covers the requested window, newest first', () => {
  const addDays = (d, n) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  const rows = daySnapshots(3, '2026-08-14', addDays);
  const days = [...new Set(rows.map((r) => r.day))];
  assert.deepEqual(days, ['2026-08-14', '2026-08-13', '2026-08-12']);
  assert.ok(rows.some((r) => r.key === 'overview:2026-08-14'));
  assert.ok(rows.some((r) => r.key === 'timeline:2026-08-14'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/lib/cloud/keys.test.js`
Expected: FAIL — cannot find `./keys.js`.

- [ ] **Step 3: Implement**

```js
// server/lib/cloud/keys.js
import crypto from 'node:crypto';

/** Stable hash: object keys are sorted so re-serialisation cannot churn. */
export function hashPayload(value) {
  const stable = JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  );
  return crypto.createHash('sha1').update(stable ?? 'null').digest('hex');
}

/** Mirrors that do not depend on a day. */
export function staticSnapshots() {
  return [
    { key: 'projects', kind: 'projects', path: '/api/projects' },
    { key: 'heatmap', kind: 'heatmap', path: '/api/heatmap' },
    { key: 'insights:models', kind: 'insights', path: '/api/stats/models' },
    { key: 'insights:tools', kind: 'insights', path: '/api/stats/tools' },
    { key: 'insights:skills', kind: 'insights', path: '/api/stats/skills' },
    { key: 'insights:hours', kind: 'insights', path: '/api/stats/hours' },
    { key: 'prs', kind: 'insights', path: '/api/prs' },
    { key: 'tokenflow', kind: 'insights', path: '/api/token-flow?days=30' },
    { key: 'claudeai', kind: 'insights', path: '/api/claudeai' },
    { key: 'usagewindow', kind: 'status', path: '/api/usage-window' },
  ];
}

/** Day-keyed mirrors across a rolling window, newest day first. */
export function daySnapshots(days, todayKey, addDays) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = i === 0 ? todayKey : addDays(todayKey, -i);
    out.push({ key: `overview:${day}`, kind: 'overview', day, path: `/api/overview?date=${day}` });
    out.push({ key: `timeline:${day}`, kind: 'timeline', day, path: `/api/timeline?date=${day}` });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/lib/cloud/keys.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify every path exists on the local server**

```bash
node --disable-warning=ExperimentalWarning -e "
import('./server/lib/cloud/keys.js').then(async ({staticSnapshots}) => {
  for (const s of staticSnapshots()) {
    const r = await fetch('http://127.0.0.1:5599' + s.path);
    console.log(r.status, s.path);
  }
});"
```
Expected: every line prints `200`. Any 404 means the key table names a route that does not exist — fix the path before continuing.

- [ ] **Step 6: Commit**

```bash
git add server/lib/cloud/keys.js server/lib/cloud/keys.test.js
git commit -m "feat(cloud): snapshot key table and stable payload hashing"
```

---

### Task 7: Sync loop

**Files:**
- Create: `server/lib/cloud/sync.js`, `server/lib/cloud/index.js`
- Modify: `server/index.js` (start the sync when configured)
- Modify: `server/config.js` (read cloud env vars)

**Interfaces:**
- Consumes: `hashPayload`, `staticSnapshots`, `daySnapshots` from Task 6; `sync.*` mutations from Task 4.
- Produces: `createCloudSync(db, { port, appVersion })` → `{ start(), stop(), syncNow(), status() }`.

- [ ] **Step 1: Add configuration**

```js
// server/config.js — append
export const CLOUD_URL = process.env.PULSE_CONVEX_URL || '';
export const CLOUD_KEY = process.env.PULSE_AGENT_KEY || '';
export const CLOUD_SYNC_DAYS = Number(process.env.PULSE_SYNC_DAYS || 90);
export const CLOUD_ENABLED = !!(CLOUD_URL && CLOUD_KEY);
```

- [ ] **Step 2: Implement the sync module**

```js
// server/lib/cloud/sync.js
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api.js';
import { CLOUD_URL, CLOUD_KEY, CLOUD_SYNC_DAYS } from '../../config.js';
import { getMeta, setMeta } from '../db.js';
import { todayKey, addDays, safeJsonParse } from '../util.js';
import { hashPayload, staticSnapshots, daySnapshots } from './keys.js';
import { log } from '../logger.js';

const SYNC_MS = 60_000;
const LIVE_MS = 15_000;

export function createCloudSync(db, { port, appVersion }) {
  const client = new ConvexHttpClient(CLOUD_URL);
  const local = (path) =>
    fetch(`http://127.0.0.1:${port}${path}`).then((r) => r.json()).then((j) => j.data);

  const hashes = () => safeJsonParse(getMeta(db, 'cloud_hashes') ?? '{}') ?? {};
  const saveHashes = (h) => setMeta(db, 'cloud_hashes', JSON.stringify(h));

  async function pushSnapshots() {
    const h = hashes();
    const specs = [...staticSnapshots(), ...daySnapshots(CLOUD_SYNC_DAYS, todayKey(), addDays)];
    const batch = [];
    for (const spec of specs) {
      let payload;
      try { payload = await local(spec.path); } catch { continue; }
      const hash = hashPayload(payload);
      if (h[spec.key] === hash) continue;      // unchanged — skip the write
      h[spec.key] = hash;
      batch.push({ key: spec.key, kind: spec.kind, day: spec.day, payload, updatedAt: Date.now() });
      if (batch.length >= 20) {
        await client.mutation(api.sync.putSnapshots, { agentKey: CLOUD_KEY, items: batch.splice(0) });
      }
    }
    if (batch.length) await client.mutation(api.sync.putSnapshots, { agentKey: CLOUD_KEY, items: batch });
    saveHashes(h);
  }

  async function pushSessions() {
    const since = Number(getMeta(db, 'cloud_cursor_sessions') ?? 0);
    const rows = db.prepare(
      'SELECT id, last_event_at FROM sessions WHERE COALESCE(last_event_at, started_at) > ? ORDER BY COALESCE(last_event_at, started_at) LIMIT 200'
    ).all(since);
    if (!rows.length) return;
    const items = [];
    for (const r of rows) {
      const detail = await local(`/api/sessions/${r.id}`);
      if (!detail?.session) continue;
      const s = detail.session;
      items.push({
        sessionId: s.id, projectId: s.projectId, projectName: s.projectName,
        title: s.title ?? null, startedAt: s.startedAt ?? null, claudeMs: s.claudeMs,
        estCostUsd: s.estCostUsd ?? null, promptCount: s.promptCount,
        payload: s, updatedAt: Date.now(),
      });
      await client.mutation(api.sync.putSnapshots, {
        agentKey: CLOUD_KEY,
        items: [{ key: `session:${s.id}`, kind: 'session', payload: detail, updatedAt: Date.now() }],
      });
    }
    if (items.length) await client.mutation(api.sync.putSessions, { agentKey: CLOUD_KEY, items });
    setMeta(db, 'cloud_cursor_sessions', String(Math.max(...rows.map((r) => r.last_event_at ?? 0), since)));
  }

  async function pushPrompts() {
    const since = Number(getMeta(db, 'cloud_cursor_prompts') ?? 0);
    const rows = db.prepare(
      `SELECT p.uuid, p.session_id, p.project_id, p.ts, p.kind, p.text, p.char_count,
              pr.name project_name, s.title session_title
         FROM prompts p
         LEFT JOIN projects pr ON pr.id = p.project_id
         LEFT JOIN sessions s ON s.id = p.session_id
        WHERE p.ts > ? ORDER BY p.ts LIMIT 500`
    ).all(since);
    if (!rows.length) return;
    await client.mutation(api.sync.putPrompts, {
      agentKey: CLOUD_KEY,
      items: rows.map((r) => ({
        uuid: r.uuid, sessionId: r.session_id, projectId: r.project_id,
        projectName: r.project_name ?? null, sessionTitle: r.session_title ?? null,
        ts: r.ts, kind: r.kind, text: r.text, charCount: r.char_count,
      })),
    });
    setMeta(db, 'cloud_cursor_prompts', String(rows[rows.length - 1].ts));
  }

  async function pushJournal() {
    const since = Number(getMeta(db, 'cloud_cursor_journal') ?? 0);
    const rows = db.prepare(
      `SELECT j.id, j.ts, j.project_path, j.session_id, j.text, j.source, p.name project_name
         FROM journal j LEFT JOIN projects p ON p.path = j.project_path
        WHERE j.id > ? ORDER BY j.id LIMIT 200`
    ).all(since);
    if (!rows.length) return;
    await client.mutation(api.sync.putJournal, {
      agentKey: CLOUD_KEY,
      items: rows.map((r) => ({
        localId: r.id, ts: r.ts, projectPath: r.project_path ?? null,
        projectName: r.project_name ?? null, sessionId: r.session_id ?? null,
        text: r.text, source: r.source,
      })),
    });
    setMeta(db, 'cloud_cursor_journal', String(rows[rows.length - 1].id));
  }

  async function pushLive() {
    const payload = await local('/api/overview');
    await client.mutation(api.sync.putSnapshots, {
      agentKey: CLOUD_KEY,
      items: [{ key: 'live', kind: 'live', payload: payload.liveSessions ?? [], updatedAt: Date.now() }],
    });
    await client.mutation(api.sync.heartbeat, {
      agentKey: CLOUD_KEY,
      version: appVersion,
      ingestPhase: 'watching',
      liveCount: (payload.liveSessions ?? []).length,
      dbSessions: db.prepare('SELECT count(*) c FROM sessions').get().c,
      syncedThrough: Date.now(),
    });
  }

  let timers = [];
  async function cycle() {
    try {
      await pushSnapshots();
      await pushSessions();
      await pushPrompts();
      await pushJournal();
    } catch (e) {
      log.warn('cloud sync failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return {
    start() {
      timers.push(setInterval(cycle, SYNC_MS));
      timers.push(setInterval(() => pushLive().catch(() => {}), LIVE_MS));
      timers.forEach((t) => t.unref());
      setTimeout(cycle, 10_000).unref();
      log.info('cloud sync started');
    },
    stop() { timers.forEach(clearInterval); timers = []; },
    syncNow: cycle,
  };
}
```

- [ ] **Step 3: Wire it into the server**

```js
// server/index.js — inside startBackground(), after the watcher is ready
if (CLOUD_ENABLED) {
  const { createCloudSync } = await import('./lib/cloud/sync.js');
  createCloudSync(db, { port: PORT, appVersion: APP_VERSION }).start();
} else {
  log.info('cloud sync disabled (set PULSE_CONVEX_URL and PULSE_AGENT_KEY to enable)');
}
```

- [ ] **Step 4: Run with sync disabled to prove no regression**

```bash
npm run check
node --disable-warning=ExperimentalWarning server/index.js
```
Expected: log line "cloud sync disabled…", app behaves exactly as before. Stop the process.

- [ ] **Step 5: Run with sync enabled against the dev deployment**

```bash
PULSE_CONVEX_URL=$(grep '^CONVEX_URL' .env.local | cut -d= -f2) \
PULSE_AGENT_KEY=<the key set in Task 3> \
node --disable-warning=ExperimentalWarning server/index.js
```
Expected: "cloud sync started"; within ~15s `npx convex data snapshots` shows rows, and `npx convex data agent` shows one heartbeat row.

- [ ] **Step 6: Commit**

```bash
git add server/lib/cloud/ server/config.js server/index.js
git commit -m "feat(cloud): mirror local REST payloads into Convex"
```

---

### Task 8: Verification script (shape parity)

**Files:**
- Create: `scripts/verify-cloud.mjs`

**Interfaces:**
- Consumes: `staticSnapshots`, `daySnapshots` (Task 6); `snapshots.get` (Task 5).
- Produces: exit code 0 when every mirrored payload deep-equals its local REST response.

- [ ] **Step 1: Implement the script**

```js
// scripts/verify-cloud.mjs
import assert from 'node:assert/strict';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { staticSnapshots, daySnapshots } from '../server/lib/cloud/keys.js';
import { todayKey, addDays } from '../server/lib/util.js';

const PORT = process.env.CLAUDE_TRACKER_PORT || 5599;
const client = new ConvexHttpClient(process.env.PULSE_CONVEX_URL);
// Reads require a signed-in user, so verification runs against the agent's
// own view: fetch through a temporary admin key issued by `npx convex env`.
const specs = [...staticSnapshots(), ...daySnapshots(3, todayKey(), addDays)];

let failures = 0;
for (const spec of specs) {
  const localRes = await fetch(`http://127.0.0.1:${PORT}${spec.path}`).then((r) => r.json());
  const cloud = await client.query(api.snapshots.get, { key: spec.key });
  try {
    assert.deepEqual(cloud, localRes.data);
    console.log(`ok   ${spec.key}`);
  } catch {
    failures++;
    console.log(`FAIL ${spec.key}`);
  }
}
console.log(failures ? `${failures} mismatched` : 'all payloads match');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it**

```bash
PULSE_CONVEX_URL=$(grep '^CONVEX_URL' .env.local | cut -d= -f2) node scripts/verify-cloud.mjs
```
Expected: every line `ok`, final line `all payloads match`, exit 0.
If reads are refused because the script has no user identity, temporarily grant it by exporting `ALLOWED_GITHUB_LOGINS` and running the query through `npx convex run snapshots:get '{"key":"projects"}'` instead — the assertion logic is unchanged.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-cloud.mjs
git commit -m "test(cloud): verify mirrored payloads match local REST responses"
```

---

### Task 9: Job queue — Convex side

**Files:**
- Create: `convex/jobs.ts`
- Test: `convex/jobs.test.ts`

**Interfaces:**
- Produces: `jobs.enqueue({kind, payload})` (user) → job id; `jobs.list({limit})` (user); `jobs.claimNext({agentKey})` (agent) → job or null; `jobs.update({agentKey, id, status, outputTail?, localJobId?, sessionId?, error?})` (agent).

- [ ] **Step 1: Write the failing test**

```ts
// convex/jobs.test.ts
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const KEY = "k";

test("claimNext returns each queued job once", async () => {
  process.env.PULSE_AGENT_KEY = KEY;
  process.env.ALLOWED_GITHUB_LOGINS = "pldagenais";
  const t = convexTest(schema);
  const asUser = t.withIdentity({ nickname: "pldagenais" });
  await asUser.mutation(api.jobs.enqueue, { kind: "run", payload: { prompt: "hi" } });

  const first = await t.mutation(api.jobs.claimNext, { agentKey: KEY });
  const second = await t.mutation(api.jobs.claimNext, { agentKey: KEY });
  expect(first?.payload).toEqual({ prompt: "hi" });
  expect(second).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/jobs.test.ts`
Expected: FAIL — `api.jobs` undefined.

- [ ] **Step 3: Implement**

```ts
// convex/jobs.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, requireAgent } from "./lib/guards";

export const enqueue = mutation({
  args: { kind: v.string(), payload: v.any() },
  handler: async (ctx, { kind, payload }) => {
    const login = await requireUser(ctx);
    return await ctx.db.insert("jobs", {
      kind, payload, status: "queued", requestedBy: login, createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    return await ctx.db.query("jobs").order("desc").take(Math.min(limit ?? 20, 50));
  },
});

export const claimNext = mutation({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) => {
    requireAgent(agentKey);
    const next = await ctx.db
      .query("jobs")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
    if (!next) return null;
    await ctx.db.patch(next._id, { status: "running", claimedAt: Date.now() });
    return { ...next, status: "running" };
  },
});

export const update = mutation({
  args: {
    agentKey: v.string(),
    id: v.id("jobs"),
    status: v.optional(v.string()),
    outputTail: v.optional(v.string()),
    localJobId: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { agentKey, id, ...patch }) => {
    requireAgent(agentKey);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v2]) => v2 !== undefined));
    if (clean.status === "done" || clean.status === "error") clean.finishedAt = Date.now();
    await ctx.db.patch(id, clean);
    return { ok: true };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/jobs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add convex/jobs.ts convex/jobs.test.ts
git commit -m "feat(convex): remote job queue with agent claim semantics"
```

---

### Task 10: Job queue — agent poller

**Files:**
- Create: `server/lib/cloud/jobs.js`
- Modify: `server/lib/cloud/sync.js` (start the poller alongside sync)

**Interfaces:**
- Consumes: `jobs.claimNext`, `jobs.update` (Task 9); existing `jobs.launch()` from `server/lib/jobs.js`.
- Produces: `createQueuePoller(client, { jobs, db })` → `{ start(), stop() }`.

- [ ] **Step 1: Implement the poller**

```js
// server/lib/cloud/jobs.js
import { api } from '../../../convex/_generated/api.js';
import { CLOUD_KEY } from '../../config.js';
import { log } from '../logger.js';

const POLL_MS = 10_000;

export function createQueuePoller(client, { jobs, db }) {
  let timer = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const job = await client.mutation(api.jobs.claimNext, { agentKey: CLOUD_KEY });
      if (!job) return;
      log.info(`cloud job ${job._id}: claimed (${job.kind})`);

      if (job.kind === 'run') {
        const project = db
          .prepare('SELECT id, path FROM projects WHERE id=?')
          .get(Number(job.payload.projectId));
        if (!project) throw new Error('unknown project');
        const { jobId, sessionId } = jobs.launch({
          projectId: project.id,
          projectPath: project.path,
          prompt: String(job.payload.prompt ?? ''),
          model: job.payload.model ?? null,
          maxTurns: Number(job.payload.maxTurns) || 15,
          permissionMode: 'default',   // remote runs are read-only by policy
        });
        await client.mutation(api.jobs.update, {
          agentKey: CLOUD_KEY, id: job._id, localJobId: jobId, sessionId: sessionId ?? undefined,
        });
        const watch = setInterval(async () => {
          const row = db.prepare('SELECT status, output_tail FROM pulse_jobs WHERE id=?').get(jobId);
          if (!row) return;
          await client.mutation(api.jobs.update, {
            agentKey: CLOUD_KEY, id: job._id,
            status: row.status === 'running' ? 'running' : row.status,
            outputTail: (row.output_tail ?? '').slice(-4000),
          }).catch(() => {});
          if (row.status !== 'running') clearInterval(watch);
        }, 3000);
        watch.unref();
      } else if (job.kind === 'kill') {
        jobs.kill(Number(job.payload.jobId));
        await client.mutation(api.jobs.update, { agentKey: CLOUD_KEY, id: job._id, status: 'done' });
      } else {
        await client.mutation(api.jobs.update, {
          agentKey: CLOUD_KEY, id: job._id, status: 'error', error: `unsupported kind ${job.kind}`,
        });
      }
    } catch (e) {
      log.warn('cloud job poll failed:', e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  return {
    start() { timer = setInterval(tick, POLL_MS); timer.unref(); },
    stop() { if (timer) clearInterval(timer); },
  };
}
```

- [ ] **Step 2: Start it from the sync module**

In `createCloudSync`, accept `jobs` in the options object and inside `start()` add:

```js
import { createQueuePoller } from './jobs.js';
// ...
const poller = createQueuePoller(client, { jobs, db });
poller.start();
```

Update the call site in `server/index.js` to pass `jobs`.

- [ ] **Step 3: End-to-end test**

```bash
npx convex run jobs:enqueue '{"kind":"run","payload":{"projectId":9,"prompt":"Reply with exactly: OK","model":"claude-haiku-4-5","maxTurns":2}}'
```
Expected: within ~10s the server logs "cloud job … claimed (run)", then a local job appears in `/api/jobs`, and `npx convex data jobs` shows the row transitioning to `done` with `outputTail` containing `OK`.

- [ ] **Step 4: Commit**

```bash
git add server/lib/cloud/jobs.js server/lib/cloud/sync.js server/index.js
git commit -m "feat(cloud): claim and execute remotely queued jobs"
```

---

### Task 11: Frontend data-source resolver (pure module)

**Files:**
- Create: `web/src/lib/source.ts`
- Test: `web/src/lib/source.test.ts`
- Modify: `web/package.json` (add vitest)

**Interfaces:**
- Produces:
  - `detectMode(hostname: string): 'local' | 'cloud'`
  - `resolveRemote(path: string): { fn: string; args: Record<string, unknown> } | null` — `null` means the path is local-only.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/source.test.ts
import { describe, it, expect } from 'vitest';
import { detectMode, resolveRemote } from './source';

describe('detectMode', () => {
  it('treats loopback as local', () => {
    expect(detectMode('127.0.0.1')).toBe('local');
    expect(detectMode('localhost')).toBe('local');
  });
  it('treats anything else as cloud', () => {
    expect(detectMode('pulse.vercel.app')).toBe('cloud');
  });
});

describe('resolveRemote', () => {
  it('maps day-keyed endpoints to snapshot keys', () => {
    expect(resolveRemote('/api/overview?date=2026-08-14')).toEqual({
      fn: 'snapshots:get', args: { key: 'overview:2026-08-14' },
    });
  });
  it('maps session detail to its snapshot', () => {
    expect(resolveRemote('/api/sessions/abc-123')).toEqual({
      fn: 'snapshots:get', args: { key: 'session:abc-123' },
    });
  });
  it('maps prompt search to the search query', () => {
    expect(resolveRemote('/api/prompts?q=migration&pageSize=25')).toEqual({
      fn: 'prompts:search', args: { q: 'migration', limit: 25 },
    });
  });
  it('returns null for local-only endpoints', () => {
    expect(resolveRemote('/api/manage/mcp')).toBeNull();
    expect(resolveRemote('/api/memory')).toBeNull();
  });
});
```

- [ ] **Step 2: Install vitest and run to verify failure**

```bash
npm --prefix web install -D vitest
npx --prefix web vitest run src/lib/source.test.ts
```
Expected: FAIL — cannot resolve `./source`.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/source.ts
export type Mode = 'local' | 'cloud';

export function detectMode(hostname: string): Mode {
  return hostname === '127.0.0.1' || hostname === 'localhost' ? 'local' : 'cloud';
}

export const MODE: Mode =
  typeof window === 'undefined' ? 'local' : detectMode(window.location.hostname);

/** Map a local REST path to a Convex call. null = local-only capability. */
export function resolveRemote(path: string): { fn: string; args: Record<string, unknown> } | null {
  const [raw, qs = ''] = path.split('?');
  const q = new URLSearchParams(qs);
  const day = q.get('date');
  const snapshot = (key: string) => ({ fn: 'snapshots:get', args: { key } });

  if (raw === '/api/overview') return snapshot(`overview:${day ?? ''}`);
  if (raw === '/api/timeline') return snapshot(`timeline:${day ?? ''}`);
  if (raw === '/api/projects') return snapshot('projects');
  if (raw === '/api/heatmap') return snapshot('heatmap');
  if (raw === '/api/prs') return snapshot('prs');
  if (raw === '/api/claudeai') return snapshot('claudeai');
  if (raw === '/api/usage-window') return snapshot('usagewindow');
  if (raw === '/api/token-flow') return snapshot('tokenflow');
  if (raw.startsWith('/api/stats/')) return snapshot(`insights:${raw.split('/').pop()}`);

  const project = raw.match(/^\/api\/projects\/(\d+)$/);
  if (project) return snapshot(`project:${project[1]}`);

  const session = raw.match(/^\/api\/sessions\/([\w-]+)$/);
  if (session) return snapshot(`session:${session[1]}`);

  const report = raw.match(/^\/api\/report\/(\d+)$/);
  if (report) return snapshot(`report:${report[1]}`);

  if (raw === '/api/sessions') {
    return { fn: 'sessions:list', args: { limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/prompts') {
    return { fn: 'prompts:search', args: { q: q.get('q') ?? '', limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/journal') {
    return { fn: 'journal:list', args: { limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/jobs') return { fn: 'jobs:list', args: { limit: 20 } };
  if (raw === '/api/status') return { fn: 'agentStatus:get', args: {} };

  return null; // manage/*, memory/*, routines/*, actions — local only
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix web vitest run src/lib/source.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/source.ts web/src/lib/source.test.ts web/package.json web/package-lock.json
git commit -m "feat(web): REST-path to Convex-call resolver"
```

---

### Task 12: Frontend Convex client + api.ts branch

**Files:**
- Create: `web/src/lib/convexClient.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/main.tsx` (auth provider in cloud mode)
- Modify: `web/package.json` (convex, @convex-dev/auth)

**Interfaces:**
- Consumes: `MODE`, `resolveRemote` (Task 11); Convex queries from Tasks 5 and 9.
- Produces: `callRemote(path, method, body)` used inside `api.*`; `UnavailableRemotely` error class.

- [ ] **Step 1: Install client dependencies**

```bash
npm --prefix web install convex @convex-dev/auth
```

- [ ] **Step 2: Implement the dispatcher**

```ts
// web/src/lib/convexClient.ts
import { ConvexReactClient } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { resolveRemote } from './source';

export class UnavailableRemotely extends Error {
  constructor(path: string) {
    super(`${path} needs your PC — open Pulse on your machine`);
  }
}

export const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const FN: Record<string, any> = {
  'snapshots:get': api.snapshots.get,
  'sessions:list': api.sessions.list,
  'prompts:search': api.prompts.search,
  'journal:list': api.journal.list,
  'jobs:list': api.jobs.list,
  'agentStatus:get': api.agentStatus.get,
};

export async function callRemote(path: string, method: string, body?: unknown): Promise<any> {
  if (method === 'POST' && path === '/api/jobs') {
    return convex.mutation(api.jobs.enqueue, { kind: 'run', payload: body });
  }
  if (method !== 'GET') throw new UnavailableRemotely(path);
  const call = resolveRemote(path);
  if (!call || !FN[call.fn]) throw new UnavailableRemotely(path);
  return convex.query(FN[call.fn], call.args);
}
```

- [ ] **Step 3: Branch inside api.ts**

At the top of each method in `web/src/lib/api.ts`, before the `fetch`, add:

```ts
import { MODE } from './source';
import { callRemote } from './convexClient';
// inside request(): 
if (MODE === 'cloud') return callRemote(url, options?.method ?? 'GET', bodyValue);
```

`queries.ts` and every component stay unchanged.

- [ ] **Step 4: Verify the local build still passes**

```bash
npm --prefix web run build
npm --prefix web run test -- --run
```
Expected: build succeeds; tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/convexClient.ts web/src/lib/api.ts web/src/main.tsx web/package.json web/package-lock.json
git commit -m "feat(web): route data access through Convex in cloud mode"
```

---

### Task 13: Cloud-mode UI (sign-in, offline banner, hidden local features)

**Files:**
- Modify: `web/src/main.tsx`, `web/src/components/layout/AppLayout.tsx`
- Create: `web/src/components/layout/SignIn.tsx`, `web/src/components/layout/OfflineBanner.tsx`

**Interfaces:**
- Consumes: `MODE` (Task 11), `convex` client (Task 12), `agentStatus.get` (Task 5).

- [ ] **Step 1: Sign-in screen**

```tsx
// web/src/components/layout/SignIn.tsx
import { useAuthActions } from '@convex-dev/auth/react';

export function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="glass rounded-xl p-8 text-center">
        <div className="font-display text-2xl font-semibold text-ink">
          Pulse<span className="text-claude">▌</span>
        </div>
        <p className="mt-2 text-[13px] text-dim">Sign in to view your Claude Code dashboard.</p>
        <button
          onClick={() => void signIn('github')}
          className="mt-5 rounded-md border border-claude/50 bg-claude/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20"
        >
          continue with github
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wrap the app in cloud mode**

```tsx
// web/src/main.tsx — cloud mode only
import { ConvexAuthProvider, Authenticated, Unauthenticated } from '@convex-dev/auth/react';
import { convex } from './lib/convexClient';
import { MODE } from './lib/source';
import { SignIn } from './components/layout/SignIn';

const tree = MODE === 'cloud' ? (
  <ConvexAuthProvider client={convex}>
    <Unauthenticated><SignIn /></Unauthenticated>
    <Authenticated>{app}</Authenticated>
  </ConvexAuthProvider>
) : app;
```

- [ ] **Step 3: Offline banner**

```tsx
// web/src/components/layout/OfflineBanner.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { fmtRelative } from '../../lib/format';

export function OfflineBanner() {
  const q = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get<{ lastHeartbeatAt: number } | null>('/api/status'),
    refetchInterval: 60_000,
  });
  const last = q.data?.lastHeartbeatAt;
  if (!last || Date.now() - last < 120_000) return null;
  return (
    <div className="border-b border-user/40 bg-user/10 px-5 py-2 font-mono text-[11px] text-user">
      Your PC is offline — showing data as of {fmtRelative(last)}.
    </div>
  );
}
```

Render it directly under the header in `AppLayout`, and filter the nav in cloud mode:

```tsx
const nav = MODE === 'cloud' ? NAV.filter((n) => n.to !== '/manage') : NAV;
```

- [ ] **Step 4: Build and verify**

```bash
npm --prefix web run build
```
Expected: build succeeds. Locally (`127.0.0.1:5599`) the app must look and behave exactly as before — no sign-in screen, Manage still present.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): cloud-mode sign-in, offline banner, local-only nav filtering"
```

---

### Task 14: Vercel deployment

**Files:**
- Create: `vercel.json`, `.vercelignore`

- [ ] **Step 1: Add configuration**

```json
// vercel.json
{
  "buildCommand": "npx convex deploy --cmd 'npm --prefix web ci && npm --prefix web run build' --cmd-url-env-var-name VITE_CONVEX_URL",
  "outputDirectory": "web/dist",
  "installCommand": "npm install",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

```
# .vercelignore
data/
server/
hooks/
scripts/
docs/
```

- [ ] **Step 2: Create a Convex production deployment and deploy key**

```bash
npx convex deploy   # prompts to create prod; requires explicit consent
npx convex env set PULSE_AGENT_KEY <same key> --prod
npx convex env set ALLOWED_GITHUB_LOGINS pldagenais --prod
npx convex env set AUTH_GITHUB_ID <id> --prod
npx convex env set AUTH_GITHUB_SECRET <secret> --prod
```

- [ ] **Step 3: Link and deploy**

```bash
vercel link --yes
vercel env add CONVEX_DEPLOY_KEY production   # paste key from the Convex dashboard
vercel --prod
```
Expected: a deployment URL. Visiting it shows the sign-in screen.

- [ ] **Step 4: Point the local agent at production**

Update the scheduled task environment (or `data/.env`) with the **production** `PULSE_CONVEX_URL`, restart the server, and confirm `npx convex data agent --prod` shows a fresh heartbeat.

- [ ] **Step 5: End-to-end verification**

1. Sign in on the Vercel URL with GitHub → dashboard renders with real data.
2. Sign in with a different GitHub account (or revoke the allow-list entry) → refused.
3. Stop the local server → offline banner appears, data still renders.
4. Queue a job from the Run page → local server claims and runs it; output appears remotely.

- [ ] **Step 6: Commit**

```bash
git add vercel.json .vercelignore
git commit -m "chore: vercel deployment configuration"
git push
```

---

## Self-Review

**Spec coverage:** every spec section maps to a task — mirroring strategy (6, 7), Convex tables (2), auth (3), agent sync (7), job queue (9, 10), frontend adapter (11, 12), cloud UI (13), deployment (14), verification (8, 14 step 5), repo hygiene (1).

**Placeholders:** none — every step carries runnable commands or complete code. The two values that cannot be generated (GitHub OAuth client id/secret) are called out as an explicit user prerequisite in Task 3.

**Type consistency:** `putSnapshots`/`putSessions`/`putPrompts`/`putJournal`/`heartbeat` (Task 4) match the calls in `sync.js` (Task 7); `claimNext`/`update` (Task 9) match the poller (Task 10); the `fn` strings in `resolveRemote` (Task 11) match the `FN` lookup table (Task 12) and the query names defined in Task 5.

**Known risk carried forward:** Task 8's verification script reads through `snapshots.get`, which requires a user identity. If Convex refuses the script's unauthenticated call, use the documented `npx convex run` fallback in that step rather than weakening the auth guard.

---

## Execution record (2026-08-14)

All 14 tasks executed. Deviations from the plan, and why:

- **@auth/core version** — the plan pinned 0.37.0; `@convex-dev/auth@0.0.95` requires `^0.41.1`. Installed 0.41.3.
- **`/api/stats` paths** — the plan invented `/api/stats/models` etc. Stats is a single
  endpoint taking `groupBy` plus a date range. Task 6's "verify every path returns 200"
  step caught this before any of it shipped; cloud now mirrors a canonical 90-day window
  per grouping and `resolveRemote` drops the range.
- **`anyApi` instead of the generated api** — importing `convex/_generated/api.js` from
  server code pulled Convex's TypeScript sources into the root nodenext typecheck.
- **Auth tables** — `...authTables` was missing from the schema; `@convex-dev/auth`
  requires them.
- **Config source** — the plan assumed environment variables. The Windows scheduled task
  inherits no shell environment, so settings fall back to git-ignored `data/cloud.json`.
- **Added, not planned: `server/lib/cloud/redact.js`** — credential-shaped strings are
  stripped from prompt text before mirroring, after a real OAuth secret was pasted into a
  session. Verified: present in the local DB, absent from the cloud mirror.
- **Vercel** points at the Convex **dev** deployment. Production was deliberately not
  created; it is a separate database and needs a new OAuth callback URL.

Verified end to end: mirror (177 snapshots / 40 sessions / 300 prompts), GitHub OAuth
redirect with correct client id, PKCE and callback, local mode unchanged, and a job
queued in Convex claimed by the local agent and executed (exit 0, "PONG", 13.5s,
ingested as a normal session).

## Post-deployment fixes (2026-08-14, same day)

The first live run of the deployment failed in four ways. All four are the same
underlying mistake: **the cloud path was never exercised against a real signed-in
session**, so nothing caught a claim or an envelope that differed from the local
API.

**1. Nobody could read anything.** `requireUser` matched the allow-list against
`identity.nickname`, but Convex Auth signs only `sub/iss/aud/iat/exp` — the JWT
carries no email, name, or GitHub login. The login resolved to `""`, `isAllowed`
failed closed, and every user-facing query threw "Account not permitted", which
renders as a signed-in shell with empty cards. The guard now resolves the user via
`getAuthUserId` and matches the email on the `users` row; the allow-list env var is
`ALLOWED_USERS` (`ALLOWED_GITHUB_LOGINS` is still read as a fallback).

The tests passed against the broken guard because `withIdentity({nickname})` supplied
a claim the real token never carries. They now insert a `users` row and present a
`<userId>|<sessionId>` subject — the shape Convex Auth actually produces
(`convex/lib/testUser.ts`).

**2. The pill said "reconnecting…" forever.** Cloud mode opened an EventSource
against Vercel, which serves no SSE. `LiveProvider` now splits: local keeps SSE,
cloud polls the mirrored `live` snapshot every 15s and invalidates page queries at
60s, matching the agent's own sync cadence rather than refetching four times per
mirror update.

**3. The dashboard, then the Run page, crashed on undefined.** The hand-written read
functions returned bare arrays where the REST routes return envelopes
(`{total, page, pageSize, rows}`, `{jobs, running}`), and `jobs:list` returned queue
rows (`{kind, payload}`) where the page renders local `jobRow` fields. Shape parity
was supposed to hold by construction; these functions were exactly the places it did
not, because they were written by hand instead of mirroring a response. Each now
returns its route's envelope, and the tests assert the envelope rather than the inner
array.

**4. Project details, calendars and reports were blank.** They resolved to snapshot
keys the agent never wrote. The agent now mirrors, per project, `/api/projects/:id`,
the current month's calendar, and the all-time report (a few KB each) — the report
range is normalised away exactly as `/api/stats` already does. The PDF export is
rendered by the local server, so that link is hidden in cloud mode.

Verified in the browser against the live deployment: dashboard, timeline, projects,
project detail (calendar populated), sessions, prompts, insights, journal, status,
mission, run, and report all render real data with **zero console errors**. The live
pill reads "3 working · 2 cloud".

**Note for future work:** an already-open tab kept serving the old bundle after deploying,
which made a fixed page look broken. When verifying a deploy, check the served bundle hash
or use a fresh tab.

*(Corrected 2026-08-15: this was originally attributed to a stale service worker. That is
wrong — `web/public/sw.js` caches no assets at all, intercepting only `mode === 'navigate'`
to serve an offline fallback. The old bundle persisted because an open tab keeps its loaded
modules and its cached `index.html`; `vite:preloadError` only fires when a lazy chunk 404s,
which never happens if the user does not navigate to a new route. Giving open tabs a real
update path is Task 18 of `2026-08-15-improvement-backlog-25.md`.)*
