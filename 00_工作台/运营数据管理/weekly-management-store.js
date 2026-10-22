'use strict';
const crypto=require('node:crypto'),core=require('./daily-brief-core'),domain=require('./weekly-management');
const latestSQL=`SELECT r.*,p.start_date,p.end_date,p.sha256 FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE r.content->>'reportType'='weekly' AND p.end_date<$1 AND r.published_at<=$2 AND NOT EXISTS(SELECT 1 FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id AND n.published_at<=$2) ORDER BY p.start_date DESC,r.published_at DESC LIMIT 12`;
async function actionFeedback(db,reportId,index,cutoff=new Date().toISOString()){
 let row=(await db.query('SELECT id,content FROM operations_analysis_reports WHERE id=$1',[reportId])).rows[0];if(!row?.content.actions[index])return null;
 const signature=core.hash(row.content.actions[index]),matches=[];
 for(let n=0;row&&n<30;n++){
  const actionIndex=row.content.actions.findIndex(a=>core.hash(a)===signature);
  if(actionIndex<0)break;
  const f=(await db.query('SELECT id,report_id,action_index,detail,created_by,created_at FROM operations_weekly_feedback WHERE report_id=$1 AND action_index=$2 AND created_at<=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[row.id,actionIndex,cutoff])).rows[0];if(f)matches.push(f);
  if(!row.content.supersedes)break;row=(await db.query('SELECT id,content FROM operations_analysis_reports WHERE id=$1',[row.content.supersedes])).rows[0];
 }
 return matches.sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at))[0]||null;
}
async function collect(db,packet){
 const range=domain.week(packet.current.start),cutoff=packet.generatedAt;if(range.end!==packet.current.end)throw Error('资料必须是完整周');
 const history=(await db.query(latestSQL,[range.start,cutoff])).rows;
 const issued=(await db.query("SELECT r.*,p.start_date,p.end_date FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id WHERE r.content->>'reportType'='weekly' AND p.end_date<$1 AND r.published_at<=$2 ORDER BY p.start_date DESC,r.published_at DESC,r.id DESC LIMIT 100",[range.start,cutoff])).rows.reverse();
 const prior=history.find(r=>r.end_date===core.add(range.start,-1));
 const original=prior?issued.find(r=>r.start_date===prior.start_date&&r.content.management?.forecast):null;
 const previous=prior?{id:prior.id,start:prior.start_date,end:prior.end_date,sha256:prior.sha256,publishedAt:prior.published_at,management:prior.content.management||null,issuedForecast:original?{reportId:original.id,publishedAt:original.published_at,...original.content.management.forecast}:null,issuedTarget:original?.content.management.nextTarget??null,legacyWeekly:prior.content.weekly,actions:prior.content.actions.slice(0,3)}:null;
 const reviews=[];
 if(prior)for(let i=0;i<previous.actions.length;i++){
  const f=await actionFeedback(db,prior.id,i,cutoff);
  reviews.push({reportId:prior.id,index:i,action:previous.actions[i],feedback:f?{id:f.id,...f.detail,by:f.created_by,at:f.created_at}:{execution:'pending',effect:'unconfirmed',evidence:'未取得反馈',result:'待确认',recommendation:'pending'}});
 }
 const daily={reports:[],missing:[],stale:[],provisional:[],basis:'仅作经营背景，不累计作为周收入；保留日报原时点的天气、库存和截止信息'};
 for(let i=0;i<7;i++){
  const date=core.add(range.start,i),r=(await db.query('SELECT * FROM operations_daily_briefs WHERE business_date=$1 AND created_at<=$2 ORDER BY revision DESC LIMIT 1',[date,cutoff])).rows[0];
  if(!r){daily.missing.push(date);continue;}
  if(await core.fingerprint(db,date)!==r.source_hash)daily.stale.push(date);if(!r.payload.finalized)daily.provisional.push(date);
  daily.reports.push({id:r.id,date,revision:r.revision,supersedes:r.supersedes,sourceHash:r.source_hash,payloadHash:core.hash(r.payload),createdAt:r.created_at,
   cutoffTime:r.payload.cutoffTime,finalized:r.payload.finalized,weather:r.payload.weather,coffee:r.payload.coffee,background:r.payload.metrics.background,
   analysis:r.payload.analysis,metrics:r.payload.metrics});
 }
 daily.complete=!daily.missing.length&&!daily.stale.length&&!daily.provisional.length;
 const monthEnd=core.add(range.end,7),monthStart=range.start.slice(0,7)+'-01';
 const months=(await db.query('SELECT substring(business_date,1,7) AS "month",SUM(net_amount)::float8 income FROM business_revenue_facts_v2 WHERE business_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1',[monthStart,range.end])).rows;
 const setting=(await db.query("SELECT value FROM app_config WHERE key='daily_brief_month_targets'")).rows[0];
 const monthGoals={};for(const m of [...new Set([range.start.slice(0,7),range.end.slice(0,7),core.add(range.end,1).slice(0,7),monthEnd.slice(0,7)])]){
  const v=setting?.value?.[m];monthGoals[m]=typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 }
 const records=[];
 const selectedPeriods=new Set();
 for(const r of issued){
  const f=r.content.management?.forecast;if(!f||f.end>range.end)continue;
  const actual=core.money(Number((await db.query('SELECT SUM(net_amount)::float8 income FROM business_revenue_facts_v2 WHERE business_date BETWEEN $1 AND $2',[f.start,f.end])).rows[0].income||0));
  const comparable=f.basis===domain.BASIS&&domain.week(f.start).end===f.end;
  const eligible=+new Date(r.published_at)<=+new Date(f.start+'T16:00:00+08:00')&&f.sampleCutoff<f.start,selectedForEvaluation=eligible&&!selectedPeriods.has(f.start);if(selectedForEvaluation)selectedPeriods.add(f.start);
  records.push({reportId:r.id,start:f.start,end:f.end,value:f.value,basis:f.basis,methodVersion:f.methodVersion,sampleCutoff:f.sampleCutoff,actual,...domain.difference(actual,f.value),baseline:f.baseline?.value??null,eligible,comparable,selectedForEvaluation});
 }
 const forecast=previous?.issuedForecast;
 const previousForecast=forecast&&forecast.start===range.start&&forecast.end===range.end&&forecast.basis===domain.BASIS?{...domain.difference(domain.income(packet.metrics.current),forecast.value),reportId:forecast.reportId,methodVersion:forecast.methodVersion,basis:forecast.basis,eligible:+new Date(forecast.publishedAt)<=+new Date(range.start+'T16:00:00+08:00')&&forecast.sampleCutoff<range.start}:null;
 const calendar={rule:'普通周一闭馆，节假日周一开馆，长假后首个工作日补休；节日及临时例外以有证据的实际安排为准，未确认不统计真实营业天数',days:Array.from({length:14},(_,i)=>{const date=core.add(range.start,i),weekday=new Date(date+'T12:00:00Z').getUTCDay();return {date,weekday:weekday||7,weekend:weekday===0||weekday===6,background:daily.reports.find(r=>r.date===date)?.background||null,holidayAndActualOpen:'须结合官方日历及实际例外复核'};})};
 const context={version:domain.VERSION,cutoff,previous,actionReviews:reviews,daily,calendar,monthGoals,monthActuals:months,previousForecast,forecastHistory:domain.trajectory(records),
  financeBasis:'正式统一快照按业务日期取全馆收入；日报只作背景；跨月按自然月重取，不整周累加',todos:[]};
 if(!daily.complete)context.todos.push('日报资料未齐或未完成日结/修订：缺失'+daily.missing.length+'天，暂报'+daily.provisional.length+'天，待修订'+daily.stale.length+'天');
 if(reviews.some(r=>r.feedback.execution==='pending'))context.todos.push('上期行动缺反馈，执行和效果均待确认');
 if(!previous)context.todos.push('未取得紧邻上一周已发布报告，不能跨周冒接');
 if(!previousForecast)context.todos.push('未取得上期同范围同口径的结构化预测，保留历史原文，不反解析展示数字');
 return JSON.parse(JSON.stringify(context));
}
const sourceSignature=c=>core.hash({previous:c.previous,actionReviews:c.actionReviews,daily:c.daily,monthGoals:c.monthGoals,monthActuals:c.monthActuals,forecastHistory:c.forecastHistory});
const financeSignature=p=>core.hash(JSON.parse(JSON.stringify({current:p.current,previous:p.previous,business:p.business,funnel:p.funnel,products:p.products,periodExpenses:p.periodExpenses,refundDays:p.refundDays,metrics:p.metrics})));
async function event(db,runId,kind,actor,detail){await db.query('INSERT INTO operations_weekly_events(id,run_id,kind,actor,detail) VALUES($1,$2,$3,$4,$5::jsonb)',[crypto.randomUUID(),runId,kind,actor,JSON.stringify(detail)]);}
async function prepare(db,start,actor){
 const current=domain.week(start),previous=domain.week(core.add(start,-7));if(current.end>=core.day(new Date()))throw Object.assign(Error('完整周须在周日结束后准备'),{status:400});
 const packet=await require('./operations-report-packet').collectPacket(db,current,previous,'周经营复盘：资料准备，不生成经营结论，不自动发布');
 await db.query('INSERT INTO operations_analysis_packets(id,start_date,end_date,compare_start,compare_end,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[packet.id,current.start,current.end,previous.start,previous.end,packet.sha256,JSON.stringify(packet),actor]);
 const id=crypto.randomUUID();await db.query("INSERT INTO operations_weekly_runs(id,packet_id,start_date,state,created_by) VALUES($1,$2,$3,'prepared',$4)",[id,packet.id,start,actor]);await event(db,id,'prepare',actor,{packetId:packet.id,sha256:packet.sha256});return {id,packet};
}
async function assertFresh(db,packet){
 const fresh=await require('./operations-report-packet').collectPacket(db,packet.current,packet.previous,packet.context);
 if(financeSignature(fresh)!==financeSignature(packet)||sourceSignature(fresh.managementContext)!==sourceSignature(packet.managementContext))throw Object.assign(Error('资料已补录或修订，请重新准备并复核；原快照仍保留'),{status:409});
}
function management(packet,analysis){const c=packet.managementContext;return {...analysis,cutoff:c.cutoff,sourceContextHash:sourceSignature(c),actual:domain.income(packet.metrics.current),previousActual:domain.income(packet.metrics.previous),previousForecast:c.previousForecast,actionReviews:c.actionReviews.map(r=>({...r,advice:analysis.actionReviewAdvice.find(a=>a.index===r.index)})),daily:c.daily,monthActuals:c.monthActuals,monthGoals:c.monthGoals,forecastHistory:c.forecastHistory};}
function overview(m){const d=m.previousForecast,delta=core.money(m.actual-m.currentTarget);return [
 ['本周实际收入',m.actual.toFixed(2)+'元',`上周${m.previousActual.toFixed(2)}元，变化${core.money(m.actual-m.previousActual)}元`],
 ['本周收入指标完成情况',m.currentTarget.toFixed(2)+'元；完成'+(m.currentTarget>0?(m.actual/m.currentTarget*100).toFixed(1)+'%':'率不适用'),`差额${delta}元`],
 ['本周实际与上周预测差异',d?d.forecast.toFixed(2)+'元':'未取得可比预测',d?`差额${d.amount}元；偏差率${d.rate==null?'不可计算':(d.rate*100).toFixed(1)+'%'}${d.eligible?'':'；历史重建/事后发布'}`:'原预测不改写'],
 ['下周收入指标',m.nextTarget.toFixed(2)+'元',m.forecast.start+'—'+m.forecast.end],
 ['下周预测收入',m.forecast.value.toFixed(2)+'元',`较指标差额${core.money(m.forecast.value-m.nextTarget)}元`]];}
async function gatePublish(db,report,source,runId){
 const run=(await db.query('SELECT * FROM operations_weekly_runs WHERE id=$1 FOR UPDATE',[runId])).rows[0];
 if(!run||run.packet_id!==source.id||run.state!=='reviewed')throw Object.assign(Error('周报尚未完成Agent分析和人工复核'),{status:409});
 const stored=run.analysis;if(core.hash(stored.report)!==core.hash(report))throw Object.assign(Error('报告在复核后发生变化，请重新复核'),{status:409});
 await assertFresh(db,source.payload);if(!source.payload.managementContext.daily.complete)throw Object.assign(Error('日报资料不足，不能发布完整正式周报'),{status:409});
 return run;
}
module.exports={collect,sourceSignature,financeSignature,event,prepare,assertFresh,management,overview,gatePublish,actionFeedback};
