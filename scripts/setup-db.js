/**
 * Turso データベース セットアップスクリプト
 *
 * 使い方:
 *   1. .env ファイルに TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を設定
 *   2. node scripts/setup-db.js を実行
 */

require('dotenv/config');
const { createClient } = require('@libsql/client');

async function setup() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    console.error('エラー: .env ファイルに TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を設定してください');
    console.error('参考: .env.example を .env にコピーして値を入力');
    process.exit(1);
  }

  console.log('データベースに接続中...');
  const client = createClient({ url, authToken });

  console.log('テーブルを作成中...');

  await client.batch([
    `CREATE TABLE IF NOT EXISTS daily_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      date TEXT NOT NULL,
      steps INTEGER DEFAULT 0,
      goal INTEGER DEFAULT 8000,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(device_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      goal INTEGER DEFAULT 8000,
      stride INTEGER DEFAULT 70,
      weight INTEGER DEFAULT 60,
      sensitivity INTEGER DEFAULT 12,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_daily_steps_device_date ON daily_steps(device_id, date)`,
    `CREATE INDEX IF NOT EXISTS idx_settings_device ON settings(device_id)`,
  ]);

  console.log('');
  console.log('セットアップ完了!');
  console.log('  - daily_steps テーブル');
  console.log('  - settings テーブル');
  console.log('');

  await client.close();
}

setup().catch(err => {
  console.error('セットアップ失敗:', err.message);
  process.exit(1);
});
