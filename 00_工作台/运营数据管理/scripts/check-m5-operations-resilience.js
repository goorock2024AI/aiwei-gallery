const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

global.window = {};
require('../app/js/operations-dashboard.js');
const dashboard = global.window.OperationsDashboard;

const first = dashboard._beginSectionLoad('trend');
assert.equal(first.aborted, false);
const second = dashboard._beginSectionLoad('trend');
assert.equal(first.aborted, true);
assert.equal(second.aborted, false);
const detail = dashboard._beginSectionLoad('detail');
assert.equal(second.aborted, false, 'Starting another section must not cancel trend');
assert.equal(detail.aborted, false);

dashboard._period = { year: '2026', month: '02' };
dashboard._detailType = 'revenue';
dashboard._detailLayer = 'all';
dashboard._detailStatus = 'all';
assert.match(dashboard._detailRequestPath(), /business_date=lte\.2026-02-28/);
assert.match(dashboard._detailRequestPath(), /limit=500&count=none$/);

const root = path.join(__dirname, '..');
const operations = fs.readFileSync(path.join(root, 'app/js/operations-dashboard.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'app/js/store.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const m5GetPaths = [...operations.matchAll(/(?:_sectionRequest\(signal, )?([`'])\/(rest\/v1\/[^`']+)\1/g)].map(match => match[2]);
assert.ok(m5GetPaths.length >= 14);
assert.ok(m5GetPaths.every(value => value.includes('count=none')), 'Every operations dashboard GET path must suppress unused counts');
assert.match(store, /if \(options\.signal\) opts\.signal = options\.signal/);
assert.match(server, /query\.count !== 'none'/);
assert.match(server, /k === 'count'/);

console.log('PASS M5-08 resilience model: per-section cancellation, leap-safe range, bounded no-count requests and compatible REST switch');
