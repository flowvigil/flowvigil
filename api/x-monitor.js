// api/x-monitor.js
// Vercel Cron Job — runs every 30 minutes
// Monitors X for relevant tweets and sends email digest via Resend
// v2 — broadened keywords for higher daily tweet volume

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ─── KEYWORDS TO MONITOR ───────────────────────────────────────────────────
// Broadened to find 10+ tweets per day using natural ICP language
const KEYWORD_GROUPS = [
  // TIER 1 — High intent, direct pain
  {
    label: 'Zapier broke',
    query: '(zapier broke OR zapier stopped OR zapier "not working" OR "my zap" error) -is:retweet lang:en',
    priority: 'HIGH',
    account: 'both'   // relevant for both @EngOpsAI and @FlowVigil
  },
  {
    label: 'Automation broke',
    query: '(automation broke OR automation stopped OR "workflow stopped" OR "workflow broke") -is:retweet lang:en',
    priority: 'HIGH',
    account: 'both'
  },
  {
    label: 'n8n issues',
    query: '(n8n broke OR n8n stopped OR "n8n issue" OR "n8n not working" OR "n8n error") -is:retweet lang:en',
    priority: 'HIGH',
    account: 'flowvigil'
  },
  {
    label: 'Client complained',
    query: '("client complained" OR "client noticed" OR "client told me" OR "client found out") -is:retweet lang:en',
    priority: 'HIGH',
    account: 'flowvigil'
  },

  // TIER 2 — Medium intent, adjacent pain
  {
    label: 'Automation agency',
    query: '("automation agency" OR "nocode agency" OR "zapier expert" OR "make.com agency") -is:retweet lang:en',
    priority: 'MEDIUM',
    account: 'both'
  },
  {
    label: 'Workflow problems',
    query: '("workflow error" OR "workflow issue" OR "workflow problem" OR "webhook failed") -is:retweet lang:en',
    priority: 'MEDIUM',
    account: 'both'
  },
  {
    label: 'Make.com issues',
    query: '(make.com broke OR "make.com error" OR "integromat error" OR "make scenario" error) -is:retweet lang:en',
    priority: 'MEDIUM',
    account: 'flowvigil'
  },
  {
    label: 'Webhook failures',
    query: '("webhook failed" OR "webhook error" OR "api stopped" OR "integration broke") -is:retweet lang:en',
    priority: 'MEDIUM',
    account: 'both'
  },

  // TIER 3 — Low intent, thought leadership
  {
    label: 'AI agent failures',
    query: '("AI agent" broke OR "AI agent" failed OR "AI agent" stopped OR "agent error") -is:retweet lang:en',
    priority: 'LOW',
    account: 'engopsai'
  },
  {
    label: 'No-code frustration',
    query: '("nocode" frustration OR "zapier limits" OR "make limits" OR "no-code problem") -is:retweet lang:en',
    priority: 'LOW',
    account: 'flowvigil'
  },
  {
    label: 'Ops monitoring',
    query: '("workflow monitoring" OR "automation monitoring" OR "ops monitoring" OR "monitor automations") -is:retweet lang:en',
    priority: 'LOW',
    account: 'both'
  },
];

// ─── FILTERS ───────────────────────────────────────────────────────────────
const MIN_FOLLOWERS = 25;    // lowered from 50 to catch more real users
const MAX_AGE_HOURS = 3;     // extended from 2 to 3 hours for more volume

// ─── X API SEARCH ──────────────────────────────────────────────────────────
async function searchTweets(query) {
  const params = new URLSearchParams({
    query,
    max_results: '10',
    'tweet.fields': 'created_at,public_metrics,author_id',
    'user.fields': 'username,public_metrics',
    expansions: 'author_id',
  });

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?${params}`,
    { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`X API error for query "${query}":`, err);
    return { tweets: [], users: {} };
  }

  const data = await res.json();
  if (!data.data || !data.data.length) return { tweets: [], users: {} };

  const users = {};
  if (data.includes?.users) {
    data.includes.users.forEach(u => {
      users[u.id] = {
        username: u.username,
        followers: u.public_metrics?.followers_count || 0,
      };
    });
  }

  return { tweets: data.data, users };
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────
async function getSeenIds(ids) {
  if (!ids.length) return new Set();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/seen_tweets?id=in.(${ids.join(',')})&select=id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return new Set();
  const rows = await res.json();
  return new Set(rows.map(r => r.id));
}

async function markAsSeen(tweets) {
  if (!tweets.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/seen_tweets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(tweets),
  });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function isFresh(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

function timeAgo(createdAt) {
  const mins = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function priorityColor(p) {
  if (p === 'HIGH')   return { bg: '#2a0a0d', border: '#e63946', text: '#e63946' };
  if (p === 'MEDIUM') return { bg: '#2a1d0a', border: '#f4a261', text: '#f4a261' };
  return                     { bg: '#0a1a2a', border: '#457b9d', text: '#457b9d' };
}

function accountBadge(account) {
  if (account === 'flowvigil') return { label: '@FlowVigil', color: '#00c2a8' };
  if (account === 'engopsai')  return { label: '@EngOpsAI',  color: '#a78bfa' };
  return                               { label: 'Both',       color: '#6b7585' };
}

// ─── EMAIL BUILDER ─────────────────────────────────────────────────────────
function buildEmailHtml(newTweets) {
  const high   = newTweets.filter(t => t.priority === 'HIGH');
  const medium = newTweets.filter(t => t.priority === 'MEDIUM');
  const low    = newTweets.filter(t => t.priority === 'LOW');

  const tweetCard = t => {
    const pc = priorityColor(t.priority);
    const ab = accountBadge(t.account);
    return `
    <tr>
      <td style="padding:0 0 12px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#12151a; border:1px solid #1e2330;
                      border-left:3px solid ${pc.border}; border-radius:0 8px 8px 0;">
          <tr>
            <td style="padding:18px 22px;">

              <!-- META -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
                <tr>
                  <td>
                    <span style="color:#00c2a8; font-family:'Courier New',monospace; font-size:11px; font-weight:700;">
                      @${t.username}
                    </span>
                    <span style="color:#4a5568; font-family:'Courier New',monospace; font-size:11px; margin-left:8px;">
                      ${Number(t.followers).toLocaleString()} followers · ${t.likes} likes · ${t.timeAgo}
                    </span>
                  </td>
                  <td align="right">
                    <span style="background:${pc.bg}; color:${pc.text};
                                 font-family:'Courier New',monospace; font-size:9px;
                                 letter-spacing:0.12em; text-transform:uppercase;
                                 padding:3px 7px; border-radius:2px; margin-right:4px;">
                      ${t.priority}
                    </span>
                    <span style="background:#1e2330; color:${ab.color};
                                 font-family:'Courier New',monospace; font-size:9px;
                                 letter-spacing:0.08em; padding:3px 7px; border-radius:2px;">
                      ${ab.label}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- TWEET -->
              <p style="color:#c0c7d4; font-size:13px; line-height:1.65; margin:0 0 14px;
                        font-style:italic; border-left:2px solid #1e2330; padding-left:12px;">
                "${t.text}"
              </p>

              <!-- KEYWORD + REPLY BTNS -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="color:#4a5568; font-family:'Courier New',monospace;
                                 font-size:10px; text-transform:uppercase; letter-spacing:0.1em;">
                      ${t.keyword}
                    </span>
                  </td>
                  <td align="right">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        ${t.account !== 'engopsai' ? `
                        <td style="padding-right:6px;">
                          <a href="https://twitter.com/intent/tweet?in_reply_to=${t.id}&via=FlowVigil"
                             style="display:inline-block; padding:7px 14px; background:#00c2a8;
                                    color:#0a0c10; font-size:11px; font-weight:700;
                                    text-decoration:none; border-radius:4px;
                                    letter-spacing:0.04em; text-transform:uppercase;">
                            @FlowVigil →
                          </a>
                        </td>` : ''}
                        ${t.account !== 'flowvigil' ? `
                        <td>
                          <a href="https://twitter.com/intent/tweet?in_reply_to=${t.id}&via=EngOpsAI"
                             style="display:inline-block; padding:7px 14px; background:#1e2330;
                                    color:#a78bfa; font-size:11px; font-weight:700;
                                    text-decoration:none; border-radius:4px;
                                    letter-spacing:0.04em; text-transform:uppercase;
                                    border:1px solid #a78bfa;">
                            @EngOpsAI →
                          </a>
                        </td>` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  };

  const section = (label, num, tweets, color) => tweets.length === 0 ? '' : `
    <tr>
      <td style="padding:20px 0 10px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#4a5568; font-family:'Courier New',monospace; font-size:11px; letter-spacing:0.1em;">${num}</td>
            <td style="width:12px;"></td>
            <td style="color:${color}; font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.16em; text-transform:uppercase;">
              ${label} · ${tweets.length} tweet${tweets.length !== 1 ? 's' : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${tweets.map(tweetCard).join('')}
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#0a0c10; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10; padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px; width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px; vertical-align:middle;">
                          <img src="https://www.flowvigil.com/FlowVigilLogo.jpg"
                               width="28" height="28" style="border-radius:6px; display:block;" alt="FlowVigil">
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="font-size:18px; font-weight:700; color:#e8eaed; letter-spacing:-0.5px;">FlowVigil</span>
                          <span style="font-size:12px; color:#4a5568; font-family:'Courier New',monospace; margin-left:8px;">X Monitor v2</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right">
                    <span style="font-family:'Courier New',monospace; font-size:11px; color:#4a5568;">
                      ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TITLE CARD -->
          <tr>
            <td style="background:#12151a; border:1px solid #1e2330; border-radius:10px; padding:28px 32px 24px;">
              <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="color:#4a5568; font-family:'Courier New',monospace; font-size:11px;">00</td>
                  <td style="width:12px;"></td>
                  <td style="color:#00c2a8; font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.16em; text-transform:uppercase;">X Engagement Digest</td>
                </tr>
              </table>
              <h1 style="color:#e8eaed; font-size:22px; font-weight:700; margin:0 0 8px; letter-spacing:-0.5px;">
                🔥 ${newTweets.length} tweet${newTweets.length !== 1 ? 's' : ''} to engage on
              </h1>
              <p style="color:#7a8599; font-size:13px; margin:0; line-height:1.6;">
                ${high.length} high · ${medium.length} medium · ${low.length} low priority
                &nbsp;·&nbsp;
                <span style="color:#00c2a8;">@FlowVigil</span> and
                <span style="color:#a78bfa;">@EngOpsAI</span> tagged per tweet
              </p>
            </td>
          </tr>

          <!-- ACCOUNT LEGEND -->
          <tr>
            <td style="padding:12px 0 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:16px;">
                    <span style="background:#1e2330; color:#00c2a8; font-family:'Courier New',monospace;
                                 font-size:10px; padding:4px 10px; border-radius:4px;">
                      @FlowVigil — product voice
                    </span>
                  </td>
                  <td>
                    <span style="background:#1e2330; color:#a78bfa; font-family:'Courier New',monospace;
                                 font-size:10px; padding:4px 10px; border-radius:4px;">
                      @EngOpsAI — thought leader voice
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TWEET SECTIONS -->
          <table width="100%" cellpadding="0" cellspacing="0">
            ${section('🔥 High Priority', '01', high, '#e63946')}
            ${section('🟡 Medium Priority', '02', medium, '#f4a261')}
            ${section('🔵 Low Priority', '03', low, '#457b9d')}
          </table>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top:28px; border-top:1px solid #1e2330; text-align:center;">
              <p style="color:#3a4050; font-size:11px; font-family:'Courier New',monospace; margin:0; line-height:1.8;">
                FlowVigil X Monitor v2 · Runs every 30 minutes via GitHub Actions<br>
                <a href="https://flowvigil.com" style="color:#00c2a8; text-decoration:none;">flowvigil.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
const authHeader = req.headers.authorization;
const querySecret = req.query?.secret;
const isAuthorized =
  authHeader === `Bearer ${process.env.CRON_SECRET}` ||
  querySecret === process.env.CRON_SECRET;

if (!isAuthorized) {
  return res.status(401).json({ error: 'Unauthorized' });
}

  try {
    const allNewTweets = [];

    for (const group of KEYWORD_GROUPS) {
      const { tweets, users } = await searchTweets(group.query);

      const filtered = tweets.filter(t => {
        const user = users[t.author_id];
        if (!user) return false;
        if (user.followers < MIN_FOLLOWERS) return false;
        if (!isFresh(t.created_at)) return false;
        return true;
      });

      if (!filtered.length) continue;

      const ids = filtered.map(t => t.id);
      const seenIds = await getSeenIds(ids);

      const newTweets = filtered
        .filter(t => !seenIds.has(t.id))
        .map(t => ({
          id: t.id,
          keyword: group.label,
          priority: group.priority,
          account: group.account,
          username: users[t.author_id]?.username || 'unknown',
          followers: users[t.author_id]?.followers || 0,
          likes: t.public_metrics?.like_count || 0,
          text: t.text,
          createdAt: t.created_at,
          timeAgo: timeAgo(t.created_at),
        }));

      allNewTweets.push(...newTweets);

      if (newTweets.length) {
        await markAsSeen(newTweets.map(t => ({
          id: t.id,
          keyword: t.keyword,
          author: t.username,
          followers: t.followers,
          likes: t.likes,
          tweet_text: t.text,
        })));
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (!allNewTweets.length) {
      console.log('No new tweets this run.');
      return res.status(200).json({ success: true, newTweets: 0 });
    }

    // Sort: HIGH first, then MEDIUM, then LOW; within each by followers desc
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    allNewTweets.sort((a, b) =>
      order[a.priority] !== order[b.priority]
        ? order[a.priority] - order[b.priority]
        : b.followers - a.followers
    );

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'FlowVigil X Monitor <hello@flowvigil.com>',
        to: 'hello@flowvigil.com',
        subject: `🔥 ${allNewTweets.length} tweets to engage on — FlowVigil X Monitor`,
        html: buildEmailHtml(allNewTweets),
      }),
    });

    if (!emailRes.ok) console.error('Resend error:', await emailRes.text());

    console.log(`Digest sent: ${allNewTweets.length} new tweets`);
    return res.status(200).json({ success: true, newTweets: allNewTweets.length });

  } catch (err) {
    console.error('X Monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}
