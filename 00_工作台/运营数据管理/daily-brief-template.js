'use strict';
// Approved business-facing template 1.0. Raw snapshots remain in the private archive.
const amount=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const clock=v=>{const d=new Date(v);return Number.isNaN(+d)?'采集时':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};
const names={ticket:'门票',visit_combo:'咖啡套票',coffee:'单售咖啡',creative_retail:'文创',beverage_retail:'饮料',workshop:'工坊',gallery_sale:'画廊',space_rental:'场地租赁'};
function sections(p){
 const m=p.metrics,w=p.weather||{},c=p.coffee,a=p.analysis||{},delta=m.changeAmount;
 const change=`较上周同日${delta>=0?'增加':'减少'}${amount(Math.abs(delta))}元`+(m.changeRate==null?'':`（${m.changeRate>=0?'+':''}${(m.changeRate*100).toFixed(1)}%）`);
 const business=[...m.businesses].sort((a,b)=>['ticket','visit_combo','coffee','beverage_retail','creative_retail','workshop','gallery_sale','space_rental'].indexOf(a.code)-['ticket','visit_combo','coffee','beverage_retail','creative_retail','workshop','gallery_sale','space_rental'].indexOf(b.code));
 const income=`收入${amount(m.income)}元，${change}\n${business.map(b=>`· ${names[b.code]||b.name}：${amount(b.income)}元`).join('\n')}\n\n到馆${m.visitors==null?'人次待核对':amount(m.visitors)+'人次'}｜本月累计收入${amount(m.monthIncome)}元`;
 const weather=w.status==='ok'?`采集时${String(w.currentText).replace(/（.*?）/g,'').trim()}。`:'天气暂未取得。';
 const stock=!c?'库存待核对。':!c.initialized?'请完成咖啡豆首次盘点。':`咖啡豆余量${amount(c.availableGrams)}克`+(c.suggestedGrams>0?`，${c.status==='urgent'?'需优先核对库存并安排补货':'请核对补货安排'}。建议采购约${amount(c.suggestedGrams/1000)}公斤，结合在途订单和保鲜要求确认。`:'，暂未提示补货。');
 const review=a.mode==='agent'?a.review:`收入${delta>=0?'高于':'低于'}上周同日。${[...m.businesses].sort((a,b)=>b.income-a.income).slice(0,3).map(b=>names[b.code]||b.name).join('、')}是主要收入来源。`;
 const tomorrow=[`· 天气预报：${w.status==='ok'?w.tomorrowText+'。':'暂未取得。'}`,c?.suggestedGrams>0?'· 优先落实咖啡豆补货，做好现场接待准备。':'· 核对备料安排，做好现场接待准备。'].join('\n');
 return [['今日经营',income],['今日天气',weather],['备料提醒',stock],['今日复盘',review],['明日重点',tomorrow]];
}
function note(p){const time=Number.isNaN(Date.parse(p.cutoffTime))?p.generatedAt:p.cutoffTime;const date=Number.isNaN(Date.parse(time))?p.date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(time));return '统计截止：'+date+' '+clock(time)+'（北京时间）｜'+(p.finalized?'日结已完成':'暂报，日结未完成');}
function text(p){return `艾维美术馆｜${p.date}经营日报\n今日复盘 · 明日提示\n\n`+sections(p).map(([title,body],i)=>`${['📊','🌦','☕','📝','📌'][i]} ${title}\n${body}`).join('\n\n')+(note(p)?'\n\n'+note(p):'');}
module.exports={sections,note,text,version:'1.0'};
