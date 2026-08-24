// ScrapCRM — Scraper Agent pool: discover leads, escalate to Scrapling on anti-bot
const { db, emit } = require('../db');
const { submit, nextTask, completeTask, failTask } = require('../ceo');
const { learn } = require('../lessons');
const { spawn } = require('child_process');
const path = require('path');

// Extract emails/phones/socials from raw HTML
function extractFromHtml(html, baseUrl) {
  const out = { name: '', email: null, phone: null, socials: {} };
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) out.name = title[1].replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'\"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim().slice(0, 120);
  // skip giant brands — not realistic prospects for outreach
  const BIG = /(lululemon|adidas|nike|sephora|zara|h&m|asos|next.decathlon|decathlon|ikea|apple)/i;
  out.isBig = BIG.test(html.slice(0, 3000)) || BIG.test(baseUrl);
  const em = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g);
  if (em) out.email = em.find(e => !/\.(png|jpg|webp|gif|css|js)/i.test(e)) || null;
  const ph = html.match(/(?:\+212|00212|\+971|\+966|\+974|\+965|\+973|\+968|\+44|)\s?[\d][\d\s().-]{7,14}\d/g);
  if (ph) out.phone = ph[0].trim();
  const fb = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/i);
  if (fb) out.socials.facebook = fb[0];
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i);
  if (ig) out.socials.instagram = ig[0];
  const li = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._-]+/i);
  if (li) out.socials.linkedin = li[0];
  const tt = html.match(/https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._-]+/i);
  if (tt) out.socials.tiktok = tt[0];
  return out;
}

// Plain fetch with timeout
async function plainFetch(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' }, redirect: 'follow' });
    const html = await res.text();
    clearTimeout(t);
    return { ok: true, status: res.status, html };
  } catch (e) {
    clearTimeout(t);
    // detect anti-bot-ish failures for lesson learning
    learn('scraper', `fetch-fail:${new URL(url).hostname}`, 'escalate to Scrapling stealth fetcher');
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 200) };
  }
}

// Scrapling escalation via python venv script
async function scraplingFetch(url) {
  return new Promise(resolve => {
    const py = path.join(process.env.SCRAPLING_PY || 'C:/Users/telba/.scrapling-venv/Scripts/python.exe');
    const proc = spawn(py, ['-c', `
import json
from scrapling.fetchers import Fetcher
try:
    r = Fetcher.get(${JSON.stringify(url)})
    print(json.dumps({"ok": True, "status": r.status, "html": r.html_content[:500000]}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)[:300]}))
`], { windowsHide: true });
    let buf = '';
    proc.stdout.on('data', d => buf += d);
    proc.on('close', () => {
      try {
        const line = buf.trim().split('\n').find(l => l.startsWith('{'));
        resolve(line ? JSON.parse(line) : { ok: false, error: 'no output' });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
    setTimeout(() => { proc.kill(); resolve({ ok: false, error: 'timeout' }); }, 60000);
  });
}

async function runScrapeTask(task) {
  const payload = JSON.parse(task.payload);
  const url = payload.url;
  emit('scraper', 'scraping', url);

  let res = await plainFetch(url);
  if (!res.ok || /cloudflare|captcha|access denied|just a moment/i.test(res.html || '')) {
    emit('scraper', 'anti-bot detected', `${url} → escalating to Scrapling`, 'warn');
    res = await scraplingFetch(url);
  }

  if (!res.ok || !res.html) {
    failTask(task.id, res.error || 'no html');
    learn('scraper', `domain-blocked:${new URL(url).hostname}`, 'CEO should skip this domain in future runs');
    emit('scraper', 'failed', `${url}: ${res.error || 'blocked'}`, 'error');
    return;
  }

  const data = extractFromHtml(res.html, url);
  // reject junk pages (anti-bot interstitials, errors)
  const junk = /^(just a moment|403|access denied|attention required|security check|you are being redirected|select your country|error|not found|captcha|redirecting|here wego|vercel|example domain|.*business database)/i;
  if (data.isBig || (!data.email && (!data.name || junk.test(data.name)))) {
    completeTask(task.id, 'skipped junk page');
    learn('scraper', 'junk-page', 'page was an anti-bot/error page — no lead created');
    emit('scraper', 'skipped', url + ' (junk page, no data)', 'warn');
    return;
  }
  completeTask(task.id, `extracted ${data.name || url}`);

  // Upsert lead
  const existing = data.email && db.prepare('SELECT id FROM leads WHERE email=?').get(data.email);
  if (existing) {
    db.prepare("UPDATE leads SET website=COALESCE(?,website), phone=COALESCE(?,phone), updated_at=datetime('now') WHERE id=?")
      .run(url, data.phone, existing.id);
    emit('scraper', 'lead updated', `${data.name || url}`, 'success');
    return;
  }
  db.prepare(`INSERT INTO leads (name, website, email, phone, source, niche)
              VALUES (?,?,?,?,?,?)`)
    .run(data.name || new URL(url).hostname, url, data.email, data.phone, 'scraper', payload.niche || '');
  emit('scraper', 'new lead', `${data.name || url}${data.email ? ' <' + data.email + '>' : ''}`, 'success');
}

// Worker loop
function startWorker() {
  async function tick() {
    try {
      const t = nextTask('scraper'); // CEO routes all scraping to 'scraper' queue
      if (t) await runScrapeTask(t);
    } catch (e) { emit('scraper', 'worker error', e.message, 'error'); }
    setTimeout(tick, 3000);
  }
  tick();
}

module.exports = { startWorker, submit };
