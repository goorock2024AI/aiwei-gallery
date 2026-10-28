'use strict';
const crypto=require('node:crypto'),booking=require('./space-booking'),accounting=require('./space-accounting'),recordPayment=require('./space-payment');
const text=(v,max=500)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('填报内容无效或过长');return v.trim();};
function clean(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('请填写简易租赁信息');
 const p={space:text(input.space||'',100),client:text(input.client||'',200),contact:text(input.contact||'',200),phone:text(input.phone||'',100),notes:text(input.notes||'',2000),startAt:booking.timestamp(input.startAt),endAt:booking.timestamp(input.endAt),amount:Number(input.amount)};
 if(!p.space||!p.client)throw Error('请选择场地并填写客户名称');if(p.endAt<=p.startAt)throw Error('结束时间必须晚于开始时间');
 if(accounting.cents(p.amount)<=0)throw Error('经营性租赁金额必须大于0');
 if((Date.parse(p.endAt+'+08:00')-Date.parse(p.startAt+'+08:00'))/86400000>366)throw Error('简易流程仅支持366天以内的使用安排');
 return p;
}
module.exports=({pool,getRequester,ensureRole,sendJSON,sendError,toCamel})=>async(req,res,q={})=>{
 let db;try{
  const user=await getRequester(req);if(!ensureRole(res,user,req.method==='GET'?['admin','editor','viewer']:['admin','editor']))return;
  if(!['GET','POST'].includes(req.method))return sendError(res,405,'仅支持查询和简易租赁操作');
  db=await pool.connect();
  if(req.method==='GET'){
   if(!q.id){const rows=(await db.query('SELECT space_usage_id,mode,start_at,end_at,version,completed_at FROM space_quick_rentals ORDER BY start_at DESC')).rows;return sendJSON(res,200,{rentals:rows.map(toCamel)});}
   const row=(await db.query('SELECT * FROM space_quick_rentals WHERE space_usage_id=$1',[q.id])).rows[0];if(!row)return sendError(res,404,'简易租赁不存在');
   const project=(await db.query('SELECT * FROM space_usage_with_payments WHERE id=$1',[q.id])).rows[0];
   delete row.initial_request_hash;if(user.role==='viewer'){delete row.client_contact;delete row.client_phone;}
   return sendJSON(res,200,{rental:toCamel(row),project:toCamel(project)});
  }
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('填报内容过大');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  if(!['create','save','payment','convert','complete'].includes(body.action))throw Error('简易流程操作无效');
  const id=text(String(q.id||body.id||''),100);if(!id)throw Error('租赁标识缺失，请重新打开表单');
  await db.query('BEGIN');
  // Serialize both create retries and edits before touching an existing project lock.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['space-quick:'+id]);
  let project=(await db.query('SELECT * FROM space_usage WHERE id=$1 FOR UPDATE',[id])).rows[0];
  const projectBefore=project?{...project}:null;
  const old=(await db.query('SELECT * FROM space_quick_rentals WHERE space_usage_id=$1 FOR UPDATE',[id])).rows[0];
  let payment=null,saved;
  if(body.action==='create'||body.action==='save'){
   const p=clean(body.project),paymentInput=body.payment||null;
   const requestHash=crypto.createHash('sha256').update(JSON.stringify({project:p,payment:paymentInput})).digest('hex');
   if(body.action==='create'&&old){if(old.initial_request_hash!==requestHash){const e=Error('此登记标识已使用，请刷新核对');e.status=409;throw e;}await db.query('COMMIT');return sendJSON(res,200,{id,unchanged:true});}
   if(body.action==='create'&&project)throw Error('该项目已有完整流程登记，不能覆盖');
   if(body.action==='save'&&(!old||old.mode!=='simple'))throw Error('请在对应的完整流程中维护此项目');
   if(body.action==='save'&&body.version!==old.version){const e=Error('租赁资料已更新，请重新打开核对');e.status=409;throw e;}
   const spaces=(await db.query("SELECT value FROM app_config WHERE key='spaces'")).rows[0]?.value;
   if(!Array.isArray(spaces)||!spaces.some(s=>(typeof s==='string'?s:s.name)===p.space))throw Error('请选择已维护的使用场地');
   if(old?.completed_at&&(p.startAt!==old.start_at||p.endAt!==old.end_at||p.amount!==Number(project.receivable_amount)||p.space!==project.space))throw Error('已确认使用的日期、场地及金额不能直接改动，请转完整流程核对执行记录');
   if(project?.status==='已取消')throw Error('已取消租赁不能直接修改');
   const next={...(project||{}),id,date:p.startAt.slice(0,10),end_date:p.endAt.slice(0,10),space:p.space,receivable_amount:p.amount,rental_type:'付费',business_type_code:'space_rental',status:project?.status||'已确认',business_status:project?.business_status||'租赁确认'};
   if(project)await accounting.guardProject(db,next);
   if(next.status!=='已完成')await booking.guard(db,{id,space:p.space,start:p.startAt,end:p.endAt});
   if(!project)project=(await db.query("INSERT INTO space_usage(id,date,end_date,space,project_name,type,client,status,rental_type,receivable_amount,business_layer_code,business_type_code,cooperation_mode,project_owner,business_status,notes) VALUES($1,$2,$3,$4,$5,'场地租赁',$6,'已确认','付费',$7,'art_transaction_cooperation','space_rental','租赁',$8,'租赁确认',$9) RETURNING *",[id,next.date,next.end_date,p.space,'短租 · '+p.client+' · '+next.date,p.client,p.amount,user.display_name||user.username||'',p.notes])).rows[0];
   else project=(await db.query('UPDATE space_usage SET date=$2,end_date=$3,space=$4,client=$5,receivable_amount=$6,notes=$7,project_name=$8 WHERE id=$1 RETURNING *',[id,next.date,next.end_date,p.space,p.client,p.amount,p.notes,'短租 · '+p.client+' · '+next.date])).rows[0];
   saved=(await db.query(`INSERT INTO space_quick_rentals(space_usage_id,start_at,end_at,client_contact,client_phone,initial_request_hash,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(space_usage_id) DO UPDATE SET start_at=excluded.start_at,end_at=excluded.end_at,client_contact=excluded.client_contact,client_phone=excluded.client_phone,version=space_quick_rentals.version+1,updated_by=excluded.updated_by,updated_at=now() RETURNING *`,[id,p.startAt,p.endAt,p.contact,p.phone,requestHash,user.id])).rows[0];
   if(paymentInput){if(body.action!=='create')throw Error('后续收款请单独登记，避免重复录入');payment=await recordPayment(db,user,project,paymentInput);}
  }else{
   if(!old||!project)throw Error('简易租赁不存在');
   if(body.action==='convert'&&old.mode==='full'){await db.query('COMMIT');return sendJSON(res,200,{id,unchanged:true});}
   if(old.mode!=='simple')throw Error('此租赁已转完整流程，请从项目工作台继续');
   if(body.action==='payment'){
    if(!body.payment||typeof body.payment!=='object')throw Error('请填写实际收款');payment=await recordPayment(db,user,project,body.payment);saved=old;
   }else{
    if(body.action==='complete'&&old.completed_at){await db.query('COMMIT');return sendJSON(res,200,{id,unchanged:true});}
    if(body.version!==old.version){const e=Error('租赁资料已更新，请重新打开核对');e.status=409;throw e;}
    if(body.action==='convert'){
     saved=(await db.query("UPDATE space_quick_rentals SET mode='full',converted_at=now(),updated_by=$2,updated_at=now(),version=version+1 WHERE space_usage_id=$1 RETURNING *",[id,user.id])).rows[0];
    }else{
     if(old.completed_at){await db.query('COMMIT');return sendJSON(res,200,{id,unchanged:true});}
     if(project.status==='已取消')throw Error('已取消租赁不能确认使用');
     if(Date.parse(old.end_at+'+08:00')>Date.now())throw Error('使用结束后才能确认已完成');
     if((await db.query("SELECT 1 FROM space_execution_lines WHERE space_usage_id=$1 AND status<>'voided' LIMIT 1",[id])).rowCount)throw Error('已有使用明细，请从使用与执行中核对');
     const end=old.end_at.endsWith('T00:00')?new Date(Date.parse(old.end_at.slice(0,10)+'T00:00:00Z')-86400000).toISOString().slice(0,10):old.end_at.slice(0,10);
     for(const line of accounting.split(old.start_at.slice(0,10),end,Number(project.receivable_amount)))await db.query("INSERT INTO space_execution_lines(id,space_usage_id,usage_date,amount,status,notes,confirmed_by,confirmed_at) VALUES($1,$2,$3,$4,'confirmed','简易租赁确认实际使用；跨日按天分摊',$5,now())",[crypto.randomUUID(),id,line.date,line.amount,user.id]);
     await db.query("UPDATE space_usage SET status='已完成' WHERE id=$1",[id]);
     saved=(await db.query('UPDATE space_quick_rentals SET completed_at=now(),updated_by=$2,updated_at=now(),version=version+1 WHERE space_usage_id=$1 RETURNING *',[id,user.id])).rows[0];
    }
   }
  }
  if(!payment?.unchanged)await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),user.id,'space_quick_'+body.action,'space_quick_rentals',id,JSON.stringify({before:old||null,after:saved,projectBefore,project,paymentId:payment?.payment.id||null})]);
  await db.query('COMMIT');return sendJSON(res,body.action==='create'?201:200,{id,rental:toCamel(saved),...(payment?{payment:toCamel(payment.payment),remainingAmount:payment.remainingAmount,unchanged:!!payment.unchanged}:{})});
 }catch(e){await db?.query('ROLLBACK').catch(()=>{});return sendError(res,e.status||(e.code==='23505'?409:400),e.code==='23505'?'此登记或收款已存在，请刷新核对':e.message);}finally{db?.release();}
};
