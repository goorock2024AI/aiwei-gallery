'use strict';
// Physical consumption, not net accounting revenue. Refunds do not unmake coffee.
const HOUR = 3600000, DAY = 24 * HOUR;
const DEFAULTS = { gramsPerCup: 20, leadHours: 60, targetDays: 6, packGrams: null,
  freshDays: null, openDays: null, arrivalAgeDays: null, openHour: 10, closeHour: 18, excludedNames: [] };
const calendarSource = 'https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html';
const holidays = [['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']];
const workdays = ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'];
const dateKey = t => new Date(+new Date(t) + 8 * HOUR).toISOString().slice(0, 10);
const midnight = d => +new Date(d + 'T00:00:00+08:00');
const addDays = (d,n) => dateKey(midnight(d) + n * DAY);
const num = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
const mean = a => a.length ? a.reduce((s,n)=>s+n,0)/a.length : 0;
const quantile = (a,p) => a.length ? [...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)] : 0;
function dayType(date, overrides = {}) {
  if (overrides[date]?.type) return overrides[date].type;
  if (holidays.some(([a,b])=>date>=a && date<=b)) return 'holiday';
  if (workdays.includes(date)) return 'weekday';
  return [0,6].includes(new Date(date+'T12:00:00+08:00').getUTCDay()) ? 'weekend' : 'weekday';
}
function cups(row, config = DEFAULTS) {
  const items = Array.isArray(row.coffee_items) ? row.coffee_items : [];
  const excluded = new Set(config.excludedNames || []);
  const coffee = items.length ? items.reduce((s,i)=>s+(excluded.has(i.name)?0:num(i.qty)),0) : num(row.coffee_qty);
  return coffee + num(row.combo_qty);
}
function dailySales(rows, config) {
  const daily = {};
  for (const row of rows) {
    // A voided entry can be an input error; it is excluded, unlike refunds.
    if (row.status === '已作废') continue;
    daily[row.date] = (daily[row.date] || 0) + cups(row,config);
  }
  return daily;
}
function estimate(date, history, overrides) {
  const type = dayType(date,overrides), manual = overrides[date];
  if (type==='closed') return { cups:0, samples:0, basis:'闭馆日', confidence:'manual' };
  if (manual?.cups != null) return { cups:manual.cups, samples:0, basis:'人工预期', confidence:'manual' };
  const previous = Object.keys(history).filter(d=>d<date && d>=addDays(date,-84) && dayType(d,overrides)!=='closed').sort();
  const sameType = previous.filter(d=>dayType(d,overrides)===type);
  const dow = d=>new Date(d+'T12:00:00+08:00').getUTCDay();
  const sameWeek = sameType.filter(d=>dow(d)===dow(date)).slice(-8);
  let dates = sameWeek.length>=4 ? sameWeek : sameType.slice(-12);
  let basis = sameWeek.length>=4 ? '同星期近期销量' : '同类日期近期销量';
  if (dates.length<3) { dates=previous.slice(-14); basis='同类样本不足，参考近期有记录日期'; }
  const values=dates.map(d=>history[d]);
  // Recency weights keep a new exhibition from being drowned by old demand.
  const weights=dates.map((_,i)=>i+1), sum=weights.reduce((s,n)=>s+n,0);
  const forecast=sum ? values.reduce((s,n,i)=>s+n*weights[i],0)/sum : null;
  return { cups:forecast, samples:dates.length, basis, confidence:dates.length>=4 && !basis.includes('不足')?'normal':'low' };
}
function expiry(lot, config) {
  const deadlines=[];
  if (lot.bestBefore) deadlines.push(midnight(addDays(lot.bestBefore,1)));
  if (lot.roastDate && config.freshDays) deadlines.push(midnight(addDays(lot.roastDate,config.freshDays+1)));
  if (lot.openedDate && config.openDays) deadlines.push(midnight(addDays(lot.openedDate,config.openDays+1)));
  return deadlines.length ? Math.min(...deadlines) : Infinity;
}
function forecast(state, rows, now = new Date()) {
  const at=+new Date(now), today=dateKey(at), config={...DEFAULTS,...state.config}, overrides=state.overrides||{};
  const daily=dailySales(rows,config), historical=Object.fromEntries(Object.entries(daily).filter(([d])=>d<today));
  for(const [d,value]of Object.entries(overrides))if(d<today && value.cups!=null && historical[d]==null)historical[d]=value.cups;
  const days=Array.from({length:31},(_,i)=>{const date=addDays(today,i);return {date,type:dayType(date,overrides),...estimate(date,historical,overrides)};});
  const elapsed=(at-midnight(today)-config.openHour*HOUR)/((config.closeHour-config.openHour)*HOUR);
  if(elapsed>=.25&&elapsed<1&&days[0].cups!=null&&days[0].confidence!=='manual'){
    const runRate=(daily[today]||0)/elapsed;
    if(runRate>days[0].cups){days[0].cups=runRate;days[0].basis+='；按今日销售速度上调';}
  }
  const warnings=[];
  if (days.some(d=>!d.date.startsWith('2026-'))) warnings.push('部分日期的年度节假日安排尚未配置，请手动确认假日与调休。');
  if (days.some(d=>d.confidence==='low' || d.cups==null)) warnings.push('同类销量样本不足；预测仅供参考，请补充活动预期。无流水日期未当作零销量。');
  if (!config.freshDays || config.arrivalAgeDays==null) warnings.push('尚未确认适饮天数或到货时豆龄，建议量未完成新鲜度上限校验。');
  if (!config.packGrams) warnings.push('尚未填写每袋重量，建议量暂按克显示。');
  const errors=[];
  for (const d of Object.keys(historical).sort()) {
    const p=estimate(d,historical,overrides);
    if (p.cups!=null && p.samples>=4) errors.push(Math.max(0,historical[d]-p.cups));
  }
  const provisional=errors.length<8;
  const dailyError=provisional ? Math.max(5,mean(days.slice(0,7).map(d=>d.cups||0))*.5) : quantile(errors,.9);
  const safetyGrams=Math.ceil(dailyError*Math.sqrt(config.leadHours/24)*20);
  if (provisional) warnings.push('误差样本不足，暂用较保守安全余量；不是断豆概率保证。');
  const anchor=state.anchor;
  const elapsedCups=anchor ? Object.entries(daily).filter(([d])=>d>=anchor.date && d<=today).reduce((s,[,v])=>s+v,0)-anchor.baselineCups : 0;
  if (elapsedCups<0) warnings.push('盘点前后销量发生追溯修改，请重新盘点校正。');
  const used=Math.max(0,elapsedCups)*20;
  const lots=(state.lots||[]).map(l=>({...l,remaining:l.grams,expires:expiry(l,config)}));
  let debt=used;
  for(const lot of lots){const n=Math.min(lot.remaining,debt);lot.remaining-=n;debt-=n;}
  const physical=lots.reduce((s,l)=>s+l.remaining,0)-debt;
  const expired=lots.filter(l=>l.expires<=at).reduce((s,l)=>s+l.remaining,0);
  const available=physical-expired;
  if (expired>0) warnings.push(`有 ${Math.round(expired)} 克已超设置的适饮期限，未计入可用库存，请盘点处理。`);
  if (lots.some(l=>l.remaining>0 && !Number.isFinite(l.expires))) warnings.push('部分库存缺少批次日期，无法判断适饮期限。');
  const pending=(state.orders||[]).filter(o=>o.status==='pending');
  const overdue=pending.filter(o=>+new Date(o.eta)<=at);
  if (overdue.length) warnings.push('有在途订单已过预计到货时间，未将其视为可用，请更新到货时间或确认收货。');
  const arrival=at+config.leadHours*HOUR;
  function demand(start,end) {
    let grams=0;
    for(const d of days){
      const base=midnight(d.date), begin=base+config.openHour*HOUR, finish=base+config.closeHour*HOUR;
      const left=Math.max(begin,start,d.date===today?at:begin), right=Math.min(finish,end);
      if(right<=left)continue;
      const remaining=d.date===today ? Math.max(0,(d.cups||0)-(daily[today]||0)) : (d.cups||0);
      const duration=d.date===today ? Math.max(HOUR/60,finish-Math.max(at,begin)) : finish-begin;
      grams+=remaining*20*(right-left)/duration;
    }
    return grams;
  }
  // Project physical lots in FIFO order. Expiry must be applied after earlier
  // consumption, once per lot; independent subtraction double-counts old lots.
  const scheduled=pending.filter(o=>+new Date(o.eta)>at).map(o=>({...o,time:+new Date(o.eta)}));
  const nodes=new Set([at,arrival,...[5,6,7].map(n=>arrival+n*DAY)]);
  for(let t=at+HOUR;t<=at+30*DAY;t+=HOUR)nodes.add(t);
  for(const l of lots)if(l.expires>at&&l.expires<=at+30*DAY)nodes.add(l.expires);
  for(const o of scheduled)if(o.time<=at+30*DAY)nodes.add(o.time);
  const queue=lots.filter(l=>l.expires>at&&l.remaining>0).map(l=>({...l}));
  let shortage=debt,previous=at;
  const projection=[];
  for(const t of [...nodes].sort((a,b)=>a-b)){
    let need=demand(previous,t);
    for(const l of queue){const take=Math.min(l.remaining,need);l.remaining-=take;need-=take;}
    shortage+=need;
    for(const l of queue)if(l.expires<=t)l.remaining=0;
    for(const o of scheduled.filter(o=>o.time===t)){
      const cover=Math.min(shortage,o.grams);shortage-=cover;
      queue.push({remaining:o.grams-cover,expires:Infinity});
    }
    projection.push({time:t,balance:queue.reduce((s,l)=>s+l.remaining,0)-shortage});previous=t;
  }
  function remainingAt(end) {
    let low=0,high=projection.length-1;
    while(low<high){const mid=Math.ceil((low+high)/2);if(projection[mid].time<=end)low=mid;else high=mid-1;}
    const node=projection[low];return node.balance-demand(node.time,end);
  }
  let stockout=null;
  for(let t=at;t<=at+28*DAY;t+=HOUR){if(remainingAt(t)<=0&&demand(t,t+HOUR)>0){stockout=new Date(t).toISOString();break;}}
  const leadDemand=demand(at,arrival), leadBalance=remainingAt(arrival);
  let status=!anchor?'setup':days.slice(0,8).some(d=>d.cups==null)?'insufficient':stockout && +new Date(stockout)<=arrival?'urgent':leadBalance<safetyGrams?'buy':'ok';
  const candidates=[5,6,7].map(n=>{
    const end=arrival+n*DAY;
    // Cover the worst gap, including before a later shipment arrives. This
    // discounts later deliveries without allowing them to bridge an early gap.
    const worst=Math.min(remainingAt(arrival),remainingAt(end),...projection.filter(n=>n.time>=arrival&&n.time<=end).map(n=>n.balance));
    // Missed demand before arrival is an emergency gap, not backordered coffee.
    const raw=Math.max(0,safetyGrams-worst+Math.min(0,leadBalance));
    const rounded=config.packGrams ? Math.ceil(raw/config.packGrams)*config.packGrams : Math.ceil(raw/20)*20;
    const freshWindow=config.freshDays && config.arrivalAgeDays!=null ? Math.max(0,config.freshDays-config.arrivalAgeDays) : null;
    const freshCap=freshWindow==null?null:Math.max(0,demand(arrival,arrival+freshWindow*DAY)-Math.max(0,leadBalance));
    const cap=freshCap==null?rounded:config.packGrams?Math.floor(freshCap/config.packGrams)*config.packGrams:Math.floor(freshCap/20)*20;
    const grams=Math.max(0,Math.min(rounded,cap));
    return {days:n,grams,unconstrainedGrams:rounded,freshCap,conflict:grams<rounded,coverageDemand:Math.ceil(demand(arrival,end))};
  });
  const chosen=candidates.find(c=>c.days===config.targetDays)||candidates[1];
  if(chosen.conflict)warnings.push('安全备货量超过适饮期内预计消耗量，建议小包装、拆批到货或应急供应；不自动扩大库存。');
  let reorderAt=null;
  if(anchor && status==='ok')for(let t=at;t<at+21*DAY;t+=HOUR){if(remainingAt(t+config.leadHours*HOUR)<safetyGrams){reorderAt=new Date(t).toISOString();break;}}
  return {now:new Date(at).toISOString(),today,config,days,warnings,status,initialized:!!anchor,availableGrams:anchor?Math.round(available):null,
    physicalGrams:anchor?Math.round(physical):null,consumedGrams:used,safetyGrams,leadDemandGrams:Math.ceil(leadDemand),
    arrival:new Date(arrival).toISOString(),stockout,reorderAt,suggestedGrams:['setup','insufficient'].includes(status)?null:chosen.grams,
    candidates,provisional,overdueOrders:overdue.length,calendarSource,
    assumptions:['每天营业时间内均匀分配需求；未采集小时销量，不保证精确断豆时刻。','套票每套计1杯；咖啡明细可排除不耗豆商品；退款不回补已制作咖啡。','无流水日期不自动当零销量；有其他正常收入流水而咖啡为零的日期纳入零销量样本。','在途按预计到货时间加入逐时库存预测，补货量覆盖期间内最深缺口，避免晚到订单掩盖早期断豆。']};
}
module.exports={DEFAULTS,dateKey,addDays,dayType,cups,dailySales,estimate,expiry,forecast};
