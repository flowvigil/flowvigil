// api/waitlist.js
// Vercel serverless function — handles waitlist signups
// Stores lead in Supabase + sends confirmation email via Resend

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://flowvigil.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { name, email, clients, timestamp } = req.body;

    // Basic validation
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // 1. Store lead in Supabase
    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        source: 'waitlist',
        name: name || null,
        email,
        clients: clients || null,
        score: null,
        tier: null
      })
    });

    if (!supabaseRes.ok) {
      const err = await supabaseRes.text();
      console.error('Supabase error:', err);
      // Don't block — still send email even if DB fails
    }

    // 2. Send confirmation email via Resend
    const firstName = name ? name.split(' ')[0] : 'there';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Rao from FlowVigil <hello@flowvigil.com>',
        to: email,
        subject: "You're on the FlowVigil waitlist 👁",
        html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to FlowVigil</title>
</head>
<body style="margin:0; padding:0; background:#080b0f; font-family: 'DM Mono', monospace, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080b0f; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom: 32px;">
              <span style="font-family: sans-serif; font-size: 20px; font-weight: 800; color: #f0f2f5; letter-spacing: -0.5px;">
                👁 FlowVigil
              </span>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background: #111518; border: 1px solid #1a1f25; border-radius: 8px; padding: 36px 32px;">

              <p style="color: #00c2a8; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 20px; font-family: monospace;">
                Early Access Confirmed
              </p>

              <h1 style="color: #f0f2f5; font-size: 26px; font-weight: 800; margin: 0 0 16px; line-height: 1.2; font-family: sans-serif; letter-spacing: -0.5px;">
                You're on the list, ${firstName}.
              </h1>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0 0 24px;">
                Welcome to FlowVigil — the monitoring layer that tells you before your client does.
                We're building this for agencies exactly like yours, and early signups get
                <strong style="color: #f0f2f5;">3 months free</strong> when we launch.
              </p>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0 0 24px;">
                While you wait — one quick question I'd love your honest answer to:
              </p>

              <div style="background: #1a1f25; border-left: 3px solid #00c2a8; padding: 16px 20px; margin: 0 0 28px; border-radius: 0 4px 4px 0;">
                <p style="color: #f0f2f5; font-size: 14px; margin: 0; line-height: 1.6; font-style: italic;">
                  "What's the last time a broken workflow cost you a client or a conversation you didn't want to have?"
                </p>
              </div>

              <p style="color: #6b7585; font-size: 14px; line-height: 1.7; margin: 0 0 28px;">
                Just hit reply — I read every response personally. Your answer shapes what we build first.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: #00c2a8; border-radius: 4px;">
                    <a href="https://flowvigil.com/score"
                       style="display: inline-block; padding: 14px 28px; color: #080b0f; font-size: 13px; font-weight: 800; text-decoration: none; font-family: sans-serif; letter-spacing: 0.05em; text-transform: uppercase;">
                      Take the Silent Failure Scorecard →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #4a5260; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
                Takes 5 minutes. Shows you exactly how exposed your client workflows are right now.
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="color: #3a4050; font-size: 11px; font-family: monospace; margin: 0;">
                FlowVigil · No more silent failures.<br>
                <a href="https://flowvigil.com" style="color: #00c2a8; text-decoration: none;">flowvigil.com</a>
                · <a href="mailto:hello@flowvigil.com" style="color: #3a4050; text-decoration: none;">hello@flowvigil.com</a>
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
      const err = await emailRes.text();
      console.error('Resend error:', err);
    }

    // 3. Send internal notification to yourself
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'FlowVigil Leads <hello@flowvigil.com>',
        to: 'hello@flowvigil.com',
        subject: `🎯 New waitlist signup: ${email}`,
        html: `
          <p><strong>New waitlist signup!</strong></p>
          <p><strong>Name:</strong> ${name || 'Not provided'}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Clients managed:</strong> ${clients || 'Not provided'}</p>
          <p><strong>Time:</strong> ${timestamp || new Date().toISOString()}</p>
          <p><a href="https://app.supabase.com">View in Supabase →</a></p>
        `
      })
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
