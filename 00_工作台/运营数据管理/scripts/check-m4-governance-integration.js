const fs=require('fs'),assert=require('assert/strict');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));const base='http://127.0.0.1:3112/rest/v1';const tokens={};let checks=0;
async function request(path,method='GET',body,role='editor',status=200){const r=await fetch(base+'/'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,`${method} ${path} ${JSON.stringify(data)}`);checks++;return data}
(async()=>{for(const role of ['admin','editor','viewer'])tokens[role]=(await request('login','POST',{username:`m305-${role}`,password:cfg.password},'none')).token;
  const issues=await request('data_governance_issues_v2?order=business_date.desc&limit=5000');
  const baseline=await request('data_governance_baseline_v2?order=period_month.asc&limit=5000');
  assert.ok(issues.length>0&&baseline.length>0);assert.ok(issues.every(x=>x.issueId&&x.issueKey&&x.issueGroup&&x.priority));
  const totalIssues=baseline.reduce((s,x)=>s+x.issueCount,0);assert.equal(totalIssues,issues.length);
  await request('data_governance_baseline_v2','GET',undefined,'viewer',403);
  await request('data_governance_baseline_v2','POST',{},'admin',405);
  await request('data_governance_issues_v2','POST',{},'editor',403);
  console.log(`PASS ${checks} HTTP checks: stable governance issues, baseline totals, role permissions and read-only guards`);
})().catch(e=>{console.error(e);process.exitCode=1});
