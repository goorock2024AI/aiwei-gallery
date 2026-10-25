'use strict';
const core=require('./daily-brief-core');
// Proposals only: approval is deliberately false by default.
const proposed={approved:false,absolute:50,ratio:0.05,smallBase:200,stockGrams:500,stockRatio:0.25,mergeMinutes:10,maxMergeMinutes:30,maxCorrections:2};
function policy(input={}){
 if(typeof input==='string')input=JSON.parse(input);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(proposed,k)))throw Error('更正规则配置无效');
 const p={...proposed,...input};if(typeof p.approved!=='boolean')throw Error('更正规则批准状态无效');
 for(const k of ['absolute','ratio','smallBase','stockGrams','stockRatio','mergeMinutes','maxMergeMinutes','maxCorrections'])if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<=0)throw Error('更正阈值需为有限正数');
 if(p.ratio>1||p.stockRatio>1||p.mergeMinutes>60||p.maxMergeMinutes<p.mergeMinutes||p.maxMergeMinutes>120||!Number.isInteger(p.maxCorrections)||p.maxCorrections>5)throw Error('更正规则范围无效');return p;
}
const at=(date,time)=>+new Date(date+'T'+time+':00+08:00');
function within(date,now){return +new Date(now)>=at(date,'18:00')&&+new Date(now)<=at(core.add(date,1),'18:20');}
function moneyImportant(old,value,p){const difference=Math.abs(core.money(value-old)),base=Math.abs(old);return difference>=p.absolute&&(base<p.smallBase||difference/Math.max(base,0.01)>=p.ratio);}
function compare(old,next,p){
 const changes=[];const add=(item,before,after,important=false,unit='元')=>{if(before!==after)changes.push({item,old:before,new:after,difference:typeof before==='number'&&typeof after==='number'?core.money(after-before):null,unit,important});};
 add('收入总额',old.metrics.income,next.metrics.income,moneyImportant(old.metrics.income,next.metrics.income,p));
 const before=Object.fromEntries(old.metrics.businesses.map(b=>[b.code,b]));const after=Object.fromEntries(next.metrics.businesses.map(b=>[b.code,b]));
 for(const code of new Set([...Object.keys(before),...Object.keys(after)])){const a=before[code]?.income||0,b=after[code]?.income||0;add((after[code]||before[code]).name||code,a,b,moneyImportant(a,b,p));}
 add('日结状态',old.finalized?'已日结':'未日结',next.finalized?'已日结':'未日结',old.finalized&&!next.finalized,'');
 const a=old.coffee,b=next.coffee;
 // Never substitute today's stock for yesterday's original operating snapshot.
 if(a&&b&&a.today===old.date&&b.today===next.date){
  const urgent=(x)=>x.status==='urgent'||x.availableGrams<=0;
  const label=v=>({urgent:'紧急补货',buy:'建议补货',ok:'正常',setup:'待盘点',insufficient:'资料不足'}[v]||'待核对');
  add('备料状态',label(a.status),label(b.status),urgent(a)!==urgent(b),'');
  if((a.availableGrams<=0)!==(b.availableGrams<=0))add('咖啡豆可用库存',a.availableGrams,b.availableGrams,true,'克');
  const stockChange=Math.abs((b.suggestedGrams||0)-(a.suggestedGrams||0));
  add('建议备料量',a.suggestedGrams||0,b.suggestedGrams||0,stockChange>=p.stockGrams&&stockChange/Math.max(a.suggestedGrams||0,p.stockGrams)>=p.stockRatio,'克');
 }
 return {changes,important:changes.some(c=>c.important),signature:core.hash(changes)};
}
function correction(date,comparison,now,reason){
 const time=new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 return `艾维美术馆｜${date}日报更正\n`+comparison.changes.map(c=>`· ${c.item}：${c.old}${c.unit} → ${c.new}${c.unit}`+(c.difference==null?'':`，差额${c.difference>=0?'+':''}${c.difference}${c.unit}`)).join('\n')+`\n修订时间：${time}（北京时间）\n原因：${reason||'来源记录发生变化，具体原因待核实。'}`;
}
function accountingBasisChanged(before,next){return (before?.metrics?.spaceAccounting?.basis||'space-cash-before-execution')!==(next?.metrics?.spaceAccounting?.basis||'space-cash-before-execution');}
module.exports={proposed,policy,at,within,compare,correction,moneyImportant,accountingBasisChanged};
