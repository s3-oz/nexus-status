-- Nexus Status Schema v2
-- Single source of truth for session, activity, rate limit, and git data.
-- Mini-hosted version. Evolves from v1 to express honest session state
-- (working / waiting-for-user / idle / blocked / disconnected) instead of
-- the v1 everything-is-"active" lie.
--
-- Changes from v1:
--   sessions.status        CHECK constraint added
--   sessions.last_user_input_at         NEW
--   sessions.last_assistant_message_at  NEW
--   sessions.waiting_on                 NEW
--   (last_activity retained under same name — TaskFlow reads it)

-- ── Sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  hostname TEXT,
  model TEXT,
  context_remaining REAL,
  mode TEXT,

  -- Honest state machine (v2)
  status TEXT NOT NULL DEFAULT 'working'
    CHECK (status IN ('working','waiting-for-user','idle','blocked','disconnected')),
  status_message TEXT DEFAULT '',
  waiting_on TEXT,  -- e.g. 'permission-prompt', 'user-reply', 'tool-approval'

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),          -- last pulse received
  last_user_input_at TIMESTAMPTZ,                            -- most recent user message
  last_assistant_message_at TIMESTAMPTZ,                     -- most recent assistant final

  metadata JSONB DEFAULT '{}'
);

-- ── Projects (aggregate) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_status TEXT NOT NULL DEFAULT 'idle',
  config JSONB DEFAULT '{}'
);

-- ── Activity events (real-time tool ops from hooks) ──────────────────────────
CREATE TABLE IF NOT EXISTS activity_events (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  project_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Rate limits (API usage / context) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  model TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  tokens_remaining INTEGER,
  context_window INTEGER,
  context_remaining REAL,
  reset_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Git stats (per-project commit + line metrics) ────────────────────────────
CREATE TABLE IF NOT EXISTS git_stats (
  id SERIAL PRIMARY KEY,
  project_name TEXT UNIQUE NOT NULL,
  commits_7d INTEGER DEFAULT 0,
  lines_7d INTEGER DEFAULT 0,
  commits_prev_7d INTEGER DEFAULT 0,
  lines_prev_7d INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_project ON activity_events(project_name);
CREATE INDEX IF NOT EXISTS idx_rate_limits_session ON rate_limits(session_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_recorded ON rate_limits(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_git_stats_project ON git_stats(project_name);
