# Implementation Plan: ScrapCRM — Multi-Agent Scraping + CRM System

## Overview
A self-contained local system (Node.js backend + SQLite + simple web UI) where specialized AI agents discover, scrape, audit, enrich, score, and track business leads — coordinated by a CEO agent, with a self-learning loop that records every agent mistake and feeds corrections back into future runs. The UI has two main sections: **Agents** (each agent with its live event feed) and **Prospects/Leads** (pipeline CRM).

Project directory: `C:\Users\telba\scrapcrm\`

## Architecture Decisions
- **Desktop app:** **Electron** — real installable laptop app (.exe), not a browser tab. The Express+SQLite backend runs embedded inside the Electron main process; the UI is the Electron window itself. Packaged with electron-builder into `ScrapCRM Setup.exe` for any Windows laptop.
- **DB:** single SQLite file `scrapcrm.db` (WAL mode). Tables: leads, agent_events, agent_runs, lessons (self-learning), email_checks, site_audits, tasks (CEO work queue).
- **Scraping engine:** Python venv already installed at `C:\Users\telba\.scrapling-venv` with Scrapling 0.4.14 (anti-bot bypass). Node spawns it for hard sites.
- **Agents (all report to CEO):**
  1. **CEO Agent** — receives every agent's plan/intent before execution ("tell the CEO what they will do"), approves/queues work, assigns priorities, resolves conflicts.
  2. **Scraper Agents** (pool of N concurrent workers) — discover + extract leads from sources (Google Maps-ish directories, store registries, niche lists) using Scrapling when anti-bot is detected.
  3. **Email Auditor Agent** — syntax check → MX lookup → SMTP mailbox probe (RCPT TO without sending) → verdict VALID/RISKY/DEAD. Never sends mail.
  4. **Website Analyzer Agent** — does the site exist? tech stack, speed signals, mobile-friendliness, meta/SEO basics, social links found on page.
  5. **SEO Expert Agent** — commerce-aware (B2B + B2C): keyword presence, title/meta quality, structured data, Google index/rank estimate (via search queries), content gaps, scored 0–100 with recommendations.
  6. **Facebook/Social Presence Agent** — checks FB page existence, follower signals, IG/LinkedIn/TikTok presence; flags "no social = opportunity".
  7. **Google Ranking Agent** — queries Google for brand+keyword, records position, indexed pages estimate (`site:`), maps listing presence.
  8. **Ads Expert Agent** — detects Meta Pixel/gtag pixels on the site, Facebook Ads Library presence check, paid-search signal; classifies: running ads / no ads (opportunity).
  9. **Self-Learning Engine** — not an agent but a shared loop: every failed scrape/bad verdict/false-positive gets written as a "lesson" (pattern → correction); agents read lessons relevant to their domain before each run and adjust behavior. Mirrors how Hermes accumulates memory from mistakes.
- **LLM use:** optional. Deterministic logic works offline; if `GOOGLE_API_KEY` exists in config.env, agents use Gemini for summarizing findings and writing recommendations. Never required.
- **Frontend:** single-page vanilla JS + CSS served by Express at :8899. Two sections:
  - **Agents section** — card per agent: status, current job, and a live event stream (polled).
  - **Leads section** — table of prospects: name, site, email + deliverability badge, SEO score, social/ads flags, stage (new → audited → enriched → qualified → contacted), notes, actions.
- **Safety:** conservative scraping rate limits per domain, robots-aware, no email SENDING anywhere in the system (audit only).

## Task List

### Phase 1: Foundation
- [ ] Task 1: Project skeleton + DB layer (`db.js` with node:sqlite, WAL, schema for all tables) + Express server serving empty UI at :8899
- [ ] Task 2: Core event bus + agent registry (register/start/stop/status; events persisted to agent_events)
- [ ] Task 3: UI shell with two sections (Agents grid + Leads table), polling API endpoints `/api/agents`, `/api/events`, `/api/leads`

### Checkpoint: Foundation
- [ ] Server runs, UI loads, agents appear as cards, leads table renders (empty)

### Phase 2: Agents
- [ ] Task 4: CEO Agent + task queue: agents submit intents ("I will scrape X") → CEO validates/dedupes/prioritizes → dispatches; all decisions logged as events
- [ ] Task 5: Scraper Agent pool (2 workers): source plugins (directory/niche-list URL seeds), plain fetch first, auto-escalate to Scrapling venv on anti-bot detection; extracts business name/site/email/phone/socials
- [ ] Task 6: Email Auditor Agent: syntax → DNS MX → SMTP RCPT probe w/ timeouts; writes email_checks + verdict badge on lead
- [ ] Task 7: Website Analyzer Agent: reachability, tech detect, mobile viewport, perf hints, extracted socials; writes site_audits
- [ ] Task 8: SEO Expert Agent (commerce/B2B/B2C): on-page scoring (title/meta/h1/schema/keywords by niche type), Gemini-optional recommendations, 0–100 score
- [ ] Task 9: Social/Facebook + Ads Expert Agents: FB page & ads-library checks, pixel detection, presence matrix per lead
- [ ] Task 10: Google Ranking Agent: brand query rank capture, `site:` index count, map-pack presence note (rate-limited)

### Checkpoint: Core Agents
- [ ] Run one lead through full pipeline: scraped → email verified → website audited → SEO scored → social/ads/rank checked; all visible in UI

### Phase 3: Self-Learning + Polish
- [ ] Task 11: Lessons engine: failure handlers write lessons (agent, pattern, correction); agents load top lessons pre-run; lesson hit counter proves learning
- [ ] Task 12: Pipeline orchestration: CEO auto-chains enrichment stages per new lead; retries with lesson-informed backoff; daily summary event
- [ ] Task 13: Leads UX polish: filters, stage badges, detail drawer with all audit data, CSV export; end-to-end test with 5 real seed URLs

- [ ] Task 14: Electron packaging: main process embeds the Express server, app window loads the UI; electron-builder → `ScrapCRM Setup.exe` (NSIS installer, desktop shortcut); verify installed app runs full pipeline

### Checkpoint: Complete
- [ ] All acceptance criteria met; installable .exe works on any Windows laptop

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| SMTP port 25/587 blocked by ISP | Email auditor degraded | Fall back to MX-only + disposable-list checks, mark RISKY not DEAD |
| Google blocks ranking queries | Ranking agent fails | Rate-limit + cache + Scrapling escalation; mark uncertain results |
| Anti-bot walls | Scraper stalls | Scrapling stealth browser fallback already installed |
| Windows background process death | Server dies between sessions | Document start script (.vbs/.ps1 like your other systems) |

## Open Questions
- None blocking — building with safe defaults. You said plan first, so review this and say GO (or change anything) and I build it end-to-end.
