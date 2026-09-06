#!/usr/bin/env node
// Requires the isolated local M3 database and API on port 3108. Never use production data.
const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));if(cfg.host!=='127.0.0.1'||cfg.port!==55435||cfg.database!=='aiwei_m3_05_test')throw new Error('Requires dedicated local M3 database');
const tokens={};let checks=0;
async function request(path,method='GET',body,role='editor',status=200){const r=await fetch('http://127.0.0.1:3108/rest/v1/'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const j=await r.json();assert.equal(r.status,status,method+' '+path+' '+JSON.stringify(j));checks++;return j}
(async()=>{const db=new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});await db.connect();try{
for(const role of ['admin','editor','viewer'])tokens[role]=(await request('login','POST',{username:'m305-'+role,password:cfg.password},'none')).token;
await db.query("DELETE FROM operation_logs WHERE record_id LIKE 'm308-%'; DELETE FROM space_payments WHERE space_usage_id LIKE 'm308-%'; DELETE FROM space_usage WHERE id LIKE 'm308-%'");
assert.deepEqual(await request('space-entry?type='+encodeURIComponent('品牌快闪')+'&status='+encodeURIComponent('筹备中')), {businessTypeCode:'brand_event',businessStatus:'洽谈',requiresConfirmation:false});
assert.equal((await request('space-entry?type='+encodeURIComponent('展览')+'&status='+encodeURIComponent('筹备中'))).requiresConfirmation,true);
const base={id:'m308-project-1',date:'2026-09-10',endDate:'2026-09-12',space:'1号厅',projectName:'M308品牌合作',type:'品牌快闪',client:'测试品牌',status:'已确认',rentalType:'付费',receivableAmount:10000,expectedPaymentDate:'2026-09-30',businessTypeCode:'brand_event',cooperationMode:'联办',businessStatus:'已签约',contractNo:'M308-C-001',projectOwner:'测试负责人'};
await request('space-entry','POST',{project:{...base,id:'m308-no-contract',contractNo:''},classificationSource:'manual'},'editor',400);
const created=await request('space-entry','POST',{project:base,classificationSource:'manual'},'editor',201);assert.equal(created.project.businessTypeCode,'brand_event');assert.equal(created.project.contractNo,'M308-C-001');
await request('space-entry','POST',{project:{...base,id:'m308-conflict',projectName:'冲突项目',contractNo:'M308-C-002'},classificationSource:'manual'},'editor',400);assert.equal(Number((await db.query("SELECT count(*) FROM space_usage WHERE id='m308-conflict'")).rows[0].count),0);
let pay=await request('space-entry?id=m308-project-1&action=payment','POST',{payment:{id:'m308-pay-1',paymentDate:'2026-10-01',amount:4000,paymentMethod:'转账',notes:'首款'}},'editor',201);assert.equal(pay.remainingAmount,6000);
await request('space-entry?id=m308-project-1&action=payment','POST',{payment:{id:'m308-overpay',paymentDate:'2026-10-02',amount:7000,paymentMethod:'转账'}},'editor',400);assert.equal(Number((await db.query("SELECT count(*) FROM space_payments WHERE id='m308-overpay'")).rows[0].count),0);
pay=await request('space-entry?id=m308-project-1&action=payment','POST',{payment:{id:'m308-pay-2',paymentDate:'2026-10-03',amount:6000,paymentMethod:'扫码支付',notes:'尾款'}},'editor',201);assert.equal(pay.remainingAmount,0);
const view=(await request('space_project_performance_v2?id=eq.m308-project-1'))[0];assert.equal(view.receivedAmount,10000);assert.equal(view.outstandingAmount,0);assert.equal(view.paymentCount,2);assert.equal(view.firstPaymentDate,'2026-10-01');
const fact=(await request('business_revenue_facts_v2?source_id=eq.m308-pay-1'))[0];assert.equal(fact.businessTypeCode,'brand_event');assert.equal(fact.businessDate,'2026-10-01');
await request('space_project_performance_v2','POST',{},'admin',405);
const logs=await db.query("SELECT action,details FROM operation_logs WHERE record_id='m308-project-1' ORDER BY created_at");assert.deepEqual(logs.rows.map(x=>x.action),['create','payment_create','payment_create']);assert.ok(logs.rows[1].details.originalProjectId==='m308-project-1');
console.log(`PASS ${checks} HTTP checks: defaults/manual confirmation, contracts, conflict rollback, payment-date facts, overpayment guard and trusted audit.`);
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
