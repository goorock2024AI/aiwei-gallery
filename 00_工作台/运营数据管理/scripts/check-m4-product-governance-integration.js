const fs=require('fs'),assert=require('assert/strict');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));const base='http://127.0.0.1:3114/rest/v1';const tokens={};let checks=0;
async function request(path,method='GET',body,role='editor',status=200){const r=await fetch(base+'/'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,`${method} ${path} ${JSON.stringify(data)}`);checks++;return data}
(async()=>{for(const role of ['admin','editor','viewer'])tokens[role]=(await request('login','POST',{username:`m305-${role}`,password:cfg.password},'none')).token;
  const products=await request('product_master_governance_v2?product_id=ilike.m404-%25&order=product_id.asc');assert.equal(products.length,4);assert.ok(products.every(x=>x.governanceId&&x.costEvidenceStatus));
  const currentOnly=products.find(x=>x.productId==='m404-current-only');assert.equal(currentOnly.suggestedHistoricalUnitCost,null);assert.equal(currentOnly.unverifiedCostLineCount,1);
  const evidence=await request('product_cost_evidence_v2?product_id=ilike.m404-%25&order=evidence_type.asc');assert.ok(evidence.length>=4);assert.ok(evidence.every(x=>x.evidenceId&&x.historicalApplication));
  await request('product_master_governance_v2','GET',undefined,'viewer',403);await request('product_cost_evidence_v2','GET',undefined,'viewer',403);
  await request('product_master_governance_v2','POST',{},'admin',405);await request('product_cost_evidence_v2','PATCH',{},'editor',403);
  console.log(`PASS ${checks} HTTP checks: governance/evidence fields, no backdated suggestion, role permissions and read-only guards`);
})().catch(e=>{console.error(e);process.exitCode=1});
