'use strict';
// One order, independent receipts and execution. No receipt is inserted on confirmation.
Object.assign(UI,{
 async _openSpaceExecution(id){
  try{
   const [data,project]=await Promise.all([Store._request('GET','/rest/v1/space-accounting?id='+encodeURIComponent(id)),Store.getById('space',id)]);
   if(!project)throw Error('场地订单不存在');
   document.getElementById('space-execution-modal')?.remove();
   const modal=document.createElement('div');modal.id='space-execution-modal';modal.className='modal-overlay';modal.dataset.project=id;
   const esc=v=>this._escHtml(v),fmt=v=>this._fmt(v),editable=Auth.can('edit','space'),admin=Auth.currentUser?.role==='admin'||Auth.getUser?.()?.role==='admin';
   const p=data.projects.find(r=>r.id===id)||{};
   modal.innerHTML=`<div class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-label="场地使用与执行" style="display:block;height:auto;width:min(900px,calc(100vw - 32px));max-height:92vh;overflow:auto"><div class="modal-title">${esc(project.projectName)} · 使用与执行</div>
    <p class="form-hint">收款按到账日进入日结；已执行收入按确认后的使用日期进入经营日报、周报、月报。确认执行不会新增收款。可退押金请勿计入租金。</p>
    <div class="rent-stat-grid">${[['合同金额',project.receivableAmount],['累计已收',p.received],['累计已执行',p.earned],['已收未执行',p.receivedUnexecuted],['已执行未收',p.executedUnpaid],['未分配使用日期',p.unallocatedContract]].map(([k,v])=>`<div class="stat-card"><div class="stat-label">${k}</div><div class="stat-value">¥${fmt(v)}</div></div>`).join('')}</div>
    <p class="form-hint">余额截至 ${esc(data.end)}，每笔订单分别计算。历史已完成状态不会自动生成已执行收入，请依据合同和实际使用补齐明细。</p>
    <div class="table-wrap"><table class="data-table" style="min-width:620px"><thead><tr><th>使用日期</th><th>归属金额</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>${data.lines.map(l=>`<tr><td>${esc(l.usageDate)}</td><td>¥${fmt(l.amount)}</td><td>${({planned:'待执行',confirmed:'已执行',voided:'已作废'})[l.status]}</td><td>${esc(l.voidReason||l.notes||'—')}</td><td>${editable&&l.status==='planned'?`<button class="btn btn-sm btn-primary" data-id="${esc(l.id)}" onclick="UI._spaceExecutionAction('confirm',this.dataset.id,this)">确认执行</button> `:''}${editable&&l.status!=='voided'&&(l.status==='planned'||admin)?`<button class="btn btn-sm btn-secondary" data-id="${esc(l.id)}" onclick="UI._spaceExecutionAction('void',this.dataset.id,this)">作废/改期</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5">尚未安排使用明细，待依据合同核对。</td></tr>'}</tbody></table></div>
    ${editable?`<div class="card" style="margin-top:16px"><div class="card-title">安排使用明细</div><p class="form-hint">分散使用可逐场添加；连续使用按天均分，余分从首日依次分配。保存安排后仍需在实际执行时确认。改期先作废原明细再新增。</p><div class="form-grid">
    <div class="form-group"><label>安排方式</label><select id="se-mode"><option value="single">单场使用</option><option value="continuous">连续使用，按天分摊</option></select></div>
    <div class="form-group"><label>使用/开始日期</label><input id="se-start" type="date" value="${esc(project.date)}"></div>
    <div class="form-group"><label>结束日期（连续使用）</label><input id="se-end" type="date" value="${esc(project.endDate||project.date)}"></div>
    <div class="form-group"><label>本场或本段总金额</label><input id="se-amount" type="number" min="0" step="0.01" value="${fmt(p.unallocatedContract)}"></div>
    <div class="form-group full"><label>计价或分摊说明</label><input id="se-notes" maxlength="500" placeholder="例如：合同约定每场金额；连续使用按天分摊"></div></div>
    <button class="btn btn-primary" onclick="UI._spaceExecutionSchedule(this)">保存使用安排</button></div>`:''}
    ${admin?`<div class="card"><div class="card-title">登记实际退款</div><p class="form-hint">仅在退款已发生后登记。原收款保留，退款按实际日期扣减收款；执行金额须按实际履约另行核对。</p><div class="form-grid"><div class="form-group"><label>原收款</label><select id="se-refund-payment">${(project.payments||[]).filter(p=>Number(p.amount)>0).map(p=>`<option value="${esc(p.id)}">${esc(p.paymentDate)} · ¥${fmt(p.amount)}</option>`).join('')}</select></div><div class="form-group"><label>退款日期</label><input id="se-refund-date" type="date" value="${todayStr()}"></div><div class="form-group"><label>退款金额</label><input id="se-refund-amount" type="number" min="0.01" step="0.01"></div><div class="form-group"><label>退款原因</label><input id="se-refund-reason" maxlength="500"></div></div><button class="btn btn-secondary" onclick="UI._spaceRefund(this)">登记已发生的退款</button></div>`:''}
    <div class="modal-actions"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button></div></div>`;
   document.body.appendChild(modal);
  }catch(e){this.toast(e.message||'执行明细加载失败','error');}
 },
 async _spaceExecutionSchedule(button){
  const modal=document.getElementById('space-execution-modal'),id=modal.dataset.project,start=document.getElementById('se-start').value,end=document.getElementById('se-end').value,amount=Number(document.getElementById('se-amount').value),mode=document.getElementById('se-mode').value;
  const body={action:'schedule',mode,start,end,amount,lines:[{date:start,amount}],notes:document.getElementById('se-notes').value};
  button.disabled=true;try{await Store._request('POST','/rest/v1/space-accounting?id='+encodeURIComponent(id),body);this.toast('使用安排已保存，尚未计入已执行收入');await this._openSpaceExecution(id);await this._loadSpaceAccountingSummary();}catch(e){this.toast(e.message,'error');}finally{button.disabled=false;}
 },
 async _spaceExecutionAction(action,lineId,button){
  const id=document.getElementById('space-execution-modal').dataset.project,body={action,lineId};
  if(action==='void'){body.reason=prompt('请填写作废或改期原因。原记录会保留，已执行金额将从原使用日撤回。');if(!body.reason)return;}
  button.disabled=true;try{await Store._request('POST','/rest/v1/space-accounting?id='+encodeURIComponent(id),body);this.toast(action==='confirm'?'已确认执行，按使用日期计入经营收入':'原使用明细已作废并留痕');await this._openSpaceExecution(id);await this._loadSpaceAccountingSummary();}catch(e){this.toast(e.message,'error');}finally{button.disabled=false;}
 },
 async _spaceRefund(button){
  const modal=document.getElementById('space-execution-modal'),id=modal.dataset.project;
  modal.dataset.refundId=modal.dataset.refundId||crypto.randomUUID();
  const body={action:'refund',refundId:modal.dataset.refundId,paymentId:document.getElementById('se-refund-payment').value,date:document.getElementById('se-refund-date').value,amount:Number(document.getElementById('se-refund-amount').value),reason:document.getElementById('se-refund-reason').value};
  button.disabled=true;try{await Store._request('POST','/rest/v1/space-accounting?id='+encodeURIComponent(id),body);this.toast('实际退款已登记，原收款记录保留');await this._openSpaceExecution(id);await this._loadSpaceAccountingSummary();await this._refreshGanttAndStats();}catch(e){this.toast(e.message,'error');}finally{button.disabled=false;}
 },
 async _loadSpaceAccountingSummary(){
  const el=document.getElementById('space-accounting-summary');if(!el)return;
  try{const d=await Store._request('GET','/rest/v1/space-accounting');el.innerHTML=`<div class="card-title">场地经营与收款 · ${this._escHtml(d.start.slice(0,7))}</div><div class="rent-stat-grid">${[['本月已执行收入',d.executed],['本月实际收款',d.receipts],['期末已收未执行',d.receivedUnexecuted],['期末已执行未收',d.executedUnpaid]].map(([k,v])=>`<div class="stat-card"><div class="stat-label">${k}</div><div class="stat-value">¥${this._fmt(v)}</div></div>`).join('')}</div><p class="form-hint">截至 ${this._escHtml(d.end)}。收入与收款分别统计，不可相加；期末余额不按日累加。${d.pendingDays?'有 '+d.pendingDays+' 条到期使用明细待确认。':''}${d.legacyUnverified.count?'旧口径场地款 ¥'+this._fmt(d.legacyUnverified.amount)+' 缺执行日期，待核对，未计入已执行收入。':''}请在订单的“使用与执行”中安排日期和金额。</p>`;}catch(e){el.textContent='场地经营口径加载失败：'+e.message;}
 }
});
