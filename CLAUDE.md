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
| App shell | `src/App.tsx` | Run and expedition flow, saving, camp; `components/Workshop.tsx`, `TrainingHud.tsx`, `NetworkDiagram.tsx`, `PixelIcon.tsx` (MIT icons), `LabView.tsx` (the lab's panels), `ExpeditionSide.tsx` |
| Study data | `src/data/` | Term bank, ten integration chains, distinctions, story settings, scene situations, run briefs (`briefs.ts`), upgrade catalogue (`upgrades.ts`), lab challenges (`challenges.ts`) |
| Engine | `src/engine/` | Mastery and terminology ladder, scoring, teaching-mode director, offline scene generator (templates), scene sanitizer, discriminator, LSTM progress tracker (`lstm.ts`, `tracker.ts`), attention tracker over the concept relation table (`attention.ts`, `relations.ts`), both fitted in `trackerWorker.ts`, the bit-packed mastery matrix (`matrix.ts`), the roguelike run (`run.ts`: rounds, loss, upgrades, meters, endings), and the lab simulation (`lab/`: dataset, model, metrics, `runLab`, `diagnose`) |
| AI | `src/llm/` | Free hosted models (`hosted.ts`: Groq, Gemini, OpenRouter), WebLLM, Ollama and Workers AI backends; the generate–discriminate loop in `index.ts` |
| Session | `src/session/store.ts` | In-session state, dirty tracking, save payloads, study-context export |
| Cloud | `src/sync/cloud.ts`, `worker/` | Save/load and key-vault client; the Cloudflare Worker, its encrypted API-key vault (`worker/src/vault.ts`) and the D1 migrations (`0003` is the `mastery_matrix` table) |
