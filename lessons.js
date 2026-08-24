// ScrapCRM — Lessons engine (self-learning from mistakes)
const { db, emit } = require('./db');

// Record a lesson: pattern -> correction for an agent
function learn(agent, pattern, correction) {
  // dedupe: same agent+pattern increments hits and refreshes correction
  const existing = db.prepare('SELECT id FROM lessons WHERE agent=? AND pattern=?').get(agent, pattern);
  if (existing) {
    db.prepare('UPDATE lessons SET correction=?, hits=hits+1 WHERE id=?').run(correction, existing.id);
    return existing.id;
  }
  const r = db.prepare('INSERT INTO lessons (agent, pattern, correction) VALUES (?,?,?)')
    .run(agent, pattern, correction);
  emit('learning', 'lesson recorded', `${agent}: ${pattern} → ${correction}`, 'success');
  return r.lastInsertRowid;
}

// Get top relevant lessons for an agent before a run
function getLessons(agent, limit = 20) {
  return db.prepare('SELECT * FROM lessons WHERE agent=? ORDER BY hits DESC, id DESC LIMIT ?').all(agent, limit);
}

// Called when an agent successfully applies a lesson
function hit(lessonId) {
  if (lessonId) db.prepare('UPDATE lessons SET hits=hits+1 WHERE id=?').run(lessonId);
}

module.exports = { learn, getLessons, hit };
