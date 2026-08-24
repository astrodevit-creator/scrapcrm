// ScrapCRM — Social/Facebook + Ads Expert Agent: FB presence, Ads Library, pixel detection
const { db, emit } = require('../db');
const { nextTask, completeTask } = require('../ceo');

async function fetchText(url, timeout = 12000) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' }, redirect: 'follow' });
    return { status: res.status, text: await res.text() };
  } catch (e) { return { status: 0, text: '', error: e.message }; }
}

async function runCheck(task) {
  const { leadId, url, name } = JSON.parse(task.payload);
  emit('social-ads', 'checking', `${name || url}`);
  let fbPage = null, runningAds = null, pixel = false;

  // 1. fetch site for pixel detection + social links (reuse audit if present)
  const audit = db.prepare('SELECT socials FROM site_audits WHERE lead_id=? ORDER BY id DESC LIMIT 1').get(leadId);
  if (audit && audit.socials) {
    try {
      const s = JSON.parse(audit.socials);
      fbPage = s.facebook || null;
    } catch {}
  }

  const page = await fetchText(url).catch(() => ({ text: '' }));
  if (!fbPage) {
    const m = page.text.match(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/i);
    if (m) fbPage = m[0];
  }
  pixel = /connect\.facebook\.net|fbq\(|fbevents\.js/i.test(page.text);

  // 2. Facebook page existence check
  let hasFb = 0;
  if (fbPage) {
    const fbRes = await fetchText(fbPage.replace('www.', 'm.'), 10000);
    hasFb = fbRes.status === 200 && !/page isn't available|content isn't available/i.test(fbRes.text) ? 1 : 0;
  }

  // 3. Meta Ads Library public search (no login needed)
  const brand = name || (() => { try { return new URL(url).hostname.replace(/^www\./,'').split('.')[0]; } catch { return ''; } })();
  const adLibUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(brand)}&media_type=all`;
  const adLib = await fetchText(adLibUrl, 15000);
  if (/adsSuggestionNonAdvertised|See all results for/.test(adLib.text)) runningAds = null; // blocked/uncertain
  else if (adLib.status === 200 && /Sponsored|Active ads/i.test(adLib.text)) {
    // crude heuristic: library HTML contains result count markers
    const m = adLib.text.match(/(\d+)\s+result/i);
    runningAds = m ? parseInt(m[1]) > 0 : null;
  }

  // pixel on site is a strong "invests in paid" signal even without library access
  const investsInAds = pixel ? 1 : (runningAds === true ? 1 : 0);

  db.prepare(`UPDATE leads SET has_facebook=COALESCE(?,has_facebook), running_ads=?, updated_at=datetime('now') WHERE id=?`)
    .run(hasFb, investsInAds, leadId);
  completeTask(task.id, `fb=${hasFb} pixel=${pixel} ads=${runningAds}`);
  emit('social-ads', 'result', `${brand}: fb_page=${hasFb ? 'yes' : 'no'}${fbPage ? '' : ' (not found)'}, meta_pixel=${pixel ? 'yes' : 'no'}, running_ads=${runningAds === null ? 'unknown' : runningAds ? 'yes' : 'NO — opportunity'}`,
       !hasFb || runningAds === false ? 'success' : 'info');
}

function startWorker() {
  async function tick() {
    try {
      const t = nextTask('social-ads');
      if (t) await runCheck(t);
    } catch (e) { emit('social-ads', 'worker error', e.message, 'error'); }
    setTimeout(tick, 6000);
  }
  tick();
}

module.exports = { startWorker };
