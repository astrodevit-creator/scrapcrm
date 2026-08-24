// ScrapCRM — Orchestrator: CEO chains enrichment stages per lead + opportunity scoring
const { db, emit } = require('./db');
const { submit } = require('./ceo');

// When a new lead appears, CEO queues the full enrichment chain.
// Each agent announces its intent via submit() — the CEO log is the audit trail.
function enrichLead(lead) {
  if (!lead.website) return;
  let url = lead.website;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  submit('website-analyzer', 'audit site', { leadId: lead.id, url });
  submit('seo-expert', 'score SEO', { leadId: lead.id, url });
  submit('social-ads', 'check social + ads', { leadId: lead.id, url, name: lead.name });
  submit('google-ranking', 'check google rank', { leadId: lead.id, url, name: lead.name });
  if (lead.email) submit('email-auditor', 'verify email', { leadId: lead.id, email: lead.email });
}

// Watch for new leads and queue enrichment once
let lastLeadId = 0;
function startWatcher() {
  const maxRow = db.prepare('SELECT MAX(id) m FROM leads').get();
  lastLeadId = maxRow && maxRow.m ? maxRow.m : 0;

  setInterval(() => {
    const rows = db.prepare('SELECT * FROM leads WHERE id > ?').all(lastLeadId);
    for (const lead of rows) {
      emit('ceo', 'new lead detected', `#${lead.id} ${lead.name} — dispatching enrichment chain`, 'success');
      enrichLead(lead);
      lastLeadId = lead.id;
    }
  }, 5000);
}

// Recompute opportunity score: no social, no ads, bad SEO = high opportunity
setInterval(() => {
  const leads = db.prepare("SELECT * FROM leads WHERE stage != 'contacted'").all();
  for (const l of leads) {
    let s = 0;
    if (l.site_ok === 0) s += 20;                       // no site = needs one
    if (l.seo_score !== null && l.seo_score < 60) s += 25;
    if (!l.has_facebook) s += 15;
    if (!l.has_instagram) s += 5;
    if (l.running_ads === 0) s += 20;                   // no ads = we can run ads for them
    if (l.google_rank === null || l.google_rank > 10) s += 15;
    s = Math.min(100, s);
    if (s !== l.score) db.prepare("UPDATE leads SET score=? WHERE id=?").run(s, l.id);
  }
}, 15000);

module.exports = { startWatcher };
