-- Foundation schema (subsystem #1 of 7)
-- See docs/superpowers/specs/2026-05-03-foundation-design.md

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER UNIQUE,
  email           TEXT UNIQUE,
  display_name    TEXT,
  avatar_initials TEXT,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);
CREATE INDEX idx_users_telegram ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX idx_users_email    ON users(email)       WHERE email       IS NOT NULL;

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip_hash       TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE songs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- valid states (no CHECK constraint to keep future subsystems flexible):
  -- wizard_in_progress | text_generating | text_ready | text_editing |
  -- music_generating | music_ready | paid | archived | failed
  state           TEXT NOT NULL DEFAULT 'wizard_in_progress',
  occasion        TEXT,
  occasion_custom TEXT,
  genre           TEXT,
  moods_json      TEXT,
  voice           TEXT,
  wishes          TEXT,
  lyrics          TEXT,
  suno_tags       TEXT,
  title           TEXT,
  portrait_json   TEXT,
  metrics_json    TEXT,
  critique_json   TEXT,
  clips_json      TEXT,
  paid_at         INTEGER,
  order_invoice_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  extra_json      TEXT
);
CREATE INDEX idx_songs_session ON songs(session_id);
CREATE INDEX idx_songs_user    ON songs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_songs_state   ON songs(state);

CREATE TABLE email_login_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
