CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    balance REAL DEFAULT 0,
    referred_by INTEGER,
    is_verified BOOLEAN DEFAULT 0,
    is_admin BOOLEAN DEFAULT 0,
    last_bonus_at INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    pending_captcha_emoji TEXT,
    state TEXT DEFAULT 'start',
    FOREIGN KEY (id) REFERENCES users(id)
);
