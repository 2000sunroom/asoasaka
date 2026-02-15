const { getClient } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getClient();

  try {
    if (req.method === 'GET') {
      const { deviceId } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId は必須です' });
      }

      const result = await db.execute({
        sql: 'SELECT goal, stride, weight, sensitivity FROM settings WHERE device_id = ?',
        args: [deviceId],
      });

      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0]);
      } else {
        return res.status(200).json({ goal: 8000, stride: 70, weight: 60, sensitivity: 12 });
      }

    } else if (req.method === 'POST') {
      const { deviceId, goal, stride, weight, sensitivity } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId は必須です' });
      }

      await db.execute({
        sql: `INSERT INTO settings (device_id, goal, stride, weight, sensitivity, updated_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(device_id) DO UPDATE SET
                goal = excluded.goal,
                stride = excluded.stride,
                weight = excluded.weight,
                sensitivity = excluded.sensitivity,
                updated_at = datetime('now')`,
        args: [
          deviceId,
          goal || 8000,
          stride || 70,
          weight || 60,
          sensitivity || 12,
        ],
      });

      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('API /settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
