'use strict';
const crypto=require('node:crypto'),schema=require('./app/js/space-project-schema'),document=require('./space-contract-document'),accounting=require('./space-accounting');
const text=(v,max=6000)=>{if(v===undefined||v===null)return '';if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('文本内容无效或过长');return v.trim();};
const date=v=>{if(v)accounting.date(v);return v||'';};
function sanitize(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('请提供项目填报信息');
 const p={terms:{},payments:[],publicity:[],tasks:[],expenseIds:[]};
 for(const [key,,type,options]of schema.fields){let v=text(input.terms?.[key],type==='text'?6000:1000);if(type==='date')date(v);if(type==='money'&&v&&(!/^\d+(\.\d{1,2})?$/.test(v)||Number(v)>999999999))throw Error('金额须为非负数，最多两位小数');if(options&&v&&!options.includes(v))throw Error('选项无效');p.terms[key]=v;}
 for(const [a,b]of [['exhibitStart','exhibitEnd'],['setupStart','setupEnd'],['strikeStart','strikeEnd']])if(p.terms[a]&&p.terms[b]&&p.terms[b]<p.terms[a])throw Error('结束日期不能早于开始日期');
 for(const key of ['owner','source','nextAction','nextDate','notes','review','feedback','followup','confirmationEvidence'])p[key]=text(input[key]);date(p.nextDate);
 for(const key of ['payments','publicity','tasks','expenseIds'])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>100))throw Error('明细最多100条');
 p.payments=(input.payments||[]).map(r=>{const amount=Number(r.amount);if(!Number.isFinite(amount)||amount<0||amount>999999999||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw Error('付款金额无效');return {amount,dueDate:date(text(r.dueDate,10)),trigger:text(r.trigger,500),notes:text(r.notes,1000)};});
 p.publicity=(input.publicity||[]).map(r=>Object.fromEntries(['point','material','quantity','width','height','unit','orientation','period','responsibilities','specification'].map(k=>[k,text(r[k],k==='specification'?2000:1000)])));
 p.tasks=(input.tasks||[]).map(r=>({id:text(r.id,100)||crypto.randomUUID(),title:text(r.title,500),owner:text(r.owner,200),dueDate:date(text(r.dueDate,10)),status:['待办','进行中','已完成','不适用'].includes(r.status)?r.status:'待办',evidence:text(r.evidence,2000)}));
 p.expenseIds=[...new Set((input.expenseIds||[]).map(x=>text(x,100)))];
 return p;
}
function defaults(project){return {terms:{projectName:project.project_name,venueName:'艾维美术馆',spaceName:project.space,exhibitStart:project.date,exhibitEnd:project.end_date||project.date,totalAmount:String(project.receivable_amount||''),contractNo:project.contract_no||''},owner:project.project_owner||'',payments:[],publicity:[],tasks:[],expenseIds:[]};}
module.exports={sanitize,defaults};
module.exports.handler=({pool,getRequester,ensureRole,sendJSON,sendError,toCamel})=>async(req,res,q)=>{
 let db;try{
  const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor']))return;
  if(!['GET','POST'].includes(req.method))return sendError(res,405,'仅支持查询及保存');
  db=await pool.connect();
  if(req.method==='GET'&&!q.id){const rows=(await db.query('SELECT space_usage_id,version,payload,updated_at FROM space_project_workflows ORDER BY updated_at DESC')).rows;return sendJSON(res,200,{workflows:rows.map(toCamel)});}
  const id=text(q.id,100);if(!id)throw Error('请选择项目');
  if(req.method==='GET'){
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const project=(await db.query('SELECT * FROM space_usage WHERE id=$1',[id])).rows[0];if(!project)return await db.query('ROLLBACK').then(()=>sendError(res,404,'项目不存在'));
   const workflow=(await db.query('SELECT * FROM space_project_workflows WHERE space_usage_id=$1',[id])).rows[0];
   const documents=(await db.query('SELECT id,revision,template_version,source_version,created_at FROM space_contract_documents WHERE space_usage_id=$1 ORDER BY revision DESC',[id])).rows;
   if(q.document){const doc=(await db.query('SELECT * FROM space_contract_documents WHERE id=$1 AND space_usage_id=$2',[String(q.document),id])).rows[0];if(!doc)return await db.query('ROLLBACK').then(()=>sendError(res,404,'合同版本不存在'));await db.query('COMMIT');
    if(q.format){if(!['docx','pdf'].includes(q.format))throw Error('文件格式无效');const content=q.format==='pdf'?await document.pdf(doc.snapshot):document.docx(doc.snapshot);res.writeHead(200,{'Content-Type':q.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="space-contract-v${doc.revision}.${q.format}"; filename*=UTF-8''${encodeURIComponent((doc.snapshot.terms.projectName||'项目')+'-合同草稿-v'+doc.revision+'.'+q.format)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(content);}
    return sendJSON(res,200,{document:toCamel(doc),preview:document.model(doc.snapshot)});
   }
   const expenses=(await db.query('SELECT e.id,e.date,e.amount,e.category,e.description,e.reimbursement_status FROM expense e JOIN space_project_expenses l ON l.expense_id=e.id WHERE l.space_usage_id=$1 ORDER BY e.date',[id])).rows;
   const events=(await db.query("SELECT action,version,created_at,after_payload->>'notes' notes,after_payload->>'nextAction' next_action FROM space_project_workflow_events WHERE space_usage_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30",[id])).rows;
   await db.query('COMMIT');const payload=workflow?.payload||defaults(project);return sendJSON(res,200,{project:toCamel(project),version:workflow?.version||0,payload,documents:documents.map(toCamel),expenses:expenses.map(toCamel),events:events.map(toCamel),opportunity:schema.isOpportunity(project),templateVersion:schema.version,preview:document.model(payload)});
  }
  let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>400000)throw Error('填报内容过大');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  if(!['save','generate','confirm-cooperation'].includes(body.action))throw Error('操作无效');
  await db.query('BEGIN');
  const project=(await db.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!project)throw Error('项目不存在');
  const old=(await db.query('SELECT * FROM space_project_workflows WHERE space_usage_id=$1 FOR UPDATE',[id])).rows[0];
  if(body.version!==(old?.version||0)){const e=Error('资料已被其他人更新，请刷新后核对');e.status=409;throw e;}
  let saved;
  if(body.action==='save'){
   const payload=sanitize(body.payload);if(old?.payload.confirmation)payload.confirmation=old.payload.confirmation;
   if(payload.expenseIds.length){const valid=(await db.query("SELECT id FROM expense WHERE id=ANY($1::text[]) AND COALESCE(type,'运营支出')<>'备用金借入' AND (reimbursement_status IS NULL OR reimbursement_status<>$2)",[payload.expenseIds,'已作废'])).rows;if(valid.length!==payload.expenseIds.length)throw Error('所选支出不存在或已作废');}
   await db.query('DELETE FROM space_project_expenses WHERE space_usage_id=$1',[id]);for(const eid of payload.expenseIds)await db.query('INSERT INTO space_project_expenses(space_usage_id,expense_id,linked_by) VALUES($1,$2,$3)',[id,eid,user.id]);
   saved=(await db.query('INSERT INTO space_project_workflows(space_usage_id,payload,version,updated_by) VALUES($1,$2,1,$3) ON CONFLICT(space_usage_id) DO UPDATE SET payload=excluded.payload,version=space_project_workflows.version+1,updated_by=excluded.updated_by,updated_at=now() RETURNING *',[id,JSON.stringify(payload),user.id])).rows[0];
  }else if(body.action==='generate'){
   if(!old)throw Error('请先保存合同填报信息');
   if(!/^[a-f0-9-]{36}$/i.test(String(body.requestId||'')))throw Error('生成请求标识无效');
   const exists=(await db.query('SELECT * FROM space_contract_documents WHERE id=$1',[body.requestId])).rows[0];
   if(exists){if(exists.space_usage_id!==id||exists.source_version!==old.version)throw Error('生成请求标识已使用');await db.query('COMMIT');return sendJSON(res,200,{document:toCamel(exists),unchanged:true});}
   const revision=Number((await db.query('SELECT COALESCE(MAX(revision),0)+1 revision FROM space_contract_documents WHERE space_usage_id=$1',[id])).rows[0].revision);
   saved=(await db.query('INSERT INTO space_contract_documents(id,space_usage_id,revision,template_version,snapshot,source_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[body.requestId,id,revision,schema.version,JSON.stringify({...old.payload,_documentCreatedAt:new Date().toISOString()}),old.version,user.id])).rows[0];
  }else{
   if(user.role!=='admin')return await db.query('ROLLBACK').then(()=>sendError(res,403,'仅管理员可确认合作'));
   if(!schema.isOpportunity(project))throw Error('该项目已是正式或历史合作，请通过变更流程核对');
   const f=old?.payload?.terms;if(!f)throw Error('请先保存合同条件');
   for(const key of ['partyAName','partyBName','contractNo','exhibitStart','exhibitEnd','totalAmount'])if(!String(f[key]||'').trim())throw Error('请补齐签约主体、合同编号、展期和正式金额');
   const evidence=text(body.evidence,2000);if(!evidence||body.confirmed!==true)throw Error('请明确确认已取得签约或合作依据并填写凭据位置');
   if(!project.space)throw Error('请先在登记信息中确认空间');
   const formalAmount=Number(f.totalAmount);if(project.rental_type==='付费'&&formalAmount<=0)throw Error('付费合作须有正式金额');
   if(project.rental_type==='免费'&&formalAmount!==0)throw Error('免费合作的正式金额应为零');
   if(formalAmount>0&&((old.payload.payments||[]).length===0||Math.round(old.payload.payments.reduce((n,p)=>n+p.amount,0)*100)!==Math.round(formalAmount*100)||(old.payload.payments||[]).some(p=>!p.dueDate&&!p.trigger)))throw Error('请先核对付款节点、到期条件及合计金额');
   if(body.documentId){const doc=(await db.query('SELECT source_version FROM space_contract_documents WHERE id=$1 AND space_usage_id=$2',[body.documentId,id])).rows[0];if(!doc||doc.source_version!==old.version)throw Error('所选合同草稿已过期，请核对最新版本');}
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['space-booking:'+project.space]);
   const conflict=(await db.query("SELECT id FROM space_usage WHERE space=$1 AND status IN ('已确认','进行中') AND date<=$2 AND COALESCE(NULLIF(end_date,''),date)>=$3 AND id<>$4 LIMIT 1",[project.space,f.exhibitEnd,f.exhibitStart,id])).rows[0];if(conflict)throw Error('正式展期与现有预约冲突，请先核对');
   const changed={...project,date:f.exhibitStart,end_date:f.exhibitEnd,receivable_amount:formalAmount};await accounting.guardProject(db,changed);
   const absolute=(old.payload.payments||[]).map(p=>p.dueDate).filter(Boolean).sort()[0]||'';
   await db.query("UPDATE space_usage SET business_status='已签约',status='已确认',contract_no=$2,receivable_amount=$3,date=$4,end_date=$5,expected_payment_date=$6,project_owner=$7 WHERE id=$1",[id,f.contractNo,formalAmount,f.exhibitStart,f.exhibitEnd,absolute,old.payload.owner||project.project_owner||'']);
   const payload={...old.payload,confirmation:{evidence,documentId:body.documentId||'',by:user.id,at:new Date().toISOString()}};
   saved=(await db.query('UPDATE space_project_workflows SET payload=$2,version=version+1,updated_by=$3,updated_at=now() WHERE space_usage_id=$1 RETURNING *',[id,JSON.stringify(payload),user.id])).rows[0];
  }
  await db.query('INSERT INTO space_project_workflow_events(id,space_usage_id,action,version,before_payload,after_payload,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),id,body.action,saved.version||old.version,old?JSON.stringify(old.payload):null,JSON.stringify(saved.payload||saved.snapshot),user.id]);
  await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),user.id,'space_workflow_'+body.action,'space_project_workflows',id,JSON.stringify({previousVersion:old?.version||0,version:saved.version||old.version,documentId:body.action==='generate'?saved.id:null,templateVersion:schema.version})]);
  await db.query('COMMIT');return sendJSON(res,body.action==='generate'?201:200,body.action==='generate'?{document:toCamel(saved),missing:document.model(saved.snapshot).missing}:{version:saved.version,payload:saved.payload,saved:true});
 }catch(e){await db?.query('ROLLBACK').catch(()=>{});return sendError(res,e.status||(e.code==='23505'?409:400),e.code==='23505'?'该支出已关联其他项目或版本重复，请刷新核对':e.message);}finally{db?.release();}
};
