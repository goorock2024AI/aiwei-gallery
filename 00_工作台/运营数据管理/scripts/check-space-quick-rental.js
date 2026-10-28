'use strict';
// Browser plugin not available; isolated PostgreSQL and real Edge only. Never production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{Client,Pool}=require('pg');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(process.env.AIWEI_TEST_CONFIG||path.join(root,'tmp/m3-05-test.json'))),out=process.env.AIWEI_TEST_OUTPUT||path.join(root,'tmp/space-quick');
assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55435);fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:3161',name='aiwei_space_quick_'+Date.now(),admin=new Client({...cfg,user:'postgres',database:'postgres'}),tokens={};let pool,child,browser,created=false,checks=0;
async function api(route,method='GET',body,role='admin',status=200){const r=await fetch(base+'/rest/v1/'+route,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(j));checks++;return j;}
(async()=>{await admin.connect();try{
 await admin.query('CREATE DATABASE '+name+' TEMPLATE aiwei_m3_05_test');created=true;pool=new Pool({...cfg,user:'postgres',database:name});
 for(const f of ['20261011_operations_analysis_reports.sql','20261021_coffee_inventory.sql','20261021_daily_briefs.sql','20261022_daily_delivery_loop.sql','20261022_weekly_management.sql','20261024_space_execution.sql','20261028_space_quick_rentals.sql'])await pool.query(fs.readFileSync(path.join(root,'sql',f),'utf8'));
 const fingerprint=async()=>JSON.stringify((await pool.query("SELECT 'space' t,md5(jsonb_agg(s ORDER BY id)::text) h FROM space_usage s UNION ALL SELECT 'payments',md5(jsonb_agg(p ORDER BY id)::text) FROM space_payments p UNION ALL SELECT 'expense',md5(jsonb_agg(e ORDER BY id)::text) FROM expense e")).rows),before=await fingerprint();
 for(let i=0;i<2;i++)await pool.query(fs.readFileSync(path.join(root,'sql/20261025_space_project_workflow.sql'),'utf8'));assert.equal(await fingerprint(),before);checks++;
 const log=fs.openSync(path.join(out,'api.log'),'w');child=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,HOST:'127.0.0.1',PORT:'3161',STATIC_DIR:path.join(root,'app'),DB_HOST:cfg.host,DB_PORT:String(cfg.port),DB_NAME:name,DB_PASS:cfg.password,AUTH_SECRET:'isolated-space-workflow',REPORT_ARCHIVE_DIR:path.join(out,'archive')}});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'API must start');
 for(const role of ['admin','editor','viewer'])tokens[role]=(await api('login','POST',{username:'m305-'+role,password:cfg.password},'none')).token;

 const route='space-quick-rental';const uuid=()=>crypto.randomUUID();
 await api(route,'GET',null,'none',401);await api(route,'POST',{},'viewer',403);await api(route,'DELETE',{},'admin',405);
 await pool.query("INSERT INTO app_config(key,value) VALUES('spaces',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify([{name:'简易隔离场地A'},{name:'简易隔离场地B'}])]);
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),past=new Date(Date.parse(day)-86400000).toISOString().slice(0,10),future=new Date(Date.parse(day)+86400000*7).toISOString().slice(0,10);
 const basic={space:'简易隔离场地A',client:'隔离客户',contact:'隔离联系人',phone:'000-test',startAt:past+'T09:00',endAt:past+'T10:00',amount:1000,notes:'隔离测试，不是实际租赁'};
 const create=(id,project=basic,payment)=>api(route+'?id='+id,'POST',{action:'create',id,project,...(payment?{payment}:{})},'editor',201);
 for(const patch of [{amount:-1},{amount:1.001},{startAt:'2026-02-30T09:00'},{endAt:past+'T08:00'},{space:'不存在场地'},{client:''}])await api(route+'?id='+uuid(),'POST',{action:'create',project:{...basic,...patch}},'editor',400);
 const badId=uuid();await api(route+'?id='+badId,'POST',{action:'create',project:basic,payment:{id:uuid(),amount:100,paymentDate:future}},'editor',400);assert.equal((await pool.query('SELECT count(*)::int n FROM space_usage WHERE id=$1',[badId])).rows[0].n,0);checks++;
 const id=uuid(),payment={id:uuid(),amount:100,paymentDate:past,paymentMethod:'现金',notes:'首次实收'};
 await create(id,basic,payment);await api(route+'?id='+id,'POST',{action:'create',project:basic,payment},'editor');
 let data=await api(route+'?id='+id);assert.equal(data.project.contractNo,'');assert.equal(data.project.businessStatus,'租赁确认');assert.equal(Number(data.project.receivedAmount),100);assert.equal(data.rental.mode,'simple');assert.equal(data.project.payments.length,1);checks+=5;
 assert.equal((await pool.query('SELECT count(*)::int n FROM cash_movements WHERE source_id=$1',[payment.id])).rows[0].n,1);checks++;
 await api(route+'?id='+id,'POST',{action:'create',project:{...basic,amount:2000},payment},'editor',409);
 await api('space-project-workflow?id='+id,'GET',null,'editor',400);await api('space-entry?id='+id,'PATCH',{project:{receivableAmount:1}},'editor',400);
 const viewer=await api(route+'?id='+id,'GET',null,'viewer');assert.equal(viewer.rental.clientPhone,undefined);checks++;
 const partial={id:uuid(),amount:300,paymentDate:past,paymentMethod:'转账'};
 await api(route+'?id='+id,'POST',{action:'payment',payment:partial},'editor');await api(route+'?id='+id,'POST',{action:'payment',payment:partial},'editor');
 let audit=(await pool.query("SELECT count(*)::int n FROM operation_logs WHERE record_id=$1 AND action='payment_create'",[id])).rows[0].n;assert.equal(audit,2);checks++;
 await api('space-entry?id='+id+'&action=payment','POST',{payment:partial},'editor');
 await api(route+'?id='+id,'POST',{action:'payment',payment:{...partial,amount:301}},'editor',409);
 await api(route+'?id='+id,'POST',{action:'payment',payment:{...partial,id:uuid(),amount:601}},'editor',400);
 await api(route+'?id='+id,'POST',{action:'save',version:0,project:basic},'editor',409);
 await api(route+'?id='+id,'POST',{action:'save',version:1,project:{...basic,amount:399}},'editor',400);
 await api(route+'?id='+id,'POST',{action:'save',version:1,project:{...basic,contact:'更新的隔离联系人'}},'editor');
 data=await api(route+'?id='+id);assert.equal(data.rental.version,2);assert.equal(data.rental.clientContact,'更新的隔离联系人');assert.equal(Number(data.project.receivedAmount),400);checks+=3;
 await api(route+'?id='+uuid(),'POST',{action:'create',project:{...basic,startAt:past+'T09:30',endAt:past+'T11:00'}},'editor',409);
 const adjacent=uuid();await create(adjacent,{...basic,startAt:past+'T10:00',endAt:past+'T11:00'});
 await create(uuid(),{...basic,space:'简易隔离场地B'});
 // Concurrent requests for the same free slot: one winner, one conflict, no double booking.
 const parallel=await Promise.all([1,2].map(async()=>{const r=await fetch(base+'/rest/v1/'+route+'?id='+uuid(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.editor},body:JSON.stringify({action:'create',project:{...basic,startAt:future+'T12:00',endAt:future+'T13:00'}})});await r.json();return r.status;}));assert.deepEqual(parallel.sort(),[201,409]);checks++;
 // Full projects without precise slots continue occupying the whole day.
 const formalId='quick-full-fixture';await pool.query("INSERT INTO space_usage(id,date,end_date,space,project_name,status,rental_type,receivable_amount,business_type_code,cooperation_mode,business_status,contract_no) VALUES($1,$2,$2,'简易隔离场地B','隔离整日合作','已确认','付费',100,'space_rental','租赁','已签约','FIXTURE')",[formalId,future]);
 await api(route+'?id='+uuid(),'POST',{action:'create',project:{...basic,space:'简易隔离场地B',startAt:future+'T14:00',endAt:future+'T15:00'}},'editor',409);
 await api('space-entry?id='+formalId,'PATCH',{project:{space:'简易隔离场地A'}},'editor',409);
 // Complete actual use independently of cash; no duplicate earning or receipt on retries.
 const beforeReceipts=(await pool.query('SELECT count(*)::int n FROM space_payments WHERE space_usage_id=$1',[id])).rows[0].n;
 await api(route+'?id='+id,'POST',{action:'complete',version:2},'editor');data=await api(route+'?id='+id);assert(data.rental.completedAt);checks++;
 await api(route+'?id='+id,'POST',{action:'complete',version:2},'editor');
 assert.equal((await pool.query("SELECT sum(amount)::float8 n FROM space_execution_lines WHERE space_usage_id=$1 AND status='confirmed'",[id])).rows[0].n,1000);assert.equal((await pool.query('SELECT count(*)::int n FROM space_payments WHERE space_usage_id=$1',[id])).rows[0].n,beforeReceipts);checks+=2;
 await api(route+'?id='+id,'POST',{action:'save',version:3,project:{...basic,amount:1001}},'editor',400);
 const far=new Date(Date.parse(day)+86400000*8).toISOString().slice(0,10),futureId=uuid();await create(futureId,{...basic,startAt:far+'T09:00',endAt:far+'T10:00'});
 await api(route+'?id='+futureId,'POST',{action:'complete',version:1},'editor',400);
 await api(route+'?id='+id,'POST',{action:'payment',payment:{id:uuid(),amount:600,paymentDate:day,paymentMethod:'扫码支付'}},'editor');assert.equal(Number((await api(route+'?id='+id)).project.receivedAmount),1000);checks++;
 // Conversion keeps identifiers, exact slots and receipts, and unlocks contract drafting only then.
 const receiptsBefore=JSON.stringify((await pool.query('SELECT * FROM space_payments WHERE space_usage_id=$1 ORDER BY id',[id])).rows);
 await api(route+'?id='+id,'POST',{action:'convert',version:3},'editor');data=await api(route+'?id='+id);assert.equal(data.rental.mode,'full');assert.equal(JSON.stringify((await pool.query('SELECT * FROM space_payments WHERE space_usage_id=$1 ORDER BY id',[id])).rows),receiptsBefore);checks+=2;
 const full=await api('space-project-workflow?id='+id);assert.equal(full.project.contractNo,'');assert.equal(full.opportunity,true);checks+=2;
 await api(route+'?id='+id,'POST',{action:'payment',payment:{id:uuid(),amount:1,paymentDate:day}},'editor',400);

 // Cross-midnight completion excludes the zero-length final calendar day.
 const crossId=uuid(),earlier=new Date(Date.parse(past)-86400000).toISOString().slice(0,10);
 await create(crossId,{...basic,space:'简易隔离场地B',startAt:earlier+'T22:00',endAt:past+'T00:00',amount:123.45});
 await api(route+'?id='+crossId,'POST',{action:'complete',version:1},'editor');const cross=(await pool.query("SELECT usage_date,amount::float8 amount FROM space_execution_lines WHERE space_usage_id=$1 AND status='confirmed'",[crossId])).rows;assert.deepEqual(cross,[{usage_date:earlier,amount:123.45}]);checks++;
 await api(route+'?id='+uuid(),'POST',{action:'create',project:{...basic,space:'简易隔离场地B',startAt:earlier+'T23:00',endAt:past+'T00:00'}},'editor',409);
 // Signing after conversion preserves completed usage and supports adjacent bookings.
 const savedFull=await api('space-project-workflow?id='+id,'POST',{action:'save',version:0,payload:{...full.payload,terms:{...full.payload.terms,partyBName:'隔离乙方',contractNo:'QUICK-FIXTURE',partyAName:'忽略客户端甲方'},payments:[{amount:1000,trigger:'原短租约定'}]}},'editor');
 // Set authoritative museum data via the administrative profile API before confirming.
 const cat=await api('space-project-workflow?profiles=1');const seededCat=await api('space-project-workflow?profiles=1','POST',{version:cat.version,organizations:[{id:'quick-fixture-org',terms:{partyAName:'隔离甲方'}}],venues:[{id:'quick-fixture-venue',terms:{venueName:'隔离馆',venueAddress:'隔离地址'}}]});
 const signedPayload={...savedFull.payload,profileSelection:{organizationId:'quick-fixture-org',venueId:'quick-fixture-venue',version:seededCat.version}};
 await api('space-project-workflow?id='+id,'POST',{action:'save',version:savedFull.version,payload:signedPayload},'editor');
 await api('space-project-workflow?id='+id,'POST',{action:'confirm-cooperation',version:2,evidence:'隔离测试补签凭据',confirmed:true},'admin');
 const signed=(await pool.query('SELECT status,contract_no FROM space_usage WHERE id=$1',[id])).rows[0];assert.equal(signed.status,'已完成');assert.equal(signed.contract_no,'QUICK-FIXTURE');assert.equal(JSON.stringify((await pool.query('SELECT * FROM space_payments WHERE space_usage_id=$1 ORDER BY id',[id])).rows),receiptsBefore);checks+=3;
 // Browser plugin not available: actual Edge, no production test data.
 const {chromium}=require('playwright');browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');await page.locator('#login-username').fill('m305-admin');await page.locator('#login-password').fill(cfg.password);await page.locator('#login-form button').click();await page.locator('[data-tab=space]').waitFor();await page.locator('[data-tab=space]').click();await page.getByText('空间运营项目',{exact:true}).waitFor();assert(await page.title());
 await page.getByRole('button',{name:'新增项目',exact:true}).click();await page.locator('#spe-client').fill('浏览器隔离客户');await page.locator('#space-project-edit').getByRole('button',{name:'简易流程',exact:true}).click();await page.locator('#space-quick-modal').waitFor();assert.equal(await page.locator('#sq-client').inputValue(),'浏览器隔离客户');assert.equal(await page.locator('#space-quick-modal input[id*=contract]').count(),0);checks+=2;
 await page.locator('#sq-space').selectOption('简易隔离场地A');await page.locator('#sq-start').fill(past+'T14:00');await page.locator('#sq-end').fill(past+'T15:00');await page.locator('#sq-amount').fill('800');await page.locator('#sq-contact').fill('测试联系人');await page.locator('#sq-phone').fill('test-phone');
 await page.getByRole('button',{name:'保存简易登记',exact:true}).click();await page.getByRole('button',{name:'登记本次实际收款',exact:true}).waitFor();assert((await page.locator('#sq-receipt-status').innerText()).includes('未收款'));checks++;
 await page.locator('#sq-payment-amount').fill('300');await page.getByRole('button',{name:'登记本次实际收款',exact:true}).click();await page.waitForFunction(()=>document.getElementById('sq-receipt-status')?.textContent.includes('部分收款'));
 await page.locator('#sq-payment-amount').fill('500');await page.getByRole('button',{name:'登记本次实际收款',exact:true}).click();await page.waitForFunction(()=>document.getElementById('sq-receipt-status')?.textContent.includes('已收清'));checks+=2;
 await page.screenshot({path:path.join(out,'quick-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'quick-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
 await page.setViewportSize({width:1440,height:1000});page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'转入完整流程',exact:true}).click();await page.locator('#space-project-workbench').waitFor();assert.equal(Number(await page.locator('#spterm-totalAmount').inputValue()),800);assert.equal(await page.locator('#space-quick-modal').count(),0);checks+=2;assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,pageErrors:errors,browser:'Edge; Browser plugin not available',atomicInitialReceipt:true,concurrentSlotGuard:true,idempotentReceipts:true,conversionRetainsReceipts:true,productionWrites:0,externalMessages:0},null,2));console.log('PASS quick rental: '+checks+' checks, real Edge workflow, booking concurrency, receipt and conversion safeguards');
 }finally{await browser?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>setTimeout(r,300));}await pool?.end();if(created)await admin.query('DROP DATABASE '+name);await admin.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
