// Browser plugin not available. Use local Playwright/Edge against an isolated DB clone.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(path.join(root,'tmp/m3-05-test.json')));
assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55435);
const database='aiwei_coffee_test_'+Date.now(),base='http://127.0.0.1:3147',tokens={};let child,browser,db,created=false,checks=0;
const evidence=path.join(root,'tmp/coffee-inventory');fs.mkdirSync(evidence,{recursive:true});
const admin=new Client({host:cfg.host,port:cfg.port,password:cfg.password,user:'postgres',database:'postgres'});
async function api(role='editor',method='GET',body,expected=200){const res=await fetch(base+'/rest/v1/coffee-inventory',{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const result=await res.json();assert.equal(res.status,expected,JSON.stringify(result));checks++;return result;}
async function write(action,fields={},expected=200){const current=await api();return api('editor','POST',{action,version:current.version,requestId:crypto.randomUUID(),...fields},expected);}
(async()=>{
 await admin.connect();
 try{
  await admin.query(`CREATE DATABASE ${database} TEMPLATE aiwei_m3_05_test`);created=true;
  db=new Client({host:cfg.host,port:cfg.port,password:cfg.password,user:'postgres',database});await db.connect();
  await db.query(fs.readFileSync(path.join(root,'sql/20261021_coffee_inventory.sql'),'utf8'));
  await db.query(fs.readFileSync(path.join(root,'sql/20261021_coffee_inventory.sql'),'utf8'));
  const today=require('../coffee-forecast').dateKey(new Date());
  await db.query('DELETE FROM revenue');
  await db.query(`INSERT INTO revenue(id,date,coffee_qty,combo_qty,status) SELECT 'coffee-fixture-'||i,to_char(($1::date-i),'YYYY-MM-DD'),CASE WHEN extract(isodow from ($1::date-i)) IN (6,7) THEN 30 ELSE 10 END,2,'正常' FROM generate_series(1,84) i`,[today]);
  const before=(await db.query('SELECT md5(jsonb_agg(r ORDER BY id)::text) fingerprint FROM revenue r')).rows[0].fingerprint;
  const log=fs.openSync(path.join(evidence,'server.log'),'w');
  child=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,DB_HOST:cfg.host,DB_PORT:String(cfg.port),DB_NAME:database,DB_PASS:cfg.password,AUTH_SECRET:crypto.randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:'3147',STATIC_DIR:path.join(root,'app'),UPLOAD_DIR:path.join(evidence,'uploads')}});
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Local API did not start; inspect ignored local server log');
  for(const role of ['admin','editor','viewer']){const res=await fetch(base+'/rest/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'m305-'+role,password:cfg.password})});const result=await res.json();assert.equal(res.status,200,'Local fixture login failed');tokens[role]=result.token;}
  await api('none','GET',undefined,401);await api('viewer');await api('admin');
  await api('viewer','POST',{},403);await api('editor','DELETE',undefined,405);await api('editor','POST',null,400);
  assert.equal((await api()).result.status,'setup');
  await write('receive',{grams:100,note:'未初始化不能补货'},400);
  await write('settings',{config:{packGrams:500,freshDays:21,openDays:10,arrivalAgeDays:3}});
  await write('count',{grams:1500,note:'隔离测试首次盘点',roastDate:today});
  assert.equal((await api()).result.availableGrams,1500);
  await write('receive',{grams:-100,note:'bad'},400);
  const state=await api(),body={action:'receive',grams:500,note:'实际补货 <img src=x onerror=alert(1)>',requestId:crypto.randomUUID(),version:state.version};
  await api('editor','POST',body);const replay=await api('editor','POST',body);assert.equal(replay.replayed,true);assert.equal((await api()).result.availableGrams,2000);
  await api('admin','POST',body,409);
  await api('editor','POST',{...body,grams:501},409);
  await api('editor','POST',{...body,requestId:crypto.randomUUID()},409);
  const concurrent=await api(),common={action:'receive',grams:100,note:'并发测试',version:concurrent.version};
  const responses=await Promise.all([1,2].map(()=>fetch(base+'/rest/v1/coffee-inventory',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.editor},body:JSON.stringify({...common,requestId:crypto.randomUUID()})})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);checks+=2;
  const orderId=crypto.randomUUID();await write('order',{requestId:orderId,grams:1000,eta:new Date(Date.now()+60*3600000).toISOString(),note:'隔离采购'});
  assert.equal((await api()).result.availableGrams,2100);
  await write('reschedule',{orderId,eta:new Date(Date.now()+62*3600000).toISOString(),note:'物流延迟'});
  await write('receive',{orderId,grams:900,note:'实收较少',roastDate:today});
  await write('receive',{orderId,grams:900,note:'重复收货'},409);
  assert.equal((await api()).result.availableGrams,3000);
  await write('calendar',{date:today,type:'holiday',cups:80,note:'活动预期'});
  assert.equal((await api()).result.days[0].cups,80);
  await write('calendar',{date:today,reset:true});
  await write('calendar',{date:'2026-02-30',type:'holiday',note:'bad'},400);
  const cancelId=crypto.randomUUID();await write('order',{requestId:cancelId,grams:1000,eta:new Date(Date.now()+60*3600000).toISOString(),note:'取消测试'});
  await write('cancel',{orderId:cancelId,note:'供应商缺货'});await write('cancel',{orderId:cancelId,note:'重复取消'},409);
  for(const method of ['GET','POST','PATCH','DELETE']){const res=await fetch(base+'/rest/v1/coffee_inventory_state',{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.admin},...(method==='POST'||method==='PATCH'?{body:'{}'}:{})});assert.equal(res.status,404,'Generic REST must not bypass the dedicated stock API');checks++;}
  const eventCount=Number((await db.query('SELECT COUNT(*) FROM coffee_inventory_events')).rows[0].count);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM operation_logs WHERE table_name='coffee_inventory_state'")).rows[0].count),eventCount);
  await db.query(fs.readFileSync(path.join(root,'sql/20261021_coffee_inventory_rollback.sql'),'utf8'));
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM coffee_inventory_events')).rows[0].count),eventCount);
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,channel:'msedge'});
  const errors=[],page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html');await page.locator('#login-username').fill('m305-editor');await page.locator('#login-password').fill(cfg.password);await page.locator('#login-form button').click();
  await page.locator('[data-tab="inventory"]').click();await page.locator('.inventory-inbox').waitFor();
  assert.equal(await page.locator('#page-inventory').evaluate(el=>el.classList.contains('active')),true);
  assert.equal(await page.locator('#page-revenue .inventory-shell').count(),0);
  assert.match(await page.locator('.inventory-detail').innerText(),/未来 7 天销量预期/);
  await page.getByRole('button',{name:/库存操作记录/}).click();assert.equal(await page.locator('.inventory-detail img').count(),0);assert.match(await page.locator('.inventory-detail').innerText(),/<img/);
  await page.getByText('库存与采购记录',{exact:true}).click();
  const receipt=page.locator('#inv-receive');await receipt.locator('[name=grams]').fill('200');await receipt.locator('[name=note]').fill('浏览器实际补货测试');await receipt.getByRole('button',{name:'确认补货入库'}).click();await page.waitForFunction(()=>InventoryInbox._data?.result.availableGrams===3200);
  await page.getByText('日期与活动预期',{exact:true}).click();const calendar=page.locator('form[data-inventory-action=calendar]');await calendar.locator('[name=cups]').fill('123');await calendar.locator('[name=note]').fill('浏览器活动测试');await calendar.getByRole('button',{name:'保存日期预期'}).click();await page.waitForFunction(()=>InventoryInbox._data?.result.days[0].cups===123);
  await page.getByRole('button',{name:/补货决策/}).click();await page.waitForFunction(()=>!document.querySelector('.toast'));
  await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#sidebar-toggle').click();await page.locator('[data-tab=inventory]').click();await page.locator('.inventory-inbox').waitFor();await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile horizontal overflow');await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});
  const viewer=await browser.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.addInitScript(token=>sessionStorage.setItem('aiwei_user',JSON.stringify({token,role:'viewer',displayName:'测试查看者',needPasswordChange:false})),tokens.viewer);await viewer.goto(base+'/index.html');await viewer.locator('[data-tab="inventory"]').click();await viewer.locator('.inventory-inbox').waitFor();assert.equal(await viewer.locator('.inventory-tools').count(),0);
  await viewer.setViewportSize({width:320,height:740});assert.ok(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px overflow');assert.deepEqual(errors,[]);
  assert.equal((await db.query('SELECT md5(jsonb_agg(r ORDER BY id)::text) fingerprint FROM revenue r')).rows[0].fingerprint,before);
  const result={status:'passed',httpChecks:checks,scenarios:['permissions','idempotence','concurrency','actual receipts','calendar','migration reapply','retained rollback','real menu','browser writes','viewer read-only','desktop','390px','320px','XSS escape','revenue unchanged'],pageErrors:errors,screenshots:['desktop.png','mobile.png']};fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  if(browser)await browser.close();if(child){child.kill();await new Promise(r=>setTimeout(r,400));}
  if(db)await db.end();if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await admin.query(`DROP DATABASE ${database}`);}await admin.end();
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
