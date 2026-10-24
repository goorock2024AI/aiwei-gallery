// Three operating questions share one date range and read-only facts.
const OperationsBusinessAnalysis = {
  _view:'linkage', _model:null, _target:'creative_retail', _chart:null, _chartMetric:'share',
  groups:[['visit','到馆参观'],['retail','现场零售'],['experience','体验活动'],['art','艺术品交易']],
  helper() { return typeof OperationsItemAnalysis!=='undefined'?OperationsItemAnalysis:require('./operations-item-analysis'); },
  esc(v) {return this.helper().esc(v);}, money(v) {return this.helper().money(v);},
  num(v) {return this.helper().num(v);},
  rangeRows(model,start,end) {return (model.typeDays||[]).filter(r=>r.businessDate>=start&&r.businessDate<=end);},
  visitors(model,start,end) {return this.helper().visitorSummary(model,start,end);},
  periods(model) {
    const a=this.helper(),s=model.state,buckets=new Map();
    for(let d=s.start;d<=s.end;d=a.shift(d,1)) {const key=a.bucket(d,s.granularity);if(!buckets.has(key))buckets.set(key,{period:key,start:d,end:d});buckets.get(key).end=d;}
    return [...buckets.values()];
  },
  groupSummary(model,start,end,group) {
    const rows=this.rangeRows(model,start,end).filter(r=>r.analysisGroup===group);
    const sum=key=>rows.reduce((n,r)=>n+this.num(r[key]),0),v=this.visitors(model,start,end);
    const revenue=sum('netAmount'),missingCost=sum('missingCost'),missingQuantity=sum('missingQuantity'),coveredProfit=sum('coveredProfit');
    const profit=rows.length&&!missingCost?coveredProfit:null;
    return {group,revenue,missingCost,missingQuantity,coveredProfit,profit,hasData:rows.length>0,perVisitor:rows.length&&v.visitors>0&&!v.missing?revenue/v.visitors:null};
  },
  funnel(model,start=model.state.start,end=model.state.end) {
    const layers=this.groups.map(([code,name])=>({...this.groupSummary(model,start,end,code),name}));
    const totalProfit=layers.reduce((n,l)=>n+(l.profit||0),0);
    const contributionAvailable=layers.every(l=>!l.hasData||l.profit!=null)&&totalProfit>0&&!model.unattributedRefundCount;
    layers.forEach(l=>l.profitShare=contributionAvailable&&l.profit!=null?l.profit/totalProfit*100:null);
    return {layers,space:this.groupSummary(model,start,end,'space_cooperation'),unclassified:this.groupSummary(model,start,end,'unclassified'),visitors:this.visitors(model,start,end)};
  },
  quantity(model,start,end,type) {
    if(type==='ticket'||type==='visit_combo') {const v=this.visitors(model,start,end),key=type==='ticket'?'missingTicketQuantity':'missingComboQuantity';return {value:type==='ticket'?v.ticket:v.combo,missing:(model.visitorDays||[]).filter(r=>r.businessDate>=start&&r.businessDate<=end).reduce((n,r)=>n+this.num(r[key]??r.missingVisitorQuantity),0)};}
    if(type==='coffee') {const v=this.visitors(model,start,end);const rows=this.rangeRows(model,start,end).filter(r=>r.businessTypeCode==='coffee');return {value:v.standalone,missing:rows.reduce((n,r)=>n+this.num(r.missingQuantity),0)};}
    const rows=this.rangeRows(model,start,end).filter(r=>r.businessTypeCode===type);
    return {value:rows.reduce((n,r)=>n+this.num(r.quantity),0),missing:rows.reduce((n,r)=>n+this.num(r.missingQuantity),0)};
  },
  count(v,unit='人次') {return v.toLocaleString('zh-CN')+' '+unit;},
  funnelHtml(model) {
    const s=model.state,f=this.funnel(model),v=f.visitors,periods=this.periods(model);
    const qty=(r,type,unit)=>{const q=this.quantity(model,r.start,r.end,type);return this.count(q.value,unit)+(q.missing?'（数量不完整）':'');};
    return `<article id="ia-business-funnel" class="ia-object-card"><h4>四层经营漏斗</h4><p><strong>售票记录到馆 ${this.count(v.visitors)}${v.missing?'（缺人数记录 '+v.missing+' 条）':''}</strong> · 普通票 ${this.count(v.ticket,'张')} · 套票 ${this.count(v.combo,'套')}</p>
      <div class="ia-funnel-flow">${f.layers.map((l,i)=>`<div><span>第${i+1}层 · ${l.name}</span><strong>${this.money(l.hasData?l.revenue:null)}</strong><small>每到馆人次收入 ${this.money(l.perVisitor)}</small></div>`).join('')}</div>
      <div class="ia-table-scroll"><table class="ia-funnel-table ia-period-table"><thead><tr><th>业务层</th><th>消费人次</th><th>已归属净收入</th><th>每到馆人次收入</th><th>已归属销售毛利</th><th>四层毛利贡献占比</th><th>数据状态</th></tr></thead><tbody>${f.layers.map((l,i)=>`<tr data-operating-layer="${l.group}"><th>${l.name}</th><td>${i===0?this.count(v.visitors)+(v.missing?'（部分记录）':''):'未采集可关联消费人数'}</td><td>${this.money(l.hasData?l.revenue:null)}</td><td>${this.money(l.perVisitor)}</td><td>${this.money(l.profit)}</td><td>${l.profitShare==null?'—':l.profitShare.toFixed(1)+'%'}</td><td>${!l.hasData?'无流水':l.missingCost?'缺可信成本 '+l.missingCost+' 条':model.unattributedRefundCount?'直接成本已覆盖；有待归属退款':'销售直接成本已覆盖'}</td></tr>`).join('')}</tbody></table></div>
      <p>以到馆人次为共同基数，观察零售、体验和艺术品收入的承接能力。销售毛利扣除可信销售直接成本，尚未扣除房租、工资等公共运营费用；成本不完整时不计算完整毛利和四层贡献占比。</p>
      <small>这是经营层级关系。观众可能直接购买艺术品，不要求逐层消费；下游缺少访客关联记录，暂不能计算真实消费人数和转化率。每人次收入是同期收入÷售票记录到馆人次，不能认定所有收入都来自入馆观众。免费访客尚未覆盖，人次不是去重人数。套票收入归到馆层，只计一次。</small></article>
      <article id="ia-operations-core" class="ia-object-card"><h4>区间内人数、销量与各层人均贡献</h4><div class="ia-table-scroll"><table class="ia-visitor-table ia-period-table"><thead><tr><th>期间</th><th>普通门票</th><th>套票</th><th>售票记录到馆人次</th><th>套票占比</th><th>单售咖啡杯量</th><th>套票含咖啡权益</th>${this.groups.map(([,name])=>`<th>${name}每人次收入</th>`).join('')}<th>四层每人次合计收入</th></tr></thead><tbody>${periods.map(r=>{const p=this.funnel(model,r.start,r.end),pv=p.visitors;return `<tr><th>${r.period}<small>${r.start} — ${r.end}</small></th><td>${qty(r,'ticket','张')}</td><td>${qty(r,'visit_combo','套')}</td><td>${this.count(pv.visitors)}${pv.missing?'（人数不完整）':''}</td><td>${pv.comboShare==null?'—':pv.comboShare.toFixed(1)+'%'}</td><td>${qty(r,'coffee','杯')}</td><td>${this.count(pv.combo,'杯权益')}</td>${p.layers.map(l=>`<td>${this.money(l.perVisitor)}</td>`).join('')}<td>${this.money(pv.visitors>0&&!pv.missing?p.layers.reduce((n,l)=>n+l.revenue,0)/pv.visitors:null)}</td></tr>`;}).join('')}</tbody></table></div><small>门票／套票各代表当天1人次到馆，套票含1杯咖啡权益。单售与权益分开，权益不等于实际供应杯量。无流水不能确认营业零销售。</small></article>
      <article id="ia-space-independent" class="ia-object-card"><h4>空间合作 · 独立类别</h4><p>期间已归属净收入：<strong>${this.money(f.space.hasData?f.space.revenue:null)}</strong>；不进入四层、人均收入和四层毛利贡献分母。</p><div class="ia-table-scroll"><table class="ia-space-table ia-metric-table"><thead><tr><th>期间</th><th>空间合作净收入</th></tr></thead><tbody>${periods.map(r=>{const p=this.groupSummary(model,r.start,r.end,'space_cooperation');return `<tr><th>${r.period}</th><td>${this.money(p.hasData?p.revenue:null)}</td></tr>`;}).join('')}</tbody></table></div><small>空间使用及收款、原场租收入、空间租赁及空间记录中的品牌活动独立归类。共享期间成本尚未分拆，不自动从艺术品层挪作空间成本。</small></article>
      ${f.unclassified.hasData?`<div class="operations-data-notice warning"><strong>待归类收入 ${this.money(f.unclassified.revenue)}</strong><span>单独列示，不擅自计入四层或空间合作。${model.unattributedRefundCount?'包括未归属退款调整，完整贡献占比暂不计算。':''}</span></div>`:''}`;
  },
  targetOptions(model) {
    const targets=new Map();
    (model.typeDays||[]).filter(r=>['retail','experience','art'].includes(r.analysisGroup)).forEach(r=>targets.set(r.businessTypeCode,r.businessTypeName||r.businessTypeCode));
    return [...targets];
  },
  dailyLinkage(model,target) {
    const s=model.state,rows=[];
    for(let d=s.start;d<=s.end;d=this.helper().shift(d,1)) {
      const facts=this.rangeRows(model,d,d).filter(r=>r.businessTypeCode===target&&['retail','experience','art'].includes(r.analysisGroup));
      const visitorRecord=(model.visitorDays||[]).some(r=>r.businessDate===d);
      if(!visitorRecord&&!facts.length)continue;
      const v=this.visitors(model,d,d),income=facts.reduce((n,r)=>n+this.num(r.netAmount),0);
      rows.push({date:d,weekday:['周日','周一','周二','周三','周四','周五','周六'][this.helper().day(d).getUTCDay()],ticket:v.ticket,combo:v.combo,visitors:v.visitors,missing:v.missing,share:v.comboShare,income:facts.length?income:null,perVisitor:facts.length&&v.visitors>0&&!v.missing?income/v.visitors:null});
    }
    return rows;
  },
  correlation(rows) {
    const pairs=rows.filter(r=>r.share!=null&&r.perVisitor!=null),n=pairs.length;
    if(n<3)return {n,value:null,reason:'有效同日样本不足3天'};
    const mx=pairs.reduce((v,r)=>v+r.share,0)/n,my=pairs.reduce((v,r)=>v+r.perVisitor,0)/n;
    let xx=0,yy=0,xy=0;for(const r of pairs){const x=r.share-mx,y=r.perVisitor-my;xx+=x*x;yy+=y*y;xy+=x*y;}
    return {n,value:xx>0&&yy>0?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null,reason:xx>0&&yy>0?'':'票种占比或人均收入没有变化'};
  },
  linkagePeriod(rows,start,end) {
    const scoped=rows.filter(r=>r.date>=start&&r.date<=end),paired=scoped.filter(r=>r.share!=null&&r.perVisitor!=null);
    const sum=(list,key)=>list.reduce((n,r)=>n+this.num(r[key]),0),visitors=sum(paired,'visitors');
    return {recordedDays:scoped.length,pairedDays:paired.length,visitors,comboShare:visitors>0?sum(paired,'combo')/visitors*100:null,income:paired.length?sum(paired,'income'):null,perVisitor:visitors>0?sum(paired,'income')/visitors:null,dailyIncome:paired.length?sum(paired,'income')/paired.length:null};
  },
  linkageHtml(model) {
    const s=model.state,targets=this.targetOptions(model);if(!targets.some(([code])=>code===this._target))this._target=targets[0]?.[0]||'';
    const target=this._target,label=targets.find(([code])=>code===target)?.[1]||'下游业务',rows=this.dailyLinkage(model,target),c=this.correlation(rows);
    const a=this.linkagePeriod(rows,s.currentStart,s.currentEnd),b=this.linkagePeriod(rows,s.compareStart,s.compareEnd);
    const rate=v=>v==null?'—':v.toFixed(1)+'%';
    return `<article id="ia-business-linkage" class="ia-object-card"><h4>票种与跨业务联动</h4><label>观察业务 <select id="ia-linkage-target" onchange="OperationsBusinessAnalysis.setTarget(this.value)">${targets.map(([code,name])=>`<option value="${this.esc(code)}" ${code===target?'selected':''}>${this.esc(name)}</option>`).join('')}</select></label><p>同时查看普通票、套票数量及套票占比，与<strong>${this.esc(label)}</strong>的同日收入、每到馆人次收入变化。</p>
      ${!targets.length?'<p>所选期间没有可观察的零售、体验或艺术品收入流水。</p>':''}
      <div class="ia-table-scroll"><table class="ia-linkage-comparison ia-period-table"><thead><tr><th>期间</th><th>有效同日样本</th><th>样本到馆人次</th><th>套票占比</th><th>业务净收入</th><th>每到馆人次收入</th><th>每有效样本日收入</th></tr></thead><tbody>${[[s.beforeLabel,b],[s.afterLabel,a]].map(([name,r])=>`<tr><th>${this.esc(name)}</th><td>${r.pairedDays} 天</td><td>${this.count(r.visitors)}</td><td>${rate(r.comboShare)}</td><td>${this.money(r.income)}</td><td>${this.money(r.perVisitor)}</td><td>${this.money(r.dailyIncome)}</td></tr>`).join('')}</tbody></table></div>
      <p>${s.samePeriod?'所选区间只有一期，首末期相同，不能作为两期比较。':a.perVisitor!=null&&b.perVisitor!=null?'有效同日样本中，每到馆人次'+this.esc(label)+'收入变化 '+this.helper().change(a.perVisitor,b.perVisitor)+'。':'前后期缺少有效同日样本，暂不能比较人均贡献。'} 样本日均按有效天数计算，各期覆盖不同，需结合下方日期核对。</p>
      <p>套票占比与该业务每人次收入的同日关联：${c.value==null?'暂不可计算（'+this.esc(c.reason)+'）':`相关系数 ${c.value.toFixed(2)}（${c.n} 个有效样本日）`}。这只是同步变化，不代表调价效果或套票用户的个人购买行为。</p>
      <div class="ia-trend-toolbar"><strong>同日联动趋势</strong><label>图表口径<select id="ia-linkage-metric" onchange="OperationsBusinessAnalysis._chartMetric=this.value;OperationsBusinessAnalysis.drawLinkageChart()"><option value="share" ${this._chartMetric==='share'?'selected':''}>套票占比与每人次收入</option><option value="quantity" ${this._chartMetric==='quantity'?'selected':''}>票种销量与业务收入</option></select></label></div><div class="ia-chart"><canvas id="ia-linkage-chart" role="img" aria-label="票种与下游业务的同日联动趋势"></canvas></div><div class="ia-table-scroll"><table class="ia-linkage-daily ia-period-table"><thead><tr><th>日期</th><th>星期</th><th>普通票</th><th>套票</th><th>到馆人次</th><th>套票占比</th><th>${this.esc(label)}净收入</th><th>每到馆人次收入</th><th>样本状态</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${r.date}${s.mode==='strategy'&&r.date===s.event?' · 调整当天':''}</th><td>${r.weekday}</td><td>${this.count(r.ticket,'张')}</td><td>${this.count(r.combo,'套')}</td><td>${this.count(r.visitors)}</td><td>${rate(r.share)}</td><td>${r.income==null?'无流水':this.money(r.income)}</td><td>${this.money(r.perVisitor)}</td><td>${r.missing?'缺人数':r.income==null?'无目标业务流水':!r.visitors?'无到馆分母':'可观察同日联动'}</td></tr>`).join('')}</tbody></table></div>
      <small>只使用范围内两类数据同日齐全且到馆人数完整的样本做关联计算；无流水不补零。调整当天保留在日表，独立于前后期。周末、展览、促销及团体接待均可能影响结果，需要结合实际经营背景判断。真实票种用户转化需新增访客关联记录。</small></article>`;
  },
  mount(model) {
    this._chart?.destroy();this._chart=null;
    this._model=model;
    document.getElementById('ia-business-tabs')?.remove();
    const root=document.getElementById('ia-result'),product=document.createElement('div');product.id='ia-business-products';product.dataset.analysisPanel='products';
    // Keep the proven item/detail functions intact inside the third analysis view.
    while(root.firstChild)product.append(root.firstChild);
    product.querySelector('#ia-operations-core')?.remove();
    const s=model.state;
    root.innerHTML=`<div class="ia-period-banner ia-business-scope"><strong>三个维度共用范围：${s.start} — ${s.end}</strong><span>${this.esc(s.beforeLabel)}：${s.compareStart} — ${s.compareEnd}；${this.esc(s.afterLabel)}：${s.currentStart} — ${s.currentEnd}${s.mode==='strategy'?'；调整日 '+s.event+' 单列':''}</span></div><nav id="ia-business-tabs" class="ia-business-tabs" aria-label="三个运营分析维度">${[['funnel','① 四层经营漏斗'],['linkage','② 票种与跨业务联动'],['products','③ 单品销量与选品']].map(([key,name])=>`<button type="button" data-analysis-view="${key}" onclick="OperationsBusinessAnalysis.show('${key}')">${name}</button>`).join('')}</nav><div id="ia-business-funnel-panel" data-analysis-panel="funnel">${this.funnelHtml(model)}</div><div id="ia-business-linkage-panel" data-analysis-panel="linkage">${this.linkageHtml(model)}</div>`;
    product.prepend(document.getElementById('ia-ranking'));root.append(product);
    document.getElementById('item-analysis-form').before(document.getElementById('ia-business-tabs'));
    this.show(this._view);
  },
  show(view) {
    if(view==='funnel'&&typeof VisitorAnalysis!=='undefined'){VisitorAnalysis.open();return;}
    if(!['funnel','linkage','products'].includes(view))return;
    this._view=view;
    document.querySelectorAll('[data-analysis-panel]').forEach(el=>el.hidden=el.dataset.analysisPanel!==view);
    document.querySelectorAll('[data-analysis-view]').forEach(el=>{el.classList.toggle('active',el.dataset.analysisView===view);el.setAttribute('aria-pressed',String(el.dataset.analysisView===view));});
    for(const id of ['ia-kind','ia-dimension']) {const el=document.getElementById(id);if(el)el.parentElement.hidden=view!=='products';}
    const picker=document.querySelector('.ia-object-picker');if(picker)picker.hidden=view!=='products';
    if(view==='products')this.helper()._chart?.resize();
    if(view==='linkage')this.drawLinkageChart();
  },
  setTarget(value) {if(!this._model||!this.targetOptions(this._model).some(([code])=>code===value))return;this._target=value;document.getElementById('ia-business-linkage-panel').innerHTML=this.linkageHtml(this._model);this.drawLinkageChart();},
  drawLinkageChart() {
    this._chart?.destroy();this._chart=null;
    const canvas=document.getElementById('ia-linkage-chart');if(typeof Chart==='undefined'||!canvas||!this._model)return;
    const rows=this.dailyLinkage(this._model,this._target),share=this._chartMetric==='share';
    const label=this.targetOptions(this._model).find(([code])=>code===this._target)?.[1]||'目标业务';
    const line=(label,key,color,axis)=>({label,yAxisID:axis,borderColor:color,backgroundColor:color,pointRadius:3,tension:.1,spanGaps:false,data:rows.map(r=>['ticket','combo'].includes(key)&&r.missing?null:r[key])});
    const datasets=share?[line('套票占比（%）','share','#246044','y'),line(label+'每到馆人次收入（元）','perVisitor','#a8673f','income')]:[line('普通票数量（张）','ticket','#447aa0','y'),line('套票数量（套）','combo','#246044','y'),line(label+'净收入（元）','income','#a8673f','income')];
    this._chart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,title:{display:true,text:share?'套票占比（%）':'票种销量'},...(share?{max:100}:{})},income:{position:'right',title:{display:true,text:share?'每到馆人次收入（元）':'业务净收入（元）'},grid:{drawOnChartArea:false}},x:{grid:{display:false}}}}});
  },
  exportRows(model,view=this._view) {
    const s=model.state,rows=[['运营分析',view==='funnel'?'四层经营漏斗':'票种与跨业务联动'],['日期范围',s.start,s.end],['口径','售票记录到馆人次；空间合作独立；未知成本不计零；销售毛利非净利润；同日关联非因果']];
    if(view==='linkage')return [...rows,['业务',this.targetOptions(model).find(([code])=>code===this._target)?.[1]||''],['日期','星期','普通票数量','套票数量','到馆人次','缺人数条数','套票占比%','业务净收入','每到馆人次收入'],...this.dailyLinkage(model,this._target).map(r=>[r.date,r.weekday,r.ticket,r.combo,r.visitors,r.missing,r.share,r.income,r.perVisitor])];
    rows.push(['期间','业务层','已归属净收入','每到馆人次收入','已归属销售毛利','四层毛利贡献占比%','缺成本条数','售票记录到馆人次','缺人数条数']);
    for(const p of [{period:'区间合计',start:s.start,end:s.end},...this.periods(model)]) {const f=this.funnel(model,p.start,p.end);for(const l of [...f.layers,{...f.space,name:'空间合作（独立）',perVisitor:null,profitShare:null},{...f.unclassified,name:'待归类',perVisitor:null,profitShare:null}])rows.push([p.period,l.name,l.hasData?l.revenue:null,l.perVisitor,l.profit,l.profitShare,l.missingCost,f.visitors.visitors,f.visitors.missing]);}
    return rows;
  }
};
if(typeof window!=='undefined')window.OperationsBusinessAnalysis=OperationsBusinessAnalysis;
if(typeof module!=='undefined')module.exports=OperationsBusinessAnalysis;
