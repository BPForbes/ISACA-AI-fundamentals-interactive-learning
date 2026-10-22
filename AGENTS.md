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
- Model output is untrusted. Every generated scene must pass `sanitizeScene` and the discriminator
  (`src/engine/discriminator.ts`); never render model text without both. The offline template is the reference
  every draft is graded against, so keep the offline generator faithful to the term bank.
- Call the scene loop GAN-inspired, not a GAN: nothing in it is trained adversarially.
- The LSTM progress model (`src/engine/tracker.ts`) may influence the move-on decision only while its held-out
  assessment beats the baseline. The rules in `decideAdvance` always apply, and the confirmation cap keeps a learner
  from being held on one link indefinitely.
- Calculation scenes stay on the offline engine so arithmetic is exact.

## Data and security

- Backend order for "auto" is: free hosted model, in-browser model, Cloudflare Workers AI (last resort), offline.
  A hosted-provider API key is the learner's own: it lives only in their browser's localStorage, is sent only to
  that provider, and must never appear in an error message, log, save payload or test literal.
- Uploaded provider keys live only in the Worker vault (`worker/src/vault.ts`): AES-GCM under the
  `KEY_ENCRYPTION_KEY` secret, provider-bound additional data, ciphertext in D1. Never add a route that returns a
  key, never forward a provider's error body (it can quote the key), and never let a caller choose the URL a key is
  sent to. A vaulted key is never written to browser storage.
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
