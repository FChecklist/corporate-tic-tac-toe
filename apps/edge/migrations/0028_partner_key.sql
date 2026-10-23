-- Refer & earn partners sign in again by e-mail (6-digit code or one tap): every phone or laptop gets its own key, so one sign-in never signs another device out. Apply BEFORE deploying the code that reads it.
CREATE TABLE IF NOT EXISTS partner_key (key_hash TEXT PRIMARY KEY, code TEXT NOT NULL, created_ms INTEGER NOT NULL);
