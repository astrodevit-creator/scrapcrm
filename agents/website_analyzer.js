// ScrapCRM — Website Analyzer Agent: reachability, tech, mobile, SSL, socials
const { db, emit } = require('../db');
const { nextTask, completeTask } = require('../ceo');

async function runAudit(task) {
  const { leadId, url } = JSON.parse(task.payload);
  emit('website-analyzer', 'auditing', url);
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' }, redirect: 'follow' });
    const html = await res.text();
    const ms = Date.now() - started;
    const finalUrl = res.url || url;

    const tech = [];
    if (/wp-content|wordpress/i.test(html)) tech.push('WordPress');
    if (/shopify/i.test(html)) tech.push('Shopify');
    if (/_next\/static/i.test(html)) tech.push('Next.js');
    if (/react/i.test(html)) tech.push('React');
    if (/woocommerce/i.test(html)) tech.push('WooCommerce');
    if (/prestashop/i.test(html)) tech.push('PrestaShop');
    if (/wix\.com|wixstatic/i.test(html)) tech.push('Wix');
    if (/squarespace/i.test(html)) tech.push('Squarespace');

    const socials = {};
    for (const [k, re] of Object.entries({
      facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/i,
      instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+/i,
      linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._-]+/i,
      tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._-]+/i,
    })) {
      const m = html.match(re);
      if (m) socials[k] = m[0];
    }

    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
    const mobile = /viewport/i.test(html) ? 1 : 0;
    const ssl = finalUrl.startsWith('https') ? 1 : 0;

    db.prepare(`INSERT INTO site_audits (lead_id, reachable, status_code, tech, mobile_friendly, has_ssl, load_hint_ms, socials, title, meta_description)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(leadId, 1, res.status, tech.join(',') || 'unknown', mobile, ssl, ms, JSON.stringify(socials), title.slice(0,200), metaDesc.slice(0,300));
    db.prepare(`UPDATE leads SET site_ok=1, has_facebook=?, has_instagram=?, has_linkedin=?, has_tiktok=?,
                stage=CASE WHEN stage='new' THEN 'audited' ELSE stage END, updated_at=datetime('now') WHERE id=?`)
      .run(socials.facebook ? 1 : 0, socials.instagram ? 1 : 0, socials.linkedin ? 1 : 0, socials.tiktok ? 1 : 0, leadId);

    completeTask(task.id, `${url} OK ${res.status} ${tech.join(',')}`);
    emit('website-analyzer', 'audit done', `${url} — ${res.status}, ${tech.join(',')||'unknown'}, ${ms}ms`, 'success');
  } catch (e) {
    db.prepare(`INSERT INTO site_audits (lead_id, reachable, detail) VALUES (?,0,?)`).run(leadId, String(e.message).slice(0,300));
    db.prepare("UPDATE leads SET site_ok=0, updated_at=datetime('now') WHERE id=?").run(leadId);
    completeTask(task.id, `${url} unreachable`);
    emit('website-analyzer', 'unreachable', `${url}: ${e.message}`, 'warn');
  }
}

function startWorker() {
  async function tick() {
    try {
      const t = nextTask('website-analyzer');
      if (t) await runAudit(t);
    } catch (e) { emit('website-analyzer', 'worker error', e.message, 'error'); }
    setTimeout(tick, 4000);
  }
  tick();
}

module.exports = { startWorker };
