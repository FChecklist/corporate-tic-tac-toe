-- Roles (Organizer / Host / Co-host): a short private label on each Host and Co-host key. Apply BEFORE deploying the code that reads it.
ALTER TABLE organizer_key ADD COLUMN label TEXT;
