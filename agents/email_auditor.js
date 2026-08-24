// ScrapCRM — Email Auditor Agent: syntax → MX → SMTP RCPT probe (never sends)
const dns = require('dns').promises;
const net = require('net');
const { db, emit } = require('../db');
const { nextTask, completeTask, failTask } = require('../ceo');
const { learn } = require('../lessons');

const DISPOSABLE = new Set(['mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'yopmail.com']);

function syntaxOk(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}

async function mxOk(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return mx && mx.length > 0 ? mx[0].exchange : null;
  } catch { return null; }
}

// SMTP RCPT probe: connect, HELO, MAIL FROM empty, RCPT TO target — read code only, never DATA
function smtpProbe(host, email, timeoutMs = 12000) {
  return new Promise(resolve => {
    let result = 'unknown';
    const sock = net.createConnection(25, host);
    sock.setTimeout(timeoutMs);
    let step = 0;
    const send = s => { if (s) sock.write(s + '\r\n'); };
    sock.on('data', chunk => {
      const code = parseInt(chunk.toString().slice(0, 3), 10);
      if (step === 0) { if (code === 220) send('HELO scrapcrm.audit'); else done(); step = 1; }
      else if (step === 1) { if (code === 250) send('MAIL FROM:<audit@scrapcrm.local>'); else done(); step = 2; }
      else if (step === 2) { if (code === 250) send(`RCPT TO:<${email}>`); else done(); step = 3; }
      else if (step === 3) {
        if (code === 250) result = 'valid';
        else if ([550, 551, 553].includes(code)) result = 'dead';
        else result = 'risky';
        done();
      }
    });
    function done() { try { sock.quit(); } catch {} resolve(result); }
    sock.on('timeout', () => { try { sock.destroy(); } catch {} resolve('unknown'); });
    sock.on('error', e => {
      learn('email-auditor', `smtp-block:${host}`, 'ISP blocks port 25 — fall back to MX-only verdict');
      resolve('unknown');
    });
  });
}

async function runCheck(task) {
  const { leadId, email } = JSON.parse(task.payload);
  if (!email) { completeTask(task.id, 'no email'); return; }
  emit('email-auditor', 'auditing', email);

  const syntax = syntaxOk(email);
  const domain = email.split('@')[1];
  const disposable = DISPOSABLE.has(domain.toLowerCase());
  const mx = await mxOk(domain);

  let verdict = 'dead';
  let smtpResult = null;
  const BIGPROVIDER = /^(gmail.com|googlemail.com|yahoo.|hotmail.|outlook.|icloud.com|live.|aol.com|protonmail.com|zoho.com)/i;
  if (syntax && mx && BIGPROVIDER.test(domain)) {
    verdict = disposable ? 'risky' : 'valid'; // big providers don't accept probes; MX ok = deliverable
    smtpResult = 'provider';
  } else if (syntax && mx) {
    smtpResult = await smtpProbe(mx, email);
    verdict = smtpResult !== 'unknown' ? smtpResult : (disposable ? 'risky' : 'risky');
  }

  db.prepare(`INSERT INTO email_checks (lead_id, email, syntax_ok, mx_ok, smtp_ok, disposable, verdict, detail)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(leadId, email, syntax ? 1 : 0, mx ? 1 : 0,
         smtpResult === 'valid' ? 1 : 0, disposable ? 1 : 0, verdict,
         `mx=${mx || 'none'} smtp=${smtpResult || 'n/a'}`);
  db.prepare("UPDATE leads SET email_verdict=?, updated_at=datetime('now') WHERE id=?").run(verdict, leadId);
  completeTask(task.id, `${email} → ${verdict}`);
  emit('email-auditor', 'verdict', `${email} → ${verdict.toUpperCase()}`, verdict === 'valid' ? 'success' : 'warn');
}

function startWorker() {
  async function tick() {
    try {
      const t = nextTask('email-auditor');
      if (t) await runCheck(t);
    } catch (e) { emit('email-auditor', 'worker error', e.message, 'error'); }
    setTimeout(tick, 4000);
  }
  tick();
}

module.exports = { startWorker };
