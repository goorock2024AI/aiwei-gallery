'use strict';
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const engine=require('./coffee-forecast');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function number(v,min,max,label) { if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail(`${label}超出有效范围`);return v; }
function date(v,label,optional=false){if(optional&&(v==null||v===''))return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw fail(`${label}无效`);return v;}
function time(v,label){if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(`${label}需有效时间和时区`);return new Date(v).toISOString();}
function text(v,max,label){if(typeof v!=='string'||!v.trim()||v.length>max)throw fail(`${label}不能为空且不能超过${max}字`);return v.trim();}
function lot(data,now,grams,id){
 const today=engine.dateKey(now),roastDate=date(data.roastDate,'烘焙日期',true),openedDate=date(data.openedDate,'开袋日期',true),bestBefore=date(data.bestBefore,'适饮截止日',true);
 if(roastDate&&roastDate>today||openedDate&&openedDate>today)throw fail('烘焙或开袋日期不能晚于今天');
 if(roastDate&&openedDate&&openedDate<roastDate||roastDate&&bestBefore&&bestBefore<roastDate)throw fail('批次日期前后顺序不正确');
 return {id,grams,roastDate,openedDate,bestBefore,receivedAt:now};
}
function apply(state,data,rows,now,user) {
 state.config={...engine.DEFAULTS,...state.config}; state.orders ||= [];state.lots ||= [];state.overrides ||= {};
 const id=data.requestId,action=data.action,today=engine.dateKey(now);
 if(action==='settings'){
  if(!data.config||typeof data.config!=='object'||Array.isArray(data.config))throw fail('缺少配置');
  const allowed=['targetDays','packGrams','freshDays','openDays','arrivalAgeDays','openHour','closeHour','excludedNames'];
  for(const key of Object.keys(data.config))if(!allowed.includes(key))throw fail('不支持的配置字段：'+key);
  const c={...state.config,...data.config};
  if(![5,6,7].includes(c.targetDays))throw fail('覆盖天数请选择5、6或7天');
  for(const [key,min,max]of [['packGrams',20,20000],['freshDays',1,90],['openDays',1,90],['arrivalAgeDays',0,90]])if(c[key]!=null){number(c[key],min,max,key);if(!Number.isInteger(c[key]))throw fail('配置数值需为整数');}
  number(c.openHour,0,23,'开门时间');number(c.closeHour,1,24,'关门时间');if(c.closeHour<=c.openHour)throw fail('关门时间应晚于开门时间');
  if(!Array.isArray(c.excludedNames)||c.excludedNames.length>100||c.excludedNames.some(n=>typeof n!=='string'||n.length>100))throw fail('排除商品名称无效');
  if(state.anchor&&JSON.stringify(c.excludedNames)!==JSON.stringify(state.config.excludedNames))throw fail('启用库存后不能追溯修改扣豆口径；请先联系管理员核对盘点方案');
  state.config=c;
 }else if(action==='count'){
  const grams=number(data.grams,0,1000000,'盘点重量');text(data.note,500,'盘点原因');
  const daily=engine.dailySales(rows,state.config);
  state.anchor={date:today,at:now,baselineCups:daily[today]||0};
  state.lots=[lot(data,now,grams,id)];
 }else if(action==='order'){
  if(!state.anchor)throw fail('请先初始化库存');
  const grams=number(data.grams,1,1000000,'订购重量'),eta=time(data.eta,'预计到货时间');
  if(Date.parse(eta)<=Date.parse(now)||Date.parse(eta)>Date.parse(now)+90*86400000)throw fail('预计到货时间应在未来90天内');
  state.orders.push({id,grams,eta,status:'pending',note:text(data.note,500,'采购备注'),createdAt:now,createdBy:user.id});
 }else if(action==='receive'){
  if(!state.anchor)throw fail('请先初始化库存');
  const grams=number(data.grams,1,1000000,'实际到货重量');
  if(data.orderId){const order=state.orders.find(o=>o.id===data.orderId);if(!order||order.status!=='pending')throw fail('该订单已处理或不存在',409);order.status='received';order.receivedGrams=grams;order.receivedAt=now;}
  text(data.note,500,'补货备注');state.lots.push(lot(data,now,grams,id));
 }else if(action==='cancel'||action==='reschedule'){
  const order=state.orders.find(o=>o.id===data.orderId);if(!order||order.status!=='pending')throw fail('该订单已处理或不存在',409);
  text(data.note,500,'操作原因');
  if(action==='cancel'){order.status='cancelled';order.cancelledAt=now;}else{order.eta=time(data.eta,'预计到货时间');if(Date.parse(order.eta)<=Date.parse(now))throw fail('到货时间应晚于现在');}
 }else if(action==='calendar'){
  const d=date(data.date,'日期');if(d<engine.addDays(today,-365)||d>engine.addDays(today,365))throw fail('日期需在前后一年内');
  if(data.reset===true)delete state.overrides[d];
  else {if(!['weekday','weekend','holiday','closed'].includes(data.type))throw fail('日期类型无效');
   const value={type:data.type,note:text(data.note,180,'调整原因')};
   if(data.cups!=null)value.cups=number(data.cups,0,10000,'预计杯数');state.overrides[d]=value;}
 }else throw fail('不支持的操作');
 return state;
}
function readBody(req){return new Promise((resolve,reject)=>{let body='',size=0;req.setEncoding('utf8');req.on('data',s=>{size+=Buffer.byteLength(s);if(size>65536)reject(fail('请求过大',413));else body+=s;});req.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(fail('JSON格式无效'));}});req.on('error',reject);});}
module.exports=({pool,getRequester,ensureRole,sendJSON,sendError})=>async function(req,res){
 let db;
 try{
  const user=await getRequester(req);if(!ensureRole(res,user,['admin','editor','viewer']))return;
  if(!['GET','POST'].includes(req.method))throw fail('不支持的请求方式',405);
  if(req.method==='POST'&&!ensureRole(res,user,['admin','editor']))return;
  const data=req.method==='POST'?await readBody(req):null;
  if(data && (!data||typeof data!=='object'||Array.isArray(data)))throw fail('请求需为对象');
  if(req.method==='POST'&&(!data||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId||'')))throw fail('缺少有效幂等请求编号');
  db=await pool.connect();await db.query(req.method==='POST'?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const current=(await db.query("SELECT * FROM coffee_inventory_state WHERE id='coffee'"+(data?' FOR UPDATE':''))).rows[0];
  if(!current)throw fail('库存功能尚未初始化，请联系管理员',503);
  if(data){const old=(await db.query('SELECT request_id,actor_id,payload FROM coffee_inventory_events WHERE request_id=$1',[data.requestId])).rows[0];
   if(old){if(old.actor_id!==user.id||!isDeepStrictEqual(old.payload,data))throw fail('请求编号已用于其他操作',409);await db.query('COMMIT');return sendJSON(res,200,{ok:true,replayed:true,version:current.version});}
   if(data.version!==current.version)throw fail('库存已由其他人更新，请刷新后再提交',409);
  }
  const now=new Date().toISOString(),today=engine.dateKey(now),state=current.payload;
  const since=state.anchor?.date && state.anchor.date<engine.addDays(today,-168)?state.anchor.date:engine.addDays(today,-168);
  const rows=(await db.query('SELECT id,date,coffee_qty,combo_qty,coffee_items,status FROM revenue WHERE date >= $1 AND date <= $2 ORDER BY date,created_at,id',[since,today])).rows;
  if(data){
   apply(state,data,rows,now,user);
   await db.query("UPDATE coffee_inventory_state SET payload=$1::jsonb,version=version+1,updated_at=NOW() WHERE id='coffee'",[JSON.stringify(state)]);
   await db.query('INSERT INTO coffee_inventory_events(request_id,actor_id,actor_name,action,payload,state_version) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[data.requestId,user.id,user.displayName||user.username,data.action,JSON.stringify(data),current.version+1]);
   await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[crypto.randomUUID(),user.id,'coffee_'+data.action,'coffee_inventory_state','coffee',JSON.stringify({requestId:data.requestId,version:current.version+1})]);
   await db.query('COMMIT');return sendJSON(res,200,{ok:true,version:current.version+1});
  }
  const events=(await db.query('SELECT request_id,actor_name,action,payload,created_at FROM coffee_inventory_events ORDER BY state_version DESC LIMIT 100')).rows;
  const result=engine.forecast(state,rows,now);
  await db.query('COMMIT');sendJSON(res,200,{version:current.version,result,orders:state.orders||[],overrides:state.overrides||{},events,canWrite:['admin','editor'].includes(user.role)});
 }catch(error){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('Coffee inventory:',error.message);sendError(res,error.status||500,error.status?error.message:'库存提醒暂不可用，请稍后重试');}finally{db?.release();}
};
module.exports.apply=apply;
