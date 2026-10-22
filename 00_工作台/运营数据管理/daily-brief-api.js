'use strict';
const core=require('./daily-brief-core'),store=require('./daily-brief-store');
module.exports=({pool,getRequester,ensureRole,sendJSON,sendError})=>async(req,res,q)=>{
 try{const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor','viewer']))return;
  if(req.method!=='GET')return sendError(res,405,'日报通过已授权定时服务生成，本接口只读');
  if(q.status==='1'){
   if(!ensureRole(res,user,['admin','editor']))return;
   const date=core.validateDate(q.date||core.day(new Date()));
   const followup=(await pool.query('SELECT business_date,detail,updated_at FROM operations_daily_followup WHERE business_date=$1',[date])).rows[0]||null;
   const incidents=(await pool.query('SELECT business_date,code,detail,state,reminder_state,first_seen_at,last_seen_at,resolved_at FROM operations_daily_incidents WHERE business_date=$1 ORDER BY first_seen_at',[date])).rows;
   const delivery=(await pool.query('SELECT id,kind,sequence,brief_id,baseline_id,state,attempts,last_code,next_attempt_at,accepted_at,created_at FROM operations_daily_outbox WHERE business_date=$1 ORDER BY created_at,id',[date])).rows;
   const attempts=(await pool.query('SELECT a.outbox_id,a.attempt_number,a.started_at,a.completed_at,a.state,a.code FROM operations_daily_attempts a JOIN operations_daily_outbox o ON o.id=a.outbox_id WHERE o.business_date=$1 ORDER BY a.started_at',[date])).rows;
   return sendJSON(res,200,{date,followup,incidents,delivery,attempts,memberReceipt:'未确认，接口接受不等于成员实际收到',reminder:'独立提醒渠道及负责人待配置'});
  }
  if(q.week){if(!ensureRole(res,user,['admin','editor']))return;return sendJSON(res,200,await store.weekly(pool,q.week));}
  if(q.id){if(!/^[a-f0-9-]{36}$/.test(q.id))return sendError(res,400,'日报编号无效');const row=(await pool.query('SELECT * FROM operations_daily_briefs WHERE id=$1',[q.id])).rows[0];if(!row)return sendError(res,404,'日报不存在');
   if(q.format){if(!['html','png'].includes(q.format))return sendError(res,400,'格式无效');let bytes;try{bytes=store.read(row,q.format);}catch{return sendError(res,503,'日报文件暂不可用');}
    res.writeHead(200,{'Content-Type':q.format==='html'?'text/html;charset=utf-8':'image/png','Content-Disposition':`attachment; filename="daily-${row.business_date}-v${row.revision}.${q.format}"`,'Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});return res.end(bytes);}
   const {finance,...payload}=row.payload;if(!['admin','editor'].includes(user.role))delete payload.sourceHash;return sendJSON(res,200,{id:row.id,revision:row.revision,...payload});
  }
  if(q.date)core.validateDate(q.date);const limit=Number(q.limit||20);if(!Number.isInteger(limit)||limit<1||limit>50)return sendError(res,400,'分页数量无效');
  const rows=(await pool.query(`SELECT DISTINCT ON(business_date) id,business_date,revision,payload->'finalized' finalized,created_at FROM operations_daily_briefs ${q.date?'WHERE business_date=$2':''} ORDER BY business_date DESC,revision DESC LIMIT $1`,q.date?[limit,q.date]:[limit])).rows;
  sendJSON(res,200,{reports:rows});
 }catch(e){sendError(res,400,'日报请求失败，请检查日期或功能初始化状态');}
};
