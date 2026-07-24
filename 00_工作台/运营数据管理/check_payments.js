const { Client } = require('pg');
(async () => {
  const password = process.env.DB_PASS || process.env.DB_PASSWORD;
  if (!password) throw new Error('DB_PASS or DB_PASSWORD environment variable is required');
  const c = new Client({
    host: process.env.DB_HOST || '122.51.56.50',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password,
    database: 'postgres'
  });
  await c.connect();
  const r1 = await c.query('SELECT COUNT(*) AS rows FROM space_payments');
  const r2 = await c.query("SELECT COUNT(*) AS legacy FROM space_usage WHERE received_amount > 0");
  const r3 = await c.query(`SELECT s.id, s.received_amount AS legacy,
            COALESCE(SUM(p.amount), 0) AS sub_total,
            s.received_amount - COALESCE(SUM(p.amount), 0) AS diff
     FROM space_usage s
     LEFT JOIN space_payments p ON p.space_usage_id = s.id
     GROUP BY s.id, s.received_amount
     HAVING s.received_amount > 0 AND s.received_amount <> COALESCE(SUM(p.amount), 0)
     LIMIT 5`);
  console.log('子表行数:', r1.rows[0].rows, '旧字段非零行数:', r2.rows[0].legacy);
  console.log('数据不一致样本（最多 5 行）:', JSON.stringify(r3.rows, null, 2));
  await c.end();
})();
