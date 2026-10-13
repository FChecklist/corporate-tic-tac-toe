-- TEST / LIVE mode (src/mode.ts): the mode row (default LIVE), the owner's e-mail allow-list for TEST, the e-mail event log, and the is_test flag on what TEST mode creates. Apply BEFORE deploying the code that reads them.
CREATE TABLE IF NOT EXISTS mode (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL DEFAULT 'LIVE', changed_ms INTEGER NOT NULL DEFAULT 0, reason TEXT);
INSERT OR IGNORE INTO mode(id,mode,changed_ms,reason) VALUES(1,'LIVE',0,'default');
CREATE TABLE IF NOT EXISTS test_mail_allow (email TEXT PRIMARY KEY, added_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mail_event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, to_hash TEXT NOT NULL, subject TEXT, outcome TEXT NOT NULL);
ALTER TABLE engagement ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commission ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizer_key ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizer_email ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visit_session ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
