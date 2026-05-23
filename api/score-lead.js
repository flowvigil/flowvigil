// api/score-lead.js
// Vercel serverless function — handles scorecard email captures
// Stores lead in Supabase + sends personalised score delivery email via Resend

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getTier(score) {
  if (score <= 9)  return { label: 'Critical Exposure',    color: '#e63946', emoji: '🔴' };
  if (score <= 18) return { label: 'Partial Coverage',     color: '#f4a261', emoji: '🟡' };
  if (score <= 25) return { label: 'Strong Foundation',    color: '#457b9d', emoji: '🔵' };
  return           { label: 'Agency Operator',             color: '#00c2a8', emoji: '🏆' };
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
    urgency: "The accounts you're NOT monitoring are your biggest risk. FlowVigil covers all of them in one place."
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', 'https://flowvigil.com');
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
<body style="margin:0; padding:0; background:#080b0f; font-family: sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080b0f; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom: 28px;">
              <span style="font-size: 20px; font-weight: 800; color: #f0f2f5; letter-spacing: -0.5px;">
                👁 FlowVigil
              </span>
            </td>
          </tr>

          <!-- SCORE HERO -->
          <tr>
            <td style="background: #111518; border: 1px solid #1a1f25; border-radius: 8px; padding: 36px 32px; margin-bottom: 16px;">

              <p style="color: ${tier.color}; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 12px; font-family: monospace;">
                ${tier.emoji} ${tier.label}
              </p>

              <div style="margin-bottom: 20px;">
                <span style="font-size: 64px; font-weight: 800; color: ${tier.color}; line-height: 1; letter-spacing: -2px;">${score}</span>
                <span style="font-size: 20px; color: #6b7585; font-family: monospace;">/30</span>
              </div>

              <h1 style="color: #f0f2f5; font-size: 22px; font-weight: 800; margin: 0 0 14px; line-height: 1.25; letter-spacing: -0.5px;">
                ${msg.headline}
              </h1>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0 0 24px;">
                ${msg.body}
              </p>

              <div style="background: #1a1f25; border-left: 3px solid ${tier.color}; padding: 14px 18px; margin-bottom: 28px; border-radius: 0 4px 4px 0;">
                <p style="color: #c8cdd6; font-size: 13px; margin: 0; line-height: 1.6;">
                  ${msg.urgency}
                </p>
              </div>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: #00c2a8; border-radius: 4px;">
                    <a href="https://flowvigil.com/#pricing"
                       style="display: inline-block; padding: 14px 28px; color: #080b0f; font-size: 13px; font-weight: 800; text-decoration: none; letter-spacing: 0.05em; text-transform: uppercase;">
                      ${msg.cta}
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr><td style="height: 14px;"></td></tr>

          <!-- WHAT'S NEXT -->
          <tr>
            <td style="background: #111518; border: 1px solid #1a1f25; border-radius: 8px; padding: 28px 32px;">

              <p style="color: #00c2a8; font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 14px; font-family: monospace;">
                What happens next
              </p>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
                I'm the founder of FlowVigil. Over the next few days I'll send you a short series on how agencies like yours can fix monitoring gaps — whether or not you use FlowVigil.
              </p>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0;">
                In the meantime — hit reply and tell me: what's your current setup for monitoring client workflows? Even two sentences helps me understand exactly what to build first.
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="color: #3a4050; font-size: 11px; font-family: monospace; margin: 0; line-height: 1.8;">
                FlowVigil · No more silent failures.<br>
                <a href="https://flowvigil.com" style="color: #00c2a8; text-decoration: none;">flowvigil.com</a>
                · <a href="mailto:hello@flowvigil.com" style="color: #3a4050; text-decoration: none;">Unsubscribe</a>
              </p>
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
            <p><strong>Hot scorecard lead!</strong></p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Score:</strong> ${score}/30 — ${tier.label}</p>
            <p><strong>Time:</strong> ${timestamp || new Date().toISOString()}</p>
            <p style="color: red;"><strong>Action:</strong> Reach out within 24 hours — this person is actively feeling the pain.</p>
            <p><a href="https://app.supabase.com">View all leads in Supabase →</a></p>
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
