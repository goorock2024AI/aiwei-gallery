'use strict';
// Domain calculations only. Daily briefs are evidence, never the financial ledger.
const core=require('./daily-brief-core');
const BASIS='all-income-business-date-v1',VERSION='weekly-management-1.0';
const fail=message=>Object.assign(Error(message),{status:400});
function week(start){core.validateDate(start);if(new Date(start+'T12:00:00Z').getUTCDay()!==1)throw fail('请选择周一');return {start,end:core.add(start,6)};}
const income=p=>core.money(Object.values(p.types).reduce((n,t)=>n+t.income,0));
const difference=(actual,forecast)=>({actual,forecast,amount:core.money(actual-forecast),rate:forecast>0?(actual-forecast)/forecast:null});
function required(v,name,max=1400){if(typeof v!=='string'||!v.trim()||v.length>max)throw fail(name+'缺失或过长');return v.trim();}
function amount(v,name){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e9)throw fail(name+'无效');return core.money(v);}
function feedback(v){
 const execution=v.execution||'pending',effect=v.effect||'unconfirmed',recommendation=v.recommendation||'pending';
 if(!['pending','not_done','partial','done'].includes(execution)||!['unconfirmed','effective','ineffective','mixed'].includes(effect)||!['pending','continue','adjust','stop'].includes(recommendation))throw fail('行动反馈状态无效');
 const evidence=typeof v.evidence==='string'?v.evidence.trim():'';
 if((execution==='done'||effect!=='unconfirmed')&&!evidence)throw fail('已执行或效果判断需要证据');
 if(effect!=='unconfirmed'&&!['done','partial'].includes(execution))throw fail('尚未执行不能判断已经有效');
 return {execution,effect,evidence:evidence.slice(0,3000),result:required(v.result||'待确认','观察结果'),recommendation};
}
function validateAnalysis(value,packet){
 if(!value||!Array.isArray(value.judgments)||value.judgments.length<2||value.judgments.length>3)throw fail('请提供两至三项经营判断');
 const judgments=value.judgments.map(j=>{if(!['fact','explanation','hypothesis'].includes(j.kind))throw fail('请区分事实、合理解释、待验证原因');return {kind:j.kind,judgment:required(j.judgment,'判断'),evidence:required(j.evidence,'证据'),implication:required(j.implication,'经营含义')};});
 const range=week(core.add(packet.current.start,7)),f=value.forecast;
 if(!f||f.start!==range.start||f.end!==range.end||f.basis!==BASIS)throw fail('预测须覆盖下周完整周及全馆统一口径');
 core.validateDate(f.sampleCutoff);if(f.sampleCutoff>packet.current.end)throw fail('预测样本不得晚于本周期末');
 if(!Array.isArray(f.drivers)||f.drivers.length>8)throw fail('预测变量无效');
 const forecast={...range,value:amount(f.value,'预测收入'),basis:BASIS,methodVersion:required(f.methodVersion,'预测方法版本',100),sampleCutoff:f.sampleCutoff,
  baseline:{method:'last-week-same-days',value:income(packet.metrics.current)},
  drivers:f.drivers.map(d=>{if(!['positive','negative','neutral','unknown'].includes(d.direction))throw fail('影响方向无效');core.validateDate(d.sourceDate);if(d.sourceDate>core.day(packet.generatedAt))throw fail('影响证据晚于资料截止');return {name:required(d.name,'影响因素',120),direction:d.direction,evidence:required(d.evidence,'影响证据'),sourceDate:d.sourceDate};})};
 const tasks=value.actions;if(!Array.isArray(tasks)||tasks.length<1||tasks.length>3)throw fail('下周须有一至三项行动');
 const actions=tasks.map(a=>{core.validateDate(a.due);if(a.due<range.start||a.due>range.end)throw fail('行动期限须在下周内');return {action:required(a.action,'行动'),measure:required(a.measure,'衡量指标'),owner:a.owner?required(a.owner,'负责人',120):'管理员',due:a.due,nextReview:required(a.nextReview,'下期复核要求')};});
 const currentTarget=amount(value.currentTarget,'本周收入指标'),nextTarget=amount(value.nextTarget,'下周收入指标');
 // Targets are a separately approved allocation, never a function of forecast.
 if(value.targetAuthority!=='director')throw fail('收入目标须由馆长设定');
 if(!Array.isArray(value.monthAllocations)||!value.monthAllocations.length||value.monthAllocations.length>2)throw fail('下周指标须按业务月份分配');
 const months=[...new Set(Array.from({length:7},(_,i)=>core.add(range.start,i).slice(0,7)))];
 const allocations=value.monthAllocations.map(m=>{if(!months.includes(m.month))throw fail('指标归属月份不在下周');const goal=packet.managementContext.monthGoals[m.month];if(goal==null)throw fail('月目标尚未由馆长配置');return {month:m.month,goal,weeklyAmount:amount(m.weeklyAmount,'分月指标'),allocationReason:required(m.allocationReason,'任务分配依据')};});
 if(new Set(allocations.map(m=>m.month)).size!==months.length||allocations.length!==months.length||Math.abs(allocations.reduce((n,m)=>n+m.weeklyAmount,0)-nextTarget)>.005)throw fail('跨月指标须完整分月且合计一致');
 const previous=packet.managementContext.previous;
 const issuedTarget=previous?.issuedTarget??previous?.management?.nextTarget;if(issuedTarget!=null&&currentTarget!==issuedTarget)throw fail('本周指标须承接上一期保存值，不得覆盖');
 const actionReviewAdvice=(packet.managementContext.actionReviews||[]).map(r=>{const advice=(value.actionReviewAdvice||[]).find(a=>a.index===r.index);if(!advice)return {index:r.index,recommendation:'pending',reason:'待管理员补充证据后复核'};if(!['pending','continue','adjust','stop'].includes(advice.recommendation))throw fail('复核建议无效');return {index:r.index,recommendation:advice.recommendation,reason:required(advice.reason,'复核建议依据')};});
 return {version:VERSION,judgments,forecast,actions,currentTarget,nextTarget,targetAuthority:'director',monthAllocations:allocations,actionReviewAdvice,
  reviewText:required(value.reviewText,'上期行动复核与经营评价'),importantCorrection:value.importantCorrection===true,correctionReason:value.importantCorrection?required(value.correctionReason,'重要更正原因',300):null};
}
function trajectory(records){
 const usable=records.filter(r=>r.eligible&&r.selectedForEvaluation!==false&&r.comparable&&r.actual!=null);
 const groups={};for(const r of usable){const key=r.methodVersion+' / '+r.basis;(groups[key]??=[]).push(r);}
 return {records,groups:Object.entries(groups).map(([method,rows])=>{const recent=rows.slice(-3),continuous=recent.length===3&&recent.every((r,i)=>!i||Date.parse(r.start)-Date.parse(recent[i-1].start)===604800000),mean=key=>core.money(rows.reduce((n,r)=>n+Math.abs(r.actual-r[key]),0)/rows.length);return {method,samples:rows.length,mae:mean('value'),baselineMAE:rows.every(r=>r.baseline!=null)?mean('baseline'):null,
  bias:continuous&&recent.every(r=>r.actual<r.value)?'连续三期高估':continuous&&recent.every(r=>r.actual>r.value)?'连续三期低估':'未形成连续同向偏差',assessment:rows.length<4?'样本不足，不能判断预测方法有效':'仅为历史误差比较，不证明方法有效'};}),note:'按周一16:00发布窗口核验，样本截止须早于预测周；每周首次已发预测仅入样一次，修订原值并列保留。历史重建、超时发布及范围/口径不同不混入有效样本；零预测不计算偏差率。'};
}
function summary(report,{correction=false,reason=''}={}){
 const clip=(v,max)=>{let value=String(v||'');while(Buffer.byteLength(value)>max)value=Array.from(value).slice(0,-1).join('');return value;};
 const m=report.content.management,lines=correction?['【周经营报告更正】',clip(reason,240)]:['【艾维美术馆周经营复盘】',report.startDate+'—'+report.endDate,clip(report.summary,300),
  `实际${m.actual}元；指标${m.currentTarget}元，完成${m.currentTarget>0?(m.actual/m.currentTarget*100).toFixed(1)+'%':'率不适用'}，差额${core.money(m.actual-m.currentTarget)}元。`,
  m.previousForecast?`相对上期预测差额${m.previousForecast.amount}元，偏差率${m.previousForecast.rate==null?'不可计算':(m.previousForecast.rate*100).toFixed(1)+'%'}。`:'上期可比预测未取得，偏差待核对。'];
 if(!correction)lines.push(`下周指标${m.nextTarget}元，预测${m.forecast.value}元。`);
 lines.push(...m.actions.slice(0,3).map((a,i)=>`${i+1}. ${clip(a.action,130)}（${clip(a.owner,45)}，${a.due}）`));
 lines.push('完整报告（需平台登录）：https://iwe.ucanart.cc/operations-report.html?id='+encodeURIComponent(report.id));
 // Preserve the report link even when authored content is lengthy. UTF-8 bound required by WeCom.
 const link=lines.pop();let content=lines.join('\n');while(Buffer.byteLength(content+'\n'+link)>2000)content=Array.from(content).slice(0,-1).join('');return content+'\n'+link;
}
module.exports={BASIS,VERSION,week,income,difference,required,amount,feedback,validateAnalysis,trajectory,summary};
