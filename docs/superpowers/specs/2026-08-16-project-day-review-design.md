# Day-by-day project change review

**Status:** approved design, not yet implemented
**Date:** 2026-08-16

## Problem

There is no way to answer "what actually changed in this project over the last
30 or 60 days?" in detail. The closest thing is the Report page's summarizer,
which has three gaps for this purpose:

1. **Commits are absent.** `server/routes/report.js` references the `commits`
   table zero times, even though the git scanner already collects per-file
   `--numstat` data. The report therefore cannot say *what* changed — only how
   much time was spent.
2. **Detail is thin.** The summarizer sees session titles plus at most 20
   prompts per day truncated to 400 characters. No commit messages, no files.
3. **It is feature-first.** Output groups by feature category with dates in
   parentheses, which answers "how did feature X evolve" but not "what happened
   on the 14th".

The database also stores no file paths at all — `events` has `tool_name` but no
tool input, and CLAUDE.md forbids persisting file contents. So file-level
detail cannot come from SQLite; it has to be read from git at report time.

## Goals

A day-first review over 7/30/60-day or custom windows that lists, per day, what
changed — grouped by feature within the day — built from commits, prompts,
sessions and journal notes, thorough enough to hand to someone else.

**Non-goal for v1:** surfacing work that was never committed. Days with no
commits will read thinner. Deferred deliberately until real output shows
whether it matters (see Deferred).

## Decisions

| Question | Decision |
|---|---|
| Structure | Day sections (`## <date>`), feature groups nested inside |
| Sources | commits + file names, prompts, session rollups, journal |
| File detail | read live from git; never persisted |
| Model | Opus 5, one pass |
| Quota | runs against a second account via `CLAUDE_CONFIG_DIR` |
| Location | Report page, with a link from the project page |
| Periods | 7 / 30 / 60 / custom |

### Why git is read live rather than persisted

A `commit_files` table was considered and rejected. It duplicates data git
already stores, grows with every commit (FEP alone: 694 commits in 60 days),
and needs reconciliation on rebase or history rewrite — a lot of machinery for
one report. Reading `git log --numstat` for the window costs about a second and
is always accurate to the repo's real state. File paths are used transiently
and never written to the database, which keeps the CLAUDE.md rule intact.

**Trade-off accepted:** a project whose checkout has moved or been deleted
yields no commit data. This must be stated in the output, not hidden.

### Why a separate table rather than a `kind` column on `reports`

`reports` is keyed by `project_id`. `scripts/reingest.mjs` drops `projects`
(line 16) but not `reports`, so a reingest reassigns project ids while cached
reports keep the old ones — silently re-attaching a cached report to the wrong
project. This is a known hazard in this codebase: migration v12's comment on
`project_summaries` says it is *"keyed by path, not id: reingest reassigns
project ids but leaves this table alone."*

New reviews therefore get their own path-keyed table. The existing `reports`
table and its rows are left untouched — no migration of existing data, no
change to the feature-first report's behavior.

## Architecture

### New module: `server/lib/review.js`

`report.js` is 444 lines and owns the feature-first report plus PDF rendering.
A second report kind belongs beside it, not inside it; the two share only a
date range.

Exports:
- `buildDayReview(db, projectId, from, to)` → the structured per-day document
- `DAY_REVIEW_INSTRUCTIONS` → the prompt
- `reviewInputHash(...)` → staleness key

### Git access lives in `server/lib/git.js`

`git.js` already owns the single `execFile` git invocation with `--numstat`.
Add `commitsWithFiles(repoPath, fromMs, toMs)` beside it rather than spawning
git from a second place. One call per family path, since worktrees are separate
checkouts.

Returns per commit: `{ sha, ts, message, files: [{ path, added, removed }] }`.

### Per-day assembly

For each day in `[from, to]` with any activity:

| Field | Source |
|---|---|
| `commits` | git, live |
| `sessions` | `sessions` — title, claude_ms, prompt_count, est_cost_usd, pr_links, worktree_branch |
| `prompts` | `prompts` where `kind IN ('typed','command')` |
| `journal` | `journal` matched on project family paths |

Family resolution follows the existing pattern: `SELECT id, path FROM projects
WHERE id=? OR parent_project_id=?`.

### Caps are declared, never silent

Volume is low in aggregate (a 60-day window is roughly 15–50k tokens), but
commits are lumpy — one merge day can dwarf the rest. Concrete limits:
**20 files per commit, 40 commits per day, 60 prompts per day at 1000 chars**
(up from today's 20 at 400, since the measured volume affords it). When a cap
bites, emit an explicit marker into the LLM input:

```
  … 14 more files
  … 22 more commits this day
```

Silent truncation reads as "that is all that happened", which is the exact
failure this report exists to prevent.

### LLM pass

One `runClaude` call, `maxTurns: 1`, model from settings (default Opus 5),
**`timeoutMs: 600_000`**. The current 180s default is tuned for Haiku over 14
days; Opus writing ~60 dated sections will exceed it, and timing out after
spending the quota is the worst outcome.

Reuses the existing `inflight` Map in `report.js` so two clicks do not spawn two
Opus runs.

Output contract — strict markdown, no preamble or code fences:

```markdown
## Mon, Aug 16

**Account attribution**
- Added the hook env marker and resolved sessions to a subscription
  (`hooks/notify.mjs`, `server/lib/accounts.js`, +451/-17 across 3 commits)

**Memory card**
- Guarded the memory tree against version skew (`MemoryCard.tsx`, +12/-1)
```

### API

Two endpoints, mirroring the existing report/summarize split so the UI flow is
the same one already in place:

- `GET /api/review/:projectId?from=&to=` — returns the structured per-day data
  plus any cached markdown with a `stale` flag. Never spends quota.
- `POST /api/review/:projectId/generate` — runs the Opus pass and caches the
  result. Body: `{ lang: 'en' | 'fr' }`.

Range parsing reuses `parseRange` from `report.js`, which already defaults `to`
to today and validates that `from <= to`. Presets are computed client-side into
`from`/`to`, so the server keeps one code path for presets and custom ranges.

### Storage — migration v14

```sql
CREATE TABLE project_reviews(
  project_path TEXT NOT NULL,
  period_from  TEXT NOT NULL,
  period_to    TEXT NOT NULL,
  input_hash   TEXT NOT NULL,
  model        TEXT,
  markdown     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY(project_path, period_from, period_to)
);
```

Dates are local `YYYY-MM-DD` day keys, matching `reports`. `created_at` is
epoch milliseconds. **Kept out of `scripts/reingest.mjs`'s drop list** — a
review costs Opus quota to produce and cannot be re-derived cheaply. Update the
preserved-data comments at the top of that file, as was done for the account
tables.

`input_hash` covers session ids and prompt counts, journal ids, **and commit
shas**. Commits are now an input; without them in the hash a new commit leaves
a cached review looking current while describing a stale repo.

### Settings

Two new settings, surfaced in Status:

- **`llm_config_dir`** — path to a config directory logged into the second
  account. `runClaude` passes `env: { ...process.env, CLAUDE_CONFIG_DIR }` when
  set.
- **`llm_model`** — default `claude-opus-5`.

**Verified mechanism:** `CLAUDE_CONFIG_DIR=<empty dir> claude -p …` returns
`Not logged in · Please run /login`, while the same command without it
succeeds. Credentials are therefore fully isolated per config directory, and
reports can bill to a different subscription than the interactive CLI.

One-time setup, documented in the settings hint: run
`CLAUDE_CONFIG_DIR=<dir> claude`, then `/login` as the second account.

Extend the existing "not logged in" rejection in `llm.js` to name the
configured directory, so a wrong path is diagnosable rather than looking like a
broken CLI.

### Web

- **Report page** — mode toggle (*Feature summary* / *Day-by-day review*) and
  period presets **7 / 30 / 60 / custom**; custom keeps the existing date
  inputs. New `dayReviewQuery` plus a generate action mirroring the existing
  summarize flow.
- **Project page** — a link through to the Report page with the project
  preselected. (The original request said "on a project page"; the Report page
  was chosen instead, so the project page links rather than renders.)
- **i18n** — every new string needs EN **and** FR. The project shipped full
  French localization; English fallbacks are not acceptable.
- **PDF** — `renderMarkdownish` handles a limited set of headings. Verify
  nested `**Feature**` groups render; extend it if they do not.

## Failure modes

Each is explicit in the output or the error, never silent:

| Failure | Behavior |
|---|---|
| Repo missing / worktree moved | Build from DB sources only **and state in the output** that commit data was unavailable — never emit a commit-less review that reads as "nothing was committed" |
| LLM timeout | Keep the previously cached review; surface the timeout |
| Not signed in | Actionable message naming the configured config dir |
| No activity in range | Refuse before spending quota, as `changes-summary` already does |

## Testing

Four `node:test` files exist (`memory-files.test.js`, `config-file.test.js`,
`cloud/keys.test.js`, `cloud/redact.test.js`), run with `node --test`. There is
no `test` npm script; add one as part of this work.

`server/lib/review.test.js` against a temp DB:
- days bucket to the correct local day key across a month boundary
- cap markers actually appear when limits are exceeded
- `input_hash` changes when a commit is added, and only then
- missing-repo path produces the degraded-but-labeled document

Plus end-to-end: generate a real 30-day review for this project, read it, and
confirm `project_reviews` survives `npm run reingest`.

## Deferred

**Uncommitted work.** Re-reading transcripts for `Edit`/`Write` targets would
cover days with no commits. Deferred by explicit decision until real 60-day
output shows whether those days read as too thin. It layers on top of this
design without rework.
