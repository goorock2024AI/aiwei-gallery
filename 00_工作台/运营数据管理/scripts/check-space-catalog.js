'use strict';
// Browser plugin not available; isolated PostgreSQL and real Edge only. Never production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{Client,Pool}=require('pg');
const root=path.resolve(__dirname,'..'),cfg=JSON.parse(fs.readFileSync(process.env.AIWEI_TEST_CONFIG||path.join(root,'tmp/m3-05-test.json'))),out=process.env.AIWEI_TEST_OUTPUT||path.join(root,'tmp/space-quick');
assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55435);fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:3161',name='aiwei_space_catalog_'+Date.now(),admin=new Client({...cfg,user:'postgres',database:'postgres'}),tokens={};let pool,child,browser,created=false,checks=0;
async function api(route,method='GET',body,role='admin',status=200){const r=await fetch(base+'/rest/v1/'+route,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(j));checks++;return j;}
(async()=>{await admin.connect();try{
 await admin.query('CREATE DATABASE '+name+' TEMPLATE aiwei_m3_05_test');created=true;pool=new Pool({...cfg,user:'postgres',database:name});
 for(const f of ['20261011_operations_analysis_reports.sql','20261021_coffee_inventory.sql','20261021_daily_briefs.sql','20261022_daily_delivery_loop.sql','20261022_weekly_management.sql','20261024_space_execution.sql','20261028_space_quick_rentals.sql'])await pool.query(fs.readFileSync(path.join(root,'sql',f),'utf8'));
 const fingerprint=async()=>JSON.stringify((await pool.query("SELECT 'space' t,md5(jsonb_agg(s ORDER BY id)::text) h FROM space_usage s UNION ALL SELECT 'payments',md5(jsonb_agg(p ORDER BY id)::text) FROM space_payments p UNION ALL SELECT 'expense',md5(jsonb_agg(e ORDER BY id)::text) FROM expense e")).rows),before=await fingerprint();
 for(let i=0;i<2;i++)await pool.query(fs.readFileSync(path.join(root,'sql/20261025_space_project_workflow.sql'),'utf8'));assert.equal(await fingerprint(),before);checks++;
 const log=fs.openSync(path.join(out,'api.log'),'w');child=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,HOST:'127.0.0.1',PORT:'3161',STATIC_DIR:path.join(root,'app'),DB_HOST:cfg.host,DB_PORT:String(cfg.port),DB_NAME:name,DB_PASS:cfg.password,AUTH_SECRET:'isolated-space-workflow',REPORT_ARCHIVE_DIR:path.join(out,'archive')}});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'API must start');
 for(const role of ['admin','editor','viewer'])tokens[role]=(await api('login','POST',{username:'m305-'+role,password:cfg.password},'none')).token;


 const route='space-catalog';await api(route,'GET',null,'none',401);await api(route,'POST',{},'editor',403);await api(route,'POST',{},'viewer',403);await api(route,'DELETE',{},'admin',405);await api(route,'GET',null,'editor');await api(route,'GET',null,'viewer');
 await pool.query("UPDATE app_config SET value=$1 WHERE key='spaces'",[JSON.stringify([{name:'目录原用空间',desc:'原说明',halfDayPrice:100,dailyPrice:200},{name:'目录空闲空间',desc:'',halfDayPrice:0,dailyPrice:0}])]);
 const project={id:'catalog-used',projectName:'目录隔离项目',space:'目录原用空间',date:'2026-11-10',endDate:'2026-11-10',type:'展览',client:'隔离客户',status:'筹备中',rentalType:'付费',receivableAmount:1234,businessStatus:'洽谈',businessTypeCode:'space_rental',cooperationMode:'租赁'};
 await api('space-entry','POST',{project},'editor',201);
 const original=JSON.stringify((await pool.query('SELECT * FROM space_usage WHERE id=$1',[project.id])).rows);
 let catalog=await api(route);assert.equal(catalog.spaces[0].usedCount,1);assert(catalog.spaces[0].id.startsWith('legacy-'));checks+=2;
 await api('app_config','POST',{key:'spaces',value:[]},'admin',405);await api('app_config?key=eq.spaces','PATCH',{value:[]},'admin',405);await api('app_config/spaces','DELETE',null,'admin',405);
 const add={id:crypto.randomUUID(),name:'目录新场地',desc:'说明 <script>window.catalogInjected=1</script>',halfDayPrice:300,dailyPrice:600,active:true};
 const stale=catalog;catalog=await api(route,'POST',{version:catalog.version,spaces:[...catalog.spaces,add]});assert.equal(catalog.spaces.length,3);checks++;
 await api(route,'POST',{version:stale.version,spaces:stale.spaces},'admin',409);
 await api(route,'POST',{version:catalog.version,spaces:catalog.spaces.map((r,i)=>i===0?{...r,name:'更名不允许'}:r)},'admin',400);
 await api(route,'POST',{version:catalog.version,spaces:catalog.spaces.slice(1)},'admin',400);
 await api(route,'POST',{version:catalog.version,spaces:[...catalog.spaces,{...add,id:crypto.randomUUID()}]},'admin',400);
 await api(route,'POST',{version:catalog.version,spaces:catalog.spaces.map(r=>r.id===add.id?{...r,dailyPrice:1.001}:r)},'admin',400);
 catalog=await api(route,'POST',{version:catalog.version,spaces:catalog.spaces.map((r,i)=>i===0?{...r,active:false,dailyPrice:999}:r)});
 assert.equal(JSON.stringify((await pool.query('SELECT * FROM space_usage WHERE id=$1',[project.id])).rows),original);checks++;
 await api('space-entry','POST',{project:{...project,id:'catalog-disabled-new'}},'editor',400);
 await api('space-entry?id='+project.id,'PATCH',{project:{notes:'保留已停用空间的原登记'}},'editor');
 await api('space-quick-rental?id='+crypto.randomUUID(),'POST',{action:'create',project:{space:'目录原用空间',client:'隔离短租',startAt:'2026-11-10T12:00',endAt:'2026-11-10T13:00',amount:100}},'editor',400);
 const quickId=crypto.randomUUID();await api('space-quick-rental?id='+quickId,'POST',{action:'create',project:{space:add.name,client:'隔离短租',startAt:'2026-11-10T12:00',endAt:'2026-11-10T13:00',amount:100}},'editor',201);
 let refreshed=await api(route);assert.equal(refreshed.spaces.find(r=>r.id===add.id).usedCount,1);checks++;
 // An unused entry can be renamed/deleted. Historical projects and receipts never change.
 refreshed=await api(route,'POST',{version:refreshed.version,spaces:refreshed.spaces.map(r=>r.name==='目录空闲空间'?{...r,name:'目录空闲已更名'}:r)});
 refreshed=await api(route,'POST',{version:refreshed.version,spaces:refreshed.spaces.filter(r=>r.name!=='目录空闲已更名')});
 const concurrent=await Promise.all([1,2].map(async n=>{const response=await fetch(base+'/rest/v1/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.admin},body:JSON.stringify({version:refreshed.version,spaces:refreshed.spaces.map(r=>({...r,desc:'并发请求'+n}))})});await response.json();return response.status;}));assert.deepEqual(concurrent.sort(),[200,409]);checks++;
 // Real browser: product management -> rentable spaces -> add, edit, stop, and use in both workflows.
 const {chromium}=require('playwright');browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'/index.html');await page.locator('#login-username').fill('m305-admin');await page.locator('#login-password').fill(cfg.password);await page.locator('#login-form button').click();await page.locator('[data-tab=products]').waitFor();await page.locator('[data-tab=products]').click();await page.locator('[data-ptab=spaces]').click();await page.getByRole('button',{name:'新增空间',exact:true}).waitFor();assert(await page.title());assert.equal(await page.evaluate(()=>window.catalogInjected),undefined);checks++;
 await page.getByRole('button',{name:'新增空间',exact:true}).click();await page.locator('#sc-name').fill('浏览器目录空间');await page.locator('#sc-half').fill('500');await page.locator('#sc-daily').fill('900');await page.locator('#sc-desc').fill('隔离场地说明');await page.getByRole('button',{name:'保存空间',exact:true}).click();await page.locator('#space-catalog-edit').waitFor({state:'detached'});
 let row=page.locator('#space-catalog-content tr').filter({hasText:'浏览器目录空间'});await row.waitFor();assert((await row.innerText()).includes('900'));checks++;
 await row.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('#sc-daily').fill('950');await page.getByRole('button',{name:'保存空间',exact:true}).click();await page.locator('#space-catalog-edit').waitFor({state:'detached'});assert((await row.innerText()).includes('950'));assert((await page.locator('[data-ptab=spaces]').getAttribute('class')).includes('active'));assert.equal(await page.locator('[data-ptab=spaces] .badge').innerText(),'3');checks+=3;
 await page.screenshot({path:path.join(out,'catalog-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'catalog-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-tab=space]').click();await page.getByRole('button',{name:'新增项目',exact:true}).click();assert(await page.locator('#spe-space option').filter({hasText:'浏览器目录空间'}).count());assert.equal(await page.locator('#spe-space option[value="目录原用空间"]').count(),0);checks+=2;await page.locator('#space-project-edit').getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'简易流程',exact:true}).click();assert(await page.locator('#sq-space option[value="浏览器目录空间"]').count());assert.equal(await page.locator('#sq-space option[value="目录原用空间"]').count(),0);checks+=2;await page.locator('#space-quick-modal').getByRole('button',{name:'关闭',exact:true}).click();
 // Historical calendars retain stopped spaces; existing edit forms retain their choice.
 const gantt=await page.evaluate(()=>UI._renderSpaceGantt([{id:'old',space:'目录原用空间',date:'2026-11-10',endDate:'2026-11-10',projectName:'历史隔离租赁',status:'已确认',rentalType:'付费',receivableAmount:100}],'2026-11'));assert(gantt.includes('目录原用空间'));checks++;
 await page.evaluate(id=>SpaceProjects.edit(id),project.id);assert.equal(await page.locator('#spe-space').inputValue(),'目录原用空间');checks++;await page.locator('#space-project-edit').getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('[data-tab=products]').click();await page.locator('[data-ptab=spaces]').click();await page.getByRole('button',{name:'新增空间',exact:true}).waitFor();row=page.locator('#space-catalog-content tr').filter({hasText:'浏览器目录空间'});await row.getByRole('button',{name:'停用',exact:true}).click();await page.waitForFunction(()=>!MODELS.SPACES.includes('浏览器目录空间'));await row.getByRole('button',{name:'启用',exact:true}).click();await page.waitForFunction(()=>MODELS.SPACES.includes('浏览器目录空间'));checks+=2;
 const used=page.locator('#space-catalog-content tr').filter({hasText:'目录原用空间'});await used.getByRole('button',{name:'编辑',exact:true}).click();assert(await page.locator('#sc-name').getAttribute('readonly')!==null);assert.equal(await used.getByRole('button',{name:'删除',exact:true}).count(),0);checks+=2;

 await page.locator('#space-catalog-edit').getByRole('button',{name:'取消',exact:true}).click();
 let current=await api(route);current=await api(route,'POST',{version:current.version,spaces:current.spaces.map(r=>r.id===add.id?{...r,active:false}:r)});
 await api('space-quick-rental?id='+quickId,'POST',{action:'save',version:1,project:{space:add.name,client:'隔离短租',contact:'停用后保留对接',startAt:'2026-11-10T12:00',endAt:'2026-11-10T13:00',amount:100}},'editor');
 await page.evaluate(async id=>{await Store.loadAppConfig();await QuickSpace.open(id)},quickId);assert.equal(await page.locator('#sq-space').inputValue(),add.name);checks++;
 await page.locator('#space-quick-modal').getByRole('button',{name:'关闭',exact:true}).click();
 await api('space-entry','POST',{project:{...project,id:'catalog-removed',space:'目录空闲已更名'}},'editor',400);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,pageErrors:errors,browser:'Edge; Browser plugin not available',historicalNamesProtected:true,historyInCalendar:true,sharedByBothWorkflows:true,configurationConcurrency:true,productionWrites:0,externalMessages:0},null,2));console.log('PASS space catalog: '+checks+' checks, product management UI, both rental flows, historical and concurrent write safeguards');
 }finally{await browser?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>setTimeout(r,300));}await pool?.end();if(created)await admin.query('DROP DATABASE '+name);await admin.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
