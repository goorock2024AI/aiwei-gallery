'use strict';
const SpaceDates={
 state:null,
 async edit(id){
  if(!Auth.can('edit','space'))return UI.toast('当前账号只可查看使用安排','error');
  try{const [project,data]=await Promise.all([Store.getById('space',id),Store._request('GET','/rest/v1/space-accounting?id='+encodeURIComponent(id))]);
   if(!project)throw Error('项目不存在');
   this.state={id,project,version:data.scheduleVersion,lines:data.lines,selected:new Set(data.lines.filter(l=>l.status!=='voided').map(l=>l.usageDate)),locked:new Set(data.lines.filter(l=>l.status==='confirmed').map(l=>l.usageDate)),month:project.date.slice(0,7)};
   SpaceProjects.modal('space-date-picker','选择使用日期 · '+project.projectName,`<p class="form-hint">合同范围 ${SpaceProjects.esc(project.date)} 至 ${SpaceProjects.esc(project.endDate||project.date)}。勾选实际使用日，未勾选日不占用。合同金额与收款不变；保存只安排日期，不自动确认收入。已确认执行的日期保留并锁定。</p><label for="sd-month">查看月份</label><input id="sd-month" type="month" min="${project.date.slice(0,7)}" max="${(project.endDate||project.date).slice(0,7)}" value="${project.date.slice(0,7)}" onchange="SpaceDates.month(this.value)"><div class="modal-actions"><button class="btn btn-secondary" onclick="SpaceDates.bulk('weekends')">勾选本月周六、周日</button><button class="btn btn-secondary" onclick="SpaceDates.bulk('all')">勾选本月全部日期</button><button class="btn btn-secondary" onclick="SpaceDates.bulk('clear')">清除本月未执行日期</button></div><div id="sd-calendar"></div><div id="sd-summary" class="form-hint" aria-live="polite"></div><label for="sd-reason">安排／修改原因</label><textarea id="sd-reason" rows="2" maxlength="500" placeholder="例如：按合同约定仅使用本月周末"></textarea><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('space-date-picker').remove()">关闭</button><button class="btn btn-primary" onclick="SpaceDates.save(this)">保存所选日期</button></div>`);
   this.render();
  }catch(e){UI.toast(e.message,'error');}
 },
 month(value){const s=this.state;if(value<s.project.date.slice(0,7)||value>(s.project.endDate||s.project.date).slice(0,7))return; s.month=value;this.render();},
 days(){const s=this.state,[y,m]=s.month.split('-').map(Number);return Array.from({length:new Date(y,m,0).getDate()},(_,i)=>s.month+'-'+String(i+1).padStart(2,'0'));},
 allowed(d){return d>=this.state.project.date&&d<=(this.state.project.endDate||this.state.project.date);},
 render(){const s=this.state,days=this.days(),offset=(new Date(days[0]+'T12:00:00Z').getUTCDay()+6)%7;
  document.getElementById('sd-calendar').innerHTML=`<div class="date-selection-grid">${['一','二','三','四','五','六','日'].map(w=>`<div class="date-weekday">${w}</div>`).join('')}${'<div></div>'.repeat(offset)}${days.map(d=>`<label class="date-choice${s.selected.has(d)?' selected':''}${s.locked.has(d)?' locked':''}"><input type="checkbox" data-date="${d}" ${s.selected.has(d)?'checked':''} ${!this.allowed(d)||s.locked.has(d)?'disabled':''} onchange="SpaceDates.toggle(this.dataset.date,this.checked)"><span>${Number(d.slice(8))}</span>${s.locked.has(d)?'<small>已使用</small>':''}</label>`).join('')}</div>`;
  const fixed=s.lines.filter(l=>l.status==='confirmed').reduce((n,l)=>n+Math.round(Number(l.amount)*100),0),remaining=Math.round(Number(s.project.receivableAmount)*100)-fixed,dates=[...s.selected].sort(),todo=dates.filter(d=>!s.locked.has(d));
  const amount=(d)=>s.locked.has(d)?s.lines.find(l=>l.status==='confirmed'&&l.usageDate===d).amount:(Math.floor(remaining/todo.length)+(todo.indexOf(d)<remaining%todo.length?1:0))/100;
  document.getElementById('sd-summary').innerHTML=`<p>已选 <strong>${dates.length}</strong> 天 · 合同总额 ${SpaceProjects.money(s.project.receivableAmount)} · 已确认 ${s.locked.size} 天。未执行部分按剩余金额均分，尾差按日期顺序分配。</p><div class="date-selection-preview">${dates.map(d=>`<span>${d} · ${SpaceProjects.money(amount(d))}${s.locked.has(d)?'（已使用）':''}</span>`).join('')||'尚未选择使用日期'}</div>`;
 },
 toggle(date,checked){if(!this.allowed(date)||this.state.locked.has(date))return;if(checked)this.state.selected.add(date);else this.state.selected.delete(date);this.render();},
 bulk(mode){for(const d of this.days()){if(!this.allowed(d)||this.state.locked.has(d))continue;const w=new Date(d+'T12:00:00Z').getUTCDay();if(mode==='clear')this.state.selected.delete(d);else if(mode==='all'||w===0||w===6)this.state.selected.add(d);}this.render();},
 async refresh(){if(document.getElementById('page-space')?.classList.contains('active'))await SpaceProjects.render();},
 async save(button){const s=this.state;if(!s.selected.size)return UI.toast('请至少勾选一个使用日期','error');const reason=document.getElementById('sd-reason').value.trim();if(!reason)return UI.toast('请填写安排或修改原因','error');button.disabled=true;
  try{await Store._request('POST','/rest/v1/space-accounting?id='+encodeURIComponent(s.id),{action:'selectDates',dates:[...s.selected].sort(),version:s.version,reason});document.getElementById('space-date-picker').remove();UI.toast('使用日期已保存，原合同和收款保留');try{if(document.getElementById('space-execution-modal')?.dataset.project===s.id)await UI._openSpaceExecution(s.id);await this.refresh();}catch(e){UI.toast('使用日期已保存，请刷新页面查看最新安排','error');}}catch(e){UI.toast(e.message,'error');}finally{button.disabled=false;}
 }
};
