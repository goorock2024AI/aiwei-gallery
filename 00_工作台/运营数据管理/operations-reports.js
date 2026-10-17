const crypto=require('node:crypto');
const analysis=require('./operations-item-analysis');
const metrics=require('./operations-report-metrics');
const html=require('./operations-report-html');
const reportTypeSQL="COALESCE(r.content->>'reportType',CASE WHEN p.start_date=to_char(p.start_date::date,'YYYY-MM-01') AND p.end_date=to_char((date_trunc('month',p.start_date::date)+interval '1 month - 1 day')::date,'YYYY-MM-DD') THEN 'monthly' ELSE 'special' END)";
function metadata(row,toCamel){const r=toCamel(row);r.reportType=r.content?.reportType||r.reportType||'special';r.reportVersion=r.content?.reportVersion||1;r.ruleVersion=r.content?.ruleVersion||'legacy';r.standardVersion=r.content?.weekly?.standardVersion||null;r.sourceRevision=r.content?.weekly?.sourceRevision||null;return r;}
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function checkRange(start,end){let q;try{q=analysis.validate({action:'business',kind:'revenue',dimension:'type',start,end});}catch(e){throw fail(e.message);}const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(end>today)throw fail('结束日期不能晚于今日');if((new Date(end)-new Date(start))/86400000>366)throw fail('报告分析期间最多一年');return q;}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('报告文本为空或过长');return value.trim();}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function validateWeekly(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.standardVersion!=='1.0')throw fail('周报标准版本无效');
 const rows=(v,count,maxColumns=12)=>{if(!Array.isArray(v)||v.length>count)throw fail('周报表格过大');return v.map(row=>{if(!Array.isArray(row)||!row.length||row.length>maxColumns)throw fail('周报表格列无效');return row.map(x=>text(x,1600));});};
 const overviewRows=rows(value.overviewRows,5,3);if(overviewRows.length!==5||overviewRows.some(row=>row.length!==3))throw fail('周报须有五项核心数据');
 if(!Number.isInteger(value.sourceRevision)||value.sourceRevision<1||value.sourceRevision>10000)throw fail('周报来源版本无效');
 if(!Array.isArray(value.appendixTables)||value.appendixTables.length>8||!Array.isArray(value.appendixNotes)||value.appendixNotes.length>30||!Array.isArray(value.sources)||value.sources.length>20)throw fail('周报附录无效');
 const appendixTables=value.appendixTables.map(t=>{const heads=rows([t.heads],1)[0],body=rows(t.rows,100);if(body.some(row=>row.length!==heads.length))throw fail('周报表格列数不一致');return {title:text(t.title,160),heads,rows:body};});
 const sources=value.sources.map(s=>{let url;try{url=new URL(s.url);}catch{throw fail('周报来源链接无效');}if(url.protocol!=='https:'||url.username||url.password)throw fail('周报来源须为HTTPS链接');return {title:text(s.title,200),url:url.href,published:text(s.published,30)};});
 return {standardVersion:'1.0',sourceRevision:value.sourceRevision,overviewRows,monthText:text(value.monthText,1200),footnote:text(value.footnote,1600),appendixTables,appendixNotes:value.appendixNotes.map(n=>text(n,14000)),sources};
}
function validateReport(body){
 if(typeof body.packetId!=='string'||body.packetId.length>100)throw fail('请选择来源数据包');
 const title=text(body.title,160),summary=text(body.summary,2400);
 if(!Array.isArray(body.sections)||body.sections.length<4||body.sections.length>16)throw fail('报告须包含4至16个分析章节');
 const sections=body.sections.map(s=>({title:text(s?.title,160),body:text(s?.body,14000)}));
 if(!Array.isArray(body.actions)||!body.actions.length||body.actions.length>12)throw fail('请提供可执行建议');
 const actions=body.actions.map(a=>({action:text(a?.action,1200),measure:text(a?.measure,1200)}));
 const reportType=body.reportType||'special';if(!['monthly','special','weekly'].includes(reportType))throw fail('报告类型无效');
 const topic=body.topic==null?'':text(body.topic,120),ruleVersion=body.ruleVersion||metrics.RULE_VERSION;if(ruleVersion!==metrics.RULE_VERSION)throw fail('基准规则版本不受支持');
 const supersedes=body.supersedes||null;if(supersedes!==null&&(typeof supersedes!=='string'||supersedes.length>100))throw fail('修订来源无效');
 const weekly=reportType==='weekly'?validateWeekly(body.weekly):undefined;
 if(weekly&&(sections.length!==5||actions.length>3))throw fail('标准周报须有四章经营分析、一个附录和最多三项行动');
 return {packetId:body.packetId,title,summary,sections,actions,reportType,topic,ruleVersion,supersedes,...(weekly?{weekly}:{})};
}
module.exports=function({pool,getRequester,ensureRole,sendJSON,sendError,toCamel,readOperationsRollout,rolloutEnabledForRole}){
 const readBody=async req=>{let body='';for await(const chunk of req){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>200000)throw fail('内容过大',413);}try{return JSON.parse(body);}catch{throw fail('JSON格式错误');}};
 const camelData=data=>{const out={...data};for(const key of ['typeDays','visitorDays','dailyTotals','rows','relatedCosts'])if(out[key])out[key]=out[key].map(toCamel);return out;};
 return async(req,res,q)=>{let db;
 try{
  const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor','viewer']))return;
  const rollout=await readOperationsRollout();const canPrepare=rolloutEnabledForRole(rollout.mode,user.role)&&['admin','editor'].includes(user.role);
  if(req.method==='GET'){
   if(q.packet){if(!canPrepare)return sendError(res,403,'当前账号不可下载经营数据包');const r=await pool.query('SELECT payload FROM operations_analysis_packets WHERE id=$1',[q.packet]);if(!r.rows.length)return sendError(res,404,'数据包不存在');return sendJSON(res,200,r.rows[0].payload);}
   if(q.id){const r=await pool.query(`SELECT r.*,${reportTypeSQL} report_type,p.start_date,p.end_date,p.compare_start,p.compare_end,p.sha256,p.created_at source_created_at,p.payload source_payload,(SELECT n.id FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id LIMIT 1) replaced_by FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE r.id=$1`,[q.id]);if(!r.rows.length)return sendError(res,404,'报告不存在');const report=metadata(r.rows[0],toCamel);try{report.displayMetrics=metrics.display(report.sourcePayload);}catch{report.displayMetrics=null;}delete report.sourcePayload;if(q.format==='html'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Content-Disposition':q.download==='1'?`attachment; filename="operations-report-${report.id}.html"`:'inline','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});return res.end(html.render(report));}return sendJSON(res,200,report);}
   const limit=q.limit==null?20:Number(q.limit),offset=q.offset==null?0:Number(q.offset);if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>100000)throw fail('分页参数无效');
   if(q.type&&!['monthly','special','weekly'].includes(q.type))throw fail('报告类型无效');if(q.latest!=null&&!['0','1'].includes(q.latest))throw fail('版本筛选无效');if(q.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month))throw fail('月份无效');if(q.search&&String(q.search).length>120)throw fail('搜索内容过长');
   const params=[],where=[];const condition=(sql,value)=>{params.push(value);where.push(sql.replace('?',`$${params.length}`));};if(q.type)condition(`${reportTypeSQL}=?`,q.type);if(q.latest==='1')where.push("NOT EXISTS(SELECT 1 FROM operations_analysis_reports next WHERE next.content->>'supersedes'=r.id)");if(q.month){const monthStart=q.month+'-01',monthEnd=new Date(Date.UTC(Number(q.month.slice(0,4)),Number(q.month.slice(5,7)),0)).toISOString().slice(0,10);condition('p.start_date<=?',monthEnd);condition('p.end_date>=?',monthStart);}if(q.search)condition("(r.title||' '||r.summary||' '||COALESCE(r.content->>'topic','')) ILIKE ?",'%'+q.search+'%');const clause=where.length?'WHERE '+where.join(' AND '):'';
   const total=Number((await pool.query(`SELECT COUNT(*) count FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id ${clause}`,params)).rows[0].count);
   const reports=(await pool.query(`SELECT r.id,r.title,r.summary,r.published_at,r.content,${reportTypeSQL} report_type,p.start_date,p.end_date,p.compare_start,p.compare_end,(SELECT n.id FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id LIMIT 1) replaced_by FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id ${clause} ORDER BY p.start_date DESC,r.published_at DESC,r.id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,offset])).rows.map(row=>{const r=metadata(row,toCamel);r.topic=r.content?.topic||'';delete r.content;return r;});
   const packets=canPrepare?(await pool.query('SELECT id,start_date,end_date,compare_start,compare_end,sha256,created_at FROM operations_analysis_packets ORDER BY created_at DESC,id DESC LIMIT 50')).rows.map(toCamel):[];return sendJSON(res,200,{reports,packets,total,limit,offset,canPrepare,canPublish:canPrepare&&user.role==='admin',ruleVersion:metrics.RULE_VERSION});
  }
  if(req.method!=='POST')return sendError(res,405,'只支持读取、生成数据包和发布报告');
  if(!canPrepare)return sendError(res,403,'当前账号不可准备数据或发布报告');
  const body=await readBody(req);if(!body||typeof body!=='object'||Array.isArray(body))throw fail('请求格式无效');
  if(body.action==='publish'){
   if(!ensureRole(res,user,['admin']))return;
   const report=validateReport(body),id=crypto.randomUUID();db=await pool.connect();await db.query('BEGIN');
   const source=(await db.query('SELECT * FROM operations_analysis_packets WHERE id=$1',[report.packetId])).rows[0];if(!source)throw fail('来源数据包不存在',404);
   const start=source.start_date,end=source.end_date,last=new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10);if(report.reportType==='monthly'&&(start.slice(8)!=='01'||end!==last))throw fail('月度报告需使用完整自然月数据包');
   if(report.reportType==='weekly'&&((Date.parse(end)-Date.parse(start))/86400000!==6||new Date(start+'T00:00:00Z').getUTCDay()!==1))throw fail('周报须使用周一至周日完整七天数据包');
   if(report.reportType==='weekly'&&report.weekly.sources.some(s=>!/^\d{4}-\d{2}-\d{2}$/.test(s.published)||s.published>end))throw fail('周报预测来源不得晚于报告期末');
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[report.reportType==='monthly'?'monthly:'+start:report.supersedes||crypto.randomUUID()]);
   let reportVersion=1;if(report.supersedes){const old=(await db.query(`SELECT r.*,${reportTypeSQL} report_type,p.start_date,p.end_date FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE r.id=$1`,[report.supersedes])).rows[0];if(!old)throw fail('修订报告不存在',404);if(old.report_type!==report.reportType||old.start_date!==start||old.end_date!==end)throw fail('修订须对应同类型、同经营期间的报告');if((await db.query("SELECT id FROM operations_analysis_reports WHERE content->>'supersedes'=$1",[report.supersedes])).rows.length)throw fail('该报告已有修订版，请修订最新版本',409);reportVersion=(old.content.reportVersion||1)+1;}
   else if(report.reportType==='monthly'&&(await db.query(`SELECT r.id FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE ${reportTypeSQL}='monthly' AND p.start_date=$1 AND NOT EXISTS(SELECT 1 FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id)`,[start])).rows.length)throw fail('该月已有报告，请指定原报告进行修订',409);
   await db.query('INSERT INTO operations_analysis_reports(id,packet_id,title,summary,content,published_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[id,report.packetId,report.title,report.summary,JSON.stringify({...report,packetId:undefined,title:undefined,summary:undefined,reportVersion}),user.id]);
   await db.query(`INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,'publish_operations_report','operations_analysis_reports',$3,$4::jsonb)`,[crypto.randomUUID(),user.id,id,JSON.stringify({packetId:report.packetId,title:report.title})]);await db.query('COMMIT');return sendJSON(res,201,{id,packetId:report.packetId});
  }
  if(body.action!=='packet')throw fail('操作无效');
  const current=checkRange(body.start,body.end),previous=checkRange(body.compareStart,body.compareEnd);
  if(body.context!=null&&(typeof body.context!=='string'||body.context.length>8000))throw fail('经营背景过长或无效');const context=body.context||'';
  const start=[current.start,previous.start].sort()[0],end=[current.end,previous.end].sort().pop();if((new Date(end)-new Date(start))/86400000>1100)throw fail('两个期间跨度不能超过三年');
  db=await pool.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL statement_timeout='20s'");
  const business=camelData(await analysis.queryAnalysis(db,{...current,start,end}));const funnel=camelData(await analysis.queryAnalysis(db,{...current,start,end,action:'funnel'}));
  const products={current:camelData(await analysis.queryAnalysis(db,{...current,action:'ranking',dimension:'product'})),previous:camelData(await analysis.queryAnalysis(db,{...previous,action:'ranking',dimension:'product'}))};
  const periodExpenses=(await db.query(`SELECT business_date,business_layer_code,cost_type_code,SUM(cost_amount)::float8 amount FROM business_cost_facts_v2 WHERE cost_basis='period_expense' AND business_date BETWEEN $1 AND $2 GROUP BY 1,2,3 ORDER BY 1,2,3`,[start,end])).rows.map(toCamel);
  const refundDays=(await db.query("SELECT business_date,COUNT(*)::int count,SUM(net_amount)::float8 amount FROM business_revenue_facts_v2 WHERE source_table='transaction_adjustments' AND business_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",[start,end])).rows.map(toCamel);
  const fingerprints=[];for(const table of ['revenue','gallery_sales','expense','transaction_adjustments','space_usage','space_payments']){const r=(await db.query(`SELECT COUNT(*)::int count,MD5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) fingerprint FROM ${table} t`)).rows[0];fingerprints.push({table,...r});}
  const id=crypto.randomUUID(),payload={schemaVersion:1,metricVersion:'operations-report-20261011',id,generatedAt:new Date().toISOString(),current:{start:current.start,end:current.end},previous:{start:previous.start,end:previous.end},context,questions:['馆内总人均收入与四项人均收入如何变化？','套票销量变化及普通票和单售咖啡的同步变化？','销量变化中客流与销量转化分别贡献多少？','毛利变化是否可计算，已知毛利和成本缺口是什么？'],methodology:['到馆=普通门票数量+套票数量；免费未登记访客未覆盖','销量转化非购买人数转化；套票咖啡权益非实际核销杯量','四项范围=套票、非饮料文创、工坊、画廊；完整馆内收入另含普通票、咖啡与饮料','未知成本不补零，部分覆盖毛利不得当完整毛利；空间独立；待归属退款不强制分配','同日与前后变化非因果；对比须考虑营业日、展览、假日、促销'],business,funnel,products,periodExpenses,refundDays,fingerprints,complete:true};
  payload.schemaVersion=2;payload.ruleVersion=metrics.RULE_VERSION;payload.metrics=metrics.calculate(payload);
  payload.sha256=crypto.createHash('sha256').update(canonical(payload)).digest('hex');
  await db.query('INSERT INTO operations_analysis_packets(id,start_date,end_date,compare_start,compare_end,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[id,current.start,current.end,previous.start,previous.end,payload.sha256,JSON.stringify(payload),user.id]);await db.query('COMMIT');sendJSON(res,201,payload);
 }catch(error){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('Operations reports:',error.message);sendError(res,error.status||500,error.status?error.message:'经营报告暂不可用，请重试或缩小范围');}finally{db?.release();}
 };
};
module.exports.validateReport=validateReport;

module.exports.canonical=canonical;
