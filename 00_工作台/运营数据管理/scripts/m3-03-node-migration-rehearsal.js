const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const projectDir = path.resolve(__dirname, '..');
const sqlDir = path.join(projectDir, 'sql');
const appSql = path.join(projectDir, 'app', 'sql', 'init.sql');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logDir = path.join(projectDir, 'tmp', `m3-03-node-rehearsal-${timestamp}`);

const dbUrl = process.env.AIWEI_TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const skipRollback = process.argv.includes('--skip-rollback');
const allowProductionLikeUrl = process.argv.includes('--allow-production-like-url');

const blockedPatterns = [
  'iwe.ucanart.cc',
  '122.51.56.50',
  'prod',
  'production'
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertSafeDatabaseUrl(url) {
  if (!url) {
    fail('AIWEI_TEST_DATABASE_URL or DATABASE_URL is required. Use a local/test PostgreSQL database only.');
  }

  if (allowProductionLikeUrl) return;

  const lowerUrl = url.toLowerCase();
  const looksProductionLike = blockedPatterns.some(pattern => lowerUrl.includes(pattern));
  if (looksProductionLike) {
    fail('Database URL looks production-like. Refusing to run rehearsal without explicit approval.');
  }
}

function readSql(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing SQL file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function runSqlFile(client, label, filePath) {
  const sql = readSql(filePath);
  const startedAt = new Date();
  const logPath = path.join(logDir, `${label}.log`);

  console.log(`Running ${label} ...`);
  try {
    const result = await client.query(sql);
    const resultSummary = Array.isArray(result)
      ? result.map((entry, index) => ({
          index,
          command: entry.command,
          rowCount: entry.rowCount,
          rows: entry.rows && entry.rows.length ? entry.rows.slice(0, 20) : undefined
        }))
      : {
          command: result.command,
          rowCount: result.rowCount,
          rows: result.rows && result.rows.length ? result.rows.slice(0, 20) : undefined
        };

    fs.writeFileSync(logPath, JSON.stringify({
      label,
      filePath,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ok: true,
      result: resultSummary
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(logPath, JSON.stringify({
      label,
      filePath,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        position: error.position,
        detail: error.detail
      }
    }, null, 2));
    throw new Error(`${label} failed. See ${logPath}. ${error.message}`);
  }
}

async function main() {
  assertSafeDatabaseUrl(dbUrl);
  fs.mkdirSync(logDir, { recursive: true });

  console.log('M3-03 Node migration rehearsal started.');
  console.log(`Logs: ${logDir}`);
  console.log('Database URL is intentionally not printed.');

  const client = new Client({
    connectionString: dbUrl
  });

  await client.connect();
  try {
    await runSqlFile(client, '00-init-1-0-schema', appSql);
    await runSqlFile(client, '01-business-dimensions', path.join(sqlDir, '20260903_m3_02_business_dimensions.sql'));
    await runSqlFile(client, '02-product-gallery-space-extensions', path.join(sqlDir, '20260903_m3_02_product_gallery_space_extensions.sql'));
    await runSqlFile(client, '03-business-fact-views', path.join(sqlDir, '20260903_m3_02_business_fact_views.sql'));
    await runSqlFile(client, '04-validate', path.join(sqlDir, '20260903_m3_02_validate.sql'));

    if (!skipRollback) {
      await runSqlFile(client, '05-rollback', path.join(sqlDir, '20260903_m3_02_rollback.sql'));
      await runSqlFile(client, '06-reinit-after-rollback', appSql);
    }
  } finally {
    await client.end();
  }

  console.log('M3-03 Node migration rehearsal finished.');
}

main().catch(error => fail(error.message));
