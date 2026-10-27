'use strict';
// Shared daily report presentation. Raw snapshots remain in the private archive.
const amount=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const known=v=>typeof v==='number'&&Number.isFinite(v);
const clock=v=>{const d=new Date(v);return Number.isNaN(+d)?'待核对':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};
const names={ticket:'门票',visit_combo:'咖啡套票',coffee:'单售咖啡',creative_retail:'文创零售',beverage_retail:'饮料零售',workshop:'工坊',gallery_sale:'画廊',space_rental:'场地租赁'};
const order=Object.keys(names);
function comparisonDate(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-7);return d.toISOString().slice(0,10);}
// Older snapshots retain their comparison packet; use it without inventing missing values.
function metrics(p){
 const m={...p.metrics},previous=p.finance?.day?.metrics?.previous;
 if(m.previousVisitors===undefined)m.previousVisitors=previous?.visitors?.value??null;
 if(m.previousIncome===undefined&&previous?.types)m.previousIncome=Object.values(previous.types).reduce((n,b)=>n+b.income,0);
 const current=new Map((m.businesses||[]).map(b=>[b.code,b]));
 m.businesses=[...new Set([...current.keys(),...Object.keys(previous?.types||{})])].map(code=>{
  const b=current.get(code);return {code,name:b?.name||names[code]||code,income:b?.income??0,previousIncome:b?.previousIncome??(previous?.types?(previous.types[code]?.income??0):null)};
 }).sort((a,b)=>(order.indexOf(a.code)<0?99:order.indexOf(a.code))-(order.indexOf(b.code)<0?99:order.indexOf(b.code)));
 return m;
}
function isClosed(p){
 const m=p.metrics;
 return /^\d{4}-\d{2}-\d{2}$/.test(p.date)&&new Date(p.date+'T12:00:00Z').getUTCDay()===1
  &&m?.income===0&&Array.isArray(m.businesses)&&m.businesses.every(b=>b.income===0);
}
function title(p){const [,m,d]=p.date.split('-').map(Number);return `艾维美术馆经营日报 | ${m}月${d}日`;}
function dateLine(p){
 const [y,m,d]=p.date.split('-').map(Number),weekday='日一二三四五六'[new Date(p.date+'T12:00:00Z').getUTCDay()],w=p.weather||{};
 const weather=w.status==='ok'?`天气：采集时${String(w.currentText).replace(/（.*?）/g,'').trim()}`:'天气：暂未取得';
 return `${y}年${m}月${d}日 星期${weekday} 【${weather}】`;
}
function change(current,previous,unit='元'){
 if(!known(current)||!known(previous))return '同比待核对';
 const delta=current-previous;
 if(delta===0)return '同比持平（0%）';
 if(previous<=0)return `上周同期${amount(previous)}${unit}，${delta>0?'增加':'减少'}${amount(Math.abs(delta))}${unit}，涨跌幅不适用`;
 return `同比${delta>0?'上升':'下降'}${(Math.abs(delta)/previous*100).toFixed(1)}%`;
}
function review(p,compact=false){
 if(isClosed(p))return '闭馆休息日未营业';
 const m=metrics(p),lines=[`对比上周同期（${comparisonDate(p.date)}，同为星期${'日一二三四五六'[new Date(p.date+'T12:00:00Z').getUTCDay()]}）：收入${change(m.income,m.previousIncome)}。`];
 const business=m.businesses.filter(b=>b.income!==0||b.previousIncome!==0);
 for(const b of business){if(compact){lines.push(`· ${names[b.code]||b.name}：${amount(b.income)}元（${known(b.previousIncome)?`较上周${b.income>=b.previousIncome?'+':'−'}${amount(Math.abs(b.income-b.previousIncome))}元`:'上周待核对'}）`);continue;}lines.push(`· ${names[b.code]||b.name}：${amount(b.income)}元；上周同期${known(b.previousIncome)?amount(b.previousIncome)+'元':'待核对'}，${change(b.income,b.previousIncome)}${known(b.previousIncome)&&b.income!==b.previousIncome?`，${b.income>=b.previousIncome?'增加':'减少'}${amount(Math.abs(b.income-b.previousIncome))}元`:''}。`);}
 if(!business.length)lines.push('· 当日及上周同期各项收入均为0元。');
 const changed=m.businesses.filter(b=>known(b.previousIncome)&&b.income!==b.previousIncome);
 if(known(m.previousIncome)&&m.income!==m.previousIncome){
  const falling=m.income<m.previousIncome,drivers=changed.filter(b=>falling?b.income<b.previousIncome:b.income>b.previousIncome).sort((a,b)=>Math.abs(b.income-b.previousIncome)-Math.abs(a.income-a.previousIncome));
  const offsets=changed.filter(b=>falling?b.income>b.previousIncome:b.income<b.previousIncome);
  if(drivers.length)lines.push(`收入${falling?'下降':'增长'}主要来自${drivers.slice(0,3).map(b=>`${names[b.code]||b.name}${falling?'减少':'增加'}${amount(Math.abs(b.income-b.previousIncome))}元`).join('、')}。`+(offsets.length?`其他分类${falling?'增长':'下降'}合计${amount(offsets.reduce((n,b)=>n+Math.abs(b.income-b.previousIncome),0))}元，抵消了部分${falling?'降幅':'增幅'}。`:''));
 }else if(known(m.previousIncome)&&changed.length)lines.push('各分类收入增减相互抵消，总收入与上周同期持平。');
 lines.push(`今日到馆${known(m.visitors)?amount(m.visitors)+'人次':'人次待核对'}，上周同期${known(m.previousVisitors)?amount(m.previousVisitors)+'人次':'待核对'}，${change(m.visitors,m.previousVisitors,'人次')}${known(m.visitors)&&known(m.previousVisitors)&&m.visitors!==m.previousVisitors?`，${m.visitors>=m.previousVisitors?'增加':'减少'}${amount(Math.abs(m.visitors-m.previousVisitors))}人次`:''}。`);
 if(known(m.visitors)&&known(m.previousVisitors)&&m.visitors<m.previousVisitors){
  const rain=p.weather?.status==='ok'&&/雨/.test(p.weather.currentText||'')&&!/无雨|未降雨/.test(p.weather.currentText||'');
  lines.push(rain?'采集时有降雨，到馆人次也低于上周同期，降雨可能影响公园客流；目前缺少全天降雨和游客数据，影响程度待核实。':'到馆人次较上周同期减少，需结合天气、展览活动和公园客流记录核实原因。');
 }
 return lines.join('\n');
}
function note(p){
 if(isClosed(p))return '';
 const time=Number.isNaN(Date.parse(p.cutoffTime))?p.generatedAt:p.cutoffTime,d=new Date(time);
 const date=Number.isNaN(+d)?p.date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(d);
 const lines=[`统计截止：${date} ${clock(time)}（北京时间）｜${p.finalized?'日结已完成':'暂报，日结未完成'}`,`本日报“同比”指与上周同一星期几相比：${p.date} 对比 ${comparisonDate(p.date)}。`,`到馆人次按普通门票与套票数量统计，未登记免费访客未覆盖；本月累计按自然月统计。`];
 const m=metrics(p),sa=m.spaceAccounting;
 if(!known(m.targetProgress))lines.push('本月目标未设置或无有效正数目标，目标达成率暂不可计算。');
 if(p.weather?.status==='ok')lines.push('天气来源：和风天气；所示为采集时天气，不代表全天实况。');
 if(sa){lines.push(`场地租赁按确认使用日期计收入：今日已执行${amount(sa.executed)}元；今日实收${amount(sa.receipts)}元，不重复计入经营收入。`,`期末已收未执行${amount(sa.receivedUnexecuted)}元；已执行未收${amount(sa.executedUnpaid)}元。`);if(sa.pendingDays)lines.push(`待核对：${sa.pendingDays}条到期使用明细尚未确认。`);if(sa.legacyUnverified?.count)lines.push(`旧场地款${amount(sa.legacyUnverified.amount)}元缺执行日期，未计入已执行收入。`);}
 for(const alert of m.alerts||[])if(!lines.some(line=>line.includes(alert)))lines.push('数据提示：'+alert);
 return lines.join('\n');
}
function sections(p){
 if(isClosed(p))return [['营业概况','闭馆休息日未营业']];
 const m=metrics(p),w=p.weather||{},c=p.coffee;
 const income=[`收入总额${amount(m.income)}元，${change(m.income,m.previousIncome)}`,`今日到馆${known(m.visitors)?amount(m.visitors)+'人次':'人次待核对'}，${change(m.visitors,m.previousVisitors,'人次')}`,`本月累计收入${amount(m.monthIncome)}元，${known(m.targetProgress)?'目标达成率'+(m.targetProgress*100).toFixed(1)+'%':'目标达成率暂不可计算（目标未设置）'}`].join('\n');
 const stock=!c?'库存待核对。':!c.initialized?'请完成咖啡豆首次盘点。':`咖啡豆余量${amount(c.availableGrams)}克`+(c.suggestedGrams>0?`，${c.status==='urgent'?'需优先核对库存并安排补货':'请核对补货安排'}。建议采购约${amount(c.suggestedGrams/1000)}公斤，结合在途订单和保鲜要求确认。`:'，暂未提示补货。');
 const tomorrow=[`· 天气预报：${w.status==='ok'?w.tomorrowText+'。':'暂未取得。'}`,c?.suggestedGrams>0?'· 优先落实咖啡豆补货，做好现场接待准备。':'· 核对备料安排，做好现场接待准备。'].join('\n');
 return [['营业概况',income],['今日复盘',review(p)],['明日重点',tomorrow],['备料提醒',stock],['统计说明',note(p)]];
}
function text(p){
 if(isClosed(p))return `${title(p)}\n\n闭馆休息日未营业`;
 const blocks=sections(p),build=()=>`${title(p)}\n\n${dateLine(p)}\n\n`+blocks.map(([heading,body])=>`${heading}\n${body}`).join('\n\n');
 let result=build();
 if(Buffer.byteLength(result,'utf8')>2048){
  blocks[1][1]=review(p,true);
  const time=Number.isNaN(Date.parse(p.cutoffTime))?p.generatedAt:p.cutoffTime;
  blocks[4][1]=`截至${clock(time)}（北京时间），${p.finalized?'日结已完成':'暂报，日结未完成'}。\n同比：${p.date} 对比 ${comparisonDate(p.date)}（上周同一星期几）。\n到馆=普通门票+套票数量；月累计按自然月。天气为采集时观测。`;
  if(p.metrics.spaceAccounting)blocks[4][1]+='场地按使用日计收入，实收不重复计入；待核对明细见归档。';
  result=build();
 }
 return result;
}
module.exports={isClosed,title,dateLine,metrics,change,review,comparisonDate,sections,note,text,version:'1.1'};
