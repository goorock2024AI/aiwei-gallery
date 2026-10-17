const RULE_VERSION='1.0.0';
const sum=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
const ratio=(a,b)=>b>0?a/b:null;
const change=(a,b)=>b>0?(a-b)/b:null;
const inRange=(rows,range)=>(rows||[]).filter(r=>r.businessDate>=range.start&&r.businessDate<=range.end);
function period(packet,range){
 const days=inRange(packet.business.visitorDays,range),rows=inRange(packet.business.typeDays,range),four=inRange(packet.funnel.typeDays,range);
 const visitors={recorded:sum(days,'ticketCount')+sum(days,'comboCount'),missingFacts:sum(days,'missingVisitorQuantity')};visitors.value=visitors.missingFacts?null:visitors.recorded;
 const types={};for(const code of [...new Set(rows.map(r=>r.businessTypeCode))]){const list=rows.filter(r=>r.businessTypeCode===code);types[code]={income:sum(list,'netAmount'),quantity:sum(list,'quantity'),missingQuantityFacts:sum(list,'missingQuantity'),knownGrossProfit:sum(list,'coveredProfit'),missingCostFacts:sum(list,'missingCost')};types[code].grossProfit=types[code].missingCostFacts?null:types[code].knownGrossProfit;types[code].quantityPer100Visitors=types[code].missingQuantityFacts||visitors.value===null?null:ratio(types[code].quantity*100,visitors.value);}
 const onsiteRows=rows.filter(r=>['ticket','visit_combo','coffee','beverage_retail','creative_retail','workshop','gallery_sale'].includes(r.businessTypeCode)||['experience','art'].includes(r.analysisGroup));
 const onsite={income:sum(onsiteRows,'netAmount'),missingCostFacts:sum(onsiteRows,'missingCost')};onsite.perVisitor=visitors.value===null?null:ratio(onsite.income,visitors.value);onsite.grossProfit=onsite.missingCostFacts?null:sum(onsiteRows,'coveredProfit');
 const refunds=inRange(packet.refundDays,range),fourIncome=sum(four,'netAmount'),fourMissing=sum(four,'missingCost'),fourKnown=sum(four,'coveredProfit');
 const projects={};for(const [code,group] of [['visit_combo',null],['creative_retail',null],['workshop','experience'],['gallery_sale','art']]){const list=four.filter(r=>r.businessTypeCode===code||(group&&r.analysisGroup===group)),missingCost=sum(list,'missingCost'),known=sum(list,'coveredProfit');projects[code]={income:sum(list,'netAmount'),quantity:sum(list,'quantity'),missingQuantityFacts:sum(list,'missingQuantity'),missingCostFacts:missingCost,knownGrossProfit:known,grossProfit:list.length&&!missingCost?known:null,perVisitor:visitors.value===null?null:ratio(sum(list,'netAmount'),visitors.value),quantityPer100Visitors:sum(list,'missingQuantity')||visitors.value===null?null:ratio(sum(list,'quantity')*100,visitors.value),profitContribution:list.length&&!fourMissing&&!refunds.length&&fourKnown>0?known/fourKnown:null,hasFacts:!!list.length};}
 return {range,calendarDays:(Date.parse(range.end)-Date.parse(range.start))/86400000+1,visitors,types,onsite,projects,four:{income:fourIncome,perVisitor:visitors.value===null?null:ratio(fourIncome,visitors.value),missingCostFacts:fourMissing,grossProfit:fourMissing?null:fourKnown},unallocatedRefunds:{facts:sum(refunds,'count'),amount:sum(refunds,'amount')}};
}
function calculate(packet){
 const current=period(packet,packet.current),previous=period(packet,packet.previous),v=current.visitors.value,bv=previous.visitors.value;
 const decomposition=v!==null&&bv>0&&previous.onsite.perVisitor!==null?{method:'先改变客流，再改变每人次收入；算术拆解，不代表因果',visitorEffect:(v-bv)*previous.onsite.perVisitor,perVisitorEffect:current.onsite.income-v*previous.onsite.perVisitor,totalChange:current.onsite.income-previous.onsite.income}:null;
 const alerts=[];for(const [name,p]of [['本期',current],['比较期',previous]]){if(p.visitors.missingFacts)alerts.push(`${name}到馆数量缺失，完整人均与销量密度不可计算`);if(p.onsite.missingCostFacts)alerts.push(`${name}存在缺成本销售事实，完整毛利不可计算`);if(p.unallocatedRefunds.facts)alerts.push(`${name}存在待归属退款，人均收入使用已归属口径`);}
 const suspects=[];for(const [periodName,products] of Object.entries(packet.products||{}))for(const r of products.rows||[])if(!r.isGalleryArtwork&&/^(水(?:（|$)|纯悦水|纯悦苏打水|苏打水|可乐|可口可乐|雪碧|芬达|拿铁咖啡|冷萃茉莉|魔爪|魔抓|茉莉冷萃茶|萃茶|茉莉花茶)/.test(r.label))suspects.push({period:periodName,objectKey:r.objectKey,label:r.label,quantity:r.quantity,income:r.netAmount});
 if(suspects.length)alerts.push('文创分类存在饮料名称疑点；四项及选品口径需复核，程序未擅自重分类');
 return {ruleVersion:RULE_VERSION,calculationVersion:'1.0.0',current,previous,comparison:{visitorChange:v===null||bv===null?null:change(v,bv),onsiteIncomeChange:change(current.onsite.income,previous.onsite.income),onsitePerVisitorChange:current.onsite.perVisitor===null||previous.onsite.perVisitor===null?null:change(current.onsite.perVisitor,previous.onsite.perVisitor),incomeDecomposition:decomposition},quality:{alerts,classificationSuspects:suspects,inventoryAndAvailabilityProvided:false,actualCoffeeRedemptionProvided:false,visitorPurchaseIdentityProvided:false}};
}
function display(packet){
 const m=packet.metrics?.calculationVersion==='1.0.0'?packet.metrics:calculate(packet);
 const values=p=>({visitors:p.visitors.value,income:p.onsite.income,perVisitor:p.onsite.perVisitor,grossProfit:p.unallocatedRefunds.facts?null:p.onsite.grossProfit});
 const businesses=[['ticket','普通门票'],['visit_combo','咖啡套票'],['coffee','单售咖啡'],['creative_retail','零售原分类'],['workshop','工坊'],['gallery_sale','画廊']].map(([code,name])=>({name,previousIncome:m.previous.types[code]?.income??null,currentIncome:m.current.types[code]?.income??null}));
 return {calculationVersion:m.calculationVersion,current:values(m.current),previous:values(m.previous),businesses,alerts:m.quality.alerts};
}
module.exports={calculate,display,RULE_VERSION};
