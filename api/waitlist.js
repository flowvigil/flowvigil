// api/waitlist.js
// Vercel serverless function — handles waitlist signups
// Stores lead in Supabase + sends confirmation email via Resend

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
    const { name, email, clients, timestamp } = req.body;

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
                  <td style="color: #00c2a8; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;">Early access confirmed</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN CARD -->
          <tr>
            <td style="background: #12151a; border: 1px solid #1e2330; border-radius: 10px; padding: 40px 36px;">

              <h1 style="color: #e8eaed; font-size: 28px; font-weight: 700; margin: 0 0 18px; line-height: 1.2; letter-spacing: -0.8px;">
                You're on the list, ${firstName}.
              </h1>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0 0 26px;">
                Welcome to FlowVigil — the monitoring layer that tells you before your client does.
                We're building this for agencies exactly like yours, and early signups get
                <strong style="color: #e8eaed;">3 months free</strong> when we launch.
              </p>

              <!-- DIVIDER -->
              <div style="height: 1px; background: #1e2330; margin: 0 0 26px;"></div>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0 0 22px;">
                While you wait — one quick question I'd love your honest answer to:
              </p>

              <!-- CALLOUT -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
                <tr>
                  <td style="width: 3px; background: #00c2a8; border-radius: 2px;"></td>
                  <td style="padding: 18px 22px; background: #181c24; border-radius: 0 8px 8px 0;">
                    <p style="color: #c0c7d4; font-size: 14px; margin: 0; line-height: 1.65; font-style: italic;">
                      "What's the last time a broken workflow cost you a client — or a conversation you didn't want to have?"
                    </p>
                  </td>
                </tr>
              </table>

              <p style="color: #7a8599; font-size: 15px; line-height: 1.75; margin: 0 0 32px;">
                Just hit reply — I read every response personally. Your answer shapes what we build first.
              </p>

              <!-- CTA BUTTON -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background: #00c2a8; border-radius: 6px;">
                          <a href="https://flowvigil.com/score"
                             style="display: inline-block; padding: 14px 30px; color: #0a0c10; font-size: 13px; font-weight: 700; text-decoration: none; letter-spacing: 0.04em; text-transform: uppercase;">
                            Take the Silent Failure Scorecard →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="color: #4a5568; font-size: 12px; margin: 20px 0 0; line-height: 1.6; font-family: 'Courier New', monospace;">
                10 questions · 5 minutes · instant score
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
                      <a href="mailto:hello@flowvigil.com" style="color: #3a4050; text-decoration: none;">hello@flowvigil.com</a>
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
      const err = await emailRes.text();
      console.error('Resend error:', err);
    }

    // 3. Internal notification
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
          <div style="font-family: sans-serif; background: #0a0c10; color: #e8eaed; padding: 24px;">
            <h2 style="color: #00c2a8; margin: 0 0 16px;">New Waitlist Signup</h2>
            <p><strong>Name:</strong> ${name || 'Not provided'}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Clients managed:</strong> ${clients || 'Not provided'}</p>
            <p><strong>Time:</strong> ${timestamp || new Date().toISOString()}</p>
          </div>
        `
      })
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
