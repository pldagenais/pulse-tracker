# Pulse Improvement Backlog — 25 Items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness, performance, accessibility and design-consistency defects found by a full audit of Pulse, and add four analysis features that exploit data already sitting unread in the database.

**Architecture:** No structural change. Server work is confined to `server/lib/stats.js`, `server/lib/live.js`, `server/lib/jobs.js` and the route boundary; frontend work to `web/src/lib/live.tsx`, `web/src/components/ui.tsx`, `web/src/index.css` and the pages. The four new features follow the existing `groupBy` plumbing, so each appears in cloud mode by adding one line to `server/lib/cloud/keys.js`.

**Tech Stack:** Node 24 ESM + JSDoc, `node:sqlite`, Express, SSE · React 19 + TypeScript strict + Tailwind v4 + TanStack Query v5 · Convex mirror for remote mode.

**Spec:** None — this plan is derived from an audit, not a design. Provenance is recorded below.

---

## Provenance — how these 25 were chosen

Eight parallel audits (visual design, accessibility, React bugs, server bugs, performance, cloud parity, feature gaps, data edge cases) produced **96 candidate findings**. Every candidate was then handed to an adversarial verifier instructed to open the cited files and default to *rejected* when uncertain.

**72 candidates were rejected** — the claim didn't match the code, the problem was already handled by a guard elsewhere, or the "missing" feature already existed. **24 survived.** One further item (#18) was verified directly rather than by the audit, bringing the total to 25.

Treat the survivors as load-bearing: each one names files and lines that were read, and several carry a `correction` where the verifier confirmed the direction but fixed the specifics. Where a correction exists, this plan uses the corrected version:

- The root font-size is **17px**, not 16px (`html { font-size: 106.25% }`) — pixel arithmetic in item 16 reflects this.
- TanStack Query's default `gcTime` is 5 minutes — this is what makes item 3's bug reachable.
- The jobs "close event fires early" sub-claim was **dropped** as unproven; item 5 is scoped to the process-tree kill only.
- 12 turns / 13 sessions cross local midnight in the current DB (not 18).

---

## Global Constraints

Copied verbatim from `CLAUDE.md`; every task's requirements implicitly include these.

- **Never write anything under `~/.claude/projects`.** Sole exception: the memory editor writing `*.md` inside `<project>/memory/` folders. Item 13 caches reads of `~/.claude/sessions` — read-only, and a different directory.
- **The parser rules in `CLAUDE.md` are load-bearing.** Human-prompt discrimination, crediting `message.usage` once per `message.id`, reading `sessionId` per line, excluding `<synthetic>`, using in-file timestamps rather than mtimes. Violating any of them corrupts every statistic.
- **`data/tracker.db` is a rebuildable cache** except `journal`, `settings`, `hook_events`, `meta` and the designated user tables. Anything new that holds user data must be omitted from the drop list in `scripts/reingest.mjs`. Item 12 stores its cache counter in `meta` for exactly this reason.
- **The server runs unattended.** An unhandled rejection kills the process; the scheduled task only restarts it if it actually exits, so an infinite loop (item 1) is worse than a crash.
- **Every colour must come from a CSS variable defined in BOTH `:root` and `[data-theme='light']`** in `web/src/index.css`. A hard-coded hex in a component is a bug (item 18 removes the last one).
- **Run `npm run check` (server JSDoc typecheck) and `npx tsc --noEmit` in `web/` before each commit.** Convex changes additionally run `npx vitest run convex/`.

---

## Batch 1 — Availability and durable-data bugs ✅ SHIPPED 2026-08-15

Nothing else matters while the server can hang, a page can white-screen, and hand-typed notes can be written onto the wrong session. No dependencies; ship first.

**Shipped as `ffb5ae3`, `b7335b2`, `1806c12`, `ac0fdd8`, `c276328`.** Notes from execution:

- **Task 1 was worse than described.** The day walk is *synchronous*, so an inverted range did not merely spin — it blocked the event loop entirely: a 5s watchdog timer inside the reproduction never fired. HTTP, SSE, ingest and every timer starve. The 400-day clamp in the original write-up was deliberately **not** implemented: termination was the bug, and silently truncating a legitimate 371-day heatmap would be a worse answer than serving it.
- **Task 5's mechanism was confirmed live:** the process chain is `node.exe → cmd.exe → claude.exe`, so `child.kill()` reaped the middle shell and orphaned the model. The audit's secondary claim that the `close` handler settles early could not be reproduced and was left alone.
- **Task 4 turned up a bug not in this plan.** The service worker's offline `Response` carried no `cache-control`, so Chrome heuristically cached it per URL: one failed navigation during a server restart left tabs rendering "offline" permanently, while the server answered 200 and same-origin fetches from that very page succeeded. Only unregistering the worker recovered it. Fixed here (`no-store` + a self-healing heartbeat poll) rather than deferred, because it obstructs every future browser verification. **This is also the true cause of the "stale bundle" confusion recorded in the remote-deployment plan** — same heuristic-caching mechanism, and it makes Task 18 more valuable than it looked.

### Task 1: Bound `rangeDaily`'s day loop and reject inverted ranges

*(merges two independently-reported findings — one defect, two report paths)*

**Files:**
- Modify: `server/lib/stats.js:95-112`, `server/lib/stats.js:29-35`
- Modify: `server/routes/data.js:21-27`, `:119-122`, `:227-231`
- Modify: `server/routes/system.js:279-288`
- Modify: `server/routes/report.js` (`parseRange`)

**Symptom.** `GET /api/heatmap?from=2026-09-01&to=2026-08-01` walks days forever, pinning the single-threaded server at 100% CPU and growing an array until OOM. The process never exits, so the scheduled task never restarts it — SSE, hooks and ingest all starve behind it. Same reachable via `/api/stats?groupBy=day` and `/api/export?what=daily`.

- [ ] **Step 1: Write the failing test**

Add `server/lib/stats.test.mjs` (or extend the smoke harness):

```js
import { rangeDaily } from './stats.js';
// inverted range must terminate and return nothing
const rows = rangeDaily(db, '2026-09-01', '2026-08-01');
if (rows.length !== 0) throw new Error(`expected [], got ${rows.length} rows`);
```

- [ ] **Step 2: Run it and watch it hang**

Run: `node --disable-warning=ExperimentalWarning server/lib/stats.test.mjs`
Expected: the process hangs (Ctrl-C to exit) — that *is* the bug.

- [ ] **Step 3: Bound the loop**

In `server/lib/stats.js:95`, replace `for (let day = fromDay; ; day = addDays(day, 1))` with a guarded loop: return `[]` immediately when `fromDay > toDay` (plain string compare is correct on `YYYY-MM-DD`), and cap iterations at `const MAX_DAYS = 3660`, breaking on `day > toDay` as well as `day === toDay`. Apply the same guard to `pushDayClipped` (`:29-35`) and to the structurally identical loop in `/api/projects/:id` (`server/routes/data.js:227-231`).

- [ ] **Step 4: Reject inverted ranges at the boundary**

In `server/routes/data.js:21-27` (`rangeParams`) and `:119-122`, after `dayParam`, `return bad(res, 'from must be <= to')` when inverted, and clamp spans to 400 days. Same in `server/routes/system.js:279-288` and `mountReport`'s `parseRange`. Two independent layers: the loop can no longer hang even if a future caller bypasses the route guard.

- [ ] **Step 5: Verify**

```bash
curl.exe -s -m 5 -o NUL -w "%{http_code}\n" "http://127.0.0.1:5599/api/heatmap?from=2026-12-01&to=2026-08-01"
```
Expected: `400` instantly. Then confirm `/api/overview` still returns `200` in well under a second, and run `npm run check`.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(server): bound the daily zero-fill loop and reject inverted ranges"
```

### Task 2: Return `null` from `agentStatus:get` when the status snapshot is absent

**Files:**
- Modify: `convex/agentStatus.ts:21-27`
- Modify: `web/src/lib/source.ts:79`, `web/src/components/layout/OfflineBanner.tsx:16`
- Test: `convex/reads.test.ts`

**Symptom.** In cloud mode `/status` white-screens (`Cannot read properties of undefined (reading 'watching')`) whenever the `status` snapshot hasn't synced — the first ~8s of a fresh deploy, and *permanently* if `/api/status` ever throws locally, because `pushSnapshots` swallows per-endpoint failures with `continue`.

- [ ] **Step 1: Write the failing test**

In `convex/reads.test.ts`, beside the existing "missing snapshot returns null" case:

```ts
test("agentStatus.get returns null when the status snapshot is absent", async () => {
  const t = convexTest(schema);
  const asUser = await asAllowedUser(t);
  expect(await asUser.query(api.agentStatus.get, {})).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run convex/reads.test.ts`
Expected: FAIL — currently returns an object with `lastHeartbeatAt: null` rather than `null`.

- [ ] **Step 3: Implement**

`convex/agentStatus.ts:21-27` — return `null` when `snap` is missing instead of spreading `{}`; keep the `{...base, lastHeartbeatAt, ingestPhase}` merge when it exists. Add a separate `heartbeat` query returning only `{lastHeartbeatAt}` so the OfflineBanner (and Task 8) still works when status is null, and map it in `web/src/lib/source.ts` alongside the `/api/status` entry.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run convex/`
Expected: PASS.

- [ ] **Step 5: Verify in the deployed app**

Delete the `status` snapshot row in the Convex dashboard and load `/status` on the deployed SPA: skeletons and an offline banner, no white screen.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(cloud): return null when the status snapshot has not synced"
```

### Task 3: Key the session detail subtree by session id

**Files:**
- Modify: `web/src/components/session/SessionDetailView.tsx:117`, `:343-346`
- Modify: `web/src/components/session/SessionDrawer.tsx:71`, `web/src/pages/SessionPage.tsx:20`

**Symptom.** Open `/sessions/A`, then `/sessions/B`, then back to `A` within TanStack's 5-minute `gcTime` (so `q.data` resolves synchronously and nothing remounts): the card shows **B's** tags and note, and the next tag click or textarea blur `PUT`s them to `/api/sessions/A/meta`. `session_meta` survives `npm run reingest`, so this **permanently corrupts hand-entered data** — the reason this ranks first among the UI bugs.

- [ ] **Step 1: Reproduce**

With two sessions that have different tags, navigate A → B → A in under 5 minutes and observe A rendering B's tags.

- [ ] **Step 2: Key the subtree**

`SessionDetailView.tsx:117` → `<TagsAndNote key={s.id} …/>`. Also key the whole view at `SessionDrawer.tsx:71` and `SessionPage.tsx:20` → `<SessionDetailView key={sessionId} …/>`, which resets `PromptRowItem`'s `expanded`/`showReplay` too.

- [ ] **Step 3: Reconcile against the server echo**

Make `save()` (`SessionDetailView.tsx:343-346`) adopt the server's echoed `{tags, note}` from the `PUT` response (`server/routes/data.js:410`) as the new local state instead of trusting the optimistic value, so a normalized or rejected tag stops rendering as accepted.

- [ ] **Step 4: Verify**

Browser with DevTools Network open: A → B → A, confirm the tag list matches A; click a tag and inspect the `PUT /api/sessions/A/meta` body — it must contain A's tags. Then check `select * from session_meta` in `data/tracker.db` for cross-contamination from earlier testing.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(web): key session detail by id so tags cannot be saved onto the wrong session"
```

### Task 4: Surface failed writes instead of swallowing them

**Files:**
- Modify: `web/src/components/session/SessionDetailView.tsx:25-29`, `:343-357`
- Modify: `web/src/pages/RunPage.tsx:340-348`, `:397-407`, `:442-445`
- Modify: `web/src/pages/StatusPage.tsx:284`, `:297`

**Symptom.** A dozen bare `async` onClick handlers have no try/catch. In cloud mode every one rejects with `UnavailableRemotely`, so a remote user tags a session, sees the tag appear, and nothing is ever persisted. Locally a 500 or a mid-write restart is equally invisible.

- [ ] **Step 1: Convert to mutations**

Follow the pattern already used at `RunPage.tsx:271-292` and `StatusPage.tsx:268-277`: `useMutation` with rendered `isError`. Cover `toggleStar`, `save`/`addTag`/`removeTag` (with `onError` restoring the previous tags/note), `ScheduleRow.toggle`/`del`, `TemplateRow.del`/`togglePin`, `JobRow.kill`, and the webhook enable/delete.

- [ ] **Step 2: Gate local-only controls**

Gate these on `MODE === 'local'` (`web/src/lib/source.ts`) — rendered disabled with a `title` explaining it needs the PC, rather than a control that always fails.

- [ ] **Step 3: Verify**

Stop the server, click the star on a session → a visible inline error appears and the browser console shows **no** `Unhandled promise rejection`. On the deployed SPA, the tag input and kill buttons render disabled.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(web): surface failed writes instead of silently dropping them"
```

### Task 5: Kill the whole `claude` process tree for headless jobs

**Files:**
- Modify: `server/lib/jobs.js:75`, `:92-95`, `:117-123`
- Reference: `server/routes/actions.js:31-45`, `:101-116` (the correct PID-targeted pattern)

**Symptom.** `jobs.launch` spawns with `shell: true`, so `child.kill()` terminates only `cmd.exe`; the real `claude` grandchild keeps running — burning quota, growing its transcript, and ignoring both the 30-minute `JOB_TIMEOUT_MS` ceiling and the user's explicit Interrupt. The job's status and its `MAX_CONCURRENT` slot end up out of sync with reality.

- [ ] **Step 1: Reproduce**

Launch a headless job, click Interrupt, then:
```bash
Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Select ProcessId,CommandLine
```
Expected today: a surviving `claude` process.

- [ ] **Step 2: Implement**

Drop `shell: true` at `server/lib/jobs.js:75` and resolve the launcher explicitly the way `server/routes/actions.js:31-45` resolves `wt.exe`/`code.cmd` (absolute path to `claude.cmd`, or `cmd.exe /c claude`). If the shell must stay, replace `child.kill()` at `:94` and `:121` with `execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'])` and only `settle()` once the tree is confirmed gone. Callers (`server/routes/jobs.js:87-92`, `server/lib/cloud/jobs.js:63`) need no change.

Note: the audit also claimed the `close` handler settles early; the verifier could not confirm it, so that claim is **not** part of this task.

- [ ] **Step 3: Verify**

Repeat Step 1 — no surviving `claude` child, and the Run page row flips to `killed` at the same moment. Then `npm run check`.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(jobs): kill the whole claude process tree, not the cmd.exe wrapper"
```

---

## Batch 2 — The live data layer ✅ SHIPPED 2026-08-15

All three tasks edit `web/src/lib/live.tsx` and its consumers; doing them together avoids three conflicting rewrites of one file. Task 8 depends on the `heartbeat` query added in Task 2.

**Shipped as `c8814ad`, `2252217`.** Notes from execution:

- **Task 6 verified against a real 195s outage:** attempt gaps 8-10-18-32-32-32-32s, holding the cap instead of collapsing to the watchdog's 15s cadence, with clean reconnection when the server returned.
- **Task 8 went one step further than planned:** the offline banner now reads the live store (the same 15s heartbeat poll as the pill) instead of running its own 60s query — during verification the pill recovered a minute before the banner did, which is exactly the disagreement `STALE_MS`-sharing was meant to prevent. The `stale` state blanks `sessions`, which clears the PWA badge and kill buttons for free.
- **Shipped alongside (user request, not in the original 25):** the project-page "latest changes" card — 2-3 paragraphs of prose over the last 14 days, generated by the existing summarizer, cached in `project_summaries` (migration v12, keyed by project *path* so reingest's id reshuffle cannot mis-attach it), staleness = any session activity after it was written, mirrored to cloud via the project snapshot.

### Task 6: Make the SSE watchdog respect the reconnect backoff

**Files:** Modify `web/src/lib/live.tsx:107-131`, `:159-180`

**Symptom.** When the tracker is down, `onopen` never fires so `lastEventRef` never advances; after 90s of silence the watchdog calls `connect()` on **every 15s tick**, defeating the `onerror` backoff chain that has already climbed to 30s. Two reconnect sources interleave for the entire outage.

- [ ] **Step 1: Implement**

Set `lastEventRef.current = Date.now()` at the top of `connect()` so the watchdog measures time since the last *attempt*. Store the `onerror` `setTimeout` handle in a ref, and `clearTimeout` it both at the top of `connect()` and in the effect cleanup, so at most one reconnect is ever pending.

- [ ] **Step 2: Verify**

Stop the tracker with DevTools → Network filtered to `eventsource`. Attempts must space out 1s, 2s, 4s … 30s and stay at 30s, rather than settling into a 15s cadence.

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(web): stop the SSE watchdog racing the reconnect backoff"
```

### Task 7: Split `LiveContext` into a selectable store

**Files:** Modify `web/src/lib/live.tsx:22-26`, `:132-146`; `web/src/components/layout/AppLayout.tsx:54`, `:62-69`; `web/src/components/layout/notifier.ts:14-57`

**Symptom.** Every `session-activity` frame builds a fresh context value, and `AppLayout` consumes it only to derive two integers for the PWA badge — so the entire shell (10 NavLinks, header, LivePill, AlertBell, OfflineBanner, SessionDrawer, CommandPalette, ShortcutHelp) re-renders several times a second, precisely while Claude is working.

- [ ] **Step 1: Implement**

Keep live state in a ref-backed store and expose `useLiveSelector(selector)` on `useSyncExternalStore` (or split into `LiveSessionsContext` + `LiveConnectionContext`). `AppLayout` selects only `{needsYou, working, ingestPhase}`; `LivePill` and `useCompletionNotifier` keep the full session list.

- [ ] **Step 2: Verify**

React DevTools Profiler with "Highlight updates" while a session works: only `LivePill` (and the badge effect when counts change) flashes; nav and header stay still.

- [ ] **Step 3: Commit**

```bash
git commit -am "perf(web): make live state selectable so the shell stops re-rendering"
```

### Task 8: Mark cloud live state stale when the PC stops reporting

**Files:** Modify `web/src/lib/live.tsx:44-61`; `web/src/components/layout/LivePill.tsx:28-46`, `:94`; `web/src/components/layout/AppLayout.tsx:62-69`; `web/src/components/layout/OfflineBanner.tsx:7`; `web/src/lib/source.ts`

**Symptom.** Remotely, nothing expires the mirrored `live` snapshot. With the PC asleep the pill still pulses cyan reading `working · Project · 11h 04m` — the elapsed timer running off the *viewer's* clock — the installed PWA keeps a permanent badge, and every phantom row still offers a kill button. Only the thin OfflineBanner tells the truth.

- [ ] **Step 1: Implement**

In `CloudLiveProvider`, read the `heartbeat` query from Task 2; once `Date.now() - lastHeartbeatAt > STALE_MS`, set `connection: 'stale'` and blank `sessions`. Label it "PC offline" in cloud mode. Gate the `setAppBadge` effect and `killable` on a fresh connection. Move `STALE_MS` out of `OfflineBanner.tsx:7` into `web/src/lib/source.ts` so the banner and the pill can never disagree.

- [ ] **Step 2: Verify**

On the deployed SPA, stop the local tracker and wait ~2 minutes: the pill reads "PC offline", session rows disappear, the PWA badge clears, no kill buttons remain.

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(cloud): expire live state when the PC stops reporting"
```

---

## Batch 3 — Day keys, day boundaries and prices ✅ SHIPPED 2026-08-15

Every task here is "the number is attributed to the wrong day, or shown without the caveat that makes it true". Depends on Task 1 (same `rangeDaily` loop).

**Shipped as `c7b36f5`.** Notes from execution:

- **Task 9 gained a `TzGate`:** `todayKey()` is called during render, so the agent zone cannot be retrofitted after queries fire — a gate component fetches the heartbeat once between sign-in and the first render, and the 15s live poll keeps it fresh. Only `dayKeyOf`/`todayKey` are zone-sensitive; the rest of `time.ts` is pure string math.
- **Task 10 verified by conservation:** over full history (392 turns, 12 crossing midnight), `rangeDaily` totals match raw table sums to 1ms / 1 cent of rounding, tokens exact; a real 10.7h crossing turn now credits 17.5% to its second day. Sessions count on every day they touch; turn counts stay on the start day (counts can't be fractional). The Digest week header uses the distinct count locally only — cloud's `sessions:list` caps `total` at the page size, so it keeps the sum there.
- **Task 11 verified both directions** by flipping one session's `has_unpriced_tokens` in the derived cache and watching the day flag follow, then restoring. The day flag is session-granularity: any unpriced session touching a day marks that day partial.

### Task 9: Derive cloud day keys from the agent's timezone

**Files:** Modify `web/src/lib/time.ts:1-13`; `server/lib/cloud/sync.js:188-195`; `convex/schema.ts` (agent table); `web/src/pages/DashboardPage.tsx:32`, `:100`, `:103`; `web/src/pages/ProjectDetailPage.tsx:137`

**Symptom.** `web/src/lib/time.ts` assumes browser and server share a machine. Check Pulse from a phone one timezone *ahead* of the PC and `DashboardPage` requests `overview:<tomorrow-on-the-PC>`, which was never mirrored — five StatCards, "last 7 days" and "today by project" stay skeletons forever, with no error. One timezone *behind*, you silently get yesterday's numbers labelled today.

- [ ] **Step 1: Publish the agent's zone**

Add `tz: Intl.DateTimeFormat().resolvedOptions().timeZone` to the heartbeat mutation and the agent table, and expose it on the status/heartbeat read.

- [ ] **Step 2: Format against it in cloud mode**

In `web/src/lib/time.ts:6-13`, make `todayKey`/`dayKeyOf` format via `Intl.DateTimeFormat('en-CA', { timeZone })` — which yields `YYYY-MM-DD` directly — when `MODE === 'cloud'`.

- [ ] **Step 3: Replace skeleton-forever with an empty state**

Independently of the timezone fix, a genuinely unmirrored day must say so: replace the guards at `DashboardPage.tsx:32,100,103` and `ProjectDetailPage.tsx:137` with an explicit "no data mirrored for this day" state.

- [ ] **Step 4: Verify**

DevTools → Sensors → timezone `Asia/Tokyo`, reload the deployed SPA: the dashboard renders the agent's current day with real numbers; forcing a genuinely unmirrored date shows the empty state, not skeletons.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(cloud): key days by the agent's timezone, not the viewer's"
```

### Task 10: Split cross-midnight turns across days and hours

**Files:** Modify `server/lib/stats.js:25-36`, `:59-72`, `:106`, `:210-213`; `web/src/pages/DigestPage.tsx:89`

**Symptom.** A turn's whole `claude_ms`, cost and output tokens land on the day it *started*, while only its wall interval is clipped — so the Timeline day view draws a continued gantt block for the after-midnight portion beneath a StatCard reporting zero Claude time. `hourHistogram` does the same one level finer, letting a single hour bucket exceed 60 minutes. This DB has 12 such turns out of 385, and 13 sessions spanning local days.

- [ ] **Step 1: Pro-rate by clipped share**

Have `pushDayClipped` return its clipped sub-intervals, and pro-rate `claude_ms`/`est_cost_usd`/`output_tokens` by clipped-duration share at `:65-71` instead of dumping them into `localDayKey(t.started_at)`. Apply the same walk in `hourHistogram` instead of reading `getHours()` once.

- [ ] **Step 2: Fix the derived session count**

In `DigestPage.tsx:89`, replace the summed per-day `sessions` figure with a distinct-session count over the week range.

- [ ] **Step 3: Verify conservation**

Sum `claudeMs` across a range from `rangeDaily` and compare with `SELECT sum(claude_ms) FROM turns` over the same window — they must match within rounding, both before and after the change. Then open a Timeline day that begins with a continued block: the "Claude working" StatCard is non-zero. Run `npm run smoke`.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(stats): split cross-midnight turns across days and hours"
```

### Task 11: Render the unpriced flag everywhere cost is shown

**Files:** Modify `server/lib/stats.js:53-72`; `web/src/lib/types.ts`; `web/src/pages/InsightsPage.tsx:44`, `:133`; `web/src/pages/DashboardPage.tsx:72`; `web/src/pages/ComparePage.tsx:66-75`, `:98-103`

**Symptom.** The server already computes `unpriced` per model and `has_unpriced_tokens` per session, but the UI drops it. Insights prints a confident `$0.00` for a model missing from the price table, and ComparePage paints that session **green as the cheaper winner**, because it reads `estCostUsd ?? 0` with `lowerBetter: true`. The app states a falsehood with full confidence.

- [ ] **Step 1: Carry the flag through**

Carry a per-day `unpriced` flag through `rangeDaily` (set when any credited event in the day fails `ratesFor`) and add it to `DayStat` in `web/src/lib/types.ts`.

- [ ] **Step 2: Render it**

Asterisk + `title` on the Insights model rows (`unpriced` is already merged at `InsightsPage.tsx:44`); a "partial" badge on the Dashboard est-cost StatCard and the budget bar; and in ComparePage, suppress winner colouring on the cost row whenever either side has `hasUnpricedTokens`.

- [ ] **Step 3: Verify**

Temporarily remove one model from `server/lib/pricing.js` and restart: Insights shows `$0.00*` with a tooltip, the dashboard cost card shows "partial", Compare renders that row neutral. Then `npm run check` and restore the model.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(ui): never present an unpriced model as costing zero"
```

---

## Batch 4 — Read-path performance

Depends on batches 1–3: the `rangeDaily` shape and the live store must be settled before optimizing around them.

### Task 12: Halve and memoize `records()`

**Files:** Modify `server/lib/stats.js:151-199`; `server/routes/data.js:88`; `server/lib/aggregate.js` (recompute path); optionally `web/src/lib/queries.ts`

**Symptom.** `/api/overview` recomputes `records(db)` on every request even though it ignores the `date` param, doing **two** whole-history passes over an unfiltered `SELECT … FROM turns`. Measured on this DB: `records()` 4.03ms vs 0.57ms for the day the caller actually asked for — and the cloud sync issues 90 `/api/overview` fetches per cycle, producing byte-identical results each time. Cost grows as O(days × turns).

- [ ] **Step 1: Benchmark first**

Write a scratchpad bench that calls `records(db)` twice and prints both durations. Record the numbers — Step 4 compares against them.

- [ ] **Step 2: Single-pass it**

Derive both series from one `rangeDaily(db, from, today)` call, merging `legacy_daily` inline instead of calling `heatmapDays` separately.

- [ ] **Step 3: Memoize behind a data-version counter**

Store the counter in `meta` (a preserved table, so it survives `npm run reingest`), bumped by `server/lib/aggregate.js`'s recompute path whenever turns/prompts change. `records()` returns the cached object while the counter is unchanged. Optionally move it out of `/api/overview` into `/api/records` with a long `staleTime`.

- [ ] **Step 4: Verify**

Re-run the bench: the second call must be sub-0.1ms (memo hit) and the first roughly halved (~2ms). Diff `/api/overview` response bodies before and after — byte-identical.

- [ ] **Step 5: Commit**

```bash
git commit -am "perf(server): single-pass and memoize records()"
```

### Task 13: Cache the live registry and debounce the SSE broadcast

**Files:** Modify `server/lib/live.js:63-68`, `:141-162`

**Symptom.** Every `UserPromptSubmit`, `Notification`, `Stop`, `SessionStart` and every transcript file change rebuilds the whole live snapshot: a synchronous `readdirSync` of `~/.claude/sessions` plus `readFileSync` + `JSON.parse` + `process.kill(pid, 0)` per file, plus per-row queries — all serialized and broadcast on the same thread that serves HTTP and drives ingest.

- [ ] **Step 1: Implement**

Cache `liveRegistry()` behind a 2–3s TTL with an mtime check on `SESSIONS_DIR`, so a burst of hook events reuses one scan. Coalesce `onChange` on a ~250ms trailing timer rather than firing per event, keeping an immediate first emit so the UI still feels instant.

**Invariant check:** this reads `~/.claude/sessions`, never `~/.claude/projects`, and writes nothing.

- [ ] **Step 2: Verify**

POST 20 synthetic hook events in a loop while watching `curl.exe -N http://127.0.0.1:5599/api/live` — frames collapse to a handful rather than 20, and the final frame still reflects final state.

- [ ] **Step 3: Commit**

```bash
git commit -am "perf(server): cache the live registry and coalesce SSE broadcasts"
```

### Task 14: Move Gantt tooltip and brush state out of the chart root

**Files:** Modify `web/src/components/timeline/Gantt.tsx:126`, `:144-160`, `:189-193`, `:266-336`

**Symptom.** Hovering any turn block, gap or prompt tick calls `setTip` on the `Gantt` root, re-rendering every row, axis tick and `<rect>`. Brush-drag calls `setDrag` on every `pointermove` while `svgX` reads `getBoundingClientRect()` in the same handler — a forced layout immediately followed by a full SVG re-render, at pointer-event frequency.

- [ ] **Step 1: Implement**

Extract marks into a `React.memo`'d `<SessionRow>` and hoist the tooltip into a sibling that owns `tip` state. Cache the SVG rect in a ref on `pointerdown`, invalidated by the existing `ResizeObserver` in `useElementWidth`, instead of measuring per move. Hold the drag rect in a ref and drive the brush `<rect>` with a direct style write, committing to state only on `pointerup`.

- [ ] **Step 2: Verify**

Chrome Performance recording while sweeping the pointer across a busy day: no "Forced reflow" warnings, scripting time per hover frame near zero. Brush-zoom still selects the same range.

- [ ] **Step 3: Commit**

```bash
git commit -am "perf(web): keep Gantt hover and brush state out of the chart root"
```

---

## Batch 5 — Design system consistency

Introduces the shared primitives (`StatCard.topRight`, `<Switch>`, `ProgressBar` on `scaleX`) that Batch 6's reduced-motion rules then name.

### Task 15: Rebuild Mission Control's rate-window trio on `StatCard`

**Files:** Modify `web/src/pages/MissionPage.tsx:27-68`; `web/src/components/ui.tsx:29-56`; `web/src/index.css:346-353`

**Symptom.** On the page whose entire job is conveying live pressure, the three headline numbers render at ~19px while the same numbers elsewhere render at 29px — and their labels use `.card-title` (Bricolage, 650 weight, `--color-ink`), making the label the loudest text in the pane. The hierarchy is exactly inverted, and `.card-title` is doing double duty as the Card header style.

- [ ] **Step 1: Extend `StatCard`**

Add an optional `topRight?: ReactNode` to `StatCard` for the Gauge icon and percent readout.

- [ ] **Step 2: Replace the hand-rolled panes**

Swap the three `<div className="glass rounded-xl px-4 py-3">` blocks for `<StatCard label="trailing 5h window" value={fmtCost(u.window5h.estCostUsd)} accent="user">`, pushing the prompt/turn counts, the `% of your estimate` chip and the `<ProgressBar>` into the existing `sub` slot — which is already `ReactNode`, as `DashboardPage.tsx:39-47` demonstrates with Sparkline + DeltaLine.

- [ ] **Step 3: Re-scope `.card-title`**

Narrow `.card-title` to the `Card` header only, so the display face never competes with a KPI label again.

- [ ] **Step 4: Verify**

DevTools computed font-size: Mission Control's three values measure the same 29px as Dashboard's, and their labels use the mono `.microlabel`. `grep -rn "card-title" web/src` returns only `ui.tsx`'s Card header.

- [ ] **Step 5: Commit**

```bash
git commit -am "design: put Mission Control's KPIs on StatCard and re-scope .card-title"
```

### Task 16: Add a `Switch` primitive that animates with `transform`

**Files:** Create the primitive in `web/src/components/ui.tsx`; modify `web/src/pages/StatusPage.tsx:288-291`, `:360-370`; `web/src/pages/RunPage.tsx:366-371`; `web/src/components/manage/RoutinesCard.tsx:118`; `web/src/components/ui.tsx:136-142`

**Symptom.** All four switches swap `left-0.5` ↔ `left-[18px]` under `transition-all` — animating a layout property on the main thread, the one place in the app that violates its own transform/opacity motion discipline. At the real 17px root the knob rests 2.1px from the left edge but 5.4px from the right, so it visibly fails to reach the far end.

- [ ] **Step 1: Build it**

`<Switch checked onChange size>` with a fixed `left` inset and the knob moved by `translate-x-[…]`, travel computed as `trackWidth − knobWidth − 2×inset` so both ends inset identically, under `transition-transform duration-[140ms] var(--ease)`.

- [ ] **Step 2: Replace all four call sites, then fix `ProgressBar`**

Change `ProgressBar` to a full-width fill with `transform-origin: left` animating `scaleX` instead of `transition-[width]`.

- [ ] **Step 3: Verify**

`grep -rn "left-\[18px\]" web/src` returns nothing. Zoom to 400% and confirm both knob end-positions are inset identically. DevTools → Rendering → "Layout Shift Regions" shows no layout work while toggling.

- [ ] **Step 4: Commit**

```bash
git commit -am "design: add a Switch primitive that animates on transform"
```

### Task 17: Drop `[color-scheme:dark]` from the Prompts date inputs

**Files:** Modify `web/src/pages/PromptsPage.tsx:141`, `:148`

**Symptom.** The two date filters force `[color-scheme:dark]` on themselves. `color-scheme` is already stamped per theme at the root, so this is a no-op in dark mode and, in light mode, renders two dark native fields and a dark calendar popup inside a toolbar of white `bg-surface` selects — the most conspicuous light-theme defect in the app.

- [ ] **Step 1: Delete both utilities**

The root declarations (`index.css:31` and `:69`) already give each theme the correct native control rendering.

- [ ] **Step 2: Verify**

Light theme, `/prompts`, click a date field: field background and calendar popup match the neighbouring selects. Re-check dark — unchanged.

- [ ] **Step 3: Commit**

```bash
git commit -am "design: let the Prompts date inputs follow the active theme"
```

### Task 18: Make the offline shell theme-aware and teach open tabs about new builds

*(added outside the audit — verified directly while debugging a deploy)*

**Files:** Modify `web/public/sw.js`; `web/src/main.tsx:18-30`; add a build-stamp emit to `web/vite.config.ts`

**Symptom.** Two defects in the same seam:

1. `web/public/sw.js` hard-codes `background:#07090d;color:#94a1b2` in `OFFLINE_HTML`. Since `grep -rnoE "#[0-9a-fA-F]{6}" web/src --include=*.tsx` returns **zero** matches, this is the last hard-coded palette in the app, and it shows a light-theme user a black screen.
2. Nothing tells an already-open tab that a new build shipped. The service worker caches no assets — it only intercepts `mode === 'navigate'` and falls back to offline HTML — so an open tab simply keeps its loaded modules and cached `index.html` indefinitely. `vite:preloadError` only fires when a *lazy chunk* 404s, which does not happen if the user never navigates to a new route. **This is what actually caused a fixed page to keep rendering the old broken bundle during the last deploy** (it was misattributed to service-worker caching at the time).

- [ ] **Step 1: Make the offline page theme-aware**

Rewrite `OFFLINE_HTML`'s inline style to use `prefers-color-scheme` — it cannot read the app's CSS variables, so a media query is the correct mechanism. Keep it a single self-contained string.

- [ ] **Step 2: Emit a build stamp**

Have Vite define `__BUILD_ID__` (a hash or timestamp) and expose it at a stable path the SPA can poll cheaply.

- [ ] **Step 3: Detect and offer the update**

In `main.tsx`, poll the build stamp on an interval and on `visibilitychange`; when it differs from the running `__BUILD_ID__`, show a non-blocking toast ("A new version is available — Reload") wired to `location.reload()`. Never reload automatically — the user may be mid-prompt on the Run page.

- [ ] **Step 4: Verify**

Open the app, deploy a new build, then return to the still-open tab: within one poll interval the toast appears, and clicking it loads the new bundle. Confirm the offline page renders light-on-white under `prefers-color-scheme: light` via DevTools → Rendering.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(web): theme the offline shell and notify open tabs of new builds"
```

---

## Batch 6 — Accessibility

Depends on Batch 2 (LivePill's label shape) and Batch 5 (the `Switch` and `ProgressBar` the reduced-motion rules now name).

### Task 19: Add `.sr-only` and announce live state and route changes

**Files:** Modify `web/src/index.css`; `web/src/components/layout/LivePill.tsx:24-57`, `:66`; `web/src/components/layout/AppLayout.tsx:159`, `:182-193`; `web/src/components/layout/OfflineBanner.tsx`; `web/src/components/ui.tsx:49`

**Symptom.** `grep -rn "aria-live\|role=\"status\"\|sr-only" web/src` returns **zero** hits. Pulse is a real-time dashboard where nothing is announced: a screen-reader user never learns that a session needs their input — the single most time-critical signal the app produces — and SPA route changes swap the `h1` silently with no focus move.

- [ ] **Step 1: Add the utility and the live region**

Add `.sr-only` to `index.css`. In `LivePill`, remove the `aria-label="Live sessions"` at `:66` (it currently overrides the visible text as the accessible name) and add a sibling `<span role="status" aria-live="polite" class="sr-only">` rendering the same `label` string.

- [ ] **Step 2: Announce progress and outages**

Give the indexing banner `role="status" aria-live="polite" aria-atomic="true"` with a text child throttled to every 10% rather than every file; give `OfflineBanner` `role="alert"`.

- [ ] **Step 3: Announce route changes**

Add a `useEffect` on `location.pathname` that writes the resolved title into a dedicated `role="status"` node and focuses `<main tabIndex={-1}>`.

- [ ] **Step 4: Silence the firehose**

Add explicit `aria-live="off"` on `StatCard`'s re-keyed value span, so `stat-pop` churn never becomes a stream of announcements.

- [ ] **Step 5: Verify**

`grep -rn "aria-live" web/src` now returns hits. With a screen reader (or Chrome's a11y tree), navigate Dashboard → Timeline: the page name is announced and focus lands on `<main>`. Start a session and confirm "2 sessions need you" is announced once, not per frame.

- [ ] **Step 6: Commit**

```bash
git commit -am "a11y: announce live state, progress and route changes"
```

### Task 20: Give keyboard users the destructive controls

**Files:** Modify `web/src/components/layout/LivePill.tsx:138-148`; `web/src/pages/MissionPage.tsx:117-126`; `web/src/pages/RunPage.tsx:426-433`; `web/src/pages/ProjectsPage.tsx:107`

**Symptom.** The Interrupt (kill) button is `hidden … group-hover:block` — `display:none`, so it is removed from the tab order and the accessibility tree entirely. A keyboard-only or screen-reader user can **never** interrupt a running session. Template Pin/Delete are mouse-only for the same reason, and the Projects page's open-in buttons take focus while painted fully transparent.

- [ ] **Step 1: Implement**

Replace `hidden … group-hover:block` with `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100` — never `display:none`. On RunPage put `focus-within:opacity-100` on the wrapping `<span>` so both nested buttons reveal together. Add `focus-visible:opacity-100` on ProjectsPage. The correct pattern already exists at `JournalPage.tsx:145,155` — follow it.

Consider rendering the kill buttons at reduced opacity *always*: they are destructive but already confirm-gated, and hiding the emergency stop is the wrong default.

- [ ] **Step 2: Verify**

Tab through a Mission Control tile with the mouse parked off-screen: Interrupt becomes visible on focus and activates with Enter. Same for template Pin/Delete on `/run` and the open-in buttons on `/projects`.

- [ ] **Step 3: Commit**

```bash
git commit -am "a11y: make hover-revealed controls reachable by keyboard"
```

### Task 21: Close the `prefers-reduced-motion` gaps

**Files:** Modify `web/src/index.css:412-423`; optionally `web/src/lib/theme.ts:31-34`

**Symptom.** The reduced-motion block covers the named effect classes but misses the two largest motions: the full-viewport `aurora-drift 48s … infinite` on `body::before` that every page floats over — continuous, unstoppable, on every route, exactly what the signal exists to suppress — and `html.theme-anim *`, whose `!important` transitions override the block's own `transition: none`. `.glass-hover`'s translate and `ProgressBar` also still animate.

- [ ] **Step 1: Implement**

In the reduced-motion block: add `body::before { animation: none; }`; add `html.theme-anim, html.theme-anim *, html.theme-anim *::before, html.theme-anim *::after { transition: none !important; }` (the `!important` is required to beat `:213-223`); add `.glass, .glass-hover:hover { transition: none; transform: none; }`; and broaden the five-element transition reset to `*, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }`, keeping the named-class rules as documentation of intent.

- [ ] **Step 2: Verify**

DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce": the aurora backdrop is frozen (two screenshots 10s apart are pixel-identical), the light/dark toggle swaps instantly with no crossfade, and card hover produces no lift.

- [ ] **Step 3: Commit**

```bash
git commit -am "a11y: honour prefers-reduced-motion for the aurora and theme swap"
```

---

## Batch 7 — New analysis features

All four build on `server/lib/stats.js` and the existing `groupBy` plumbing, so they follow the hardening in Batches 1 and 3. `resolveRemote` already maps `/api/stats?groupBy=X` to `insights:X` (`web/src/lib/source.ts:51`), so each new grouping needs only a matching entry in `server/lib/cloud/keys.js` to appear in cloud mode.

### Task 22: Surface MCP server usage

**Files:** Modify `server/lib/stats.js` (new `mcpUsage`); `server/routes/data.js:101-116`; `web/src/lib/queries.ts`; `web/src/lib/types.ts`; `web/src/pages/ManagePage.tsx:92-107`; `web/src/pages/InsightsPage.tsx`; `server/lib/cloud/keys.js:35-49`

**Benefit.** Answers "which MCP servers earn their context cost?" — every MCP server burns tool-definition tokens in every request, and this machine exposes 40+ of them with zero usage signal. The data has been accumulating in `events.attr_mcp_server` / `attr_mcp_tool` since migration v1 and is read by **nothing**: a repo-wide grep for `attr_mcp` returns only the write sites. No re-ingest needed.

- [ ] **Step 1: Add the aggregate**

`mcpUsage(db, fromMs, toMs)` modelled exactly on `skillUsage()` at `:299-313`: group by `attr_mcp_server`, then by `attr_mcp_server||attr_mcp_tool`, with `max(ts)` as `lastUsedAt`.

- [ ] **Step 2: Wire the route and the query**

`case 'mcp'` in the `groupBy` switch; `mcpStatsQuery` + an `McpUsageData` type on the client.

- [ ] **Step 3: Render it**

Join by server name inside `McpCard` so each row gains `142 calls · last used 2d ago` or a dim `never used in 90d`; add a matching card beside "skills & plugins" on Insights.

- [ ] **Step 4: Mirror it**

Add `{ key: 'insights:mcp', kind: 'insights', path: stats('mcp') }` to `staticSnapshots`.

- [ ] **Step 5: Verify**

```bash
curl.exe -s "http://127.0.0.1:5599/api/stats?groupBy=mcp&from=2026-05-01&to=2026-08-15"
```
Rows are non-empty and their call counts sum to `SELECT count(*) FROM events WHERE attr_mcp_server IS NOT NULL` over the same window. The Manage page shows a usage line per server, including at least one "never used".

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(insights): surface MCP server usage from data already captured"
```

### Task 23: Chart each session's context curve with compaction marks

**Files:** Modify `server/lib/stats.js` (new `contextSeries`); `server/routes/data.js:270-326`; `web/src/components/session/SessionDetailView.tsx`

**Benefit.** Context pressure currently exists only as a live gauge for working sessions — the moment a session idles, the number is gone forever. Yet every credited event already stores `input + cache_read + cache_create_5m + cache_create_1h`, which *is* the context size at that instant, so the full curve of every historical session is already in the DB.

- [ ] **Step 1: Add `contextSeries(db, sessionId)`**

Select credited assistant events in `ts` order, sum the four input-side columns per point, and flag a compaction wherever the value drops more than ~40% from the running max.

- [ ] **Step 2: Include it in the session payload**

Add to `/api/sessions/:id` — which the cloud mirrors automatically via `session:<id>`, so no `keys.js` change is needed.

- [ ] **Step 3: Render**

A small area chart with compaction ticks beneath the turns chart in `SessionDetailView`, reusing the existing hand-rolled chart conventions and `--color-claude`.

- [ ] **Step 4: Verify**

Open a long session known to have compacted: the chart shows a sawtooth with a tick at each drop, and the final point equals the number Mission Control's ContextGauge showed while it was live. `npm run check`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(sessions): chart the context curve and mark compactions"
```

### Task 24: Add a "compaction tax · 30d" insight card

*(ships independently of Task 23, but shares its detector)*

**Files:** Modify `server/lib/stats.js` (new `compactionTax`); `server/routes/data.js`; `web/src/pages/InsightsPage.tsx:104-196`; `server/lib/cloud/keys.js`

**Benefit.** Compaction is the sharpest cost event in a long session — it forces a full fresh re-read afterwards — and is completely invisible in the product today. This quantifies it: compactions per session and the cache-write tokens spent rebuilding context, pairing naturally with the existing token-economics sankey and the cost explainer's cache-write reasoning.

- [ ] **Step 1: Aggregate across sessions**

`compactionTax(db, fromMs, toMs)` over a 30-day window, sharing the drop detector with Task 23 (extract it to one helper — do not duplicate the threshold).

- [ ] **Step 2: Expose and render**

Via `/api/token-flow` or `case 'compaction'`; render a card beside the token-flow card. Add the key to `staticSnapshots`.

- [ ] **Step 3: Verify**

The card's compaction count matches a direct SQL check of the same detector over `events` for the window, and the cache-write token figure reconciles with the token-flow card's cache-write total — it must be a subset.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(insights): quantify the compaction tax"
```

### Task 25: Measure context switching and longest focus block

**Files:** Modify `server/lib/stats.js` (new `focusStats`); `server/routes/data.js:101`; `web/src/lib/queries.ts`; `web/src/pages/InsightsPage.tsx`; `web/src/pages/DigestPage.tsx:86-90`; `server/lib/cloud/keys.js`

**Benefit.** Insights answers *when* you work and *how much*, but never how fragmented the work was. For someone running parallel sessions across projects, thrash is the metric that actually explains a bad week.

- [ ] **Step 1: Add `focusStats(db, fromMs, toMs)`**

Order turns by `started_at`, join `sessions.project_id` (the same join `projectSplit` already uses), count transitions where the project changes, and merge same-project runs into blocks with the existing `mergeIntervals` helper. Pure query-time math over a few hundred turns — consistent with the no-rollup-tables note at the top of `stats.js`.

- [ ] **Step 2: Expose, render, mirror**

`case 'focus'`; `focusStatsQuery`; an Insights card (switches-per-day sparkline + longest-block stat) and one headline line in Digest; `insights:focus` in `keys.js`.

- [ ] **Step 3: Verify**

```bash
curl.exe -s "http://127.0.0.1:5599/api/stats?groupBy=focus&from=2026-08-01&to=2026-08-15"
```
The longest block must never exceed the day's `wallMs` from `groupBy=day` for the same date, and switches for a single-project day must be 0. Insights and Digest render the new figures.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(insights): measure context switching and focus blocks"
```

---

## Final verification

After all batches:

- [ ] `npm run check` (server JSDoc) — clean
- [ ] `cd web && npx tsc --noEmit` — clean
- [ ] `npx vitest run convex/` and `cd web && npx vitest run` — all pass
- [ ] `npm run smoke` — parser output unchanged
- [ ] Reingest safety: confirm no new user-data table was added to the drop list in `scripts/reingest.mjs`
- [ ] Walk every page in both themes, dark and light, with zero console errors
- [ ] Walk every page on the deployed SPA in a **fresh tab** (see Task 18 — an open tab may still be running the old bundle)
- [ ] DevTools → Rendering → emulate `prefers-reduced-motion: reduce` and confirm the aurora is frozen
