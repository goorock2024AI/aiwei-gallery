// Universal item analysis; dates and source amounts come from the read-only API.
const OperationsItemAnalysis = {
  _generation:0, _objectsLoadId:0, _detailGeneration:0, _chart:null, _model:null, _objects:[], _controller:null, _detailController:null,
  num(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; },
  esc(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  money(value) { return value == null ? '—' : '¥'+Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); },
  iso(d) { return d.toISOString().slice(0,10); },
  day(value) { return new Date(value+'T00:00:00Z'); },
  shift(value,days) { return this.iso(new Date(+this.day(value)+days*86400000)); },
  days(start,end) { return Math.round((this.day(end)-this.day(start))/86400000)+1; },
  today() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); },
  defaults() {
    const today=this.day(this.today()), y=today.getUTCFullYear(), m=today.getUTCMonth();
    const start=this.iso(new Date(Date.UTC(y,m-3,1))), end=this.iso(new Date(Date.UTC(y,m,0)));
    return {kind:'revenue',dimension:'type',start,end,granularity:'month',mode:'timeline',event:this.iso(new Date(Date.UTC(y,m-1,1)))};
  },
  dimensions(kind) { return kind==='cost' ? [['costType','成本类型'],['item','具体支出项'],['project','项目'],['layer','财务归属层（历史口径）']] : [['type','业务类型'],['product','商品／服务项'],['project','项目'],['layer','财务归属层（历史口径）']]; },
  init() {
    const root=document.getElementById('operations-item-content'); if(!root)return;
    this.dispose(); this._state ||= this.defaults(); const s=this._state;
    root.innerHTML=`<form id="item-analysis-form" class="item-analysis-filters" onsubmit="event.preventDefault();OperationsItemAnalysis.load()">
      <label>收支类型<select id="ia-kind" onchange="OperationsItemAnalysis.changeKind()"><option value="revenue" ${s.kind==='revenue'?'selected':''}>收入分析</option><option value="cost" ${s.kind==='cost'?'selected':''}>成本分析</option></select></label>
      <label>逐项对象类型<select id="ia-dimension" onchange="OperationsItemAnalysis.reloadObjects(true)">${this.dimensions(s.kind).map(([v,l])=>`<option value="${v}" ${s.dimension===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>开始日期<input id="ia-start" type="date" value="${s.start}" required></label><label>结束日期<input id="ia-end" type="date" value="${s.end}" required></label>
      <label>时间粒度<select id="ia-granularity">${[['day','日'],['week','周（周一开始）'],['month','月']].map(([v,l])=>`<option value="${v}" ${s.granularity===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>比较方式<select id="ia-mode" onchange="OperationsItemAnalysis.modeChanged()">${[['timeline','区间内首末期比较'],['strategy','区间内策略调整前后']].map(([v,l])=>`<option value="${v}" ${s.mode===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label class="ia-strategy">调整名称<input id="ia-event-name" value="${this.esc(s.eventName||'')}" placeholder="例如：套票调价" maxlength="80"></label><label class="ia-strategy">调整日期<input id="ia-event" type="date" value="${s.event}"></label>
      <div class="ia-object-picker"><label>搜索对象<input id="ia-search" type="search" placeholder="输入业务、商品、项目或支出名称" oninput="OperationsItemAnalysis.filterObjects()"></label><label>分析对象（最多三个）<select id="ia-objects" multiple size="5" aria-describedby="ia-object-help"></select></label><small id="ia-object-help">可多选并排比较；对象来自所选日期范围内的完整事实，候选金额为区间合计。修改日期后点击“更新对象”。</small></div>
      <div class="ia-actions"><button type="button" class="btn btn-secondary" onclick="OperationsItemAnalysis.reloadObjects()">更新对象</button><button id="ia-run" class="btn btn-primary" type="submit">开始分析</button><button id="ia-export" type="button" class="btn btn-secondary" disabled onclick="OperationsItemAnalysis.exportAnalysis()">导出分析表</button><button type="button" class="btn btn-secondary" onclick="OperationsItemAnalysis.showProductRanking()">查看商品销量排行</button><span id="ia-status" role="status" aria-live="polite"></span></div>
    </form><div id="ia-ranking"></div><div id="ia-result"></div><div id="ia-details"></div>`;
    document.getElementById('ia-granularity').value=s.granularity;
    this.modeChanged();
    root.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',()=>{
      if(['ia-kind','ia-dimension','ia-search'].includes(el.id))return;
      this._generation++;this._controller?.abort();
      document.getElementById('ia-export').disabled=true;document.getElementById('ia-run').disabled=false;document.getElementById('ia-ranking').innerHTML='';this._ranking=null;
      document.getElementById('ia-result').setAttribute('aria-busy','false');
      this.status('筛选已变更，点击“开始分析”更新结果');
    }));
    return this.reloadObjects(false,true);
  },
  dispose() {
    this._generation++;this._objectsLoadId++;this._detailGeneration++;this._controller?.abort();this._detailController?.abort();this._chart?.destroy();this._chart=null;
    if(typeof OperationsBusinessAnalysis!=='undefined'){OperationsBusinessAnalysis._chart?.destroy();OperationsBusinessAnalysis._chart=null;}
  },
  modeChanged() {
    const mode=document.getElementById('ia-mode').value;
    document.getElementById('ia-start').disabled=false;document.getElementById('ia-end').disabled=false;
    document.querySelectorAll('.ia-strategy').forEach(el=>el.hidden=mode!=='strategy');
  },
  changeKind() {
    const kind=document.getElementById('ia-kind').value;
    document.getElementById('ia-dimension').innerHTML=this.dimensions(kind).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    return this.reloadObjects(true);
  },
  collect() {
    const get=id=>document.getElementById('ia-'+id).value;
    const s={kind:get('kind'),dimension:get('dimension'),start:get('start'),end:get('end'),granularity:get('granularity'),mode:get('mode'),event:get('event'),eventName:get('event-name')};
    const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+this.day(value)) && this.iso(this.day(value))===value;
    if(![s.start,s.end].every(valid)||s.end<s.start)throw new Error('请填写有效的分析起止日期');
    if(s.end>this.today())throw new Error('结束日期不能晚于今日');
    if(this.days(s.start,s.end)>1097)throw new Error('分析时间最多三年');
    if(s.mode==='strategy') {
      if(!valid(s.event)||s.event<=s.start||s.event>=s.end)throw new Error('调整日期须在所选区间内部，前后各至少保留一天');
      s.compareStart=s.start;s.compareEnd=this.shift(s.event,-1);
      s.currentStart=this.shift(s.event,1);s.currentEnd=s.end;
      s.beforeLabel='调整前';s.afterLabel='调整后';
    } else {
      s.mode='timeline';s.compareStart=s.start;s.currentEnd=s.end;
      const first=this.bucket(s.start,s.granularity),last=this.bucket(s.end,s.granularity);
      s.compareEnd=s.start;s.currentStart=s.end;
      for(let d=s.start;d<=s.end;d=this.shift(d,1)) {
        const bucket=this.bucket(d,s.granularity);
        if(bucket===first)s.compareEnd=d;
        if(bucket===last&&this.bucket(this.shift(d,-1),s.granularity)!==last)s.currentStart=d;
      }
      if(first===last)s.currentStart=s.start;
      s.beforeLabel='区间首期';s.afterLabel='区间末期';s.samePeriod=first===last;
    }
    this._state=s;return s;
  },
  async request(action,s,ids,extra={},signal) {
    const params=new URLSearchParams({action,kind:s.kind,dimension:s.dimension,start:s.start,end:s.end,...extra});
    if(ids?.length)params.set('objects',JSON.stringify(ids));
    return Store._request('GET','/rest/v1/operations-item-analysis?'+params,undefined,signal?{signal}:{});
  },
  status(message,error=false) { const el=document.getElementById('ia-status');if(el){el.textContent=message;el.classList.toggle('ia-error',error);} },
  selected() { return Array.from(document.getElementById('ia-objects').selectedOptions,el=>el.value); },
  filterObjects(selected=this.selected()) {
    const term=document.getElementById('ia-search').value.trim().toLocaleLowerCase('zh-CN');
    const select=document.getElementById('ia-objects');
    select.innerHTML=this._objects.filter(o=>selected.includes(o.objectKey)||o.label.toLocaleLowerCase('zh-CN').includes(term)).map(o=>`<option value="${this.esc(o.objectKey)}" ${selected.includes(o.objectKey)?'selected':''}>${this.esc(o.label)} · ${this.money(o.amount)}</option>`).join('');
  },
  async reloadObjects(reset=false,auto=false) {
    document.getElementById('ia-ranking').innerHTML='';this._ranking=null;
    const objectsLoadId=++this._objectsLoadId;
    const id=++this._generation;this._controller?.abort();this._controller=new AbortController();
    document.getElementById('ia-run').disabled=true;document.getElementById('ia-objects').disabled=true;
    document.getElementById('ia-export').disabled=true;
    this._detailGeneration++;this._detailController?.abort();document.getElementById('ia-details').innerHTML='';
    try {
      const s=this.collect(), selected=reset?[]:this.selected();this.status('正在更新对象…');
      const response=await this.request('objects',s,[],{},this._controller.signal);
      if(id!==this._generation)return;
      this._objects=response.objects;
      const next=selected.filter(key=>this._objects.some(o=>o.objectKey===key));
      if(!next.length&&this._objects.length)next.push(this._objects[0].objectKey);
      this.filterObjects(next);this.status(this._objects.length?`可分析 ${this._objects.length} 个对象`:'所选期间没有经营事实');
      if(auto||reset)await this.load();
    } catch(e) {if(id===this._generation&&e.name!=='AbortError')this.status(e.message,true);}
    finally {if(objectsLoadId===this._objectsLoadId){document.getElementById('ia-run').disabled=false;document.getElementById('ia-objects').disabled=false;}}
  },
  aggregate(rows,kind,relatedCosts=[]) {
    const out={salesAmount:0,refundAmount:0,netAmount:0,costAmount:0,quantity:0,pricedAmount:0,factCount:0,recordCount:0,missingQuantity:0,missingCost:0,coveredProfit:0,costCoveredRevenue:0,qualityCount:0,unattributedRefunds:0,deductionAmount:0};
    const groups=new Set();
    rows.forEach(row=>{Object.keys(out).forEach(key=>out[key]+=this.num(row[key]));(row.quantityGroups||[]).forEach(g=>groups.add(JSON.stringify(g)));});
    Object.keys(out).forEach(key=>out[key]=Number(out[key].toFixed(6)));
    out.relatedCost=relatedCosts.reduce((n,r)=>n+this.num(r.costAmount),0);
    out.hasData=out.factCount>0;out.singleUnit=groups.size===1;out.unitKey=out.singleUnit?Array.from(groups)[0]:null;
    out.averagePrice=out.singleUnit&&out.quantity>0?out.pricedAmount/out.quantity:null;
    out.quantityCoverage=out.salesAmount>0?out.pricedAmount/out.salesAmount:null;
    out.grossProfit=kind==='revenue'&&out.hasData&&out.missingCost===0&&out.unattributedRefunds===0?out.coveredProfit:null;
    out.contribution=out.grossProfit==null?null:out.grossProfit-out.relatedCost;
    return out;
  },
  bucket(value,granularity) {
    if(granularity==='month')return value.slice(0,7);
    if(granularity==='week')return this.shift(value,-((this.day(value).getUTCDay()+6)%7));
    return value;
  },
  buildModel(response,s,ids) {
    const objects=ids.map(key=>{
      const countedType=s.kind==='revenue'&&s.dimension==='type'&&['ticket','visit_combo','coffee'].includes(key);
      const rows=response.rows.filter(r=>r.objectKey===key).map(r=>countedType&&r.quantityGroups?.length?{...r,quantityGroups:[[key,'counted-unit',this.unit(key)]]}:r),costs=(response.relatedCosts||[]).filter(r=>r.objectKey===key);
      const current=rows.filter(r=>r.businessDate>=(s.currentStart||s.start)&&r.businessDate<=(s.currentEnd||s.end)), comparison=rows.filter(r=>r.businessDate>=s.compareStart&&r.businessDate<=s.compareEnd);
      const buckets=new Map(),bounds=new Map();for(let d=s.start;d<=s.end;d=this.shift(d,1)){const key=this.bucket(d,s.granularity);if(!buckets.has(key)){buckets.set(key,[]);bounds.set(key,{periodStart:d,periodEnd:d,periodDays:0});}const bound=bounds.get(key);bound.periodEnd=d;bound.periodDays++;}
      rows.filter(r=>r.businessDate>=s.start&&r.businessDate<=s.end).forEach(r=>buckets.get(this.bucket(r.businessDate,s.granularity))?.push(r));
      return {key,label:this._objects.find(o=>o.objectKey===key)?.label||rows[0]?.label||key,
        overall:this.aggregate(rows,s.kind,costs),
        current:this.aggregate(current,s.kind,costs.filter(r=>r.businessDate>=(s.currentStart||s.start)&&r.businessDate<=(s.currentEnd||s.end))),
        comparison:this.aggregate(comparison,s.kind,costs.filter(r=>r.businessDate>=s.compareStart&&r.businessDate<=s.compareEnd)),
        series:Array.from(buckets,([period,values])=>({period,...bounds.get(period),...this.aggregate(values,s.kind,costs.filter(r=>this.bucket(r.businessDate,s.granularity)===period&&r.businessDate>=s.start&&r.businessDate<=s.end))}))};
    });
    const totals=response.dailyTotals||[];
    const sum=(start,end,field)=>totals.filter(r=>r.businessDate>=start&&r.businessDate<=end).reduce((n,r)=>n+this.num(r[field]),0);
    for(const o of objects) {
      const field=s.kind==='cost'?'costAmount':'netAmount';
      for(const [key,start,end] of [['current',s.currentStart||s.start,s.currentEnd||s.end],['comparison',s.compareStart,s.compareEnd]]) {
        const total=sum(start,end,'amount');o[key].share=total>0?o[key][field]/total*100:null;
        if(s.kind==='revenue'&&s.dimension==='type'&&['ticket','visit_combo'].includes(o.key)) {
          const quantity=sum(start,end,'ticketQuantity');o[key].ticketShare=quantity>0?o[key].quantity/quantity*100:null;
        }
      }
    }
    return {state:{...s},objects,typeDays:response.typeDays||[],visitorDays:response.visitorDays||[],dailyTotals:response.dailyTotals||[],unattributedRefundCount:response.unattributedRefundCount,days:this.days(s.currentStart||s.start,s.currentEnd||s.end),compareDays:this.days(s.compareStart,s.compareEnd)};
  },
  change(now,before) {
    if(now==null||before==null)return '不可比较';
    if(before===0)return now===0?'持平':'新增／基期为零';
    const rate=(now-before)/Math.abs(before)*100;return `${rate>0?'+':''}${rate.toFixed(1)}%`;
  },
  interpretation(object,model) {
    const a=object.current,b=object.comparison,kind=model.state.kind;
    if(!a.hasData||!b.hasData)return '有一段期间没有事实记录，无法据此判断增长率或策略效果。请核实是否完整录入。';
    const field=kind==='cost'?'costAmount':'netAmount';
    let text=`${kind==='cost'?'成本':'净收入'}${this.change(a[field],b[field])}；日均${this.change(a[field]/model.days,b[field]/model.compareDays)}。`;
    if(kind==='revenue'&&a.averagePrice!=null&&b.averagePrice!=null&&a.unitKey===b.unitKey&&a.missingQuantity===0&&b.missingQuantity===0&&b.quantity>0&&model.days===model.compareDays) {
      const quantityEffect=(a.quantity-b.quantity)*b.averagePrice, priceEffect=a.quantity*(a.averagePrice-b.averagePrice);
      text+=`销售额变化中，销量效应 ${this.money(quantityEffect)}，均价效应 ${this.money(priceEffect)}；退款变化 ${this.money(a.refundAmount-b.refundAmount)}，其他扣减变化 ${this.money(a.deductionAmount-b.deductionAmount)}。`;
    } else if(kind==='revenue')text+='数量缺失、混合商品或比较时长不同，暂不进行总额量价分解；可查看日均销量和成交均价，或选择具体商品复核。';
    return text;
  },
  metricRows(object,model) {
    const a=object.current,b=object.comparison,kind=model.state.kind;
    const metrics=kind==='cost'?[['成本金额','costAmount','money']]:[['销售额','salesAmount','money'],['退款金额（已归属）','refundAmount','money'],['净收入（已归属）','netAmount','money'],['销量（已记录）','quantity','quantity'],['成交均价','averagePrice','money'],['销售毛利','grossProfit','money']];
    if(kind==='revenue'&&model.state.dimension==='project')metrics.push(['明确归属期间成本','relatedCost','money'],['项目贡献（未分摊公共成本）','contribution','money']);
    metrics.push(['原始记录数','recordCount','count']);
    metrics.push(['占全馆同口径金额','share','percent']);
    if(a.ticketShare!==undefined)metrics.push(['票种销量占比（已记录）','ticketShare','percent']);
    const field=kind==='cost'?'costAmount':'netAmount';
    metrics.push([`日均${kind==='cost'?'成本':'净收入'}（日历天）`,'daily','money']);
    if(kind==='revenue')metrics.push(['日均销量（已记录／日历天）','dailyQuantity','quantity']);
    return metrics.map(([label,key,format])=>{
      const val=(v,days)=>key==='daily'?v[field]/days:key==='dailyQuantity'?v.singleUnit?v.quantity/days:null:key==='quantity'&&!v.singleUnit?null:v[key];
      const now=val(a,model.days),before=val(b,model.compareDays);
      const fmt=v=>v==null?'—':format==='money'?this.money(v):format==='percent'?Number(v).toFixed(1)+'%':Number(v).toLocaleString('zh-CN');
      const change=model.state.samePeriod?'—（仅一期）':format==='percent'&&a.hasData&&b.hasData&&now!=null&&before!=null?`${now-before>0?'+':''}${(now-before).toFixed(1)} 个百分点`:this.change(a.hasData?now:null,b.hasData?before:null);
      return `<tr><th>${label}</th><td>${fmt(now)}</td><td>${fmt(before)}</td><td>${change}</td></tr>`;
    }).join('');
  },
  relationshipHtml(model) {
    const s=model.state;if(s.kind!=='revenue'||model.objects.length<2)return '';
    const rows=model.objects.map(o=>{
      const a=o.current,b=o.comparison;
      const qty=!s.samePeriod&&a.hasData&&b.hasData&&a.singleUnit&&b.singleUnit&&a.unitKey===b.unitKey&&a.missingQuantity===0&&b.missingQuantity===0?this.change(a.quantity/model.days,b.quantity/model.compareDays):'数量口径不足';
      const price=!s.samePeriod&&a.hasData&&b.hasData&&a.unitKey===b.unitKey?this.change(a.averagePrice,b.averagePrice):'不可比较';
      return '<tr><th>'+this.esc(o.label)+'</th><td>'+this.change(a.hasData&&!s.samePeriod?a.netAmount/model.days:null,b.hasData&&!s.samePeriod?b.netAmount/model.compareDays:null)+'</td><td>'+qty+'</td><td>'+price+'</td></tr>';
    }).join('');
    const complete=model.objects.every(o=>o.current.hasData&&o.comparison.hasData);
    const after=model.objects.reduce((n,o)=>n+o.current.netAmount,0)/model.days,before=model.objects.reduce((n,o)=>n+o.comparison.netAmount,0)/model.compareDays;
    const guidance=model.objects.some(o=>o.key==='visit_combo')?'调价复盘时，先确认套票成交均价是否变化，再看门票与套票的销量占比、咖啡日均销量以及合计日均收入。套票增长同时单票下降，可能存在票种替代；咖啡变化需核实套票是否包含咖啡、核销与单售口径。价格合理性还需结合毛利、客流、营业日和活动背景判断，同步变化不能证明调价造成影响。':'比较各项目在同一区间内的日均销量、成交均价和收入变化，观察是否存在同步增长或相互替代。数量按各项目自身单位分别计算，不跨项目相加。价格或其他策略是否合理，还需结合毛利、客流、营业日和活动背景判断；同步变化不能证明因果。';
    return '<article class="ia-object-card"><h4>所选项目的联动变化</h4><p>'+this.esc(s.afterLabel)+'相对'+this.esc(s.beforeLabel)+'；所选项目合计日均净收入：'+(complete&&!s.samePeriod?this.change(after,before):'不可比较')+'</p><div class="ia-table-scroll"><table class="ia-metric-table"><thead><tr><th>项目</th><th>日均净收入变化</th><th>日均销量变化</th><th>成交均价变化</th></tr></thead><tbody>'+rows+'</tbody></table></div><p>'+this.esc(guidance)+'</p></article>';
  },
  visitorSummary(model,start,end) {
    const sum=(rows,key)=>rows.filter(r=>r.businessDate>=start&&r.businessDate<=end).reduce((n,r)=>n+this.num(r[key]),0);
    const ticket=sum(model.visitorDays,'ticketCount'),combo=sum(model.visitorDays,'comboCount'),standalone=sum(model.visitorDays,'standaloneCoffeeCount'),missing=sum(model.visitorDays,'missingVisitorQuantity');
    const visitors=ticket+combo,revenue=sum(model.dailyTotals,'visitRevenue'),missingCost=sum(model.dailyTotals,'visitMissingCost'),coveredProfit=sum(model.dailyTotals,'visitCoveredProfit');
    return {ticket,combo,standalone,visitors,missing,revenue,missingCost,coveredProfit,perVisitorProfit:visitors>0&&!missing&&!missingCost&&!model.unattributedRefundCount?coveredProfit/visitors:null,perVisitor:visitors>0&&!missing?revenue/visitors:null,coffeeEntitlements:combo+standalone,comboShare:visitors>0&&!missing?combo/visitors*100:null};
  },
  operationsHtml(model) {
    if(model.state.kind!=='revenue')return '';const s=model.state,all=this.visitorSummary(model,s.start,s.end),a=this.visitorSummary(model,s.currentStart,s.currentEnd),b=this.visitorSummary(model,s.compareStart,s.compareEnd);
    const fmt=v=>v.toLocaleString('zh-CN');
    let explanation='到馆收入变化需要同时看人数与人均贡献。';
    if(a.perVisitor!=null&&b.perVisitor!=null&&!s.samePeriod)explanation=s.afterLabel+'相对'+s.beforeLabel+'：日均到馆人次 '+this.change(a.visitors/model.days,b.visitors/model.compareDays)+'，每人次基础业务收入 '+this.change(a.perVisitor,b.perVisitor)+'，日均基础业务收入 '+this.change(a.revenue/model.days,b.revenue/model.compareDays)+'。这些是同期变化，不能单独证明调价的因果。';
    else explanation+='当前对照包含缺失人数、零人数或仅一期，暂不计算人均变化。';
    return '<article id="ia-operations-core" class="ia-object-card"><h4>到馆经营分析</h4><p><strong>所选期间已记录到馆 '+fmt(all.visitors)+' 人次'+(all.missing?'（部分记录缺人数 '+all.missing+' 条）':'')+'；基础业务收入 '+this.money(all.revenue)+'；每人次收入 '+this.money(all.perVisitor)+'；每人次销售毛利 '+this.money(all.perVisitorProfit)+'</strong></p><p>'+this.esc(explanation)+'</p><div class="ia-table-scroll"><table class="ia-visitor-table ia-metric-table"><thead><tr><th>期间</th><th>售票记录到馆人次</th><th>其中套票人次／占比</th><th>基础业务已归属净收入</th><th>每人次收入</th><th>每人次销售毛利</th><th>单售咖啡杯量</th><th>套票含咖啡权益</th></tr></thead><tbody>'+model.objects[0].series.map(r=>{const v=this.visitorSummary(model,r.periodStart,r.periodEnd);return '<tr><th>'+r.period+'</th><td>'+fmt(v.visitors)+(v.missing?'（人数不完整）':'')+'</td><td>'+fmt(v.combo)+'／'+(v.comboShare==null?'—':v.comboShare.toFixed(1)+'%')+'</td><td>'+this.money(v.revenue)+'</td><td>'+this.money(v.perVisitor)+'</td><td>'+this.money(v.perVisitorProfit)+(v.missingCost?'（缺成本）':'')+'</td><td>'+fmt(v.standalone)+' 杯</td><td>'+fmt(v.combo)+' 杯</td></tr>';}).join('')+'</tbody></table></div><small>馆长已确认：普通票／套票各代表当天1人入馆，每套票含1杯咖啡。按原始售票数量计人次，不是去重人数；尚不覆盖未登记的免费访客。基础业务收入为门票、套票、单售咖啡和文创已归属净收入，画廊、场租与其他业务分开；套票收入只计一次，含咖啡权益不再虚构一笔收入。咖啡权益不等同于已核销供应杯量。人均收入不是人均利润；成本不完整时不输出人均毛利。</small></article>';
  },
  unit(key) {
    let type=key;try{const parsed=JSON.parse(key);if(Array.isArray(parsed))type=parsed[0];}catch{}
    return {ticket:'张',visit_combo:'套',coffee:'杯',gallery_sale:'件'}[type]||'销售单位';
  },
  quantityText(row,key) {
    if(!row.hasData)return '无流水';
    if(row.missingQuantity&&row.quantity===0)return '数量未录入';
    if(!row.singleUnit)return '单位不可合并';
    return row.quantity.toLocaleString('zh-CN')+' '+this.unit(key)+(row.missingQuantity?'（部分数量，缺 '+row.missingQuantity+' 条）':'');
  },
  quantityMatrixHtml(model) {
    if(model.state.kind!=='revenue')return '';
    const objects=model.objects;
    return '<article id="ia-quantity-matrix" class="ia-object-card"><h4>各期销量对照</h4><p>直接查看所选区间内每期数量；各项目分别计量，不把张、套、杯相加。无流水与数量未录入分别显示。</p><div class="ia-table-scroll"><table class="ia-quantity-table ia-metric-table"><thead><tr><th>期间</th>'+objects.map(o=>'<th>'+this.esc(o.label)+'销量（'+this.unit(o.key)+'）</th>').join('')+'</tr></thead><tbody>'+objects[0].series.map((r,index)=>'<tr><th>'+r.period+'</th>'+objects.map(o=>{const v=o.series[index],prev=o.series[index-1];const rate=prev&&v.hasData&&prev.hasData&&v.singleUnit&&prev.singleUnit&&!v.missingQuantity&&!prev.missingQuantity?this.change(v.quantity,prev.quantity):'不可比较';return '<td><strong>'+this.quantityText(v,o.key)+'</strong>'+(index?'<small style="display:block">较区间内上一期：'+rate+'</small>':'')+'<small style="display:block">收入 '+this.money(v.netAmount)+'</small></td>';}).join('')+'</tr>').join('')+'<tr><th>区间合计</th>'+objects.map(o=>'<td><strong>'+this.quantityText(o.overall,o.key)+'</strong></td>').join('')+'</tr></tbody></table></div></article>';
  },
  async showProductRanking() {
    if(typeof OperationsBusinessAnalysis!=='undefined')OperationsBusinessAnalysis._view='products';
    document.getElementById('ia-kind').value='revenue';
    document.getElementById('ia-dimension').innerHTML=this.dimensions('revenue').map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('');
    document.getElementById('ia-dimension').value='product';
    document.getElementById('ia-search').value='';
    await this.reloadObjects(true);document.getElementById('ia-ranking').scrollIntoView({block:'start',behavior:'smooth'});
  },
  productProfit(row) {return this.num(row.missingCost)===0&&this.num(row.missingQuantity)===0?this.num(row.coveredProfit):null;},
  rankingCategory(row) {return row.isGalleryArtwork||row.businessTypeCode==='gallery_sale'?'gallery_sale':row.businessTypeCode==='creative_retail'&&!row.isBeverage?'creative_retail':null;},
  rankingRows(category,sort) {
    const source=(this._ranking?.rows||[]).filter(r=>this.rankingCategory(r)&&(!category||this.rankingCategory(r)===category));
    return source.sort((a,b)=>{
      if(sort==='profit')return (this.productProfit(a)==null)-(this.productProfit(b)==null)||(this.productProfit(b)??0)-(this.productProfit(a)??0)||a.objectKey.localeCompare(b.objectKey);
      if(sort==='amount')return this.num(b.netAmount)-this.num(a.netAmount)||a.objectKey.localeCompare(b.objectKey);
      if(sort==='frequency')return this.num(b.salesDays)-this.num(a.salesDays)||a.objectKey.localeCompare(b.objectKey);
      return (a.missingQuantity>0)-(b.missingQuantity>0)||this.num(b.quantity)-this.num(a.quantity)||a.objectKey.localeCompare(b.objectKey);
    });
  },
  renderRanking(category,sort='quantity') {
    if(!this._ranking)return;
    const types=new Map([['creative_retail','文创商品'],['gallery_sale','画廊作品']]);
    category??='';this._ranking.category=category;this._ranking.sort=sort;
    const rows=this.rankingRows(category,sort),missing=rows.filter(r=>r.missingQuantity>0).length;
    const known=rows.filter(r=>this.productProfit(r)!=null),profitTotal=known.reduce((n,r)=>n+this.productProfit(r),0);
    let last=null,rank=0,complete=0;
    document.getElementById('ia-ranking').innerHTML='<article class="ia-object-card"><h4>商品动销与毛利贡献 · '+this._ranking.state.start+' — '+this._ranking.state.end+'</h4><div class="ia-actions"><label>业务类型<select id="ia-ranking-category" onchange="OperationsItemAnalysis.renderRanking(this.value,document.getElementById(\'ia-ranking-sort\').value)"><option value="">文创商品与画廊作品</option>'+Array.from(types,([key,label])=>'<option value="'+this.esc(key)+'" '+(category===key?'selected':'')+'>'+this.esc(label)+'</option>').join('')+'</select></label><label>排序<select id="ia-ranking-sort" onchange="OperationsItemAnalysis.renderRanking(document.getElementById(\'ia-ranking-category\').value,this.value)"><option value="quantity" '+(sort==='quantity'?'selected':'')+'>销量从高到低</option><option value="amount" '+(sort==='amount'?'selected':'')+'>净收入从高到低</option><option value="profit" '+(sort==='profit'?'selected':'')+'>销售毛利额从高到低</option><option value="frequency" '+(sort==='frequency'?'selected':'')+'>售出天数从高到低</option></select></label><button type="button" class="btn btn-secondary" onclick="OperationsItemAnalysis.exportRanking()">导出完整排行</button></div><p>覆盖所选期间全部 '+rows.length+' 项文创商品／画廊作品，已排除咖啡与饮料，不受三个分析对象限制。'+(missing?'其中 '+missing+' 个商品数量不完整，不参与销量名次；不能据此确认全部商品的销量冠军。':'按各商品自己的销售单位计数；相同数量并列名次。')+'</p><div class="ia-table-scroll"><table class="ia-ranking-table ia-metric-table"><thead><tr><th>名次</th><th>商品／规格</th><th>已记录销量</th><th>净收入</th><th>售出天数</th><th>销售毛利额</th><th>毛利率</th><th>毛利贡献占比</th><th>数据状态</th><th>趋势</th></tr></thead><tbody>'+rows.map(r=>{const profit=this.productProfit(r),good=sort==='profit'?profit!=null:!r.missingQuantity;if(good){complete++;const value=sort==='profit'?profit:sort==='frequency'?r.salesDays:sort==='amount'?r.netAmount:r.quantity;if(value!==last){rank=complete;last=value;}}return '<tr><td>'+(['amount','frequency'].includes(sort)?rows.indexOf(r)+1:good?rank:'—')+'</td><th>'+this.esc(r.label)+'</th><td>'+ (!r.missingQuantity?r.quantity.toLocaleString('zh-CN'):r.quantity>0?'至少 '+r.quantity:'未录入')+' '+(!r.missingQuantity||r.quantity>0?this.unit(r.objectKey):'')+'</td><td>'+this.money(r.netAmount)+'</td><td>'+this.num(r.salesDays)+' 天</td><td>'+this.money(profit)+'</td><td>'+(profit!=null&&r.netAmount>0?(100*profit/r.netAmount).toFixed(1)+'%':'—')+'</td><td>'+(profit!=null&&profitTotal>0&&!this._ranking.unattributedRefundCount?(100*profit/profitTotal).toFixed(1)+'%':'—')+'</td><td>'+(!r.missingQuantity?'数量已记录':'缺数量 '+r.missingQuantity+' 条')+(r.missingCost?'；缺成本 '+r.missingCost+' 条':'')+'</td><td><button class="btn btn-sm btn-secondary" type="button" onclick="OperationsItemAnalysis.analyzeRankedProduct('+rows.indexOf(r)+')">查看逐期销量</button></td></tr>';}).join('')+'</tbody></table></div><small>售出天数为区间内有销售收入的日期数，不等于营业天数或库存动销率。毛利额使用可信销售直接成本；缺数量／成本不按零处理。毛利贡献占比限定为当前筛选内成本完整商品的合计毛利，不是全馆净利润贡献；未归属退款存在时暂不显示贡献占比。</small></article>';
  },
  async analyzeRankedProduct(index) {
    if(!this._ranking)return;const rows=this.rankingRows(this._ranking.category,this._ranking.sort),key=rows[index]?.objectKey;
    if(!key)return;if(typeof OperationsBusinessAnalysis!=='undefined')OperationsBusinessAnalysis._view='products';
    if(document.getElementById('ia-dimension').value!=='product') {document.getElementById('ia-dimension').value='product';document.getElementById('ia-search').value='';await this.reloadObjects();}
    this.filterObjects([key]);await this.load();document.getElementById('ia-result').scrollIntoView({block:'start',behavior:'smooth'});
  },
  exportRanking() {
    if(!this._ranking)return;const s=this._ranking.state,rows=this.rankingRows(this._ranking.category,this._ranking.sort);
    this.download([['分析范围',s.start,s.end],['口径','文创商品与画廊作品，不含咖啡与饮料；数量不完整者不参与销量排名；各商品销售单位分别计数；退款数量不确认时不是净销量'],['商品','业务类型','已记录销量','数量缺失条数','已归属净收入','售出天数','可信销售毛利','缺成本条数'],...rows.map(r=>[r.label,r.businessTypeName,r.quantity,r.missingQuantity,r.netAmount,r.salesDays,this.productProfit(r),r.missingCost])],'商品销量排行-'+s.start+'-'+s.end+'.csv');
  },
  resultHtml(model) {
    const s=model.state,kind=s.kind;
    if(!model.objects.length)return '<div class="operations-data-notice"><strong>所选期间没有可逐项分析的经营事实</strong><span>可继续查看售票记录到馆人次。无流水不等同于已确认零经营。</span></div>';
    return `<div class="ia-period-banner"><strong>分析范围：${s.start} — ${s.end}（${this.days(s.start,s.end)}天）</strong><span>${s.beforeLabel}：${s.compareStart} — ${s.compareEnd}；${s.afterLabel}：${s.currentStart} — ${s.currentEnd}</span>${s.mode==='strategy'?`<span>策略：${this.esc(s.eventName||'调整复盘')} · ${s.event}；调整当天单列，完整趋势保留当天</span>`:''}<small>所有数据均在所选区间内 · 前后天数不同请看日均 · 零流水不代表确认营业零销售</small></div>
      ${this.operationsHtml(model)}
      ${this.quantityMatrixHtml(model)}
      ${this.relationshipHtml(model)}
      ${model.unattributedRefundCount?`<div class="operations-data-notice warning"><strong>期间存在 ${model.unattributedRefundCount} 条未按商品／项目分配的退款调整</strong><span>这些调整保留在原事实归类中，不能擅自分摊到当前对象。当前“已归属”净收入与退款不代表该对象全部退款后的最终结果。</span></div>`:''}
      <div class="ia-comparison-grid">${model.objects.map((o,index)=>`<article class="ia-object-card"><h4>${this.esc(o.label)}</h4><p>所选区间合计：${this.money(kind==='cost'?o.overall.costAmount:o.overall.netAmount)}${o.overall.singleUnit?'；已记录销量 '+o.overall.quantity:''}</p><table class="ia-metric-table"><thead><tr><th>指标</th><th>${s.afterLabel}</th><th>${s.beforeLabel}</th><th>变化</th></tr></thead><tbody>${this.metricRows(o,model)}</tbody></table><p>${this.esc(this.interpretation(o,model))}</p><small>${kind==='cost'?'待归类 '+o.current.qualityCount+' 条；成本按现有事实归属，不自动分摊。':`数量金额覆盖：${o.current.quantityCoverage==null?'不可计算':(100*o.current.quantityCoverage).toFixed(1)+'%'}；缺数量 ${o.current.missingQuantity} 条，缺可信成本 ${o.current.missingCost} 条，待归类 ${o.current.qualityCount} 条。${!o.current.singleUnit?'混合商品／单位或无数量，销量与共同均价不汇总。':''}${o.current.missingCost?'毛利不将缺失成本计作零；部分覆盖毛利仅供核对：'+this.money(o.current.coveredProfit)+'。':''}`}</small><button class="btn btn-sm btn-secondary" type="button" onclick="OperationsItemAnalysis.details(${index})">查看期间明细</button></article>`).join('')}</div>
      <div class="ia-trend-toolbar"><strong>逐项趋势</strong><label>图表指标<select id="ia-metric" onchange="OperationsItemAnalysis.drawChart()">${(kind==='cost'?[['costAmount','成本金额']]:[['netAmount','净收入'],['salesAmount','销售额'],['quantity','销量'],['averagePrice','成交均价'],['grossProfit','销售毛利']]).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label></div><div class="ia-chart"><canvas id="ia-chart" role="img" aria-label="所选对象的逐项经营趋势"></canvas></div>
      <div class="ia-table-scroll"><table class="ia-period-table"><thead><tr><th>对象</th><th>期间</th><th>${kind==='cost'?'成本':'净收入'}</th><th>较区间内上一期</th><th>日均金额</th>${kind==='revenue'?'<th>已记录销量</th><th>日均销量</th><th>成交均价</th><th>毛利</th>':''}<th>明细</th></tr></thead><tbody>${model.objects.map((o,i)=>o.series.map((r,j)=>`<tr><th>${this.esc(o.label)}</th><td>${r.period}${s.granularity==='week'?' 当周':''}<small style="display:block">${r.periodStart} — ${r.periodEnd} · ${r.periodDays}天</small></td><td>${this.money(kind==='cost'?r.costAmount:r.netAmount)}${r.hasData?'':'（无流水）'}</td><td>${j&&r.hasData&&o.series[j-1].hasData?this.change(kind==='cost'?r.costAmount:r.netAmount,kind==='cost'?o.series[j-1].costAmount:o.series[j-1].netAmount):'—'}</td><td>${this.money((kind==='cost'?r.costAmount:r.netAmount)/r.periodDays)}</td>${kind==='revenue'?`<td>${r.singleUnit?r.quantity:'—'}</td><td>${r.singleUnit?(r.quantity/r.periodDays).toFixed(2):'—'}</td><td>${this.money(r.averagePrice)}</td><td>${this.money(r.grossProfit)}</td>`:''}<td><button type="button" class="btn btn-sm btn-secondary" onclick="OperationsItemAnalysis.details(${i},'${r.period}')">查看</button></td></tr>`).join('')).join('')}</tbody></table></div>
      <div class="operations-data-notice"><strong>判断边界与下一步</strong><span>均价按销售额与对应数量加权；均价变化也可能来自折扣或商品组合。销量基于已录入且进入事实视图的记录，零金额赠送或未录入销量可能未覆盖。退款数量未确认时不显示净销量。建议核实营业时间、展览、周末假期与促销背景；结合区间内其他项目的同步变化复核。未采集客流时不计算转化率，也不将涨跌直接归因于策略。项目按现有项目名称归属，历史名称变更不会自动合并。</span></div>`;
  },
  async load() {
    document.getElementById('ia-ranking').innerHTML='';this._ranking=null;
    const id=++this._generation;this._controller?.abort();this._controller=new AbortController();
    this._detailGeneration++;this._detailController?.abort();document.getElementById('ia-details').innerHTML='';
    document.getElementById('ia-export').disabled=true;
    document.getElementById('ia-run').disabled=true;
    const result=document.getElementById('ia-result');result.setAttribute('aria-busy','true');this.status('正在分析…');
    try {
      const s=this.collect(),ids=this.selected();if(ids.length>3)throw new Error('请选择最多三个对象');
      const [response,ranking,business]=await Promise.all([ids.length?this.request('summary',s,ids,{},this._controller.signal):s.kind==='revenue'?this.request('business',s,[],{},this._controller.signal):Promise.resolve({rows:[]}),s.kind==='revenue'?this.request('ranking',{...s,dimension:'product'},[],{},this._controller.signal):Promise.resolve(null),s.kind==='cost'?this.request('business',{...s,kind:'revenue',dimension:'type'},[],{},this._controller.signal):Promise.resolve(null)]);if(id!==this._generation)return;
      const model=this.buildModel(response,s,ids);model.eventDay=s.mode==='strategy'?response.rows.filter(r=>r.businessDate===s.event):[];this._model=model;
      if(business){model.typeDays=business.typeDays;model.visitorDays=business.visitorDays;model.dailyTotals=business.dailyTotals;model.businessRefundCount=business.unattributedRefundCount;}
      // Reattach the ranking container before replacing results that may currently contain it.
      document.getElementById('item-analysis-form').after(document.getElementById('ia-ranking'));
      this._chart?.destroy();this._chart=null;result.innerHTML=this.resultHtml(model);
      if(s.mode==='strategy')result.insertAdjacentHTML('afterbegin',`<div class="operations-data-notice"><strong>调整当天 ${s.event}（单列，纳入完整区间趋势）</strong><span>${model.objects.map(o=>{const r=this.aggregate(model.eventDay.filter(r=>r.objectKey===o.key),s.kind);return this.esc(o.label)+'：'+this.money(s.kind==='cost'?r.costAmount:r.netAmount)+(r.hasData?'':'（无流水）');}).join('；')}</span></div>`);
      document.getElementById('ia-ranking').innerHTML='';this._ranking=ranking?{rows:ranking.rows,state:{...s},unattributedRefundCount:ranking.unattributedRefundCount}:null;if(ranking)this.renderRanking();
      document.getElementById('ia-quantity-matrix')?.after(document.getElementById('ia-chart').parentElement.previousElementSibling,document.getElementById('ia-chart').parentElement);
      if(s.kind==='revenue'&&model.objects.length&&model.objects.every(o=>o.overall.singleUnit))document.getElementById('ia-metric').value='quantity';
      this.drawChart();
      if(model.objects.some(o=>!o.overall.singleUnit)) {
        for(const option of document.getElementById('ia-metric').options)if(['quantity','averagePrice'].includes(option.value)) {option.disabled=true;option.textContent+='（含混合单位对象）';}
      }
      if(typeof OperationsBusinessAnalysis!=='undefined')OperationsBusinessAnalysis.mount({...model,unattributedRefundCount:business?business.unattributedRefundCount:model.unattributedRefundCount});
      document.getElementById('ia-export').disabled=false;this.status('分析已更新'+(!this._objects.length?'；所选期间没有经营事实':''));
    } catch(e) {if(id===this._generation&&e.name!=='AbortError'){this.status(e.message+'；显示结果如有保留仍属上次分析，请重试。',true);}}
    finally {if(id===this._generation){result.setAttribute('aria-busy','false');document.getElementById('ia-run').disabled=false;}}
  },
  drawChart() {
    this._chart?.destroy();this._chart=null;if(typeof Chart==='undefined'||!this._model?.objects.length||!document.getElementById('ia-chart'))return;
    const metric=document.getElementById('ia-metric').value,objects=this._model.objects,colors=['#246044','#a8673f','#447aa0'];
    this._chart=new Chart(document.getElementById('ia-chart'),{type:'line',data:{labels:objects[0].series.map(r=>r.period+(this._model.state.mode==='strategy'&&r.period===this.bucket(this._model.state.event,this._model.state.granularity)?' · 调整':'')),datasets:objects.map((o,i)=>({label:o.label,borderColor:colors[i],backgroundColor:colors[i],pointRadius:3,tension:.15,spanGaps:false,data:o.series.map(r=>!r.hasData?null:metric==='quantity'&&(!r.singleUnit||r.missingQuantity)?null:r[metric])}))},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:c=>`${c.dataset.label}：${metric==='quantity'?c.parsed.y:this.money(c.parsed.y)}`}}},scales:{y:{beginAtZero:true},x:{grid:{display:false}}}}});
  },
  async details(index,period='',offset=0) {
    const model=this._model;if(!model)return;
    const object=model.objects[index],s={...model.state};
    if(period) {
      const dates=[];for(let d=s.start;d<=s.end;d=this.shift(d,1))if(this.bucket(d,s.granularity)===period)dates.push(d);
      s.start=dates[0];s.end=dates[dates.length-1];
    }
    const id=++this._detailGeneration;this._detailController?.abort();this._detailController=new AbortController();
    const root=document.getElementById('ia-details');root.innerHTML='<p role="status">正在加载来源明细…</p>';
    try {
      const response=await this.request('details',s,[object.key],{offset:String(offset),limit:'100'},this._detailController.signal);
      if(id!==this._detailGeneration||model!==this._model)return;
      this._detailContext={index,period,state:s,key:object.key,total:response.total,fingerprint:response.fingerprint};
      root.innerHTML=`<h4>${this.esc(object.label)} · ${s.start} — ${s.end} · 来源明细</h4><p>共 ${response.total} 条事实，当前 ${response.total?offset+1:0}—${Math.min(offset+response.rows.length,response.total)} 条</p><div class="ia-table-scroll"><table class="ia-period-table"><thead><tr><th>日期</th><th>名称</th><th>金额</th><th>数量</th><th>项目</th><th>来源</th></tr></thead><tbody>${response.rows.map(r=>`<tr><td>${this.esc(r.businessDate)}</td><th>${this.esc(r.objectLabel)}</th><td>${this.money(s.kind==='cost'?r.costAmount:r.netAmount)}</td><td>${s.kind==='revenue'&&r.quantityReliable?this.num(r.quantity):'—'}</td><td>${this.esc(r.projectName)||'—'}</td><td>${this.esc(r.sourceTable)} / ${this.esc(r.sourceId)} / ${this.esc(r.sourceLineKey)}</td></tr>`).join('')}</tbody></table></div><div class="ia-actions"><button class="btn btn-secondary" type="button" ${offset===0?'disabled':''} onclick="OperationsItemAnalysis.details(${index},'${period}',${offset-100})">上一页</button><button class="btn btn-secondary" type="button" ${offset+100>=response.total?'disabled':''} onclick="OperationsItemAnalysis.details(${index},'${period}',${offset+100})">下一页</button><button id="ia-detail-export" class="btn btn-secondary" type="button" onclick="OperationsItemAnalysis.exportDetails()">导出此范围明细</button></div>`;
    } catch(e) {if(id===this._detailGeneration&&e.name!=='AbortError')root.innerHTML=`<p class="ia-error">${this.esc(e.message)}</p><button class="btn btn-secondary" type="button" onclick="OperationsItemAnalysis.details(${index},'${period}',${offset})">重试明细</button>`;}
  },
  csvCell(value) { let v=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"'; },
  download(rows,name) {
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(v=>this.csvCell(v)).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  exportAnalysis() {
    if(document.getElementById('ia-export').disabled||!this._model)return;
    const m=this._model,s=m.state;
    if(typeof OperationsBusinessAnalysis!=='undefined'&&OperationsBusinessAnalysis._view!=='products') {
      this.download(OperationsBusinessAnalysis.exportRows(OperationsBusinessAnalysis._model),`运营三维分析-${s.start}-${s.end}.csv`);return;
    }
    const rows=[['逐项分析',s.kind==='cost'?'成本':'收入',s.dimension],['分析范围',s.start,s.end],[s.afterLabel,s.currentStart,s.currentEnd],[s.beforeLabel,s.compareStart,s.compareEnd],['策略',s.eventName||'',s.mode==='strategy'?s.event:''],['口径','完整事实汇总；日均按日历天；项目按现有名称；未归属退款不分摊；缺成本毛利留空'],['未归属退款调整条数',m.unattributedRefundCount],['生成时间',new Date().toISOString()],['对象','分组','期间','销售额','已归属退款','已归属净收入','成本','已记录销量','成交均价','完整毛利','部分覆盖毛利','缺数量条数','缺成本条数','数量金额覆盖','待归类条数','明确项目期间成本','项目贡献','全馆金额占比%','票种销量占比%','分组开始','分组结束','日历天数','日均金额','日均已记录销量']];
    if(s.kind==='revenue'&&m.objects.length)rows.splice(8,0,['到馆经营口径','1普通票=1人次；1套票=1人次+1杯咖啡权益；人次非去重人数；未登记免费访客未覆盖；套票收入不重复计算'],['分组期间','售票记录到馆人次','缺人数记录数','套票人次','单售咖啡杯数','套票含咖啡权益杯数','基础业务已归属净收入','每人次收入','每人次销售毛利'],...m.objects[0].series.map(r=>{const v=this.visitorSummary(m,r.periodStart,r.periodEnd);return [r.period,v.visitors,v.missing,v.combo,v.standalone,v.combo,v.revenue,v.perVisitor,v.perVisitorProfit];}));
    for(const o of m.objects)for(const [label,values] of [['区间合计',[o.overall]],[s.afterLabel,[o.current]],[s.beforeLabel,[o.comparison]],['趋势',o.series],['调整当天',s.mode==='strategy'?[{period:s.event,...this.aggregate(m.eventDay.filter(r=>r.objectKey===o.key),s.kind)}]:[]]])for(const r of values){const days=r.periodDays||(label===s.afterLabel?m.days:label===s.beforeLabel?m.compareDays:label==='调整当天'?1:this.days(s.start,s.end));rows.push([o.label,label,r.period||'',r.salesAmount,r.refundAmount,r.netAmount,r.costAmount,r.singleUnit?r.quantity:'',r.averagePrice,r.grossProfit,r.coveredProfit,r.missingQuantity,r.missingCost,r.quantityCoverage,r.qualityCount,r.relatedCost,s.dimension==='project'?r.contribution:'',r.share,r.ticketShare,r.periodStart||'',r.periodEnd||'',days,(s.kind==='cost'?r.costAmount:r.netAmount)/days,r.singleUnit?r.quantity/days:'']);}
    this.download(rows,`运营逐项分析-${s.start}-${s.end}.csv`);
  },
  async exportDetails() {
    const ctx=this._detailContext,model=this._model,id=this._detailGeneration,button=document.getElementById('ia-detail-export');if(!ctx||!button)return;
    if(ctx.total>10000){this.status('明细超过 10000 条，请选择更短期间后导出；不会导出截断结果。',true);return;}
    button.disabled=true;button.textContent='正在导出…';
    try {
      const all=[];for(let offset=0;offset<Math.max(ctx.total,1);offset+=200){const page=await this.request('details',ctx.state,[ctx.key],{offset:String(offset),limit:'200'},this._detailController.signal);if(id!==this._detailGeneration||model!==this._model)return;if(page.total!==ctx.total||page.fingerprint!==ctx.fingerprint)throw new Error('导出期间事实发生变化，请刷新后重试');all.push(...page.rows);}
      if(all.length!==ctx.total||new Set(all.map(r=>r.factId)).size!==ctx.total)throw new Error('明细完整性校验失败，请重试');
      const s=ctx.state;this.download([['对象',model.objects[ctx.index].label],['期间',s.start,s.end],['口径','按现有事实归属；未归属退款不分摊；数量为已记录数量'],['生成时间',new Date().toISOString()],['事实ID','业务日期','名称','销售原额','净收入','成本','数量','项目','来源表','来源ID','明细键','质量标记'],...all.map(r=>[r.factId,r.businessDate,r.objectLabel,r.grossAmount,r.netAmount,r.costAmount,r.quantityReliable?r.quantity:'',r.projectName,r.sourceTable,r.sourceId,r.sourceLineKey,JSON.stringify(r.qualityFlags)])],`运营分析明细-${s.start}-${s.end}.csv`);
    } catch(e){if(id===this._detailGeneration&&e.name!=='AbortError')this.status(e.message,true);}
    finally {if(button.isConnected){button.disabled=false;button.textContent='导出此范围明细';}}
  }
};
if(typeof window!=='undefined')window.OperationsItemAnalysis=OperationsItemAnalysis;
if(typeof module!=='undefined')module.exports=OperationsItemAnalysis;
