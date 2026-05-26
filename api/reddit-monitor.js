// api/reddit-monitor.js v4
// Uses Reddit RSS feeds — no API key, no auth, no rate limit issues
// Parses XML from public RSS endpoints across 6 subreddits

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;

// ─── CONFIG ────────────────────────────────────────────────────────────────

const SUBREDDITS = ['zapier', 'nocode', 'automation', 'n8n', 'SaaS', 'smallbusiness'];

const KEYWORD_GROUPS = [
  { label: 'Zapier failures',    keywords: ['zapier+broke', 'zapier+stopped', 'zap+failed', 'zapier+error'],        priority: 'HIGH',   account: 'flowvigil' },
  { label: 'Workflow broke',     keywords: ['workflow+broke', 'workflow+stopped', 'workflow+error'],                 priority: 'HIGH',   account: 'both'      },
  { label: 'n8n errors',         keywords: ['n8n+error', 'n8n+broke', 'n8n+stopped'],                               priority: 'HIGH',   account: 'flowvigil' },
  { label: 'Webhook issues',     keywords: ['webhook+failed', 'webhook+error', 'webhook+not+firing'],                priority: 'HIGH',   account: 'both'      },
  { label: 'Automation stopped', keywords: ['automation+stopped', 'automation+broke', 'automation+failed'],          priority: 'HIGH',   account: 'both'      },
  { label: 'Agency pain',        keywords: ['automation+agency', 'client+automations', 'nocode+retainer'],           priority: 'MEDIUM', account: 'both'      },
  { label: 'Monitoring need',    keywords: ['monitor+workflows', 'automation+monitoring', 'monitor+zapier'],         priority: 'MEDIUM', account: 'flowvigil' },
  { label: 'Client issues',      keywords: ['client+complained', 'client+noticed', 'found+out+from+client'],        priority: 'MEDIUM', account: 'flowvigil' },
  { label: 'AI agent failures',  keywords: ['AI+agent+broke', 'AI+agent+failed', 'agent+error'],                    priority: 'LOW',    account: 'engopsai'  },
  { label: 'Silent failures',    keywords: ['silent+failure', 'how+to+monitor+automation', 'didnt+know+broke'],     priority: 'LOW',    account: 'both'      },
];

const MAX_AGE_HOURS = 24;
const MAX_POSTS     = 15;

// ─── RSS FETCH + PARSE ─────────────────────────────────────────────────────
async function fetchRSS(subreddit, keyword) {
  const url = `https://www.reddit.com/r/${subreddit}/search.rss?` +
    new URLSearchParams({
      q:           keyword.replace(/\+/g, ' '),
      sort:        'new',
      t:           'day',
      restrict_sr: '1',
    });

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FlowVigil-RSS-Monitor/4.0',
        'Accept':     'application/rss+xml, application/xml, text/xml',
      }
    });

    if (res.status === 429) { console.log(`Rate limited on r/${subreddit}`); return []; }
    if (!res.ok) { console.error(`RSS error: ${res.status} for r/${subreddit} "${keyword}"`); return []; }

    const xml = await res.text();
    return parseRSS(xml, subreddit);

  } catch (err) {
    console.error(`RSS fetch error for r/${subreddit}:`, err.message);
    return [];
  }
}

function parseRSS(xml, subreddit) {
  const posts = [];

  // Extract all <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const id       = extractTag(entry, 'id')?.split('/comments/')?.[1]?.split('/')?.[0];
    const title    = decodeHTML(extractTag(entry, 'title'));
    const link     = extractAttr(entry, 'link', 'href');
    const updated  = extractTag(entry, 'updated');
    const author   = extractTag(entry, 'name') || 'unknown';
    const content  = decodeHTML(extractTag(entry, 'content') || '');

    // Extract post text preview from content HTML
    const textMatch = content.match(/<div class="md"><p>(.*?)<\/p>/);
    const preview   = textMatch ? decodeHTML(textMatch[1]).replace(/<[^>]+>/g, '').trim() : '';

    // Extract score and comments from content
    const scoreMatch    = content.match(/(\d+) point/);
    const commentsMatch = content.match(/(\d+) comment/);
    const score         = scoreMatch    ? parseInt(scoreMatch[1])    : 0;
    const numComments   = commentsMatch ? parseInt(commentsMatch[1]) : 0;

    if (!id || !title || !link) continue;

    const createdUtc = updated ? Math.floor(new Date(updated).getTime() / 1000) : 0;

    posts.push({ id, title, url: link, author, score, numComments, preview, subreddit, createdUtc });
  }

  return posts;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function extractAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function decodeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
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
    return new Set((await res.json()).map(r => r.id));
  } catch { return new Set(); }
}

async function markAsSeen(posts) {
  if (!posts.length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/seen_reddit_posts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'return=minimal' },
      body:    JSON.stringify(posts),
    });
  } catch (err) { console.error('Supabase error:', err.message); }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
const isFresh  = utc => (Date.now() / 1000 - utc) <= MAX_AGE_HOURS * 3600;
const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '...' : (s || '');
const timeAgo  = utc => { const m = Math.round((Date.now()/1000-utc)/60); return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`; };
const pc = p => p==='HIGH'?{bg:'#2a0a0d',border:'#e63946',text:'#e63946'}:p==='MEDIUM'?{bg:'#2a1d0a',border:'#f4a261',text:'#f4a261'}:{bg:'#0a1a2a',border:'#457b9d',text:'#457b9d'};
const ab = a => a==='flowvigil'?{label:'@FlowVigil',color:'#00c2a8'}:a==='engopsai'?{label:'@EngOpsAI',color:'#a78bfa'}:{label:'Both',color:'#6b7585'};

// ─── EMAIL ─────────────────────────────────────────────────────────────────
function buildEmail(posts) {
  const high = posts.filter(p => p.priority==='HIGH');
  const med  = posts.filter(p => p.priority==='MEDIUM');
  const low  = posts.filter(p => p.priority==='LOW');

  const card = p => {
    const c=pc(p.priority), a=ab(p.account);
    return `<tr><td style="padding:0 0 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#12151a;border:1px solid #1e2330;border-left:3px solid ${c.border};border-radius:0 8px 8px 0;">
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
          ${p.preview?`<p style="color:#7a8599;font-size:13px;line-height:1.65;margin:0 0 14px;border-left:2px solid #1e2330;padding-left:12px;font-style:italic;">"${truncate(p.preview,200)}"</p>`:''}
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            <td><span style="color:#4a5568;font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;">${p.keyword} · ${p.numComments} comments</span></td>
            <td align="right"><table cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:6px;"><a href="${p.url}" style="display:inline-block;padding:7px 14px;background:#00c2a8;color:#0a0c10;font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;">View Post →</a></td>
              <td><a href="${p.url}" style="display:inline-block;padding:7px 14px;background:#1e2330;color:${a.color};font-size:11px;font-weight:700;text-decoration:none;border-radius:4px;text-transform:uppercase;border:1px solid ${a.color};">Reply as ${a.label} →</a></td>
            </tr></table></td>
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
        <td style="color:${color};font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">${label} · ${arr.length} post${arr.length!==1?'s':''}</td>
      </tr></table>
    </td></tr>${arr.map(card).join('')}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0c10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10;padding:48px 20px;">
<tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
  <tr><td style="padding-bottom:28px;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td><table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;vertical-align:middle;"><img src="https://www.flowvigil.com/FlowVigilLogo.jpg" width="28" height="28" style="border-radius:6px;display:block;" alt="FlowVigil"></td>
        <td style="vertical-align:middle;"><span style="font-size:18px;font-weight:700;color:#e8eaed;">FlowVigil</span><span style="font-size:11px;color:#4a5568;font-family:'Courier New',monospace;margin-left:8px;">Reddit Monitor</span></td>
      </tr></table></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:11px;color:#4a5568;">${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})} IST</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#12151a;border:1px solid #1e2330;border-radius:10px;padding:28px 32px 24px;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
      <td style="color:#4a5568;font-family:'Courier New',monospace;font-size:11px;">00</td>
      <td style="width:12px;"></td>
      <td style="color:#ff6314;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;">Reddit Engagement Digest</td>
    </tr></table>
    <h1 style="color:#e8eaed;font-size:22px;font-weight:700;margin:0 0 8px;">🤖 ${posts.length} post${posts.length!==1?'s':''} to engage on</h1>
    <p style="color:#7a8599;font-size:13px;margin:0;">${high.length} high · ${med.length} medium · ${low.length} low · r/${SUBREDDITS.join(', r/')}</p>
  </td></tr>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${section('🔥 High Priority','01',high,'#e63946')}
    ${section('🟡 Medium Priority','02',med,'#f4a261')}
    ${section('🔵 Low Priority','03',low,'#457b9d')}
  </table>
  <tr><td style="padding-top:28px;border-top:1px solid #1e2330;text-align:center;">
    <p style="color:#3a4050;font-size:11px;font-family:'Courier New',monospace;margin:0;">FlowVigil Reddit Monitor v4 (RSS) · <a href="https://flowvigil.com" style="color:#00c2a8;text-decoration:none;">flowvigil.com</a></p>
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
    const allNew    = [];
    const seenInRun = new Set();

    for (const group of KEYWORD_GROUPS) {
      for (const keyword of group.keywords) {
        // Only search the most relevant subreddit per keyword to keep within time limit
        // Use the first subreddit in the list that makes sense per keyword
        const targetSubs = group.priority === 'HIGH'
          ? SUBREDDITS.slice(0, 4)   // HIGH: search 4 subreddits
          : SUBREDDITS.slice(0, 2);  // MED/LOW: search 2 subreddits

        for (const subreddit of targetSubs) {
          const posts = await fetchRSS(subreddit, keyword);

          const filtered = posts.filter(p =>
            p.id &&
            isFresh(p.createdUtc) &&
            !seenInRun.has(p.id)
          );

          if (!filtered.length) continue;

          const seenIds = await getSeenIds(filtered.map(p => p.id));
          const fresh   = filtered.filter(p => !seenIds.has(p.id)).map(p => ({
            ...p,
            keyword:  group.label,
            priority: group.priority,
            account:  group.account,
            timeAgo:  timeAgo(p.createdUtc),
          }));

          fresh.forEach(p => seenInRun.add(p.id));
          allNew.push(...fresh);

          if (fresh.length) {
            console.log(`r/${subreddit} "${keyword}": ${fresh.length} new`);
            await markAsSeen(fresh.map(p => ({
              id: p.id, subreddit: p.subreddit,
              keyword: p.keyword, title: p.title,
              author: p.author, score: p.score,
            })));
          }

          // Respect Reddit's crawl delay for RSS
          await new Promise(r => setTimeout(r, 800));
        }
      }
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

    const toSend    = allNew.slice(0, MAX_POSTS);
    const emailRes  = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body:    JSON.stringify({
        from:    'FlowVigil Reddit Monitor <hello@flowvigil.com>',
        to:      'hello@flowvigil.com',
        subject: `🤖 ${toSend.length} Reddit post${toSend.length!==1?'s':''} to engage on — FlowVigil`,
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
