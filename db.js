// ScrapCRM — DB layer (better-sqlite3, WAL) — ABI-aware: works under plain Node AND packaged Electron
const path = require('path');
const fs = require('fs');
const os = require('os');

let Database;
try {
  Database = require('better-sqlite3');
  // probe: constructing on :memory: forces the lazy addon load — if ABI is wrong it throws here
  const probe = new Database(':memory:');
  probe.close();
} catch (e) {
  const want = process.versions.modules === '125' ? 'electron_sqlite3.node' : 'node_sqlite3.node';
  let src = process.resourcesPath ? path.join(process.resourcesPath, 'sqlite3-bin', want) : null;
  if (!src || !fs.existsSync(src)) src = path.join(__dirname, want);
  if (!fs.existsSync(src)) throw e;
  const mod = { exports: {} };
  process.dlopen(mod, src);
  const RealDatabase = require('better-sqlite3');
  Database = function Database(filename, options) {
    return new RealDatabase(filename, { ...(options || {}), nativeBinding: mod.exports });
  };
}

// DB lives in a writable user directory when packaged; project dir in dev
const DB_PATH = process.env.SCRAPCRM_DB
  || (process.resourcesPath ? path.join(os.homedir(), '.scrapcrm', 'scrapcrm.db')
                            : path.join(__dirname, 'scrapcrm.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, website TEXT, email TEXT, phone TEXT,
  source TEXT, country TEXT, city TEXT, niche TEXT,
  email_verdict TEXT DEFAULT 'unknown',
  seo_score INTEGER, site_ok INTEGER,
  has_facebook INTEGER, has_instagram INTEGER, has_linkedin INTEGER, has_tiktok INTEGER,
  running_ads INTEGER, fb_followers TEXT,
  google_rank INTEGER, indexed_pages TEXT,
  stage TEXT DEFAULT 'new',
  score INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT, event TEXT, detail TEXT,
  level TEXT DEFAULT 'info',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT, intent TEXT,
  payload TEXT, status TEXT DEFAULT 'queued',
  result TEXT, attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT, pattern TEXT, correction TEXT,
  hits INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, email TEXT, syntax_ok INTEGER, mx_ok INTEGER, smtp_ok INTEGER,
  disposable INTEGER, verdict TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS site_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, reachable INTEGER, status_code INTEGER, tech TEXT,
  mobile_friendly INTEGER, has_ssl INTEGER, load_hint_ms INTEGER,
  socials TEXT, title TEXT, meta_description TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function emit(agent, event, detail = '', level = 'info') {
  db.prepare('INSERT INTO agent_events (agent, event, detail, level) VALUES (?,?,?,?)')
    .run(agent, event, String(detail).slice(0, 500), level);
  console.log(`[${agent}] ${event} ${detail}`);
}

module.exports = { db, emit, DB_PATH };
