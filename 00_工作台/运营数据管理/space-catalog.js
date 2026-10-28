'use strict';
const crypto=require('node:crypto');
const text=(v,max)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('空间名称或说明无效');return v.trim();};
function normalize(value){return (Array.isArray(value)?value:[]).map(r=>{if(typeof r==='string')r={name:r};return {id:r.id||'legacy-'+crypto.createHash('sha256').update(r.name).digest('hex').slice(0,24),name:r.name,desc:r.desc||'',halfDayPrice:Number(r.halfDayPrice)||0,dailyPrice:Number(r.dailyPrice)||0,active:r.active!==false};});}
function clean(input){
 if(!Array.isArray(input)||input.length>100)throw Error('空间清单最多100项');const ids=new Set(),names=new Set();
 return input.map(r=>{const name=text(r.name,100),desc=text(r.desc||'',2000),id=text(r.id,80);if(!name||!/^[a-z0-9-]+$/i.test(id)||ids.has(id)||names.has(name.toLowerCase()))throw Error('空间名称或标识为空、重复或无效');ids.add(id);names.add(name.toLowerCase());
 for(const k of ['halfDayPrice','dailyPrice'])if(typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0||r[k]>999999999||Math.abs(r[k]*100-Math.round(r[k]*100))>0.00001)throw Error('参考租金须为非负金额，最多两位小数');
 if(typeof r.active!=='boolean')throw Error('请选择有效的启停状态');return {id,name,desc,halfDayPrice:r.halfDayPrice,dailyPrice:r.dailyPrice,active:r.active};});
}
async function load(db){const r=(await db.query("SELECT value,updated_at::text version FROM app_config WHERE key='spaces'")).rows[0];return {version:r?.version||null,spaces:normalize(r?.value)};}
async function usage(db){return new Map((await db.query('SELECT space,count(*)::int count FROM space_usage GROUP BY space')).rows.map(r=>[r.space,r.count]));}
async function guardSelection(db,name,previousName,strict=false){
 if(!name||name===previousName)return;
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['space-catalog']);
 const list=(await load(db)).spaces,row=list.find(s=>s.name===name);
 if((strict&&!row)||row?.active===false)throw Error(row?'该空间已停用，请选择其他可租赁空间':'请选择已维护的使用场地');
}
module.exports={load,guardSelection};
module.exports.handler=({pool,getRequester,ensureRole,sendJSON,sendError})=>async(req,res)=>{
 let db;try{
  const user=await getRequester(req);if(!ensureRole(res,user,req.method==='GET'?['admin','editor','viewer']:['admin']))return;
  if(!['GET','POST'].includes(req.method))return sendError(res,405,'请通过空间管理保存资料');db=await pool.connect();
  if(req.method==='GET'){const catalog=await load(db),counts=await usage(db);return sendJSON(res,200,{...catalog,spaces:catalog.spaces.map(r=>({...r,usedCount:counts.get(r.name)||0}))});}
  let size=0,chunks=[];for await(const b of req){size+=b.length;if(size>300000)throw Error('空间资料过大');chunks.push(b);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const spaces=clean(body.spaces);await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['space-catalog']);const before=await load(db);
  if(body.version!==before.version){const e=Error('空间资料已被其他人更新，请重新打开后核对');e.status=409;throw e;}
  const counts=await usage(db),next=new Map(spaces.map(r=>[r.id,r]));
  for(const old of before.spaces)if((counts.get(old.name)||0)>0&&(!next.has(old.id)||next.get(old.id).name!==old.name))throw Error('已有租赁记录的空间不能删除或更名，请停用原空间并新增空间');
  const saved=(await db.query("INSERT INTO app_config(key,value,updated_at) VALUES('spaces',$1,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp() RETURNING updated_at::text version",[JSON.stringify(spaces)])).rows[0];
  await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),user.id,'space_catalog_update','app_config','spaces',JSON.stringify({before,after:{version:saved.version,spaces}})]);
  await db.query('COMMIT');return sendJSON(res,200,{version:saved.version,spaces:spaces.map(r=>({...r,usedCount:counts.get(r.name)||0}))});
 }catch(e){await db?.query('ROLLBACK').catch(()=>{});return sendError(res,e.status||400,e.message);}finally{db?.release();}
};
