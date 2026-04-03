-- Nexus Status Database Schema
-- Single source of truth for session, activity, rate limit, and git data

-- Sessions: tracks Claude Code work sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  hostname TEXT,
  model TEXT,
  context_remaining REAL,
  mode TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  status_message TEXT DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Projects: aggregate status across sessions
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_status TEXT NOT NULL DEFAULT 'idle',
  config JSONB DEFAULT '{}'
);

-- Activity events: real-time tool operations from CC hooks
CREATE TABLE IF NOT EXISTS activity_events (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  project_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate limits: tracks API usage and context consumption
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

-- Git stats: per-project commit and line metrics
CREATE TABLE IF NOT EXISTS git_stats (
  id SERIAL PRIMARY KEY,
  project_name TEXT UNIQUE NOT NULL,
  commits_7d INTEGER DEFAULT 0,
  lines_7d INTEGER DEFAULT 0,
  commits_prev_7d INTEGER DEFAULT 0,
  lines_prev_7d INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_project ON activity_events(project_name);
CREATE INDEX IF NOT EXISTS idx_rate_limits_session ON rate_limits(session_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_recorded ON rate_limits(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_git_stats_project ON git_stats(project_name);
