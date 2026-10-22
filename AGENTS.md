# Agent instructions

These rules apply to coding agents and review bots working in this repository.

## What this is

A React + TypeScript + Vite site (GitHub Pages) that teaches ISACA AI Fundamentals Chapters 1–5 as an adventure,
plus a Cloudflare Worker (`worker/`) that stores progress in D1 and can generate scenes with Workers AI.

## Content rules

- `src/data/terms.ts` holds the exam definitions from the learner's own notes. Do not reword a definition unless
  the learner's material changes; scenes may paraphrase, the term bank may not drift.
- Keep the guide's teaching rules: one anchor concept per scene (topic lock), a miss keeps the anchor in play,
  points never override mastery, and familiar (personal-project) settings are analogies, never claims about what
  those projects implement.
- Model output is untrusted. Every generated scene must pass `sanitizeScene`; never render model text without it.
- Calculation scenes stay on the offline engine so arithmetic is exact.

## Data and security

- No secret in the tree. The sync token is chosen by the learner, stored only in their browser, and the Worker
  holds only its SHA-256 as a `wrangler secret`. Never put a token or its hash in `wrangler.toml` or a test.
- The Worker refuses every authenticated route while `SYNC_TOKEN_SHA256` is unset, and limits CORS to
  `ALLOWED_ORIGINS`. Keep both fail-closed.
- A save is one D1 batch (one transaction) and idempotent by `saveId`; a concept row is only replaced by a newer
  `updatedAt`. Keep both properties, and validate every field before it reaches SQL.

## Workflow

- `npm test` after changes to `src/engine/`, `src/session/`, `src/llm/` or `worker/`; `npm run build` before pushing.
- Tests live in `tests/` folders beside their modules (`src/engine/tests/`, `worker/test/`).
- Make the smallest correct change and match the surrounding style.
- Do not put a model name in commits, pull requests or files.
