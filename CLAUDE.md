# Claude instructions

Shared rules live in [AGENTS.md](AGENTS.md); read and follow them first.

## Commands

- `npm install` — install dependencies
- `npm run dev` — Vite dev server
- `npm test` — Vitest suite once (engine, session, AI fallback, Worker against SQLite)
- `npm run build` — typecheck (`tsc -b`) and production build
- `npx tsc -p worker/tsconfig.json` — typecheck the Worker

## Architecture

| Area | Location | Role |
| --- | --- | --- |
| App shell | `src/App.tsx` | Expedition flow, saving, camp |
| Study data | `src/data/` | Term bank, ten integration chains, distinctions, story settings |
| Engine | `src/engine/` | Mastery and terminology ladder, scoring, teaching-mode director, offline scene generator, scene sanitizer |
| AI | `src/llm/` | WebLLM, Ollama and Workers AI backends behind one prompt and fallback path |
| Session | `src/session/store.ts` | In-session state, dirty tracking, save payloads, study-context export |
| Cloud | `src/sync/cloud.ts`, `worker/` | Save/load client and the Cloudflare Worker + D1 schema |
