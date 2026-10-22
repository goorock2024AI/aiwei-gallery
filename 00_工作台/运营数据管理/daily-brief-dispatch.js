'use strict';
const core=require('./daily-brief-core');
function webhook(config=process.env){const value=config.DAILY_WECOM_WEBHOOK;if(!value)return null;let u;try{u=new URL(value);}catch{throw Error('群推送地址无效');}
 if(u.protocol!=='https:'||u.hostname!=='qyapi.weixin.qq.com'||u.pathname!=='/cgi-bin/webhook/send'||!u.searchParams.get('key')||u.username||u.password||u.port)throw Error('仅支持企业微信官方群消息推送地址');return {url:u.href,channel:core.hash(u.href)};}
const {text:summary}=require('./daily-brief-template');
async function send(pool,row,{config=process.env,fetcher=fetch,now=new Date()}={}){
 if(config.DAILY_SEND_ENABLED!=='true')return {state:'disabled'};
 if(row.business_date!==core.day(now))throw Error('自动发送仅限当日日报；历史修订不会自动补发');
 // Keep all entry points on the date-level outbox; no parallel brief-id sender remains.
 return require('./daily-brief-lifecycle').service({pool,config,fetcher,now}).run(row.business_date,{initial:true});
}
module.exports={webhook,summary,send};
