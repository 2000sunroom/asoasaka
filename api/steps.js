const { createClient } = require('@libsql/client/web');

let client = null;
function getDB() {
  if (!client) {
    const url = (process.env.TURSO_DATABASE_URL || '').trim().replace('libsql://', 'https://');
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getDB();

  try {
    if (req.method === 'POST') {
      const { deviceId, date, steps, goal } = req.body;

      if (!deviceId || !date) {
        return res.status(400).json({ error: 'deviceId and date are required' });
      }

      await db.execute({
        sql: `INSERT INTO daily_steps (device_id, date, steps, goal)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(device_id, date) DO UPDATE SET
                steps = excluded.steps,
                goal = excluded.goal`,
        args: [deviceId, date, steps || 0, goal || 8000],
      });

      return res.status(200).json({ ok: true });

    } else if (req.method === 'GET') {
      const { deviceId, date } = req.query;

      if (!deviceId || !date) {
        return res.status(400).json({ error: 'deviceId and date are required' });
      }

      const result = await db.execute({
        sql: 'SELECT steps, goal FROM daily_steps WHERE device_id = ? AND date = ?',
        args: [deviceId, date],
      });

      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0]);
      } else {
        return res.status(200).json({ steps: 0, goal: 8000 });
      }

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('API /steps error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
