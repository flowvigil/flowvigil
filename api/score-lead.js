// api/score-lead.js
// Vercel serverless function — handles scorecard email captures
// Stores lead in Supabase + sends personalised score delivery email via Resend

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getTier(score) {
  if (score <= 9)  return { label: 'Critical Exposure',  color: '#e63946', accent: '#2a0a0d', border: '#3d1117', emoji: '🔴' };
  if (score <= 18) return { label: 'Partial Coverage',   color: '#f4a261', accent: '#2a1d0a', border: '#3d2c11', emoji: '🟡' };
  if (score <= 25) return { label: 'Strong Foundation',  color: '#457b9d', accent: '#0a1a2a', border: '#112a3d', emoji: '🔵' };
  return           { label: 'Agency Operator',           color: '#00c2a8', accent: '#0a2a24', border: '#113d34', emoji: '🏆' };
}

function getTierMessage(score) {
  if (score <= 9) return {
    headline: "Your agency is one silent failure away from losing a retainer.",
    body: "You're running blind right now. Client workflows are breaking and you're finding out from them — not your own systems. The good news: FlowVigil can fix this in under 5 minutes.",
    cta: "Start protecting your retainers →",
    urgency: "Agencies at your score level typically lose 1–2 retainer clients per year from preventable silent failures."
  };
  if (score <= 18) return {
    headline: "You've got some protection — but dangerous blind spots remain.",
    body: "You're doing better than most agencies, but your monitoring has gaps. Some clients are covered, others aren't. One uncovered account is all it takes to lose a retainer you've spent months building.",
    cta: "Fill the gaps with FlowVigil →",
    urgency: "The accounts you're NOT monitoring are your biggest risk. FlowVigil covers all of them in one dashboard."
  };
  if (score <= 25) return {
    headline: "You're proactive — but you're doing it manually.",
    body: "Solid instincts and good habits. But if your monitoring depends on you showing up every morning, it's a routine, not a system. What happens when you're sick, travelling, or just busy?",
    cta: "Automate what you're doing manually →",
    urgency: "FlowVigil does in 5 minutes what your morning routine does in 45."
  };
  return {
    headline: "You're running a genuinely professional operation.",
    body: "Top 5% of automation agencies. Your clients are protected and they see your value. We'd love to compare notes — and show you what FlowVigil adds on top of what you've already built.",
    cta: "See what FlowVigil adds →",
    urgency: "Even at your level, there's always one more gap. FlowVigil finds it."
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { email, score, timestamp } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const tier = getTier(score);
    const msg  = getTierMessage(score);

    // 1. Store in Supabase
    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        source: 'scorecard',
        email,
        score,
        tier: tier.label,
        name: null,
        clients: null
      })
    });

    if (!supabaseRes.ok) {
      console.error('Supabase error:', await supabaseRes.text());
    }

    // 2. Send personalised score delivery email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Rao from FlowVigil <hello@flowvigil.com>',
        to: email,
        subject: `Your Agency Monitoring Score: ${score}/30 — ${tier.label}`,
        html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#0a0c10; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10; padding: 48px 20px;">
    <tr>
      <td align="center">
        <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px; width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom: 36px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 10px; vertical-align: middle;">
                    <img src="https://www.flowvigil.com/FlowVigilLogo.jpg" width="28" height="28" style="border-radius:6px; display:block;" alt="FlowVigil">
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 18px; font-weight: 700; color: #e8eaed; letter-spacing: -0.5px;">FlowVigil</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SECTION LABEL -->
          <tr>
            <td style="padding-bottom: 24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color: #4a5568; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.1em;">01</td>
                  <td style="width: 12px;"></td>
                  <td style="color: ${tier.color}; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;">${tier.emoji} ${tier.label}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SCORE CARD -->
          <tr>
            <td style="background: ${tier.accent}; border: 1px solid ${tier.border}; border-radius: 10px; padding: 40px 36px; margin-bottom: 14px;">

              <div style="margin-bottom: 24px;">
                <span style="font-size: 72px; font-weight: 800; color: ${tier.color}; line-height: 1; letter-spacing: -3px;">${score}</span>
                <span style="font-size: 22px; color: #4a5568; font-family: 'Courier New', monospace; vertical-align: top; margin-left: 4px;">/30</span>
              </div>

              <h1 style="color: #e8eaed; font-size: 24px; font-weight: 700; margin: 0 0 16px; line-height: 1.25; letter-spacing: -0.5px;">
                ${msg.headline}
              </h1>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0;">
                ${msg.body}
              </p>

            </td>
          </tr>

          <tr><td style="height: 14px;"></td></tr>

          <!-- URGENCY CARD -->
          <tr>
            <td style="background: #12151a; border: 1px solid #1e2330; border-radius: 10px; padding: 32px 36px;">

              <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="color: #4a5568; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.1em;">02</td>
                  <td style="width: 12px;"></td>
                  <td style="color: #00c2a8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;">What this means</td>
                </tr>
              </table>

              <!-- CALLOUT -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
                <tr>
                  <td style="width: 3px; background: ${tier.color}; border-radius: 2px;"></td>
                  <td style="padding: 18px 22px; background: #181c24; border-radius: 0 8px 8px 0;">
                    <p style="color: #c0c7d4; font-size: 14px; margin: 0; line-height: 1.65;">
                      ${msg.urgency}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA BUTTON -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background: #00c2a8; border-radius: 6px;">
                          <a href="https://flowvigil.com/#pricing"
                             style="display: inline-block; padding: 14px 30px; color: #0a0c10; font-size: 13px; font-weight: 700; text-decoration: none; letter-spacing: 0.04em; text-transform: uppercase;">
                            ${msg.cta}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr><td style="height: 14px;"></td></tr>

          <!-- WHAT'S NEXT CARD -->
          <tr>
            <td style="background: #12151a; border: 1px solid #1e2330; border-radius: 10px; padding: 32px 36px;">

              <table cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td style="color: #4a5568; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.1em;">03</td>
                  <td style="width: 12px;"></td>
                  <td style="color: #00c2a8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;">What happens next</td>
                </tr>
              </table>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
                I'm the founder of FlowVigil. Over the next few days I'll send you a short series on how agencies like yours can fix monitoring gaps — whether or not you use FlowVigil.
              </p>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0;">
                In the meantime — hit reply and tell me: <strong style="color: #c0c7d4;">what's your current setup for monitoring client workflows?</strong> Even two sentences helps me understand exactly what to build first.
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top: 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top: 1px solid #1e2330; padding-top: 20px; text-align: center;">
                    <p style="color: #3a4050; font-size: 11px; font-family: 'Courier New', monospace; margin: 0; line-height: 1.8;">
                      FlowVigil — No more silent failures.<br>
                      <a href="https://flowvigil.com" style="color: #00c2a8; text-decoration: none;">flowvigil.com</a>
                      &nbsp;·&nbsp;
                      <a href="mailto:hello@flowvigil.com" style="color: #3a4050; text-decoration: none;">Unsubscribe</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `
      })
    });

    if (!emailRes.ok) {
      console.error('Resend score email error:', await emailRes.text());
    }

    // 3. Internal notification — hot leads only (score under 19)
    if (score <= 18) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'FlowVigil Leads <hello@flowvigil.com>',
          to: 'hello@flowvigil.com',
          subject: `🔥 HOT LEAD: ${email} scored ${score}/30 (${tier.label})`,
          html: `
            <div style="font-family: sans-serif; background: #0a0c10; color: #e8eaed; padding: 24px;">
              <h2 style="color: #e63946; margin: 0 0 16px;">🔥 Hot Scorecard Lead</h2>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Score:</strong> <span style="color: ${tier.color}; font-weight: 700;">${score}/30 — ${tier.label}</span></p>
              <p><strong>Time:</strong> ${timestamp || new Date().toISOString()}</p>
              <div style="margin-top: 16px; padding: 14px 18px; background: #181c24; border-left: 3px solid #e63946; border-radius: 0 6px 6px 0;">
                <p style="color: #f0f2f5; margin: 0; font-size: 14px;"><strong>Action:</strong> Reach out within 24 hours — this person is actively feeling the pain.</p>
              </div>
            </div>
          `
        })
      });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Score lead handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
