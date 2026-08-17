export const MIGRATIONS = [
  {
    // v2 lives at the end of this array; versions apply in ascending order.
    version: 1,
    sql: `
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE projects(
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  parent_project_id INTEGER,
  worktree_branch TEXT,
  first_seen INTEGER,
  last_seen INTEGER
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  transcript_path TEXT,
  title TEXT,
  last_prompt TEXT,
  git_branch TEXT,
  cc_version TEXT,
  entrypoint TEXT,
  started_at INTEGER,
  last_event_at INTEGER,
  ended_at INTEGER,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  claude_ms INTEGER NOT NULL DEFAULT 0,
  user_active_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_1h_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL,
  has_unpriced_tokens INTEGER NOT NULL DEFAULT 0,
  tool_use_count INTEGER NOT NULL DEFAULT 0,
  subagent_count INTEGER NOT NULL DEFAULT 0,
  subagent_ms INTEGER NOT NULL DEFAULT 0,
  models TEXT,
  pr_links TEXT
);
CREATE INDEX idx_sessions_proj ON sessions(project_id, started_at);
CREATE INDEX idx_sessions_start ON sessions(started_at);

CREATE TABLE events(
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message_id TEXT,
  model TEXT,
  effort TEXT,
  usage_credited INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_create_5m INTEGER,
  cache_create_1h INTEGER,
  tool_name TEXT,
  tool_use_count INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  attr_skill TEXT,
  attr_plugin TEXT,
  attr_mcp_server TEXT,
  attr_mcp_tool TEXT,
  char_count INTEGER
);
CREATE INDEX idx_events_sess_ts ON events(session_id, ts);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_msg ON events(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_events_tool ON events(tool_name) WHERE tool_name IS NOT NULL;

CREATE TABLE prompts(
  uuid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  command_name TEXT,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prompts_ts ON prompts(ts);
CREATE INDEX idx_prompts_sess ON prompts(session_id, ts);
CREATE INDEX idx_prompts_proj ON prompts(project_id, ts);

CREATE VIRTUAL TABLE prompts_fts USING fts5(text, content='prompts', content_rowid='rowid', tokenize='porter unicode61');
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER prompts_au AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO prompts_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE turns(
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  prompt_uuid TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  claude_ms INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  tool_use_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL
);
CREATE INDEX idx_turns_sess ON turns(session_id, started_at);
CREATE INDEX idx_turns_start ON turns(started_at);

CREATE TABLE agent_runs(
  agent_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  transcript_path TEXT,
  agent_type TEXT,
  resolved_model TEXT,
  status TEXT,
  first_ts INTEGER,
  last_ts INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_1h_tokens INTEGER NOT NULL DEFAULT 0,
  tool_use_count INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL,
  tool_stats TEXT
);
CREATE INDEX idx_agent_sess ON agent_runs(session_id);
CREATE INDEX idx_agent_first_ts ON agent_runs(first_ts);

CREATE TABLE journal(
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  project_path TEXT,
  session_id TEXT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ui'
);
CREATE INDEX idx_journal_ts ON journal(ts);

CREATE TABLE legacy_daily(
  date TEXT PRIMARY KEY,
  message_count INTEGER,
  session_count INTEGER,
  tool_call_count INTEGER,
  prompt_count INTEGER,
  source TEXT
);

CREATE TABLE ingest_files(
  path TEXT PRIMARY KEY,
  file_kind TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  offset INTEGER NOT NULL DEFAULT 0,
  session_ids TEXT,
  agent_id TEXT,
  last_message_id TEXT,
  last_ingested_at INTEGER,
  parse_errors INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE hook_events(
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  event TEXT NOT NULL,
  session_id TEXT,
  cwd TEXT,
  payload TEXT
);
CREATE INDEX idx_hook_ts ON hook_events(ts);
`,
  },
  {
    // User data: starred sessions. Survives reingest (sessions keep their ids).
    version: 2,
    sql: `
CREATE TABLE starred(
  session_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
`,
  },
  {
    // Cached AI-generated changelog summaries (claude -p output). input_hash
    // lets us detect when new work invalidates a cached summary.
    version: 3,
    sql: `
CREATE TABLE reports(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_proj ON reports(project_id, period_from, period_to, created_at);
`,
  },
  {
    // Parse-failure inbox: rebuildable diagnostics (repopulated by reingest).
    // Snippets are hard-truncated — never whole transcript lines.
    version: 4,
    sql: `
CREATE TABLE parse_failures(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  file TEXT NOT NULL,
  reason TEXT,
  snippet TEXT
);
CREATE INDEX idx_parse_failures_ts ON parse_failures(ts);
`,
  },
  {
    // Control plane: headless jobs launched from the UI + reusable prompt
    // templates / per-project quick actions. USER DATA — survives reingest
    // (not in the reingest drop list).
    version: 5,
    sql: `
CREATE TABLE pulse_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  session_id TEXT,
  resume_of TEXT,
  project_id INTEGER,
  project_path TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT,
  max_turns INTEGER,
  permission_mode TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  exit_code INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  output_tail TEXT
);
CREATE INDEX idx_pulse_jobs_created ON pulse_jobs(created_at);

CREATE TABLE prompt_templates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  project_id INTEGER,
  model TEXT,
  max_turns INTEGER,
  permission_mode TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER
);
`,
  },
  {
    // Git/GitHub correlation. `commits` is a rebuildable cache keyed by
    // project_id (dropped on reingest — project ids change). `pr_status`
    // survives reingest: keyed by URL, session ids are stable.
    version: 6,
    sql: `
CREATE TABLE commits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  author_ts INTEGER NOT NULL,
  message TEXT,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  UNIQUE(project_id, sha)
);
CREATE INDEX idx_commits_proj ON commits(project_id, author_ts);
CREATE INDEX idx_commits_sess ON commits(session_id);

CREATE TABLE pr_status(
  url TEXT PRIMARY KEY,
  repo TEXT,
  number INTEGER,
  title TEXT,
  state TEXT,
  merged_at INTEGER,
  additions INTEGER,
  deletions INTEGER,
  session_id TEXT,
  checked_at INTEGER
);
`,
  },
  {
    // Recurring headless jobs run by the in-process scheduler. USER DATA —
    // survives reingest (project binding is by path, re-resolved at run time).
    version: 7,
    sql: `
CREATE TABLE scheduled_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  project_path TEXT NOT NULL,
  model TEXT,
  max_turns INTEGER,
  permission_mode TEXT,
  cadence TEXT NOT NULL DEFAULT 'daily',
  hour INTEGER NOT NULL DEFAULT 7,
  minute INTEGER NOT NULL DEFAULT 0,
  dow INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_job_id INTEGER,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    // Session tags & notes. USER DATA — survives reingest (session ids are
    // stable across rebuilds).
    version: 8,
    sql: `
CREATE TABLE session_meta(
  session_id TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    // API / tool failure feed — rebuildable diagnostics (dropped on reingest;
    // history before this migration appears after the next reingest).
    version: 9,
    sql: `
CREATE TABLE error_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  snippet TEXT
);
CREATE INDEX idx_error_events_ts ON error_events(ts);
`,
  },
  {
    // claude.ai chat usage imported from account data exports — a separate
    // layer from Claude Code sessions (no tokens/cost in exports). USER DATA:
    // survives reingest; re-run scripts/import-claudeai.mjs to refresh.
    version: 10,
    sql: `
CREATE TABLE claudeai_chats(
  uuid TEXT PRIMARY KEY,
  name TEXT,
  first_ts INTEGER,
  last_ts INTEGER,
  messages INTEGER NOT NULL DEFAULT 0,
  human_messages INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_claudeai_last ON claudeai_chats(last_ts);
`,
  },
  {
    // Alert history (ack state = user data) + outbound webhooks. Survive reingest.
    version: 11,
    sql: `
CREATE TABLE alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  rule TEXT NOT NULL,
  message TEXT NOT NULL,
  acked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_alerts_ts ON alerts(ts);

CREATE TABLE webhooks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_fired_at INTEGER,
  last_status TEXT
);
`,
  },
  {
    // "Latest changes" prose cache for project pages. Keyed by path, not id:
    // reingest reassigns project ids but leaves this table alone, so a
    // path-keyed row stays correctly attached to its project.
    version: 12,
    sql: `
CREATE TABLE project_summaries(
  project_path TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    // Multiple Claude subscriptions on one machine. Transcripts carry no
    // account identity, so attribution comes from the hook env (see
    // lib/accounts.js) and is USER DATA — it cannot be re-derived from
    // ~/.claude, so both tables stay out of reingest's drop list.
    // session_accounts is first-write-wins: a later login flip must never
    // retroactively relabel a session that already resolved.
    version: 13,
    sql: `
CREATE TABLE accounts(
  uuid TEXT PRIMARY KEY,
  email TEXT,
  org_uuid TEXT,
  label TEXT,
  profile_dir TEXT,
  rate_limit_tier TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  last_seen_at INTEGER
);
CREATE TABLE session_accounts(
  session_id TEXT PRIMARY KEY,
  account_uuid TEXT NOT NULL,
  source TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_session_accounts_account ON session_accounts(account_uuid);
`,
  },
  {
    // Day-by-day change reviews. Keyed by PATH, not id: reingest drops
    // `projects` (reassigning ids) but not this table, so an id-keyed row
    // would silently re-attach to the wrong project — the same hazard v12
    // worked around for project_summaries. Opus-generated and not
    // re-derivable, so it stays out of reingest's drop list.
    version: 14,
    sql: `
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
`,
  },
];
