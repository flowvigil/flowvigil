// api/x-monitor.js
// Vercel Cron Job — runs every 30 minutes
// Monitors X for relevant tweets and sends email digest via Resend

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ─── KEYWORDS TO MONITOR ───────────────────────────────────────────────────
const KEYWORD_GROUPS = [
  { label: 'Zapier failures',      query: '(zapier failed OR zapier broken OR "zap failed") -is:retweet lang:en',      priority: 'HIGH' },
  { label: 'n8n errors',           query: '(n8n error OR n8n broken OR n8n failed) -is:retweet lang:en',                priority: 'HIGH' },
  { label: 'Automation agency',    query: '("automation agency" OR "automate clients") -is:retweet lang:en',            priority: 'MEDIUM' },
  { label: 'Workflow monitoring',  query: '("workflow monitoring" OR "monitor workflows" OR "workflow broke") -is:retweet lang:en', priority: 'MEDIUM' },
  { label: 'Silent failures',      query: '("silent failure" OR "workflow silent" OR "zap silent") -is:retweet lang:en', priority: 'MEDIUM' },
];

// ─── FILTERS ───────────────────────────────────────────────────────────────
const MIN_FOLLOWERS = 50;
const MIN_LIKES = 0;        // include 0-like tweets — catching pain early is the point
const MAX_AGE_HOURS = 2;    // only tweets from the last 2 hours

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

  // Build a user lookup map
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
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
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

// ─── FRESHNESS CHECK ───────────────────────────────────────────────────────
function isFresh(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

function timeAgo(createdAt) {
  const mins = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// ─── EMAIL BUILDER ─────────────────────────────────────────────────────────
function buildEmailHtml(newTweets) {
  const highPriority = newTweets.filter(t => t.priority === 'HIGH');
  const medPriority  = newTweets.filter(t => t.priority === 'MEDIUM');

  const tweetCard = (t, index) => `
    <tr>
      <td style="padding: 0 0 14px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#12151a; border:1px solid #1e2330; border-left: 3px solid ${t.priority === 'HIGH' ? '#e63946' : '#f4a261'}; border-radius:0 8px 8px 0;">
          <tr>
            <td style="padding: 20px 24px;">

              <!-- META ROW -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:12px; width:100%;">
                <tr>
                  <td>
                    <span style="color:#00c2a8; font-family:'Courier New',monospace; font-size:11px; font-weight:700;">
                      @${t.username}
                    </span>
                    <span style="color:#4a5568; font-family:'Courier New',monospace; font-size:11px; margin-left:8px;">
                      ${Number(t.followers).toLocaleString()} followers
                      · ${t.likes} like${t.likes !== 1 ? 's' : ''}
                      · ${t.timeAgo}
                    </span>
                  </td>
                  <td align="right">
                    <span style="background:${t.priority === 'HIGH' ? '#2a0a0d' : '#2a1d0a'};
                                 color:${t.priority === 'HIGH' ? '#e63946' : '#f4a261'};
                                 font-family:'Courier New',monospace; font-size:9px;
                                 letter-spacing:0.12em; text-transform:uppercase;
                                 padding:3px 8px; border-radius:2px;">
                      ${t.priority}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- TWEET TEXT -->
              <p style="color:#c0c7d4; font-size:14px; line-height:1.65; margin:0 0 16px;
                        font-style:italic; border-left:2px solid #1e2330; padding-left:14px;">
                "${t.text}"
              </p>

              <!-- KEYWORD TAG + CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="color:#4a5568; font-family:'Courier New',monospace; font-size:10px;
                                 letter-spacing:0.1em; text-transform:uppercase;">
                      ${t.keyword}
                    </span>
                  </td>
                  <td align="right">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#00c2a8; border-radius:4px;">
                          <a href="https://twitter.com/intent/tweet?in_reply_to=${t.id}"
                             style="display:inline-block; padding:8px 18px; color:#0a0c10;
                                    font-size:11px; font-weight:700; text-decoration:none;
                                    letter-spacing:0.06em; text-transform:uppercase;">
                            Reply →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;

  const sectionHeader = (label, count, color) => `
    <tr>
      <td style="padding: 24px 0 12px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#4a5568; font-family:'Courier New',monospace;
                       font-size:11px; letter-spacing:0.1em;">
              ${label === 'HIGH' ? '01' : '02'}
            </td>
            <td style="width:12px;"></td>
            <td style="color:${color}; font-family:'Courier New',monospace;
                       font-size:10px; letter-spacing:0.16em; text-transform:uppercase;">
              ${label === 'HIGH' ? '🔥 High Priority' : '🟡 Medium Priority'} · ${count} tweet${count !== 1 ? 's' : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#0a0c10; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10; padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="vertical-align:middle;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px; vertical-align:middle;">
                          <img src="https://www.flowvigil.com/FlowVigilLogo.jpg"
                               width="28" height="28"
                               style="border-radius:6px; display:block;" alt="FlowVigil">
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="font-size:18px; font-weight:700; color:#e8eaed; letter-spacing:-0.5px;">
                            FlowVigil
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-family:'Courier New',monospace; font-size:11px; color:#4a5568;">
                      X Monitor · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TITLE CARD -->
          <tr>
            <td style="background:#12151a; border:1px solid #1e2330; border-radius:10px;
                       padding:28px 32px; margin-bottom:14px;">
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="color:#4a5568; font-family:'Courier New',monospace; font-size:11px; letter-spacing:0.1em;">00</td>
                  <td style="width:12px;"></td>
                  <td style="color:#00c2a8; font-family:'Courier New',monospace; font-size:10px; letter-spacing:0.16em; text-transform:uppercase;">X Engagement Digest</td>
                </tr>
              </table>
              <h1 style="color:#e8eaed; font-size:24px; font-weight:700; margin:0 0 8px; letter-spacing:-0.5px;">
                🔥 ${newTweets.length} new tweet${newTweets.length !== 1 ? 's' : ''} to engage on
              </h1>
              <p style="color:#7a8599; font-size:14px; margin:0; line-height:1.6;">
                ${highPriority.length} high priority · ${medPriority.length} medium priority · Filtered for relevance and recency
              </p>
            </td>
          </tr>

          <!-- HIGH PRIORITY TWEETS -->
          ${highPriority.length ? sectionHeader('HIGH', highPriority.length, '#e63946') : ''}
          ${highPriority.map((t, i) => tweetCard(t, i)).join('')}

          <!-- MEDIUM PRIORITY TWEETS -->
          ${medPriority.length ? sectionHeader('MEDIUM', medPriority.length, '#f4a261') : ''}
          ${medPriority.map((t, i) => tweetCard(t, i)).join('')}

          <!-- FOOTER -->
          <tr>
            <td style="padding-top:32px; border-top:1px solid #1e2330;">
              <p style="color:#3a4050; font-size:11px; font-family:'Courier New',monospace;
                        margin:0; line-height:1.8; text-align:center;">
                FlowVigil X Monitor · Runs every 30 minutes<br>
                <a href="https://flowvigil.com" style="color:#00c2a8; text-decoration:none;">flowvigil.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // Verify this is a legitimate Vercel cron call or your own test
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const allNewTweets = [];

    for (const group of KEYWORD_GROUPS) {
      const { tweets, users } = await searchTweets(group.query);

      // Filter tweets
      const filtered = tweets.filter(t => {
        const user = users[t.author_id];
        if (!user) return false;
        if (user.followers < MIN_FOLLOWERS) return false;
        if ((t.public_metrics?.like_count || 0) < MIN_LIKES) return false;
        if (!isFresh(t.created_at)) return false;
        return true;
      });

      if (!filtered.length) continue;

      // Check which tweet IDs we've already seen
      const ids = filtered.map(t => t.id);
      const seenIds = await getSeenIds(ids);

      // Keep only new ones
      const newTweets = filtered
        .filter(t => !seenIds.has(t.id))
        .map(t => ({
          id: t.id,
          keyword: group.label,
          priority: group.priority,
          username: users[t.author_id]?.username || 'unknown',
          followers: users[t.author_id]?.followers || 0,
          likes: t.public_metrics?.like_count || 0,
          text: t.text,
          createdAt: t.created_at,
          timeAgo: timeAgo(t.created_at),
        }));

      allNewTweets.push(...newTweets);

      // Mark all as seen in Supabase
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

      // Respect X API rate limits — wait 1 second between keyword searches
      await new Promise(r => setTimeout(r, 1000));
    }

    // Only send email if there are new tweets to engage on
    if (!allNewTweets.length) {
      console.log('No new tweets found this run.');
      return res.status(200).json({ success: true, newTweets: 0 });
    }

    // Sort: high priority first, then by follower count descending
    allNewTweets.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
      return b.followers - a.followers;
    });

    // Send digest email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'FlowVigil X Monitor <hello@flowvigil.com>',
        to: 'hello@flowvigil.com',
        subject: `🔥 ${allNewTweets.length} new tweet${allNewTweets.length !== 1 ? 's' : ''} to engage on — FlowVigil Monitor`,
        html: buildEmailHtml(allNewTweets),
      }),
    });

    if (!emailRes.ok) {
      console.error('Resend error:', await emailRes.text());
    }

    console.log(`Sent digest: ${allNewTweets.length} new tweets`);
    return res.status(200).json({ success: true, newTweets: allNewTweets.length });

  } catch (err) {
    console.error('X Monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}
