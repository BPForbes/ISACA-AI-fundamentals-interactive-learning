-- Hosted-model API keys, AES-256-GCM encrypted under the KEY_ENCRYPTION_KEY
-- Worker secret. Only ciphertext and IV are stored; no route returns either.
CREATE TABLE IF NOT EXISTS provider_keys (
  provider TEXT PRIMARY KEY,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
