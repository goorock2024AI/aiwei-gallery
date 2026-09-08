const fs=require('fs'),assert=require('assert/strict');const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));const base='http://127.0.0.1:3115/rest/v1',tokens={};let checks=0;
async function request(path,method='GET',body,role='editor',status=200){const r=await fetch(base+'/'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,`${method} ${path} ${JSON.stringify(data)}`);checks++;return data}
(async()=>{for(const role of ['admin','editor','viewer'])tokens[role]=(await request('login','POST',{username:`m305-${role}`,password:cfg.password},'none')).token;
  const rows=await request('revenue_attribution_candidates_v2?source_id=ilike.m405-%25&order=source_id.asc');assert.equal(rows.length,5);assert.ok(rows.every(x=>x.candidateId&&Array.isArray(x.candidateOptions)));
  const conflicts=await request('revenue_attribution_candidates_v2?candidate_status=eq.ambiguous_rules&source_id=ilike.m405-%25');assert.equal(conflicts.length,1);assert.equal(conflicts[0].candidateCount,2);
  await request('revenue_attribution_candidates_v2','GET',undefined,'viewer',403);await request('revenue_attribution_candidates_v2','POST',{},'admin',405);await request('revenue_attribution_candidates_v2','PATCH',{},'editor',403);
  console.log(`PASS ${checks} HTTP checks: attribution fields/filtering, manual/rule evidence, role permissions and read-only guards`);
})().catch(e=>{console.error(e);process.exitCode=1});
