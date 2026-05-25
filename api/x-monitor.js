export default async function handler(req, res) {

  // Auth check — accepts both header and query param
  const authHeader = req.headers.authorization;
  const querySecret = req.query?.secret;
  const isAuthorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    querySecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      debug: {
        cron_secret_set: !!process.env.CRON_SECRET,
        query_secret_received: querySecret,
        header_received: authHeader,
        match_query: querySecret === process.env.CRON_SECRET,
        match_header: authHeader === `Bearer ${process.env.CRON_SECRET}`
      }
    });
  }

  return res.status(200).json({ 
    success: true, 
    message: 'Auth passed',
    cron_secret_value: process.env.CRON_SECRET
  });
}
