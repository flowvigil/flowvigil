// api/reddit-monitor.js v2
// Monitors Reddit for relevant posts — optimised for Vercel's 60s limit
// Uses subreddit multi-search to reduce API calls from 60+ to 10

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;

// ─── CONFIG ────────────────────────────────────────────────────────────────

// Search across all subreddits in ONE call using multireddit syntax
const SUBREDDIT_MULTI = 'zapier+nocode+automation+n8n+SaaS+smallbusiness';

// 10 search queries — one per keyword group (not per subreddit)
const KEYWORD_GROUPS = [
  {
    label:    'Zapier failures',
    query:    'zapier stopped OR zapier broke OR "zap failed" OR "zapier error" OR "zapier not working"',
    priority: 'HIGH',
    account:  'flowvigil'
  },
  {
    label:    'Workflow broke',
    query:    '"workflow broke" OR "workflow stopped" OR "workflow not working" OR "workflow error" OR "workflow failing"',
    priority: 'HIGH',
    account:  'both'
  },
  {
    label:    'n8n errors',
    query:    '"n8n error" OR "n8n not working" OR "n8n broke" OR "n8n stopped" OR "n8n issue"',
    priority: 'HIGH',
    account:  'flowvigil'
  },
  {
    label:    'Webhook issues',
    query:    '"webhook not firing" OR "webhook failed" OR "webhook error" OR "webhook stopped"',
    priority: 'HIGH',
    account:  'both'
  },
  {
    label:    'Automation stopped',
    query:    '"automation stopped" OR "automation broke" OR "automation failed" OR "automation not running"',
    priority: 'HIGH',
    account:  'both'
  },
  {
    label:    'Agency pain',
    query:    '"automation agency" OR "client automations" OR "nocode retainer" OR "charging for automations"',
    priority: 'MEDIUM',
    account:  'both'
  },
  {
    label:    'Monitoring need',
    query:    '"monitor workflows" OR "automation monitoring" OR "monitor zapier" OR "workflow monitoring"',
    priority: 'MEDIUM',
    account:  'flowvigil'
  },
  {
    label:    'Client issues',
    query:    '"client complained" OR "client noticed" OR "found out from client" OR "client found out"',
    priority: 'MEDIUM',
    account:  'flowvigil'
  },
  {
    label:    'AI agent failures',
    query:    '"AI agent" broke OR "AI agent" failed OR "AI agent" stopped OR "agent error"',
    priority: 'LOW',
    account:  'engopsai'
  },
  {
    label:    'Silent failures',
    query:    '"silent failure" OR "how to monitor automation" OR "didnt know it broke" OR "found out it broke"',
    priority: 'LOW',
    account:  'both'
  },
];

const MAX_AGE_HOURS = 24;  // Reddit posts stay relevant for a full day
const MAX_POSTS_PER_DIGEST = 15;

// ─── REDDIT API ────────────────────────────────────────────────────────────
async function searchReddit(query) {
  const url = `https://www.reddit.com/r/${SUBREDDIT_MULTI}/search.json?` +
    new URLSearchParams({
      q:    query,
      sort: 'new',
      limit: '10',
      t:    'day',
    });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FlowVigil-Monitor/2.0' }
    });

    if (res.status === 429) {
      console.log('Reddit rate limit hit — skipping this query');
      return [];
    }

    if (!res.ok) {
      console.error(`Reddit API error: ${res.status} for query "${query}"`);
      return [];
    }

    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];

  } catch (err) {
    console.error(`Reddit fetch error for "${query}":`, err.message);
    return [];
  }
}

// ─── SUPABASE ──────────────────────────────────────────────────────────────
async function getSeenIds(ids) {
  if (!ids.length) return new Set();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/seen_reddit_posts?id=in.(${ids.map(id => `"${id}"`).join(',')})&select=id`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return new Set();
    const rows = await res.json();
    return new Set(rows.map(r => r.id));
  } catch { return new Set(); }
}

async function markAsSeen(posts) {
  if (!posts.length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/seen_reddit_posts`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(posts),
    });
  } catch (err) { console.error('Supabase markAsSeen error:', err.message); }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
const isFresh  = utc => (Date.now() / 1000 - utc) <= MAX_AGE_HOURS * 3600;
const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '...' : (s || '');
const timeAgo  = utc => {
  const m = Math.round((Date.now() / 1000 - utc) / 60);
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

const pc = p =>
  p === 'HIGH'   ? { bg: '#2a0a0d', border: '#e63946', text: '#e63946' } :
  p === 'MEDIUM' ? { bg: '#2a1d0a', border: '#f4a261', text: '#f4a261' } :
                   { bg: '#0a1a2a', border: '#457b9d', text: '#457b9d' };

const ab = a =>
  a === 'flowvigil' ? { label: '@FlowVigil', color: '#00c2a8' } :
  a === 'engopsai'  ? { label: '@EngOpsAI',  color: '#a78bfa' } :
                      { label: 'Both',        color: '#6b7585' };

// ─── EMAIL ─────────────────────────────────────────────────────────────────
function buildEmail(posts) {
  const high = posts.filter(p => p.priority === 'HIGH');
  const med  = posts.filter(p => p.priority === 'MEDIUM');
  const low  = posts.filter(p => p.priority === 'LOW');

  const card = p => {
    const c = pc(p.priority), a = ab(p.account);
    return `
    <tr><td style="padding:0 0 12px;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#12151a;border:1px solid #1e2330;border-left:3px solid ${c.border};border-radius:0 8px 8px 0;">
        <tr><td style="padding:18px 22px;">

          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;"><tr>
            <td>
              <span style="color:#ff6314;font-family:'Courier New',monospace;font-size:11px;font-weight:700;">r/${p.subreddit}</span>
              <span style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;margin-left:8px;">u/${p.author} · ${p.score} pts · ${p.timeAgo}</span>
            </td>
            <td align="right">
              <span style="background:${c.bg};color:${c.text};font-family:'Courier New',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:3px 7px;border-radius:2px;margin-right:4px;">${p.priority}</span>
              <span style="background:#1e2330;color:${a.color};font-family:'Courier New',monospace;font-size:9px;padding:3px 7px;border-radius:2px;">${a.label}</span>
            </td>
          </tr></table>

          <p style="color:#e8eaed;font-size:15px;font-weight:600;margin:0 0 8px;line-height:1.4;">${p.title}</p>

          ${p.preview ? `<p style="color:#7a8599;font-size:13px;line-height:1.65;margin:0 0 14px;border-left:2px solid #1e2330;padding-left:12px;font-style:italic;">"${p.preview}"</p>` : ''}

          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            <td><span style="color:#4a5568;font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;">${p.keyword} · ${p.numComments} comments</span></td>
            <td align="right">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="padding-right:6px;">
                  <a href="${p.url}" style="display:inline-block;padding:7px 14px;background:#00c2a8;color:#0a0c10;font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;">View Post →</a>
                </td>
                <td>
                  <a href="${p.url}" style="display:inline-block;padding:7px 14px;background:#1e2330;color:${a.color};font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;border:1px solid ${a.color};">Reply as ${a.label} →</a>
                </td>
              </tr></table>
            </td>
          </tr></table>

        </td></tr>
      </table>
    </td></tr>`;
  };

  const section = (label, num, arr, color) => !arr.length ? '' : `
    <tr><td style="padding:20px 0 10px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;">${num}</td>
        <td style="width:12px;"></td>
        <td style="color:${color};font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">${label} · ${arr.length} post${arr.length !== 1 ? 's' : ''}</td>
      </tr></table>
    </td></tr>
    ${arr.map(card).join('')}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10;padding:48px 20px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <tr><td style="padding-bottom:28px;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td><table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;vertical-align:middle;"><img src="https://www.flowvigil.com/FlowVigilLogo.jpg" width="28" height="28" style="border-radius:6px;display:block;" alt="FlowVigil"></td>
        <td style="vertical-align:middle;"><span style="font-size:18px;font-weight:700;color:#e8eaed;letter-spacing:-.5px;">FlowVigil</span><span style="font-size:11px;color:#4a5568;font-family:'Courier New',monospace;margin-left:8px;">Reddit Monitor</span></td>
      </tr></table></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:11px;color:#4a5568;">${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</span></td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#12151a;border:1px solid #1e2330;border-radius:10px;padding:28px 32px 24px;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
      <td style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;">00</td>
      <td style="width:12px;"></td>
      <td style="color:#ff6314;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">Reddit Engagement Digest</td>
    </tr></table>
    <h1 style="color:#e8eaed;font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-.5px;">🤖 ${posts.length} post${posts.length !== 1 ? 's' : ''} to engage on</h1>
    <p style="color:#7a8599;font-size:13px;margin:0;line-height:1.6;">${high.length} high · ${med.length} medium · ${low.length} low · r/${SUBREDDIT_MULTI.replace(/\+/g, ', r/')}</p>
  </td></tr>

  <tr><td style="padding:12px 0 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;"><span style="background:#1e2330;color:#00c2a8;font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;">@FlowVigil — product voice</span></td>
      <td><span style="background:#1e2330;color:#a78bfa;font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;">@EngOpsAI — thought leader</span></td>
    </tr></table>
  </td></tr>

  <table width="100%" cellpadding="0" cellspacing="0">
    ${section('🔥 High Priority', '01', high, '#e63946')}
    ${section('🟡 Medium Priority', '02', med, '#f4a261')}
    ${section('🔵 Low Priority', '03', low, '#457b9d')}
  </table>

  <tr><td style="padding-top:28px;border-top:1px solid #1e2330;text-align:center;">
    <p style="color:#3a4050;font-size:11px;font-family:'Courier New',monospace;margin:0;line-height:1.8;">
      FlowVigil Reddit Monitor v2 · Every 30 mins via GitHub Actions<br>
      <a href="https://flowvigil.com" style="color:#00c2a8;text-decoration:none;">flowvigil.com</a>
    </p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const isAuthorized =
    req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` ||
    req.query?.secret === process.env.CRON_SECRET;

  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const allNew   = [];
    const seenInRun = new Set();

    for (const group of KEYWORD_GROUPS) {
      console.log(`Searching: ${group.label}...`);
      const posts = await searchReddit(group.query);
      console.log(`  Found ${posts.length} posts`);

      const filtered = posts.filter(p =>
        p.id &&
        isFresh(p.created_utc) &&
        !p.stickied &&
        !seenInRun.has(p.id)
      );

      if (!filtered.length) continue;

      const seenIds = await getSeenIds(filtered.map(p => p.id));
      const fresh   = filtered
        .filter(p => !seenIds.has(p.id))
        .map(p => ({
          id:          p.id,
          subreddit:   p.subreddit,
          keyword:     group.label,
          priority:    group.priority,
          account:     group.account,
          title:       p.title,
          preview:     truncate(p.selftext?.replace(/\n/g, ' ').trim(), 200),
          author:      p.author,
          score:       p.score || 0,
          numComments: p.num_comments || 0,
          url:         `https://www.reddit.com${p.permalink}`,
          timeAgo:     timeAgo(p.created_utc),
        }));

      fresh.forEach(p => seenInRun.add(p.id));
      allNew.push(...fresh);

      if (fresh.length) {
        await markAsSeen(fresh.map(p => ({
          id: p.id, subreddit: p.subreddit,
          keyword: p.keyword, title: p.title,
          author: p.author, score: p.score,
        })));
        console.log(`  ${fresh.length} new posts marked as seen`);
      }

      // Respect Reddit's rate limit — 1 request/sec for unauthenticated
      await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`Total new posts: ${allNew.length}`);

    if (!allNew.length) {
      return res.status(200).json({ success: true, newPosts: 0 });
    }

    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    allNew.sort((a, b) =>
      order[a.priority] !== order[b.priority]
        ? order[a.priority] - order[b.priority]
        : b.score - a.score
    );

    const toSend = allNew.slice(0, MAX_POSTS_PER_DIGEST);

    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body:    JSON.stringify({
        from:    'FlowVigil Reddit Monitor <hello@flowvigil.com>',
        to:      'hello@flowvigil.com',
        subject: `🤖 ${toSend.length} Reddit post${toSend.length !== 1 ? 's' : ''} to engage on — FlowVigil`,
        html:    buildEmail(toSend),
      }),
    });

    if (!emailRes.ok) console.error('Resend error:', await emailRes.text());
    return res.status(200).json({ success: true, newPosts: toSend.length });

  } catch (err) {
    console.error('Reddit Monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}
