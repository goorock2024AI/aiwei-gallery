'use strict';
(async()=>{
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const add=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
 Auth.init();window.opener=null;
 let data,run,busy=false,dirty=false,loadedStart='',pendingRequest=null,previewHTML='',unsentText=null;
 const reportStates={prepared:'资料已准备，等待Agent整理补充并分析',analyzed:'周报草稿已完成，待您阅读复核',reviewed:'周报已复核，待发布',published:'周报已发布'};
 const kinds={operator_report:'运营人员陈述，尚未独立核实',opinion:'个人判断',hypothesis:'猜测 / 待验证原因',proposal:'想法与建议',needs_confirmation:'需要确认'};
 const deliveries={pending:'等待投递',sending:'投递处理中',accepted:'接口已接受',retry:'等待有限重试',failed:'发送失败',uncertain:'投递不确定',suppressed:'仅归档'};
 const status=(message,error=false)=>{$('weekly-status').textContent=message;$('weekly-status').classList.toggle('error',error);};
 function controls(){const ready=!!run?.analysis,editable=run?.state!=='published';for(const id of ['weekly-start','weekly-input','weekly-load','weekly-submit'])$(id).disabled=busy;$('weekly-open').disabled=busy||!ready;$('weekly-download').disabled=busy||!run;$('weekly-import').disabled=busy||!run||!editable;$('weekly-publish').disabled=busy||dirty||!Auth.isAdmin||!ready||!['analyzed','reviewed'].includes(run.state);}
 function loginRequired(){if(dirty)unsentText={start:$('weekly-start').value,text:$('weekly-input').value};data=null;run=null;dirty=false;previewHTML='';$('weekly-workspace').hidden=true;$('weekly-auth').hidden=false;$('weekly-preview').srcdoc='';$('weekly-print-report').replaceChildren();}
 async function request(method,body){const base=await Store._ensureClient(),response=await fetch(base+'/rest/v1/weekly-management'+(method==='GET'?'?start='+encodeURIComponent($('weekly-start').value):''),{method,headers:{'Content-Type':'application/json',...Auth.authHeaders()},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok){if(response.status===401)loginRequired();throw Error(value.message||value.error||'请求未完成，请重试');}return value;}
 async function execute(task){if(busy)return;busy=true;controls();status('正在处理…');try{await task();}catch(e){status(e.message,true);}finally{busy=false;controls();}}
 const date=new Date(),monday=new Date(date);monday.setDate(date.getDate()-((date.getDay()+6)%7)-7);$('weekly-start').value=[monday.getFullYear(),String(monday.getMonth()+1).padStart(2,'0'),String(monday.getDate()).padStart(2,'0')].join('-');
 const selectedWeek=new URLSearchParams(location.search).get('start');if(selectedWeek&&/^\d{4}-\d{2}-\d{2}$/.test(selectedWeek)&&new Date(selectedWeek+'T12:00:00Z').getUTCDay()===1)$('weekly-start').value=selectedWeek;
 function allowDiscard(){return !dirty||window.confirm('这段补充尚未提交，确定放弃修改吗？');}
 function renderReport(){const report=run?.analysis?.report;$('weekly-preview').hidden=true;$('weekly-preview').srcdoc='';$('weekly-cleaned').hidden=true;$('weekly-report-summary').replaceChildren();$('weekly-print-report').replaceChildren();previewHTML='';
  if(!report){$('weekly-draft-status').textContent=run?'补充和业务资料已保存，等待Agent先整理、再完成经营分析。当前由Codex发起处理，页面不会自行生成。':'提交补充后，由Agent读取业务数据并撰写周报。';$('weekly-review-hint').textContent='收入、指标、预测和下周行动由Agent整理，您无需填写。';return;}
  $('weekly-draft-status').textContent=run.state==='published'?'已发布周报，历史内容保留。':'请阅读草稿。若需修改，可在上面的补充框写下意见并重新提交。';
  const weekly=report.weekly;$('weekly-report-summary').innerHTML='<p class="readonly">'+esc(report.summary)+'</p>'+(weekly?.overviewRows?'<table class="core-table"><caption>五项核心经营数据</caption><tbody>'+weekly.overviewRows.map(row=>'<tr><th scope="row">'+esc(row[0])+'</th><td>'+esc(row[1])+'<br><span class="hint">'+esc(row[2])+'</span></td></tr>').join('')+'</tbody></table>':'');
  const view={id:run.report_id||'待发布草稿',title:report.title,reportType:'weekly',startDate:run.payload.current.start,endDate:run.payload.current.end,compareStart:run.payload.previous?.start,compareEnd:run.payload.previous?.end,publishedAt:null,content:report,sha256:run.payload.sha256,sourceCreatedAt:run.payload.generatedAt};
  previewHTML=OperationsReportLayout.render(view);$('weekly-print-report').innerHTML='<style>'+OperationsReportLayout.css+'</style>'+OperationsReportLayout.content(view);
  const cleaned=run.analysis.analysis?.operatorInputReview;if(cleaned){$('weekly-cleaned').hidden=false;$('weekly-cleaned-items').innerHTML=cleaned.items.map(item=>'<div class="review-item"><strong>'+esc(kinds[item.kind])+'</strong><p class="readonly">'+esc(item.interpretation)+'</p><p class="source-quote">原话：'+esc(item.sourceExcerpt)+'</p></div>').join('');}
  $('weekly-review-hint').textContent=run.state==='published'?'已发布内容不能原地修改；补充新意见将建立新的修订资料。':Auth.isAdmin?'点击“确认复核并发布”表示您已经阅读并同意本份周报；资料不完整或发生变化时，系统会阻止发布。':'请由管理员阅读、复核并发布。';
 }
 async function load(){const start=$('weekly-start').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||new Date(start+'T12:00:00Z').getUTCDay()!==1)throw Error('请选择周一');data=await request('GET');run=data.runs[0];loadedStart=start;dirty=false;pendingRequest=null;$('weekly-auth').hidden=true;$('weekly-workspace').hidden=false;
  $('weekly-range').textContent=start+' 至 '+add(start,6);$('weekly-input').value=data.operatorInput?.text||'';$('weekly-input-state').textContent=data.operatorInput?'上次提交：'+time(data.operatorInput.submittedAt)+'；可直接改写后重新提交。':'没有补充也可以直接提交。';
  $('weekly-previous').innerHTML=(data.previous||[]).flatMap(r=>(r.actions||[]).slice(0,3).map((a,i)=>'<p>'+esc(i+1)+'. '+esc(a.action)+'</p>')).join('')||'<p class="hint">没有上期已发布行动。</p>';
  $('weekly-progress').innerHTML='<p class="short-status">'+esc(run?reportStates[run.state]:'尚未提交本周补充')+'</p>'+(data.todos||[]).map(t=>'<p class="hint">'+esc(t)+'</p>').join('');
  $('weekly-history').innerHTML=data.operatorInput?'<p>原文已保存，时间：'+esc(time(data.operatorInput.submittedAt))+'。每次重新提交保留版本，不覆盖原文与旧周报。</p>':'<p>尚无运营补充记录。</p>';
  $('weekly-delivery').innerHTML=data.delivery.map(d=>'<p>群摘要：'+esc(deliveries[d.state]||d.state)+(d.state==='uncertain'?'，需先人工核对，不能盲目重发。':'')+'</p>').join('')||'<p class="hint">尚无群摘要投递记录。</p>';renderReport();controls();
 }
 $('weekly-login').onsubmit=e=>{e.preventDefault();execute(async()=>{await Auth.login($('weekly-username').value.trim(),$('weekly-password').value);$('weekly-password').value='';if(Auth.currentUser.needPasswordChange){location.href='index.html';return;}await load();if(unsentText?.start===$('weekly-start').value){$('weekly-input').value=unsentText.text;dirty=true;pendingRequest=null;unsentText=null;status('已登录，未提交的补充已恢复，请继续提交。');}else status('已登录，只需填写一段补充。');});};
 $('weekly-input').oninput=()=>{dirty=true;pendingRequest=null;controls();$('weekly-input-state').textContent='尚未提交；原文将完整保存。';};
 $('weekly-start').onchange=()=>{if(!allowDiscard()){$('weekly-start').value=loadedStart;return;}run=null;dirty=false;pendingRequest=null;$('weekly-report-summary').replaceChildren();$('weekly-preview').hidden=true;$('weekly-print-report').replaceChildren();$('weekly-input').value='';$('weekly-previous').replaceChildren();$('weekly-progress').textContent='周次已变更，请查看进度或提交这周的补充。';$('weekly-range').textContent=$('weekly-start').value+' 至 '+add($('weekly-start').value,6);$('weekly-history').replaceChildren();$('weekly-delivery').replaceChildren();renderReport();controls();};
 $('weekly-load').onclick=()=>{if(allowDiscard())execute(async()=>{await load();status('进度已更新。');});};
 $('weekly-submit').onclick=()=>execute(async()=>{pendingRequest??=crypto.randomUUID();await request('POST',{action:'submit-input',start:$('weekly-start').value,text:$('weekly-input').value,requestId:pendingRequest});await load();status('原文已保存，资料已准备，等待Agent整理并分析。');});
 $('weekly-open').onclick=()=>{$('weekly-preview').srcdoc=previewHTML;$('weekly-preview').hidden=!$('weekly-preview').hidden;if(!$('weekly-preview').hidden)$('weekly-preview').scrollIntoView({behavior:'smooth',block:'start'});};
 $('weekly-publish').onclick=()=>execute(async()=>{if(dirty)throw Error('补充尚未提交，请先提交并由Agent重新分析');if(run.state==='analyzed'){await request('POST',{action:'review',id:run.id,confirmed:true});run.state='reviewed';}await Store._request('POST','/rest/v1/operations-reports',{...run.analysis.report,action:'publish',runId:run.id});await load();status('周报已正式发布，群摘要状态保留在提交记录中。');});
 $('weekly-download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='周报资料-'+run.start_date+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('weekly-import').onchange=()=>execute(async()=>{const file=$('weekly-import').files[0];if(!file||file.size>190000)throw Error('请选择小于190KB的Agent稿件');if(dirty)throw Error('请先提交修改后的运营补充，再由Agent重新处理');const draft=JSON.parse(await file.text());await request('POST',{...draft,action:'analyze',id:run.id});await load();status('Agent整理与经营分析已保存，等待管理员阅读复核。');});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 if(Auth.currentUser?.token)await execute(load);else{loginRequired();status('请先登录，登录后只需填写一段补充。');}
})();
