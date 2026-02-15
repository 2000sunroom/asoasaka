const { getClient } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();
  const { deviceId, days } = req.query;

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId は必須です' });
  }

  const numDays = parseInt(days) || 7;

  try {
    const result = await db.execute({
      sql: `SELECT date, steps, goal
            FROM daily_steps
            WHERE device_id = ? AND date >= date('now', ?)
            ORDER BY date DESC`,
      args: [deviceId, `-${numDays} days`],
    });

    return res.status(200).json({ history: result.rows });
  } catch (err) {
    console.error('API /history error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
