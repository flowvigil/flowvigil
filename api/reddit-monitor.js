// api/reddit-monitor.js
// Monitors Reddit for relevant posts across 6 subreddits
// Deduplicates via Supabase + sends branded email digest via Resend
// Triggered every 30 mins via GitHub Actions

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY   = process.env.RESEND_API_KEY;

// ─── CONFIG ────────────────────────────────────────────────────────────────

const SUBREDDITS = [
  'zapier',
  'nocode',
  'automation',
  'n8n',
  'SaaS',
  'smallbusiness'
];

const KEYWORD_GROUPS = [
  // HIGH PRIORITY — direct pain, reply immediately
  {
    label: 'Zapier failures',
    keywords: ['zapier stopped', 'zapier broke', 'zapier not working', 'zap failing', 'zap failed', 'zapier error', 'zapier issue'],
    priority: 'HIGH',
    account: 'flowvigil'
  },
  {
    label: 'Workflow broke',
    keywords: ['workflow broke', 'workflow stopped', 'workflow not working', 'workflow error', 'workflow failing'],
    priority: 'HIGH',
    account: 'both'
  },
  {
    label: 'n8n errors',
    keywords: ['n8n error', 'n8n not working', 'n8n broke', 'n8n stopped', 'n8n failing', 'n8n issue'],
    priority: 'HIGH',
    account: 'flowvigil'
  },
  {
    label: 'Webhook issues',
    keywords: ['webhook not firing', 'webhook failed', 'webhook error', 'webhook stopped', 'webhook not working'],
    priority: 'HIGH',
    account: 'both'
  },
  {
    label: 'Automation stopped',
    keywords: ['automation not running', 'automation stopped', 'automation broke', 'automation failed', 'automation error'],
    priority: 'HIGH',
    account: 'both'
  },

  // MEDIUM PRIORITY — agency pain, good engagement opportunities
  {
    label: 'Agency pain',
    keywords: ['automation agency', 'manage client automations', 'nocode retainer', 'charging for automations', 'client workflow'],
    priority: 'MEDIUM',
    account: 'both'
  },
  {
    label: 'Monitoring need',
    keywords: ['monitor workflows', 'automation monitoring', 'monitor zapier', 'monitor zaps', 'workflow monitoring'],
    priority: 'MEDIUM',
    account: 'flowvigil'
  },
  {
    label: 'Client issues',
    keywords: ['client complained', 'client noticed', 'client found out', 'client angry automation', 'client workflow broke'],
    priority: 'MEDIUM',
    account: 'flowvigil'
  },

  // LOW PRIORITY — thought leadership opportunities
  {
    label: 'AI agent failures',
    keywords: ['AI agent broke', 'AI agent failed', 'AI agent stopped', 'agent error', 'agent not working'],
    priority: 'LOW',
    account: 'engopsai'
  },
  {
    label: 'Silent failures',
    keywords: ['silent failure', 'didnt know broke', 'found out from client', 'how to monitor automation'],
    priority: 'LOW',
    account: 'both'
  },
];

const MAX_AGE_HOURS  = 6;   // Reddit posts stay relevant longer than tweets
const MAX_RESULTS    = 10;  // posts per subreddit per keyword search

// ─── REDDIT API ────────────────────────────────────────────────────────────
// Reddit has a free, no-auth-required JSON API for search
async function searchReddit(subreddit, keyword) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?` +
    new URLSearchParams({
      q:        keyword,
      sort:     'new',
      limit:    MAX_RESULTS,
      restrict_sr: 'true',   // only search within this subreddit
      t:        'day',       // only posts from the last 24 hours
    });

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FlowVigil-Monitor/1.0 (workflow monitoring tool)',
    }
  });

  if (!res.ok) {
    console.error(`Reddit API error for r/${subreddit} "${keyword}": ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data?.data?.children?.map(c => c.data) || [];
}

// ─── SUPABASE ──────────────────────────────────────────────────────────────
async function getSeenIds(ids) {
  if (!ids.length) return new Set();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/seen_reddit_posts?id=in.(${ids.map(id => `"${id}"`).join(',')})&select=id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return new Set();
  const rows = await res.json();
  return new Set(rows.map(r => r.id));
}

async function markAsSeen(posts) {
  if (!posts.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/seen_reddit_posts`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      apikey:          SUPABASE_ANON_KEY,
      Authorization:   `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer:          'return=minimal',
    },
    body: JSON.stringify(posts),
  });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function isFresh(utcSeconds) {
  return (Date.now() / 1000 - utcSeconds) <= MAX_AGE_HOURS * 3600;
}

function timeAgo(utcSeconds) {
  const mins = Math.round((Date.now() / 1000 - utcSeconds) / 60);
  if (mins < 60)  return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function accountBadge(account) {
  if (account === 'flowvigil') return { label: '@FlowVigil', color: '#00c2a8' };
  if (account === 'engopsai')  return { label: '@EngOpsAI',  color: '#a78bfa' };
  return                               { label: 'Both',       color: '#6b7585' };
}

function priorityColors(p) {
  if (p === 'HIGH')   return { bg: '#2a0a0d', border: '#e63946', text: '#e63946' };
  if (p === 'MEDIUM') return { bg: '#2a1d0a', border: '#f4a261', text: '#f4a261' };
  return                     { bg: '#0a1a2a', border: '#457b9d', text: '#457b9d' };
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// ─── EMAIL BUILDER ─────────────────────────────────────────────────────────
function buildEmail(posts) {
  const high = posts.filter(p => p.priority === 'HIGH');
  const med  = posts.filter(p => p.priority === 'MEDIUM');
  const low  = posts.filter(p => p.priority === 'LOW');

  const card = p => {
    const c  = priorityColors(p.priority);
    const ab = accountBadge(p.account);
    return `
    <tr><td style="padding:0 0 12px;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#12151a;border:1px solid #1e2330;border-left:3px solid ${c.border};border-radius:0 8px 8px 0;">
        <tr><td style="padding:18px 22px;">

          <!-- META ROW -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
            <tr>
              <td>
                <span style="color:#00c2a8;font-family:'Courier New',monospace;font-size:11px;font-weight:700;">r/${p.subreddit}</span>
                <span style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;margin-left:8px;">u/${p.author} · ${p.score} pts · ${p.timeAgo}</span>
              </td>
              <td align="right">
                <span style="background:${c.bg};color:${c.text};font-family:'Courier New',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:3px 7px;border-radius:2px;margin-right:4px;">${p.priority}</span>
                <span style="background:#1e2330;color:${ab.color};font-family:'Courier New',monospace;font-size:9px;padding:3px 7px;border-radius:2px;">${ab.label}</span>
              </td>
            </tr>
          </table>

          <!-- TITLE -->
          <p style="color:#e8eaed;font-size:15px;font-weight:600;margin:0 0 8px;line-height:1.4;">
            ${p.title}
          </p>

          <!-- BODY PREVIEW -->
          ${p.preview ? `<p style="color:#7a8599;font-size:13px;line-height:1.65;margin:0 0 14px;border-left:2px solid #1e2330;padding-left:12px;font-style:italic;">"${p.preview}"</p>` : ''}

          <!-- KEYWORD + CTA ROW -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td>
                <span style="color:#4a5568;font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.1em;">${p.keyword} · ${p.numComments} comments</span>
              </td>
              <td align="right">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="padding-right:6px;">
                    <a href="${p.url}"
                       style="display:inline-block;padding:7px 14px;background:#00c2a8;color:#0a0c10;font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;">
                      View Post →
                    </a>
                  </td>
                  <td>
                    <a href="${p.url}"
                       style="display:inline-block;padding:7px 14px;background:#1e2330;color:${ab.color};font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;border:1px solid ${ab.color};">
                      Reply as ${ab.label} →
                    </a>
                  </td>
                </tr></table>
              </td>
            </tr>
          </table>

        </td></tr>
      </table>
    </td></tr>`;
  };

  const section = (label, num, arr, color) => !arr.length ? '' : `
    <tr><td style="padding:20px 0 10px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.1em;">${num}</td>
        <td style="width:12px;"></td>
        <td style="color:${color};font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">
          ${label} · ${arr.length} post${arr.length !== 1 ? 's' : ''}
        </td>
      </tr></table>
    </td></tr>
    ${arr.map(card).join('')}`;

  return `
<!DOCTYPE html><html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10;padding:48px 20px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <!-- HEADER -->
  <tr><td style="padding-bottom:28px;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td><table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;vertical-align:middle;">
          <img src="https://www.flowvigil.com/FlowVigilLogo.jpg" width="28" height="28" style="border-radius:6px;display:block;" alt="FlowVigil">
        </td>
        <td style="vertical-align:middle;">
          <span style="font-size:18px;font-weight:700;color:#e8eaed;letter-spacing:-.5px;">FlowVigil</span>
          <span style="font-size:11px;color:#4a5568;font-family:'Courier New',monospace;margin-left:8px;">Reddit Monitor</span>
        </td>
      </tr></table></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:11px;color:#4a5568;">
        ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
      </span></td>
    </tr></table>
  </td></tr>

  <!-- TITLE CARD -->
  <tr><td style="background:#12151a;border:1px solid #1e2330;border-radius:10px;padding:28px 32px 24px;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
      <td style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;">00</td>
      <td style="width:12px;"></td>
      <td style="color:#ff6314;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">Reddit Engagement Digest</td>
    </tr></table>
    <h1 style="color:#e8eaed;font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-.5px;">
      🤖 ${posts.length} post${posts.length !== 1 ? 's' : ''} to engage on
    </h1>
    <p style="color:#7a8599;font-size:13px;margin:0;line-height:1.6;">
      ${high.length} high · ${med.length} medium · ${low.length} low priority
      &nbsp;·&nbsp; r/${SUBREDDITS.join(', r/')}
    </p>
  </td></tr>

  <!-- ACCOUNT LEGEND -->
  <tr><td style="padding:12px 0 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;"><span style="background:#1e2330;color:#00c2a8;font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;">@FlowVigil — product voice</span></td>
      <td><span style="background:#1e2330;color:#a78bfa;font-family:'Courier New',monospace;font-size:10px;padding:4px 10px;border-radius:4px;">@EngOpsAI — thought leader</span></td>
    </tr></table>
  </td></tr>

  <!-- SECTIONS -->
  <table width="100%" cellpadding="0" cellspacing="0">
    ${section('🔥 High Priority', '01', high, '#e63946')}
    ${section('🟡 Medium Priority', '02', med, '#f4a261')}
    ${section('🔵 Low Priority', '03', low, '#457b9d')}
  </table>

  <!-- FOOTER -->
  <tr><td style="padding-top:28px;border-top:1px solid #1e2330;text-align:center;">
    <p style="color:#3a4050;font-size:11px;font-family:'Courier New',monospace;margin:0;line-height:1.8;">
      FlowVigil Reddit Monitor · Every 30 mins via GitHub Actions<br>
      <a href="https://flowvigil.com" style="color:#00c2a8;text-decoration:none;">flowvigil.com</a>
    </p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const authHeader  = req.headers.authorization;
  const querySecret = req.query?.secret;
  const isAuthorized =
    authHeader  === `Bearer ${process.env.CRON_SECRET}` ||
    querySecret === process.env.CRON_SECRET;

  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const allNew   = [];
    const seenKeys = new Set(); // deduplicate within this run (same post, multiple keywords)

    for (const group of KEYWORD_GROUPS) {
      for (const keyword of group.keywords) {
        for (const subreddit of SUBREDDITS) {
          const posts = await searchReddit(subreddit, keyword);

          const filtered = posts.filter(p =>
            p.id &&
            isFresh(p.created_utc) &&
            !p.stickied &&              // skip mod posts
            !seenKeys.has(p.id)         // deduplicate within run
          );

          if (!filtered.length) continue;

          const ids     = filtered.map(p => p.id);
          const seenIds = await getSeenIds(ids);

          const fresh = filtered
            .filter(p => !seenIds.has(p.id))
            .map(p => ({
              id:          p.id,
              subreddit,
              keyword:     group.label,
              priority:    group.priority,
              account:     group.account,
              title:       p.title,
              preview:     truncate(p.selftext?.replace(/\n/g, ' '), 200),
              author:      p.author,
              score:       p.score,
              numComments: p.num_comments,
              url:         `https://www.reddit.com${p.permalink}`,
              createdUtc:  p.created_utc,
              timeAgo:     timeAgo(p.created_utc),
            }));

          fresh.forEach(p => seenKeys.add(p.id));
          allNew.push(...fresh);

          if (fresh.length) {
            await markAsSeen(fresh.map(p => ({
              id:        p.id,
              subreddit: p.subreddit,
              keyword:   p.keyword,
              title:     p.title,
              author:    p.author,
              score:     p.score,
            })));
          }

          // Respect Reddit's rate limit — 60 requests/min for unauthenticated
          await new Promise(r => setTimeout(r, 1100));
        }
      }
    }

    if (!allNew.length) {
      console.log('No new Reddit posts this run.');
      return res.status(200).json({ success: true, newPosts: 0 });
    }

    // Sort: HIGH first, then MEDIUM, then LOW; within each by score desc
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    allNew.sort((a, b) =>
      order[a.priority] !== order[b.priority]
        ? order[a.priority] - order[b.priority]
        : b.score - a.score
    );

    // Cap at 20 posts per digest — avoid email overload
    const toSend = allNew.slice(0, 20);

    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body:    JSON.stringify({
        from:    'FlowVigil Reddit Monitor <hello@flowvigil.com>',
        to:      'hello@flowvigil.com',
        subject: `🤖 ${toSend.length} Reddit post${toSend.length !== 1 ? 's' : ''} to engage on — FlowVigil Monitor`,
        html:    buildEmail(toSend),
      }),
    });

    if (!emailRes.ok) console.error('Resend error:', await emailRes.text());
    console.log(`Reddit digest sent: ${toSend.length} posts`);
    return res.status(200).json({ success: true, newPosts: toSend.length });

  } catch (err) {
    console.error('Reddit Monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}
