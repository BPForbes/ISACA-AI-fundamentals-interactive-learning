# Study progress Worker

Cloudflare Worker + D1 database that stores what you learn, and optionally writes scenes with Workers AI.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Liveness |
| `GET /api/progress` | bearer | All concept progress, the last 20 sessions, the rematch queue, recent answers (for the progress model) |
| `POST /api/save` | bearer | Apply one save (idempotent by `saveId`, newer concept copies win) |
| `POST /api/generate` | bearer | Run the Workers AI model on a scene prompt (501 without the `[ai]` binding) |
| `GET /api/vault` | bearer | Which providers have a stored key, and when it was stored (never the key) |
| `PUT /api/vault/{groq\|gemini\|openrouter}` | bearer | Store a provider API key, encrypted |
| `DELETE /api/vault/{provider}` | bearer | Delete a stored key |
| `POST /api/vault/{provider}/chat` | bearer | Call the provider with the stored key; returns only the completion |
| `GET /api/vault/{provider}/models` | bearer | The provider's model list, through the stored key |

The token is never stored: the Worker holds only its SHA-256 (`SYNC_TOKEN_SHA256`) and refuses every
authenticated route while that secret is missing. CORS is limited to `ALLOWED_ORIGINS`.

## Deploy

```bash
cd worker
npx wrangler login
npx wrangler d1 create isaca-quest            # copy the database_id into wrangler.toml
npx wrangler d1 migrations apply isaca-quest --remote

TOKEN=$(openssl rand -hex 32)                 # keep this; you paste it into the site's Settings
printf %s "$TOKEN" | sha256sum | cut -d' ' -f1 | npx wrangler secret put SYNC_TOKEN_SHA256
openssl rand -base64 32 | npx wrangler secret put KEY_ENCRYPTION_KEY   # encrypts uploaded API keys
npx wrangler deploy                           # prints https://isaca-quest-sync.<account>.workers.dev
```

Then open the site → **Settings → Cloud sync**, paste the Worker URL and the token, and press **Load progress from
cloud** once. Select **Cloudflare Workers AI** (or **Auto**) to have the Worker write scenes.

To turn cloud scene generation off, delete the `[ai]` block from `wrangler.toml` and redeploy. Workers AI usage
counts against your Cloudflare account's free allocation and then its paid rate.

## API key vault

A hosted-model key uploaded from the site's Settings is encrypted with AES-256-GCM under `KEY_ENCRYPTION_KEY`, a
Worker secret, and only the ciphertext and IV go into D1 (`provider_keys`). The provider name is bound into each
ciphertext, so a row copied to another provider will not decrypt. No route returns a key: the Worker decrypts it
per request and calls the provider itself, only at the fixed base URL of Groq, Gemini or OpenRouter, and passes on
the provider's status code but never its error body, which can quote part of the key. The browser keeps no copy.

What it protects against, and what it does not:

- Someone who copies the browser's storage gets the sync token, not the provider key. They could use the key
  through your Worker until you rotate the sync token, but they cannot read it or take it elsewhere.
- Someone who reads the D1 database gets ciphertext only; the encryption key is in Cloudflare's secret store.
- Rotating `KEY_ENCRYPTION_KEY` makes stored keys undecryptable: upload them again afterwards. If a key may have
  leaked, delete it here and revoke it at the provider.

## Test

The Worker's tests run from the repository root with `npm test`, against a SQLite-backed stand-in for D1.
