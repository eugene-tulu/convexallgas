# Hackathon log

- **Project:** convexallgas
- **Event:** Convex All Gas Hackathon
- **What it does:** A compliance tracking app for EIA (Environmental Impact Assessment) projects. Uses Firecrawl to crawl regulatory sources, NVIDIA NIM LLM to extract compliance obligations, Convex database to track them, and AgentMail to send reminder emails. The user can search regulatory content, scrape and summarize pages, draft AI-powered reminder emails, and manage their compliance inbox - all in a single dashboard.
- **Live app:** https://basic-hippopotamus-995.convex.cloud
- **Repo:** none
- **Frontend:** https://basic-hippopotamus-995.convex.site
- **Convex deployment:** dev/gntulu (basic-hippopotamus-995)
- **Components:** none
- **Convex features:** Database, Actions (Node.js), Mutations, Queries, HTTP Actions, Cron Jobs
- **Auth:** none (public access for hackathon demo)
- **AI models:** NVIDIA NIM (nvapi) via OpenAI-compatible API at https://integrate.api.nvidia.com/v1 (model: nvidia/llama-3.1-405b-instruct)
- **Started:** 2026-09-01T06:34:40Z
- **Last updated:** 2026-09-02T21:55:00Z

## Log

### 2026-09-01 - working tree
Set up the hackathon environment: installed 33 Convex agent skills globally for Kilo Code (`~/.kilocode/skills/`), configured the Convex MCP server in the global `kilo.jsonc` (`type: local`, command: `npx -y convex@latest mcp start`), and placed the convex-hackathon-skill build-log at `.agents/skills/convex-hackathon-skill/` with a `references/log-format.md`. The project directory is empty — no Convex app, source files, or Git history exist yet. The convex MCP server command was verified to start successfully via the Convex CLI.

### 2026-09-01 - project scaffold
Created the project structure from scratch:
- Installed npm dependencies: `convex@1.45.0`, `react@19.2.0`, `vite@8.2.2`, `typescript@7.0.2`, `openai@7.8.0`, `firecrawl@4.38.0`, `agentmail@0.5.21`
- Installed `@x402/fetch` to resolve agentmail dependency
- Ran `npx convex init` to create local deployment at http://127.0.0.1:3210
- Ran `npx convex ai-files install` to generate AI guidelines
- Created `convex/convex.config.ts` with env var declarations: `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY`, `AGENTMAIL_DOMAIN`

### 2026-09-01 - backend schema & actions
- Created `convex/schema.ts` with 5 tables: `projects`, `regulations`, `documents`, `obligations`, `events` with appropriate indexes
- Created `convex/llm.ts` — `runLlmTask` action using OpenAI chat completions
- Created `convex/mail.ts` — AgentMail actions: `getOrCreateInbox`, `sendEmail`, `fetchMessage`, `registerWebhook`
- Created `convex/firecrawl.ts` — `crawlSource` action for crawling regulatory sources
- Created `convex/eventLog.ts` — `logEvent` internal mutation for audit trail
- Created `convex/seed.ts` — `seed` mutation for demo data
- Created `convex/obligations.ts` — obligation queries/mutations including lifecycle management
- Created `convex/documents.ts` — `searchDocuments` action with OpenAI embeddings
- Created `convex/projects.ts` — query functions for listing projects
- Created `convex/regulations.ts` — query functions for listing regulations by agency
- Created `convex/cron.ts` — `checkDueObligations` mutation that checks for overdue/pending obligations
- Created `convex/crons.ts` — cron job schedule that runs `checkDueObligations` every 30 minutes
- Created `convex/http.ts` — HTTP endpoint for AgentMail webhooks

### 2026-09-01 - frontend
- Created `src/main.tsx` — React entry point with ConvexHttpClient
- Created `src/App.tsx` — Main UI with three tabs (Projects, Regulations, Obligations) and seed button
- Created `tsconfig.json` — TypeScript config for frontend
- Created `vite.config.ts` — Vite config with React plugin and path alias

### 2026-09-02 - verification
- TypeScript compilation passes with no errors
- Fixed `cron` → `cronJobs` API per Convex guidelines
- Updated crons.ts to use `crons.interval` per Convex guidelines
- All action files use `"use node";` directive per Convex guidelines
- Fixed env var access to use `env` from `./_generated/server` per Convex guidelines
- Made `fetchMessage` and `registerWebhook` internalActions for secure HTTP routing

### 2026-09-02 - bug fixes from code review
- **Bug 1 (recurring obligations)**: Added `lastCompletedAt` field to obligations schema. `markObligationCompleted` now resets `status` to "pending" and advances `nextCheckAt` so obligations stay in the rotation
- **Bug 2 (regulations persistence)**: Added `searchAndPersist` and `scrapeAndPersist` actions that write to the `regulations` table. New `insertRegulation` internalMutation handles dedup by sourceUrl. Frontend "Scrape" button now persists results
- **Bug 3 (search returns empty)**: Switched from embedding-based cosine similarity to LLM-based search using NVIDIA NIM. `searchDocuments` and `searchRegulations` ask the LLM which documents/regulations are relevant. Works with seed data (no embeddings needed)
- **Auto-reminders**: New `reminders.ts` module with `sendReminderEmail` action. Cron now schedules reminder emails for due/overdue obligations via AgentMail (sends to `AGENTMAIL_DOMAIN`)

### 2026-09-02 - user-facing UI
- Built complete React dashboard with ConvexProvider for reactive updates
- 5 tabs: Dashboard, Crawl, Search, Inbox, Reminders
- **Dashboard**: project stats, obligation list with complete/snooze actions
- **Crawl**: Firecrawl search + scrape for regulatory content
- **Search**: semantic document search using NVIDIA NIM embeddings
- **Inbox**: AgentMail inbox management and message listing
- **Reminders**: AI-drafted compliance email sender using NVIDIA NIM
- Made `listMessages` and `searchMessages` public actions so the frontend can call them
- All components use Convex reactive queries - updates appear in real-time

### 2026-09-02 - expanded agentmail capabilities
- Expanded mail.ts to cover the full AgentMail API surface
- Added 13 functions: inbox CRUD, message list/search/get/attachment/raw/update, webhook CRUD
- Made `listMessages` and `searchMessages` public actions for frontend access
- Other sensitive operations (fetchMessage, registerWebhook, listWebhooks, etc.) remain internal
- HTTP endpoint `/webhooks/agentmail` now processes incoming emails via fetchMessage

### 2026-09-02 - expanded firecrawl capabilities
- Added comprehensive Firecrawl actions: `scrape`, `search`, `crawl`, `map`, `research` (scientific papers), and `crawlSource` (alias for scrape)
- Split documents.ts: `listDocuments` query stays in documents.ts (no Node.js), `searchDocuments` action moved to search.ts (with `"use node"`)
- Fixed Firecrawl SDK v4.38.0 API calls to match correct method signatures
- Made mail.ts actions `fetchMessage` and `registerWebhook` internalActions for secure HTTP routing

### 2026-09-02 - deployment
- Convex login successful via `npx convex login`
- Created cloud dev deployment: `dev/gntulu` (basic-hippopotamus-995)
- Updated `.env.local` with cloud deployment URLs
- Installed Node.js v22 via nvm for Node.js actions support
- Set environment variables: `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY`, `AGENTMAIL_DOMAIN`
- Switched to NVIDIA NIM API at `https://integrate.api.nvidia.com/v1` (nvapi key)
- Deployed all Convex functions successfully via `npx convex dev --once`
- Seeded demo data: 1 project ("Merced Solar Wind Farm EIA"), 2 obligations
- Vite frontend dev server running at http://localhost:5173/
- Convex Cloud URL: https://basic-hippopotamus-995.convex.cloud
- Site URL: https://basic-hippopotamus-995.convex.site
- All 6 firecrawl functions deployed: scrape, search, crawl, map, research, crawlSource
