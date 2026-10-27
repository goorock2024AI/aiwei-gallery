'use strict';
const assert=require('node:assert/strict');
const template=require('../daily-brief-template'),render=require('../daily-brief-render');
const report=(date,incomes=[0,0])=>({date,generatedAt:'2026-10-27T10:00:00Z',cutoffTime:'2026-10-27T10:00:00Z',finalized:false,metrics:{income:incomes.reduce((a,b)=>a+b,0),businesses:incomes.map((income,i)=>({code:i?'coffee':'ticket',income})),changeAmount:-100,changeRate:-1,monthIncome:1000,visitors:0},weather:{status:'missing'},coffee:null});
const closed=report('2026-10-26');
assert.equal(template.text(closed),'艾维美术馆经营日报 | 10月26日\n\n闭馆休息日未营业');
assert.deepEqual(template.sections(closed),[['营业概况','闭馆休息日未营业']]);
assert.equal(template.note(closed),'');
for(const content of [render.html(closed),render.svg(closed)]){assert(content.includes('闭馆休息日未营业'));assert(!/主要收入来源|减少|备料提醒|暂报|日结未完成|天气来源/.test(content));}
for(const p of [report('2026-10-26',[1,0]),report('2026-10-27'),report('2026-10-25'),report('2026-10-26',[100,-100]),report('2026-10-26',[-10,0])]){assert.equal(template.isClosed(p),false);assert(!template.text(p).includes('闭馆休息日未营业'));assert.equal(template.sections(p).length,5);}
assert.equal(template.isClosed({...closed,metrics:{...closed.metrics,income:null}}),false);
assert.equal(template.isClosed({...closed,metrics:{...closed.metrics,businesses:undefined}}),false);
assert.equal(template.isClosed(report('2026-11-02')),true);
assert.equal(template.isClosed(report('2026-10-26',[])),true);
console.log('PASS: closed Monday text/HTML/SVG, normal Monday, other weekdays, offsetting income, refunds, unknown metrics, historical date and empty day. No database or external messages.');
