// ScrapCRM — SEO Expert Agent (commerce-aware, B2B + B2C): on-page scoring 0-100
const { db, emit } = require('../db');
const { nextTask, completeTask } = require('../ceo');

// B2C commerce keywords vs B2B keywords
const B2C = ['shop', 'buy', 'order', 'cart', 'price', 'shipping', 'delivery', 'discount', 'sale', 'free shipping', 'cash on delivery'];
const B2B = ['wholesale', 'bulk', 'b2b', 'distributor', 'supplier', 'partnership', 'enterprise', 'quote', 'rfq', 'case study'];

function scoreSite(html) {
  const checks = [];
  const add = (name, ok, weight, note) => checks.push({ name, ok, weight, note });

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  add('title-length', title.length >= 15 && title.length <= 65, 10, `${title.length} chars`);
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
  add('meta-description', metaDesc.length >= 50 && metaDesc.length <= 165, 10, `${metaDesc.length} chars`);
  add('h1-present', /<h1[^>]*>/i.test(html), 10);
  add('viewport-mobile', /viewport/i.test(html), 10);
  add('structured-data', /application\/ld\+json/i.test(html), 12, 'schema.org JSON-LD');
  add('og-tags', /property=["']og:/i.test(html), 6);
  add('canonical', /rel=["']canonical["']/i.test(html), 5);
  add('ssl-or-https-links', !/http:\/\//i.test(html.replace(/https:\/\//g, '')), 7, 'no mixed http content');
  add('alt-texts', !/<img(?![^>]*alt=)[^>]*>/i.test(html.slice(0, 50000)), 8);

  const lower = html.toLowerCase();
  const b2cHits = B2C.filter(k => lower.includes(k)).length;
  const b2bHits = B2B.filter(k => lower.includes(k)).length;
  const commerceType = b2cHits > b2bHits ? 'B2C' : b2bHits > b2cHits ? 'B2B' : 'unknown';
  add('commerce-signals', b2cHits + b2bHits >= 3, 12, `type=${commerceType} b2c=${b2cHits} b2b=${b2bHits}`);
  add('social-proof', /testimonial|review|rating/i.test(lower), 5);
  add('cta-present', /add to cart|contact us|get started|book now|request a quote|buy now/i.test(lower), 5);

  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const gaps = checks.filter(c => !c.ok).map(c => `${c.name}${c.note ? ` (${c.note})` : ''}`);
  return { score, gaps, commerceType, title, metaDesc };
}

async function runAudit(task) {
  const { leadId, url } = JSON.parse(task.payload);
  emit('seo-expert', 'analyzing', url);
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' }, redirect: 'follow' });
    const html = await res.text();
    const r = scoreSite(html);

    db.prepare("UPDATE leads SET seo_score=?, stage=CASE WHEN stage IN ('new','audited') THEN 'enriched' ELSE stage END, updated_at=datetime('now') WHERE id=?")
      .run(r.score, leadId);
    completeTask(task.id, `SEO ${r.score}/100 (${r.commerceType})`);
    emit('seo-expert', 'score', `${url} → ${r.score}/100 [${r.commerceType}] gaps: ${r.gaps.slice(0,3).join('; ') || 'none'}`,
         r.score >= 70 ? 'success' : 'warn');
  } catch (e) {
    completeTask(task.id, `failed: ${e.message}`);
    emit('seo-expert', 'failed', `${url}: ${e.message}`, 'error');
  }
}

function startWorker() {
  async function tick() {
    try {
      const t = nextTask('seo-expert');
      if (t) await runAudit(t);
    } catch (e) { emit('seo-expert', 'worker error', e.message, 'error'); }
    setTimeout(tick, 5000);
  }
  tick();
}

module.exports = { startWorker };
