'use strict';
const crypto=require('node:crypto'),store=require('./daily-brief-store'),core=require('./daily-brief-core');
function webhook(config=process.env){const value=config.DAILY_WECOM_WEBHOOK;if(!value)return null;let u;try{u=new URL(value);}catch{throw Error('群推送地址无效');}
 if(u.protocol!=='https:'||u.hostname!=='qyapi.weixin.qq.com'||u.pathname!=='/cgi-bin/webhook/send'||!u.searchParams.get('key')||u.username||u.password||u.port)throw Error('仅支持企业微信官方群消息推送地址');return {url:u.href,channel:core.hash(u.href)};}
const {text:summary}=require('./daily-brief-template');
async function send(pool,row,{config=process.env,fetcher=fetch,now=new Date()}={}){
 if(config.DAILY_SEND_ENABLED!=='true')return {state:'disabled'};const target=webhook(config);if(!target)return {state:'not_configured'};
 if(row.business_date!==core.day(now))throw Error('自动发送仅限当日日报；历史修订不会自动补发');
 const outcomes=[];
 // Group delivery is text-only until the redesigned image is approved.
 for(const part of ['text']){
  const db=await pool.connect();let dispatch;
  try{await db.query('BEGIN');await db.query("INSERT INTO operations_daily_dispatch(brief_id,channel_hash,part,state) VALUES($1,$2,$3,'retry') ON CONFLICT DO NOTHING",[row.id,target.channel,part]);
   dispatch=(await db.query('SELECT * FROM operations_daily_dispatch WHERE brief_id=$1 AND channel_hash=$2 AND part=$3 FOR UPDATE',[row.id,target.channel,part])).rows[0];
   if(dispatch.state==='sending'){await db.query("UPDATE operations_daily_dispatch SET state='uncertain',last_code='interrupted' WHERE brief_id=$1 AND channel_hash=$2 AND part=$3",[row.id,target.channel,part]);dispatch.state='uncertain';}
   if(['accepted','uncertain','failed'].includes(dispatch.state)||dispatch.attempts>=3||dispatch.next_attempt_at&&+new Date(dispatch.next_attempt_at)>+now){await db.query('COMMIT');outcomes.push({part,state:dispatch.state});if(dispatch.state!=='accepted')break;continue;}
   await db.query("UPDATE operations_daily_dispatch SET state='sending',attempts=attempts+1,updated_at=NOW() WHERE brief_id=$1 AND channel_hash=$2 AND part=$3",[row.id,target.channel,part]);await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  let state='uncertain',code='network_unknown';
  try{
   const image=part==='image'?store.read(row,'png'):null;
   const body=part==='text'?{msgtype:'text',text:{content:summary(row.payload)}}:{msgtype:'image',image:{base64:image.toString('base64'),md5:crypto.createHash('md5').update(image).digest('hex')}};
   const response=await fetcher(target.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(response.ok){const result=await response.json();code=String(result.errcode);state=result.errcode===0?'accepted':result.errcode===45009?'retry':'failed';}
   else if(response.status>=400&&response.status<500){state='failed';code='http_'+response.status;}
  }catch{/* Do not log credential-bearing URLs. Unknown delivery is not safe to retry blindly. */}
  await pool.query("UPDATE operations_daily_dispatch SET state=$4,last_code=$5,next_attempt_at=CASE WHEN $4='retry' THEN NOW()+interval '5 minutes' ELSE NULL END,updated_at=NOW() WHERE brief_id=$1 AND channel_hash=$2 AND part=$3",[row.id,target.channel,part,state,code]);outcomes.push({part,state});if(state!=='accepted')break;
 }
 return {state:outcomes.length===1&&outcomes.every(r=>r.state==='accepted')?'accepted':'attention',parts:outcomes};
}
module.exports={webhook,summary,send};
