/* Independent inventory inbox. No POS integration and no automatic purchases. */
const InventoryInbox = {
  _data:null,_busy:false,_selected:'purchase',_filter:'all',_request:null,
  esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  grams(v){return v==null?'待确认':Number(v).toLocaleString('zh-CN')+' 克';},
  time(v){return v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'暂无';},
  local(v){const d=new Date(v);return new Date(+d+8*3600000).toISOString().slice(0,16);},
  async render(){
    const root=document.getElementById('page-inventory');if(!root)return;
    root.innerHTML='<div class="inventory-shell"><h2>库存提醒</h2><p role="status">正在计算咖啡豆用量与补货建议…</p></div>';
    try {this._data=await Store._request('GET','/rest/v1/coffee-inventory');this.paint();}
    catch(e){root.innerHTML=`<div class="inventory-shell"><h2>库存提醒</h2><div class="card" role="alert">${this.esc(e.message)}<p><button class="btn btn-secondary" onclick="InventoryInbox.render()">重新加载</button></p></div></div>`;}
  },
  messages(){
    const r=this._data.result;
    const titles={setup:'先录入当前咖啡豆库存',insufficient:'请补充销量预期',urgent:'可能在新豆到货前断豆',buy:'咖啡豆需要补货',ok:'咖啡豆库存暂时充足'};
    const descriptions={setup:'盘点一次实际重量，即可开始估算。',insufficient:'历史样本不足，暂不输出采购克数。',urgent:'常规配送可能来不及，建议联系应急供应。',buy:`参考建议 ${this.grams(r.suggestedGrams)}，查看预测与新鲜度限制。`,ok:`预计下次采购：${this.time(r.reorderAt)}。每天重新预测。`};
    const a=[{id:'purchase',title:titles[r.status],summary:descriptions[r.status],kind:['urgent','buy','setup','insufficient'].includes(r.status)?'action':'info',label:'补货决策'}];
    if(r.warnings.length)a.push({id:'quality',title:'预测与新鲜度待核对',summary:r.warnings[0],kind:'action',label:'数据与品质'});
    if(this._data.orders.some(o=>o.status==='pending'))a.push({id:'orders',title:'在途咖啡豆',summary:`${this._data.orders.filter(o=>o.status==='pending').length} 笔订单，实际收货后再计入库存。`,kind:r.overdueOrders?'action':'info',label:'采购跟进'});
    a.push({id:'history',title:'库存操作记录',summary:'查看补货、盘点及预测规则变更。',kind:'info',label:'操作留痕'});
    return a;
  },
  select(id){this._selected=id;this.paint();},
  filter(value){this._filter=value;this.paint();},
  paint(){
    const d=this._data,r=d.result,e=this.esc.bind(this),messages=this.messages(),visible=messages.filter(m=>this._filter==='all'||m.kind==='action');
    if(!visible.some(m=>m.id===this._selected))this._selected=visible[0]?.id;
    const selected=messages.find(m=>m.id===this._selected);
    document.getElementById('page-inventory').innerHTML=`<div class="inventory-shell">
      <header class="inventory-header"><div><span class="inventory-eyebrow">运营通知 · 咖啡豆</span><h2>库存提醒</h2><p>把补货安排在断豆之前，也把新鲜度留在杯子里。</p></div><button class="btn btn-secondary" onclick="InventoryInbox.render()">刷新预测</button></header>
      <div class="inventory-stats"><div><span>预计可用库存</span><strong>${this.grams(r.availableGrams)}</strong><small>销量估算 · 每杯 20 克</small></div><div><span>未来 60 小时需求</span><strong>${r.status==='insufficient'?'待确认':this.grams(r.leadDemandGrams)}</strong><small>按营业时间分配预计销量</small></div><div><span>安全余量</span><strong>${this.grams(r.safetyGrams)}</strong><small>${r.provisional?'暂用保守余量':'参考历史超预期销量'}</small></div></div>
      <div class="inventory-inbox"><aside class="inventory-list" aria-label="库存通知列表"><div class="inventory-filter"><button aria-pressed="${this._filter==='all'}" onclick="InventoryInbox.filter('all')">全部通知</button><button aria-pressed="${this._filter==='action'}" onclick="InventoryInbox.filter('action')">需处理 ${messages.filter(m=>m.kind==='action').length}</button></div>${visible.map(m=>`<button class="inventory-message ${this._selected===m.id?'selected':''}" aria-pressed="${this._selected===m.id}" onclick="InventoryInbox.select('${m.id}')"><span class="inventory-message-meta"><i class="${m.kind}"></i>${e(m.label)}</span><strong>${e(m.title)}</strong><span>${e(m.summary)}</span></button>`).join('')||'<p class="inventory-empty">当前没有需要处理的提醒。</p>'}</aside>
      <section class="inventory-detail" aria-label="通知详情">${selected?`<div class="inventory-detail-heading"><span class="inventory-eyebrow">${e(selected.label)} · ${this.time(r.now)} 更新</span><h3>${e(selected.title)}</h3><p>${e(selected.summary)}</p></div>${this.detail(selected.id)}`:'<h3>当前没有待处理事项</h3><p>可切换到全部通知查看库存和历史。</p>'}</section></div>
      ${d.canWrite?this.forms():''}<p class="inventory-footnote">自动估算不能代替实际盘点。预测会随销售、到货和活动预期更新。所有时间均为北京时间。</p>
    </div>`;
    document.querySelectorAll('#page-inventory form[data-inventory-action]').forEach(form=>form.addEventListener('submit',event=>this.submit(event)));
    if(d.canWrite)document.getElementById('inv-settings').addEventListener('submit',event=>this.settings(event));
  },
  detail(id){
    const d=this._data,r=d.result,e=this.esc.bind(this);
    if(id==='quality')return `<ul class="inventory-notes">${r.warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul><p>请在下方“预测规则”补充包装与适饮参数，在“日期与活动预期”调整特殊日期。</p><a href="${e(r.calendarSource)}" target="_blank" rel="noopener noreferrer">2026 年假日与调休来源 ↗</a>`;
    if(id==='history')return `<div class="inventory-table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>操作</th><th>内容</th><th>记录人</th></tr></thead><tbody>${d.events.map(v=>`<tr><td>${this.time(v.created_at)}</td><td>${e(({count:'盘点',receive:'到货补货',order:'登记下单',cancel:'取消订单',reschedule:'修改到货时间',settings:'调整规则',calendar:'调整日期'})[v.action]||v.action)}</td><td>${v.payload.grams!=null?this.grams(v.payload.grams)+' · ':''}${e(v.payload.note||'规则配置更新')}</td><td>${e(v.actor_name)}</td></tr>`).join('')||'<tr><td colspan="4">暂无操作记录</td></tr>'}</tbody></table></div><p>显示最近 100 次记录，完整记录保存在后台。</p>`;
    if(id==='orders')return `<div class="inventory-order-list">${d.orders.filter(o=>o.status==='pending').map(o=>`<article><div><strong>${this.grams(o.grams)}</strong><span>预计 ${this.time(o.eta)} 到货${new Date(o.eta)<new Date(r.now)?' · 已超时':''}</span><p>${e(o.note)}</p></div>${d.canWrite?`<div class="inventory-order-actions"><button class="btn btn-primary" onclick="InventoryInbox.receive('${o.id}')">确认实际到货</button><button class="btn btn-secondary" onclick="InventoryInbox.editOrder('${o.id}','reschedule')">修改到货时间</button><button class="btn btn-secondary" onclick="InventoryInbox.editOrder('${o.id}','cancel')">取消订单</button></div>`:''}</article>`).join('')}</div><p>已超时订单不会继续抵扣采购需求。晚于本次新货的在途订单请结合需求拆批。</p>`;
    const labels={weekday:'周中',weekend:'周末',holiday:'节假日',closed:'闭馆'};
    return `<div class="inventory-recommendation"><span>${['buy','urgent'].includes(r.status)?'建议采购量':'下次采购参考量'}</span><strong>${this.grams(r.suggestedGrams)}</strong><p>${r.config.packGrams&&r.suggestedGrams!=null?`约 ${r.suggestedGrams/r.config.packGrams} 袋 · 每袋 ${this.grams(r.config.packGrams)}`:'填写包装重量后可自动换算袋数'}</p><p>现在下单预计 ${this.time(r.arrival)} 到货 · 目标覆盖到货后 ${r.config.targetDays} 天</p></div>
      ${r.status==='urgent'?`<p class="inventory-alert" role="status">预计 ${this.time(r.stockout)} 库存不足。常规配送可能来不及，请联系本地应急供应或提前到货。</p>`:''}
      <div class="inventory-candidates">${r.candidates.map(c=>`<div class="${c.days===r.config.targetDays?'chosen':''}"><span>覆盖 ${c.days} 天${c.days===r.config.targetDays?' · 当前策略':''}</span><strong>${r.suggestedGrams==null?'待确认':this.grams(c.grams)}</strong><small>${c.conflict?'受适饮上限限制，需拆批':'按预期需求与安全量计算'}</small></div>`).join('')}</div>
      <h4>未来 7 天销量预期</h4><div class="inventory-table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>类型</th><th>预计销量</th><th>依据</th></tr></thead><tbody>${r.days.slice(0,7).map(v=>`<tr><td>${e(v.date)}</td><td>${labels[v.type]}</td><td>${v.cups==null?'待确认':Math.ceil(v.cups)+' 杯'}</td><td>${e(v.basis)}${v.samples?' · '+v.samples+' 天':''}</td></tr>`).join('')}</tbody></table></div>
      <details class="inventory-explain"><summary>计算依据与边界</summary><ul>${r.assumptions.map(t=>`<li>${e(t)}</li>`).join('')}<li>目标补货量会扣除可及时到货的在途订单；预测误差的历史90%分位数用于安全量，不等于90%保供承诺。</li></ul></details>`;
  },
  dates(){return '<label>烘焙日期（可选）<input name="roastDate" type="date"></label><label>开袋日期（可选）<input name="openedDate" type="date"></label><label>适饮截止日（可选）<input name="bestBefore" type="date"></label>';},
  forms(){
    const r=this._data.result,c=r.config,e=this.esc.bind(this);
    return `<div class="inventory-tools"><details id="inv-stock-tools" ${r.initialized?'':'open'}><summary>库存与采购记录</summary><div class="inventory-form-columns">
      <form data-inventory-action="count"><h4>${r.initialized?'盘点校正':'首次录入库存'}</h4><p>填写目前实际剩余重量，已售咖啡不会再次扣减。盘点将合并现有批次，日期不同时请优先单独记录补货。</p><label>实际剩余（克）<input name="grams" type="number" min="0" max="1000000" step="1" required></label>${this.dates()}<label>盘点原因<input name="note" maxlength="500" required placeholder="首次盘点／试饮损耗校正"></label><button class="btn btn-primary">保存盘点</button></form>
      ${r.initialized?`<form data-inventory-action="order"><h4>登记已下单</h4><p>记录在途量，避免重复采购；尚未到货不增加库存。</p><label>订购重量（克）<input name="grams" type="number" min="1" max="1000000" step="1" required value="${r.suggestedGrams||''}"></label><label>预计到货时间<input name="eta" type="datetime-local" required value="${this.local(r.arrival)}"></label><label>采购备注<input name="note" required maxlength="500" placeholder="供应商、订单号"></label><button class="btn btn-primary">记录下单</button></form>
      <form id="inv-receive" data-inventory-action="receive"><h4>实际到货补货</h4><p id="inv-receive-note">无需关联订单也可登记补货。</p><input type="hidden" name="orderId"><label>实际到货重量（克）<input name="grams" type="number" min="1" max="1000000" step="1" required></label>${this.dates()}<label>补货备注<input name="note" required maxlength="500" placeholder="实际收到并可用的重量"></label><button class="btn btn-primary">确认补货入库</button></form>`:''}
    </div><p id="inv-write-status" role="status"></p></details>
    <details><summary>日期与活动预期</summary><p>人工设置优先于假日日历。可确认零销量、闭馆日或活动当天杯数。</p><form data-inventory-action="calendar" class="inventory-form-grid"><label>日期<input type="date" name="date" required value="${r.today}"></label><label>日期类型<select name="type"><option value="weekday">周中／调休工作日</option><option value="weekend">周末</option><option value="holiday">节假日</option><option value="closed">闭馆日</option></select></label><label>预计咖啡杯数（可留空）<input name="cups" type="number" min="0" max="10000" step="1"></label><label>调整原因<input name="note" required maxlength="180" placeholder="活动、闭馆或销量预期"></label><button class="btn btn-primary">保存日期预期</button></form><div class="inventory-overrides">${Object.entries(this._data.overrides).sort().map(([date,v])=>`<p>${e(date)} · ${e(({weekday:'周中',weekend:'周末',holiday:'节假日',closed:'闭馆'})[v.type])} ${v.cups!=null?e(v.cups)+'杯':''} · ${e(v.note)} <button class="btn btn-sm btn-secondary" onclick="InventoryInbox.resetDate('${date}')">恢复自动判断</button></p>`).join('')}</div></details>
    <details><summary>预测规则</summary><p>每杯 20 克、配送 60 小时固定。适饮天数请结合供应商建议和实际品鉴填写；未填写时不声称已校验新鲜度。</p><form id="inv-settings" class="inventory-form-grid"><label>到货后覆盖<select name="targetDays">${[5,6,7].map(n=>`<option ${c.targetDays===n?'selected':''} value="${n}">${n} 天</option>`).join('')}</select></label>${[['packGrams','每袋重量（克）',20,20000],['freshDays','烘焙后适饮天数',1,90],['openDays','开袋后适饮天数',1,90],['arrivalAgeDays','预计到货时豆龄（天）',0,90],['openHour','每日开门时刻（0—23）',0,23],['closeHour','每日关门时刻（1—24）',1,24]].map(([key,label,min,max])=>`<label>${label}<input type="number" name="${key}" min="${min}" max="${max}" step="${['openHour','closeHour'].includes(key)?0.5:1}" value="${c[key]??''}" ${['openHour','closeHour'].includes(key)?'required':''}></label>`).join('')}<label>不耗豆的咖啡分类商品（每行一个）<textarea name="excludedNames" ${r.initialized?'readonly':''} placeholder="如柠檬茶；初始化库存前设置">${e((c.excludedNames||[]).join('\n'))}</textarea></label><button class="btn btn-primary">保存规则</button></form><p>套票暂按每套一杯计耗豆。启用库存后扣豆商品口径锁定，避免追溯改动造成错误库存。</p></details></div>`;
  },
  receive(id){const order=this._data.orders.find(o=>o.id===id);document.getElementById('inv-stock-tools').open=true;const f=document.getElementById('inv-receive');f.elements.orderId.value=id;f.elements.grams.value=order.grams;document.getElementById('inv-receive-note').textContent='正在关联订单，确认后按实际重量入库并结束此订单；分批到货请先调整采购记录。';f.scrollIntoView({behavior:'smooth',block:'center'});f.elements.grams.focus();},
  editOrder(id,action){
    const root=document.querySelector('.inventory-detail');root.innerHTML=`<h3>${action==='cancel'?'取消在途订单':'更新预计到货'}</h3><form data-inventory-action="${action}" class="inventory-form-grid"><input type="hidden" name="orderId" value="${id}">${action==='reschedule'?'<label>新的到货时间<input name="eta" type="datetime-local" required></label>':''}<label>操作原因<input name="note" required maxlength="500"></label><button class="btn btn-primary">确认保存</button><button type="button" class="btn btn-secondary" onclick="InventoryInbox.paint()">返回</button></form>`;root.querySelector('form').addEventListener('submit',event=>this.submit(event));
  },
  async resetDate(date){await this.write({action:'calendar',date,reset:true});},
  async submit(event){event.preventDefault();const f=event.currentTarget,data=Object.fromEntries(new FormData(f));data.action=f.dataset.inventoryAction;for(const k of ['grams','cups'])if(k in data)data[k]=data[k]===''?null:Number(data[k]);if(data.eta)data.eta=new Date(data.eta+'+08:00').toISOString();await this.write(data);},
  async settings(event){event.preventDefault();const raw=Object.fromEntries(new FormData(event.currentTarget)),config={};for(const [key,value]of Object.entries(raw))config[key]=key==='excludedNames'?value.split('\n').map(s=>s.trim()).filter(Boolean):value===''?null:Number(value);await this.write({action:'settings',config});},
  async write(data){
    if(this._busy)return;this._busy=true;
    const buttons=[...document.querySelectorAll('#page-inventory button')];buttons.forEach(b=>b.disabled=true);
    // Keep the same key after a lost response; a refresh must not silently replay a new purchase.
    const payloadKey=JSON.stringify(data);
    if(!this._request||this._request.key!==payloadKey)this._request={key:payloadKey,requestId:crypto.randomUUID(),version:this._data.version};
    try{await Store._request('POST','/rest/v1/coffee-inventory',{...data,requestId:this._request.requestId,version:this._request.version});this._request=null;UI.toast('库存记录已保存','success');await this.render();}
    catch(error){UI.toast(error.message,'error');const status=document.getElementById('inv-write-status');if(status)status.textContent=error.message;if(error.message.includes('库存已由')){this._request=null;await this.render();}}
    finally{this._busy=false;buttons.forEach(b=>b.disabled=false);}
  }
};
