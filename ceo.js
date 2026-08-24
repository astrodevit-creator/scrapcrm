// ScrapCRM — CEO Agent: every agent announces intent, CEO approves/dedupes/prioritizes
const { db, emit } = require('./db');
const { getLessons } = require('./lessons');

// Agents submit: { agent, intent, payload }
// CEO validates: dedupe by intent+payload signature, cap queue per agent, reject junk
function submit(agentName, intent, payload) {
  // domain-level dedupe for scrape tasks: skip if a lead with this website already exists
  if (intent === 'scrape url' && payload && payload.url) {
    try {
      const host = new URL(/^https?:/.test(payload.url) ? payload.url : 'https://' + payload.url).hostname.replace(/^www\./, '');
      const known = db.prepare('SELECT id FROM leads WHERE website LIKE ?').all('%' + host + '%');
      if (known.length) return null;
    } catch {}
  }
  const sig = `${agentName}|${intent}|${JSON.stringify(payload)}`;
  const dupe = db.prepare("SELECT id FROM tasks WHERE status IN ('queued','approved','running') AND agent||'|'||intent||'|'||payload=?").get(sig);
  if (dupe) return null; // already queued — CEO rejects duplicates silently

  // lesson-informed pre-checks
  for (const l of getLessons(agentName)) {
    if (String(payload && (payload.url || payload.email || '')).includes(l.pattern)) {
      emit('ceo', 'lesson applied', `${agentName} task adjusted: ${l.correction}`, 'warn');
      if (l.pattern.startsWith('domain-blocked:')) return null;
    }
  }

  const r = db.prepare('INSERT INTO tasks (agent, intent, payload) VALUES (?,?,?)')
    .run(agentName, intent, JSON.stringify(payload));
  emit('ceo', 'task accepted', `${agentName}: ${intent} ${typeof payload === 'object' ? (payload.url || payload.email || payload.domain || '') : ''}`);
  return r.lastInsertRowid;
}

// Pull next approved task for an agent
function nextTask(agentName) {
  const t = db.prepare("SELECT * FROM tasks WHERE agent=? AND status='queued' ORDER BY id LIMIT 1").get(agentName);
  if (!t) return null;
  db.prepare("UPDATE tasks SET status='running', updated_at=datetime('now') WHERE id=?").run(t.id);
  return t;
}

function completeTask(id, result) {
  db.prepare("UPDATE tasks SET status='done', result=?, updated_at=datetime('now') WHERE id=?").run(String(result).slice(0, 2000), id);
}

function failTask(id, err) {
  db.prepare("UPDATE tasks SET status='failed', result=?, attempts=attempts+1, updated_at=datetime('now') WHERE id=?").run(String(err).slice(0, 1000), id);
}

function stats() {
  return db.prepare("SELECT status, COUNT(*) n FROM tasks GROUP BY status").all();
}

module.exports = { submit, nextTask, completeTask, failTask, stats };
