# Claude Time Tracker

Local Windows app that tracks Claude Code usage. Node 24 server (plain ESM JS) + React SPA. Runs 24/7 via Scheduled Task "ClaudeTimeTracker", serving http://127.0.0.1:5599.

## How it works
- Parses Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) incrementally (byte-offset cursors in `ingest_files`), backfilled + watched live via chokidar.
- Real-time signals via Claude Code hooks (`~/.claude/settings.json` → `hooks/notify.mjs` → POST /api/hook).
- SQLite via built-in `node:sqlite` (run node with `--disable-warning=ExperimentalWarning`), DB at `data/tracker.db` — a rebuildable cache EXCEPT journal/settings/hook_events/meta (preserved by `npm run reingest`).
- Never writes anything under `~/.claude/projects` (read-only source data) — SOLE exception: the memory editor (`server/routes/memory.js`) may write `*.md` inside `<project>/memory/` folders (never `.jsonl`), with rotating backups in `data/memory-backups/`.
- That same editor also writes project-committed memory (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`) **inside the user's own repos**, discovered by walking up from each tracked project cwd (`server/lib/memory-files.js`). A path is writable iff that discovery pass produced it — membership in the returned index, never a pattern match on request input — and `violatesProjectsInvariant()` re-enforces the `~/.claude/projects` rule independently.

## Commands
- `npm start` — run server (serves built web/dist)
- `npm run dev` — server (--watch) + vite dev server (web on :5600, proxies /api)
- `npm run build:web` — build SPA to web/dist
- `npm run setup` — full install: deps, build, hooks, CLAUDE.md journal block, scheduled task
- `npm run check` — typecheck server JSDoc
- `npm run smoke` — parser smoke test against real transcripts

## Critical parser rules (violating these corrupts stats)
- Human prompt = user line, string content, `origin.kind==="human"` OR `/^<command-name>/` (slash commands lack `origin`); exclude isMeta / toolUseResult present / array content / `<local-command-*`.
- Credit `message.usage` ONCE per `message.id` (one API response = 2-3 assistant lines, each with the full identical usage object).
- Read `sessionId` from each line, never the filename (fork/resume files start with lines copied from another session); dedupe on line `uuid`.
- Exclude model `<synthetic>` from tokens/cost. Never persist thinking signatures or file contents.
- `cwd` is the only trustworthy project path (folder names are lossy-encoded). File mtimes unreliable — use in-file timestamps for all date logic; mtime+size only as change cursor.
- Subagent files (`<project>/<sessionId>/subagents/**/agent-*.jsonl`, `isSidechain:true`, `sessionId` = parent) → `agent_runs` rollup, NOT events rows.

## Timing model
Turn = human prompt → last timestamped event before next prompt. `claude_ms` = Σ inter-event gaps, each capped at stall_cap (10m default). `user_active_ms` = between-turn gaps ≤ idle threshold (10m default). Daily "You active" = interval union across sessions; "Claude working" = sum (parallel sessions add). Subagent time tracked separately (never added to claude_ms); subagent tokens/cost DO roll into session totals.

## Layout
- `server/` — config.js, index.js, http.js, sse.js, routes/, lib/ (db, migrations, scan, lineReader, parse, ingest, aggregate, watcher, pricing, legacy, live, logger, util)
- `web/` — Vite + React 19 + TS + Tailwind v4 SPA (TanStack Query, react-router v7, custom SVG gantt + DOM heatmap)
- `hooks/notify.mjs` — fire-and-forget hook forwarder (NEVER print to stdout — UserPromptSubmit stdout is injected into session context; always exit 0)
- `scripts/` — setup, install-hooks, install-claude-md, autostart ps1/vbs, reingest, smoke-parse

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
