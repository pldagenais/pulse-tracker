# Pulse remote deployment — design

Date: 2026-08-14
Status: approved for implementation

## Problem

Pulse is a local-only Claude Code dashboard. Its server reads
`~/.claude/projects/**/*.jsonl`, keeps SQLite on disk, receives Claude Code
hooks on `127.0.0.1:5599`, spawns `claude -p` jobs, kills local PIDs, and opens
Explorer/Terminal windows. PL wants to reach the dashboard from anywhere,
including while the PC sleeps, and to launch Claude jobs remotely.

None of the local capabilities survive a lift-and-shift to serverless: Vercel
functions have no persistent filesystem, no long-running process, and no
`~/.claude`. The system must therefore split into a **local agent** (today's
server, unchanged in its responsibilities) and a **cloud mirror** that serves
reads and brokers commands.

## Decisions (settled with PL)

| Question | Decision |
|---|---|
| Remote capability | View everything + launch Claude jobs via a queue |
| Works while PC is off | Yes — data mirrored to Convex |
| Auth | GitHub OAuth, allow-listed to PL's account |
| Prompt text in cloud | **Mirrored in full** (enables remote search) |
| Repo | New **private** GitHub repo `pldagenais/pulse` |

## Architecture

```
Your PC (runs 24/7 as a scheduled task)          Cloud
┌────────────────────────────────┐              ┌──────────────────────────┐
│ Pulse server  (source of truth)│──── sync ───▶│ Convex                   │
│  • ~/.claude ingestion         │              │  • mirrored snapshots    │
│  • SQLite, hooks, scheduler    │              │  • sessions / prompts    │
│  • claude -p jobs, kill, MCP   │◀── claim ────│  • command queue         │
│  • NEW: cloudsync + poller     │              │  • GitHub auth           │
└────────────────────────────────┘              └────────────┬─────────────┘
                                                             │ queries
                                                ┌────────────▼─────────────┐
                                                │ Vercel: existing SPA     │
                                                │  (cloud data adapter)    │
                                                └──────────────────────────┘
```

The local server remains authoritative. Convex holds a derived copy plus the
command queue. The SPA is one codebase serving two modes.

## Mirroring strategy

The agent pushes **the exact JSON shapes the existing REST API returns**, keyed
by the request they answer, rather than replicating raw tables. React
components therefore need no changes — only the fetch layer differs.

### Convex tables

```ts
snapshots   { key, kind, day?, payload, updatedAt }   // "overview:2026-08-14", "projects", "session:<id>"
sessions    { sessionId, projectId, projectName, title, startedAt,
              claudeMs, estCostUsd, promptCount, payload, updatedAt }
prompts     { uuid, sessionId, projectId, projectName, sessionTitle,
              ts, kind, text, charCount }             // searchIndex on text
journal     { localId, ts, projectPath, projectName, sessionId, text, source }
jobs        { kind, status, payload, requestedBy, createdAt, claimedAt,
              finishedAt, localJobId, sessionId, outputTail, error }
agent       { key: "status", lastHeartbeatAt, version, ingestPhase,
              liveCount, dbSessions, syncedThrough }
```

Indexes: `snapshots.by_key`, `sessions.by_startedAt`, `prompts.by_ts`,
`prompts` search index (`text`, filters `projectId`/`kind`),
`journal.by_ts`, `jobs.by_status_createdAt`, `agent.by_key`.

### Snapshot keys

| Key | Source endpoint |
|---|---|
| `overview:<day>` | `/api/overview?date=` |
| `timeline:<day>` | `/api/timeline?date=` |
| `projects` | `/api/projects` |
| `project:<id>` | `/api/projects/:id` |
| `session:<id>` | `/api/sessions/:id` |
| `insights` | model/tool/skill/hour stats bundle |
| `heatmap` | `/api/heatmap` |
| `records` | records block |
| `digest` | weekly digest |
| `report:<projectId>` | `/api/report/:id` |
| `status` | health block (sans local paths) |
| `live` | live-session snapshot, refreshed every 15s |

Day-keyed snapshots cover a rolling window (`PULSE_SYNC_DAYS`, default 90).
Older days are not mirrored; the SPA shows "not synced" for them.

Raw `events` (50k+ rows) never leave the PC — everything derived from them is
pushed as precomputed aggregates. Expected cloud volume: ~1,500 documents.

### Change detection

Local `meta` table gains watermarks: `cloud_cursor_sessions` (max
`last_event_at`), `cloud_cursor_prompts` (max `ts`), `cloud_cursor_journal`
(max id), and `cloud_snapshot_hashes` (JSON map of key → SHA1 of payload).
A snapshot is pushed only when its hash changes, which keeps Convex bandwidth
near zero on idle cycles.

## Local agent additions

New module `server/lib/cloudsync.js`, wired in `server/index.js`:

- **Config** (all optional; absent config disables sync entirely):
  `PULSE_CONVEX_URL`, `PULSE_AGENT_KEY`, `PULSE_SYNC_DAYS=90`.
- **Sync cycle** every 60s, plus an immediate cycle after ingest completes:
  heartbeat → changed sessions (batches of 50) → changed prompts (batches of
  200) → journal → changed day snapshots → changed static snapshots.
- **Live cycle** every 15s: pushes only the `live` snapshot (small).
- **Job poller** every 10s: `jobs.claimNext` → executes through the existing
  `jobs.launch()` / kill / summarize paths → pushes status and output tail
  every ~2s → finalizes.
- Failures are logged and retried on the next cycle. Sync never blocks
  ingestion, and a cloud outage cannot affect local operation.

Agent-only Convex mutations authenticate with a shared secret
(`PULSE_AGENT_KEY`) validated against a Convex environment variable. The key
lives only in the agent's environment and never enters the web bundle.

## Frontend

`web/src/lib/source.ts` decides the mode: `local` when the hostname is
`127.0.0.1`/`localhost`, otherwise `cloud`.

The adapter lives **inside `api.get/post/put/del`**, so `queries.ts` and every
component stay untouched. In cloud mode the adapter maps REST paths to Convex
calls:

- `/api/overview?date=X` → `snapshots.get({ key: "overview:X" })`
- `/api/sessions?…` → `sessions.list(…)`; `/api/sessions/:id` → `session:<id>`
- `/api/prompts?q=…` → `prompts.search(…)` (Convex search index)
- `/api/journal` → `journal.list`
- `POST /api/jobs` → `jobs.enqueue` (returns queued job id)
- `POST /api/sessions/:id/kill`, `POST /api/report/:id/summarize` → `jobs.enqueue`
- Local-only paths (`/api/manage/*`, `/api/memory/*`, `/api/routines/*`,
  `/api/projects/:id/open`, `/api/sessions/:id/resume`) throw
  `UnavailableRemotely`.

Other cloud-mode behavior:

- Live updates: SSE is local-only. Cloud mode polls the `live` snapshot every
  10s through the same adapter.
- Nav: Manage is hidden; open-in/resume buttons are hidden.
- A banner appears when `agent.lastHeartbeatAt` is older than 2 minutes:
  "PC offline — data as of &lt;time&gt;".
- Run page: submissions are labeled "queued — your PC will pick this up".

## Auth

Convex Auth with the GitHub provider. A `requireUser(ctx)` helper runs in every
**user-facing** query and mutation and checks the authenticated GitHub login
against the `ALLOWED_GITHUB_LOGINS` Convex environment variable.
Unauthenticated callers receive no data; the Vercel URL shows only a sign-in
screen.

Agent-only functions (`sync.*`, `jobs.claimNext`, `jobs.update`,
`agent.heartbeat`) are the deliberate exception: they cannot perform an OAuth
flow, so they authenticate with the shared `PULSE_AGENT_KEY` instead of a user
identity, and they are never callable from the browser bundle.

The local app on `127.0.0.1` stays unauthenticated — it is already reachable
only from PL's machine, and adding a login there would break the existing
workflow for no security gain.

## Deployment

- **GitHub**: private repo `pldagenais/pulse`. `.gitignore` already excludes
  `data/` (SQLite, imported claude.ai conversations, memory backups, logs) and
  gains `.env*`, `.convex/`, `.vercel/`. A secret/PII scan runs before the
  first push; the 2026-08-14 scan found no credentials. The one account-scoped
  value in the tree — `CLOUD_ENVIRONMENTS` in `server/lib/routines.js`, a
  snapshot of PL's cloud environment IDs — moves to `data/config.json` (git-
  ignored) with an empty in-code fallback, so the repo carries no
  account-specific identifiers.
- **Convex**: `npx convex deploy` from the repo root; env vars
  `PULSE_AGENT_KEY`, `ALLOWED_GITHUB_LOGINS`, GitHub OAuth client id/secret.
- **Vercel**: project root = repo root. Build command
  `npx convex deploy --cmd "npm --prefix web ci && npm --prefix web run build" --cmd-url-env-var-name VITE_CONVEX_URL`,
  output directory `web/dist`, SPA rewrite to `index.html`, env
  `VITE_PULSE_MODE=cloud` and `CONVEX_DEPLOY_KEY`.

## Verification

1. `scripts/verify-cloud.mjs` fetches each mirrored key from both the local
   REST API and Convex and deep-equals the payloads — the mirror is correct
   only if the shapes match exactly.
2. Auth: an unauthenticated Convex client receives zero rows from every query.
3. Queue: enqueue a job from the deployed URL, confirm the local agent claims
   it within ~10s, runs it, and that the resulting session appears in both the
   local DB and the cloud mirror.
4. Offline banner: stop the local agent, confirm the deployed app still renders
   the last mirrored data with the staleness banner.
5. Local regression: with sync disabled (no env vars), the local app behaves
   exactly as it does today.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt text lives in Convex | Accepted by PL; repo private, auth allow-listed, single-user project |
| Convex bandwidth from re-pushing | Hash-compare per snapshot; rolling day window |
| Agent key leaks into the browser bundle | Key read only from the agent's env; never referenced in `web/` |
| Vercel building the Node server | Vercel builds `web/` only; `server/` excluded from the build command |
| Stale data when the PC sleeps | Heartbeat + explicit staleness banner |
| Cloud outage degrades local app | Sync is fire-and-forget; failures are logged and retried |

## Out of scope (v1)

Remote editing of memory files, MCP management, routines, and terminal launch
(all physically local); writing journal entries from the cloud; multi-user
support; mirroring days older than the rolling window.
