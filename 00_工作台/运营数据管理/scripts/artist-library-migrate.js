'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { Client } = require('pg');
async function migrate(client) {
  for (const file of ['20261103_artist_library.sql', '20261107_artist_mail.sql'])
    await client.query(fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8'));
}
module.exports = migrate;
if (require.main === module) {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: 'postgres',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
  });
  (async () => {
    await client.connect();
    try {
      await client.query('BEGIN');
      await migrate(client);
      await client.query('COMMIT');
      console.log('Artist library migration complete');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      await client.end();
    }
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
