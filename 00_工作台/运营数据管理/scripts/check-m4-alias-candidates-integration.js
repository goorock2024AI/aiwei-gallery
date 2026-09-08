const fs = require('fs');
const assert = require('assert/strict');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const base = 'http://127.0.0.1:3113/rest/v1';
const tokens = {};
let checks = 0;

async function request(path, method = 'GET', body, role = 'editor', status = 200) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: {'Content-Type':'application/json', ...(tokens[role] ? {Authorization:`Bearer ${tokens[role]}`} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path} ${JSON.stringify(data)}`);
  checks++;
  return data;
}

(async () => {
  for (const role of ['admin','editor','viewer']) {
    tokens[role] = (await request('login','POST',{username:`m305-${role}`,password:cfg.password},'none')).token;
  }
  const candidates = await request('product_alias_candidates_v2?normalized_alias=ilike.m403%25&order=candidate_status.asc');
  assert.equal(candidates.length, 4);
  assert.ok(candidates.every(x => x.candidateId && Array.isArray(x.candidateOptions)));
  assert.deepEqual(new Set(candidates.map(x => x.candidateStatus)), new Set(['matched','unique_candidate','ambiguous','no_candidate']));
  const ambiguous = await request('product_alias_candidates_v2?candidate_status=eq.ambiguous&normalized_alias=ilike.m403%25');
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].candidateCount, 2);
  await request('product_alias_candidates_v2','GET',undefined,'viewer',403);
  await request('product_alias_candidates_v2','POST',{},'admin',405);
  await request('product_alias_candidates_v2','PATCH',{},'editor',403);
  console.log(`PASS ${checks} HTTP checks: candidate fields, filtering, editor/admin read access, viewer denial and read-only guards`);
})().catch(error => { console.error(error); process.exitCode = 1; });
