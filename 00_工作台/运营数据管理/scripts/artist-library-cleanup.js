'use strict';
// Explicit maintenance command: removes only expired staged/removed-unlinked uploads.
const fs = require('node:fs'),
  path = require('node:path');
const { Client } = require('pg');
async function cleanup(client, dir, days = 7) {
  if (!Number.isFinite(days) || days < 1)
    throw new Error('Retention must be at least one day');
  const root = path.resolve(dir);
  if (root === path.parse(root).root) throw new Error('Unsafe file directory');
  await client.query('BEGIN');
  let count = 0;
  try {
    const rows = (
      await client.query(
        "SELECT id FROM artist_files WHERE artist_id IS NULL AND state IN ('staged','removed') AND created_at < now()-($1*interval '1 day') FOR UPDATE SKIP LOCKED",
        [days],
      )
    ).rows;
    for (const row of rows) {
      if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('Unsafe file id');
      await fs.promises.unlink(path.join(root, row.id)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
      await client.query('DELETE FROM artist_files WHERE id=$1', [row.id]);
      count++;
    }
    const cutoff = Date.now() - days * 86400000;
    for (const name of await fs.promises.readdir(root)) {
      if (!/^[a-f0-9-]{36}\.part$/.test(name)) continue;
      const file = path.join(root, name),
        stat = await fs.promises.lstat(file).catch(() => null);
      if (stat?.isFile() && stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file);
        count++;
      }
    }
    await client.query('COMMIT');
    return count;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}
module.exports = cleanup;
if (require.main === module) {
  if (!process.env.ARTIST_FILE_DIR)
    throw new Error('Explicit ARTIST_FILE_DIR required');
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
      console.log(
        'Expired unlinked files removed:',
        await cleanup(
          client,
          process.env.ARTIST_FILE_DIR,
          Number(process.env.ARTIST_STAGED_RETENTION_DAYS || 7),
        ),
      );
    } finally {
      await client.end();
    }
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
