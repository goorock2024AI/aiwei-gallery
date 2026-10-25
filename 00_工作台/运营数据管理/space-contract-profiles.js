'use strict';
const crypto=require('node:crypto');
const KEY='space_contract_profiles';
const organizationKeys=['partyAName','partyACode','partyAAddress','partyAContact','partyAEmail','accountText'];
const venueKeys=['venueName','venueAddress'];
const fixedKeys=[...organizationKeys,...venueKeys];
const empty=()=>({version:0,organizations:[],venues:[]});
async function load(db){return (await db.query('SELECT value FROM app_config WHERE key=$1',[KEY])).rows[0]?.value||empty();}
function clean(input){
 const out={organizations:[],venues:[]};
 for(const [kind,keys]of [['organizations',organizationKeys],['venues',venueKeys]]){
  if(!Array.isArray(input[kind])||input[kind].length>30)throw Error('基础资料每类最多30项');
  const ids=new Set();
  out[kind]=input[kind].map(r=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)||ids.has(r.id))throw Error('资料标识无效或重复');ids.add(r.id);const terms={};for(const key of keys){const v=r.terms?.[key]||'';if(typeof v!=='string'||v.length>2000||/[\x00-\x1f]/.test(v))throw Error('基础资料内容无效');terms[key]=v.trim();}if(!terms[keys[0]])throw Error('请填写主体或场馆名称');return {id:r.id,terms};});
 }
 return out;
}
function apply(payload,catalog,previous){
 const sel=payload.profileSelection;
 if(!sel){for(const key of fixedKeys)payload.terms[key]=previous?.terms?.[key]||'';return payload;}
 if(sel.version!==catalog.version){const e=Error('合同基础资料已更新，请重新打开项目后选择并核对');e.status=409;throw e;}
 for(const [kind,idKey,keys]of [['organizations','organizationId',organizationKeys],['venues','venueId',venueKeys]]){
  if(!sel[idKey]){for(const key of keys)payload.terms[key]=previous?.terms?.[key]||'';continue;}
  const item=catalog[kind].find(r=>r.id===sel[idKey]);if(!item)throw Error('所选主体或场馆已移除，请重新选择');
  for(const key of keys)payload.terms[key]=item.terms[key]||'';
 }
 payload.profileSelection={organizationId:sel.organizationId||'',venueId:sel.venueId||'',version:catalog.version};return payload;
}
async function handle({req,res,db,user,sendJSON,sendError}){
 if(req.method==='GET')return sendJSON(res,200,await load(db));
 if(user.role!=='admin')return sendError(res,403,'仅管理员可维护合同基础资料');
 let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>160000)throw Error('基础资料过大');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[KEY]);const before=await load(db);
 if(body.version!==before.version){const e=Error('基础资料已被其他人更新，请重新打开核对');e.status=409;throw e;}
 const value={...clean(body),version:before.version+1};
 await db.query('INSERT INTO app_config(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()',[KEY,JSON.stringify(value)]);
 await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),user.id,'space_contract_profiles_update','app_config',KEY,JSON.stringify({before,after:value})]);await db.query('COMMIT');return sendJSON(res,200,value);
}
module.exports={KEY,load,apply,handle,fixedKeys,organizationKeys,venueKeys};
