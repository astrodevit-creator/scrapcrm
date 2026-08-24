// ScrapCRM — Google Ranking Agent: brand rank + site: index count (rate-limited, cached)
const { db, emit } = require('../db');
const { nextTask, completeTask } = require('../ceo');
const { learn } = require('../lessons');

const lastRun = { ts: 0 };
const MIN_GAP_MS = 8000; // rate limit between Google queries

async function googleSearch(q) {
  // respect rate limit
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRun.ts));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastRun.ts = Date.now();
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&hl=en`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept-Language': 'en' },
    });
    return await res.text();
  } catch (e) {
    learn('google-ranking', 'google-fetch-fail', 'mark result uncertain; retry later with backoff');
    return null;
  }
}

// Parse organic result positions: match domain in result links
function findRank(html, domain) {
  if (!html) return null;
  const re = /href="(https?:\/\/[^"]*?)"[^>]*>/g;
  let m, pos = 0;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/google\./.test(u)) continue;
    pos++;
    try { if (new URL(u).hostname.replace(/^www\./, '') === domain) return pos; } catch {}
  }
  return null; // not in top results
}

function extractIndexCount(html) {
  if (!html) return null;
  const m = html.match(/About ([\d,.]+) results|([\d,.]+) results/i);
  return m ? (m[1] || m[2]) : null;
}

async function runCheck(task) {
  const { leadId, url, name } = JSON.parse(task.payload);
  let domain;
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { domain = url; }
  const brand = name || domain.split('.')[0];
  emit('google-ranking', 'checking', `${brand} (${domain})`);

  const html = await googleSearch(brand);
  const rank = findRank(html, domain);

  const idxHtml = await googleSearch(`site:${domain}`);
  const indexed = extractIndexCount(idxHtml);

  db.prepare("UPDATE leads SET google_rank=?, indexed_pages=?, updated_at=datetime('now') WHERE id=?")
    .run(rank, indexed ? String(indexed) : null, leadId);
  completeTask(task.id, `rank=${rank || '>20'} index=${indexed || '?'}`);
  emit('google-ranking', 'result',
       `${brand}: ${rank ? `position #${rank}` : 'not in top 20 — SEO opportunity'}${indexed ? `, ~${indexed} pages indexed` : ''}`,
       rank && rank <= 10 ? 'success' : 'warn');
}

function startWorker() {
  async function tick() {
    try {
      const t = nextTask('google-ranking');
      if (t) await runCheck(t);
    } catch (e) { emit('google-ranking', 'worker error', e.message, 'error'); }
    setTimeout(tick, 9000);
  }
  tick();
}

module.exports = { startWorker };
