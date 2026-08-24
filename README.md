# scrapcrm

A multi-agent lead-intelligence desktop app for outreach operations. ScrapCRM
watches a local CRM of leads, dispatches a chain of specialist agents to enrich
each lead (website analysis, SEO scoring, social/ads presence, Google ranking,
email verification), scores opportunity, and surfaces the best prospects in a
desktop UI.

> Original project. Built with Node.js, Express, better-sqlite3 and Electron.
> The agent chain is orchestrated in-process; enrichment runs against public
> web pages only.

## Overview

Outreach teams need to know, per lead: does this business have a website? Is it
ranking? Is it running ads? Is the contact email valid? ScrapCRM automates that
investigation so a human can focus on the highest-opportunity prospects.

## Features

- **Lead watcher** — detects new leads and queues the enrichment chain once.
- **Agent chain** (each a focused module under `agents/`):
  - `website-analyzer` — audits the lead's site.
  - `seo-expert` — scores on-page SEO.
  - `social-ads` — checks social profiles and running ads.
  - `google-ranking` — checks search ranking.
  - `email-auditor` — verifies the contact email.
- **Opportunity scoring** — recomputes a 0–100 score (no site / weak SEO / no
  ads / no social = higher opportunity).
- **Express API** with SSRF guards (blocks private/loopback/link-local targets)
  and a 32 KB JSON body cap.
- **Electron desktop shell** (`electron/main.js`) wrapping the API + `ui/`.
- **Audit log** — the CEO orchestrator keeps a structured log of every agent
  action.

## Architecture

```
            ┌─────────────────────────────────────────┐
 leads (SQLite) │  orchestrator.js (CEO chain)         │
   │ new lead   │   website-analyzer → seo-expert →    │
   └──────────▶│   social-ads → google-ranking →       │
               │   email-auditor                        │
               └───────────────┬───────────────────────┘
                               │ writes enrichment + score
                        ┌──────▼──────┐        ┌──────────────┐
                        │  db.js      │        │ server.js    │
                        │ (better-    │◀───────│ (Express API)│
                        │  sqlite3)   │        └──────┬───────┘
                        └─────────────┘               │ Electron UI
                                               ┌──────▼──────┐
                                               │ ui/index.html│
                                               └─────────────┘
```

| File | Responsibility |
| --- | --- |
| `orchestrator.js` | CEO chain + score recompute loop |
| `server.js` | Express API + SSRF guard |
| `db.js` | SQLite schema + accessors |
| `ceo.js` | Agent dispatch / intent log |
| `lessons.js` | Learned heuristics store |
| `agents/*.js` | Individual enrichment agents |
| `electron/main.js` | Desktop shell |
| `ui/index.html` | Dashboard UI |

## Tech Stack

- Node.js
- Express
- better-sqlite3
- Electron (desktop build)

## Installation

```bash
npm install
# (the desktop app uses prebuilt better-sqlite3; the .node binaries are
#  platform-specific and are NOT committed — reinstall on your platform)
cp .env.example .env        # optional tuning
npm run dev                 # start the Express API (port 8899)
# or build/run the desktop app:
npm run dist
```

## Environment Variables

See `.env.example`:

| Variable | Purpose |
| --- | --- |
| `SCRAPCRM_DB` | SQLite DB path |
| `SCRAPCRM_NICHES` | Comma-separated niches to focus discovery on |
| `SCRAPLING_PY` | Optional path to a Python (Scrapling) helper |
| `SCRAPCRM_DEBUG` | Verbose logging |

## Usage

```bash
npm run dev
# the API starts on http://localhost:8899 and the orchestrator begins
# watching the leads table; open ui/index.html for the dashboard.
```

## Security

- The SQLite database (`*.db`, `*.db-shm`, `*.db-wal`) and native `*.node`
  binaries are **never committed** (see `.gitignore`).
- The API enforces SSRF protection: only public `http(s)` URLs are fetched, and
  resolved IPs are checked against private/loopback/link-local ranges.
- JSON body size is capped at 32 KB.
- `x-powered-by` is disabled.
- No secrets are stored in the repository.

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- 🌐 Website: [huggehub.com](https://www.huggehub.com)
- 💻 GitHub: [@astrodevit-creator](https://github.com/astrodevit-creator)
- 🔗 LinkedIn: [El Badaoui Hatim](https://www.linkedin.com/in/el-badaoui-hatim-it)
