# Study progress Worker

Cloudflare Worker + D1 database that stores what you learn, and optionally writes scenes with Workers AI.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Liveness |
| `GET /api/progress` | bearer | All concept progress, the last 20 sessions, the rematch queue, recent answers (for the progress model) |
| `POST /api/save` | bearer | Apply one save (idempotent by `saveId`, newer concept copies win) |
| `POST /api/generate` | bearer | Run the Workers AI model on a scene prompt (501 without the `[ai]` binding) |

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
npx wrangler deploy                           # prints https://isaca-quest-sync.<account>.workers.dev
```

Then open the site → **Settings → Cloud sync**, paste the Worker URL and the token, and press **Load progress from
cloud** once. Select **Cloudflare Workers AI** (or **Auto**) to have the Worker write scenes.

To turn cloud scene generation off, delete the `[ai]` block from `wrangler.toml` and redeploy. Workers AI usage
counts against your Cloudflare account's free allocation and then its paid rate.

## Test

The Worker's tests run from the repository root with `npm test`, against a SQLite-backed stand-in for D1.
