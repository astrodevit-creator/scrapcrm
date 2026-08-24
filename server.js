// ScrapCRM — Express API server (embedded in Electron main process)
const express = require('express');
const path = require('path');
const dns = require('dns').promises;
const { db, emit, DB_PATH } = require('./db');

// ---- Security helpers ----
// SSRF guard: only public http(s) URLs; block private/loopback/link-local targets
async function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('invalid url'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('http(s) only');
  const host = u.hostname;
  // literal IPs
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc|\[fd)/i.test(host)) throw new Error('private addresses not allowed');
  // resolve and check all records
  try {
    const addrs = await dns.lookup(host.replace(/^\[|\]$/g, ''), { all: true });
    for (const a of addrs) {
      const ip = a.address;
      if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1|f[cd][0-9a-f]{2}:)/i.test(ip)) throw new Error('resolves to private IP');
    }
  } catch (e) {
    if (/private IP/.test(e.message)) throw e;
    throw new Error('cannot resolve host');
  }
  return u.toString();
}

function safeStr(v, max = 300) {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, max);
}

function createServer(port = 8899) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' })); // size cap
  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'");
    next();
  });
  app.use(express.static(path.join(__dirname, 'ui')));

  // ---- Agents ----
  const AGENTS = [
    { id: 'ceo', name: 'CEO Agent', desc: 'Coordinates all agents, approves every task' },
    { id: 'scraper', name: 'Scraper', desc: 'Discovers & extracts leads (Scrapling anti-bot fallback)' },
    { id: 'email-auditor', name: 'Email Auditor', desc: 'Syntax → MX → SMTP probe. VALID/RISKY/DEAD' },
    { id: 'website-analyzer', name: 'Website Analyzer', desc: 'Reachability, tech stack, mobile, SSL, socials' },
    { id: 'seo-expert', name: 'SEO Expert', desc: 'Commerce-aware on-page scoring (B2B/B2C), 0-100' },
    { id: 'social-ads', name: 'Social & Ads Expert', desc: 'FB page, Meta pixel, Ads Library presence' },
    { id: 'google-ranking', name: 'Google Ranking', desc: 'Brand rank position + site: index count' },
    { id: 'discovery', name: 'Discovery Agent', desc: 'Finds business sites worldwide: Morocco, GCC, UK, Europe, USA, Singapore' },
    { id: 'learning', name: 'Self-Learning Engine', desc: 'Records mistakes as lessons; agents adapt' },
  ];

  app.get('/api/agents', (req, res) => {
    const rows = AGENTS.map(a => {
      const last = db.prepare('SELECT event, detail, level, created_at FROM agent_events WHERE agent=? ORDER BY id DESC LIMIT 1').get(a.id) || null;
      const count = db.prepare('SELECT COUNT(*) n FROM agent_events WHERE agent=?').get(a.id).n;
      return { ...a, events: count, last };
    });
    res.json(rows);
  });

  app.get('/api/events', (req, res) => {
    const agent = req.query.agent;
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const rows = agent
      ? db.prepare('SELECT * FROM agent_events WHERE agent=? ORDER BY id DESC LIMIT ?').all(agent, limit)
      : db.prepare('SELECT * FROM agent_events ORDER BY id DESC LIMIT ?').all(limit);
    res.json(rows);
  });

  // ---- Leads ----
  app.get('/api/leads', (req, res) => {
    let sql = 'SELECT * FROM leads';
    const cond = [], params = [];
    if (req.query.stage) { cond.push('stage=?'); params.push(req.query.stage); }
    if (req.query.q) { cond.push('(name LIKE ? OR website LIKE ? OR email LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY score DESC, id DESC LIMIT 500';
    res.json(db.prepare(sql).all(...params));
  });

  app.get('/api/leads/:id', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'not found' });
    lead.email_checks = db.prepare('SELECT * FROM email_checks WHERE lead_id=? ORDER BY id DESC').all(lead.id);
    lead.site_audits = db.prepare('SELECT * FROM site_audits WHERE lead_id=? ORDER BY id DESC').all(lead.id);
    res.json(lead);
  });

  app.post('/api/leads/:id/stage', (req, res) => {
    const STAGES = ['new','audited','enriched','qualified','contacted','dead'];
    const stage = STAGES.includes(req.body.stage) ? req.body.stage : null;
    const id = parseInt(req.params.id);
    if (!stage || !Number.isInteger(id)) return res.status(400).json({ error: 'invalid stage or id' });
    db.prepare("UPDATE leads SET stage=?, updated_at=datetime('now') WHERE id=?").run(stage, id);
    emit('ceo', 'stage change', `lead #${id} → ${stage}`);
    res.json({ ok: true });
  });

  app.post('/api/leads/:id/notes', (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    db.prepare("UPDATE leads SET notes=?, updated_at=datetime('now') WHERE id=?").run(safeStr(req.body.notes, 2000), id);
    res.json({ ok: true });
  });

  // Manual add lead
  app.post('/api/leads', (req, res) => {
    const { name, website, email } = req.body;
    if (!website && !email) return res.status(400).json({ error: 'website or email required' });
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ error: 'invalid email' });
    if (website && !/^https?:\/\/[^\s]+$/i.test(website) && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(website)) return res.status(400).json({ error: 'invalid website' });
    const r = db.prepare('INSERT INTO leads (name, website, email, source) VALUES (?,?,?,?)')
      .run(safeStr(name || website, 200), safeStr(website, 300) || null, safeStr(email, 200) || null, 'manual');
    emit('ceo', 'manual lead added', safeStr(name || website, 100), 'success');
    res.json({ id: r.lastInsertRowid });
  });

  // Add scrape seed URL (SSRF-guarded)
  app.post('/api/scrape', async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    try {
      const safe = await assertSafeUrl(url);
      const { submit } = require('./agents/scraper');
      submit('scraper', 'scrape url', { url: safe });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: 'blocked: ' + e.message });
    }
  });

  // ---- Lessons ----
  app.get('/api/lessons', (req, res) => {
    res.json(db.prepare('SELECT * FROM lessons ORDER BY hits DESC, id DESC LIMIT 100').all());
  });

  // ---- Stats ----
  app.get('/api/stats', (req, res) => {
    res.json({
      leads: db.prepare('SELECT COUNT(*) n FROM leads').get().n,
      valid_emails: db.prepare("SELECT COUNT(*) n FROM leads WHERE email_verdict='valid'").get().n,
      avg_seo: db.prepare('SELECT AVG(seo_score) a FROM leads WHERE seo_score IS NOT NULL').get().a,
      opportunities: db.prepare('SELECT COUNT(*) n FROM leads WHERE score >= 60').get().n,
      lessons: db.prepare('SELECT COUNT(*) n FROM lessons').get().n,
      tasks: db.prepare('SELECT status, COUNT(*) n FROM tasks GROUP BY status').all(),
      db_path: DB_PATH,
    });
  });

  // CSV export
  app.get('/api/export.csv', (req, res) => {
    const leads = db.prepare('SELECT * FROM leads ORDER BY score DESC').all();
    const cols = ['id','name','website','email','phone','email_verdict','seo_score','site_ok','has_facebook','has_instagram','running_ads','google_rank','indexed_pages','stage','score','notes'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...leads.map(l => cols.map(c => esc(l[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=scrapcrm-leads.csv');
    res.send(csv);
  });

  return app.listen(port, '127.0.0.1', () => emit('ceo', 'system online', `API+UI on http://localhost:${port} (localhost only) — db: ${DB_PATH}`, 'success'));
}

module.exports = { createServer };

if (require.main === module) {
  createServer();
  require('./orchestrator').startWatcher();
  require('./agents/scraper').startWorker();
  require('./agents/email_auditor').startWorker();
  require('./agents/website_analyzer').startWorker();
  require('./agents/seo_expert').startWorker();
  require('./agents/social_ads').startWorker();
  require('./agents/google_ranking').startWorker();
  require('./agents/discovery').startDiscovery();
}
