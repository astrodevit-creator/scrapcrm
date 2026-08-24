// ScrapCRM — Discovery Agent: finds business websites worldwide via search
// Coverage: Morocco, GCC (Qatar/Bahrain/Saudi/UAE/Kuwait/Oman), UK, Europe, USA, Singapore
const { emit } = require('../db');
const { submit } = require('../ceo');
const { learn, getLessons } = require('../lessons');

const COUNTRIES = {
  morocco:   { tld: '.ma', queries: ['boutique en ligne {n} maroc', 'e-commerce {n} maroc', 'société {n} casablanca'] },
  uae:       { tld: '.ae', queries: ['online store {n} dubai', '{n} shop uae', 'best {n} brands abu dhabi'] },
  saudi:     { tld: '.sa', queries: ['متجر {n} السعودية', 'online store {n} riyadh', '{n} shop saudi arabia'] },
  qatar:     { tld: '.qa', queries: ['online store {n} doha', '{n} shop qatar'] },
  bahrain:   { tld: '.bh', queries: ['online store {n} bahrain', '{n} shop manama'] },
  kuwait:    { tld: '.kw', queries: ['online store {n} kuwait', '{n} shop kuwait'] },
  uk:        { tld: '.co.uk', queries: ['online {n} shop uk', 'independent {n} brand london', '{n} store manchester'] },
  usa:       { tld: '.com', queries: ['online {n} store usa', 'small {n} brand new york', '{n} boutique los angeles'] },
  singapore: { tld: '.sg', queries: ['online {n} shop singapore', '{n} store singapore'] },
  europe:    { tld: '.eu', queries: ['online {n} shop germany', 'boutique {n} france', 'webshop {n} netherlands'] },
};

// niches Hatim sells to (DTC consumer brands)
const NICHES = process.env.SCRAPCRM_NICHES
  ? JSON.parse(process.env.SCRAPCRM_NICHES)
  : ['skincare', 'coffee', 'golf', 'padel', 'jewelry', 'activewear', 'pet supplies', 'perfume'];

const lastSearch = { ts: 0 };
const MIN_GAP = 6000;

async function ddgSearch(q) {
  const wait = Math.max(0, MIN_GAP - (Date.now() - lastSearch.ts));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastSearch.ts = Date.now();
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
          });
    return await res.text();
  } catch (e) {
    learn('discovery', 'ddg-fail', 'backoff and retry next cycle; results skipped this round');
    return null;
  }
}

// Extract external result URLs from DDG html endpoint
function extractResults(html) {
  if (!html) return [];
  const urls = new Set();
  const re = /uddg=([^&"]+)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = decodeURIComponent(m[1]);
      const host = new URL(u).hostname.replace(/^www\./, '');
      // skip big platforms/junk — we want actual business sites
      if (/facebook|instagram|tiktok|linkedin|youtube|amazon|wikipedia|reddit|pinterest|x\.com|twitter|tripadvisor|yelp|google|duckduckgo|medium|quora|trustpilot/.test(host)) continue;
      if (/\.(pdf|jpg|png)$/i.test(u)) continue;
      // skip directories/blogs/aggregators — we want actual businesses
      if (/wanderlog|explore[a-z]*\.|top-?\d|best-?\d|blog|magazine|confidential|weekly|guide|directory|timeout|thingstodo|-tours|hotels?\.|travel/.test(host)) continue;
      urls.add('https://' + host);
    } catch {}
  }
  return [...urls].slice(0, 8); // cap per query
}

async function discoverCycle() {
  const countries = Object.entries(COUNTRIES);
  const country = countries[Math.floor(Math.random() * countries.length)];
  const [cname, c] = country;
  const niche = NICHES[Math.floor(Math.random() * NICHES.length)];
  const qtpl = c.queries[Math.floor(Math.random() * c.queries.length)];
  const q = qtpl.replace('{n}', niche);

  emit('discovery', 'searching', `${cname}/${niche}: ${q}`);
  const html = await ddgSearch(q);
  const found = extractResults(html);

  let queued = 0;
  for (const url of found) {
    const exists = global.__scrapcrmDbCheck ? await global.__scrapcrmDbCheck(url) : null;
    const id = submit('scraper', 'scrape url', { url, niche: `${niche}/${cname}` });
    if (id) queued++;
  }
  emit('discovery', 'cycle done', `${found.length} sites found, ${queued} queued (${cname}/${niche})`, found.length ? 'success' : 'warn');
}

function startDiscovery(intervalMs = 45000) {
  // heartbeat so the UI card always shows liveness between searches
  setInterval(() => {
    const countries = Object.keys(COUNTRIES);
    emit('discovery', 'heartbeat', `active — watching ${Object.keys(COUNTRIES).length} markets, niches: ${NICHES.slice(0, 3).join(', ')}…`);
  }, 30000);
  // honor lessons: skip if too many recent failures
  async function tick() {
    try { await discoverCycle(); } catch (e) { emit('discovery', 'error', e.message, 'error'); }
    setTimeout(tick, intervalMs);
  }
  tick();
}

module.exports = { startDiscovery, COUNTRIES, NICHES };
