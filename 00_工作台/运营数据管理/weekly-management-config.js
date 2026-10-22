'use strict';
const fs=require('node:fs');
// The API and worker read the same protected configuration; never return webhook data to the UI.
function read(env=process.env){
 const keys=['WEEKLY_PREPARE_ENABLED','WEEKLY_SEND_ENABLED','WEEKLY_USE_DAILY_CHANNEL','WEEKLY_WECOM_WEBHOOK'];
 const config={WEEKLY_PREPARE_ENABLED:'false',WEEKLY_SEND_ENABLED:'false',WEEKLY_USE_DAILY_CHANNEL:'true'};
 const file=env.WEEKLY_CONFIG_FILE||'/run/aiwei-config/weekly-management.json';
 if(fs.existsSync(file)){const saved=JSON.parse(fs.readFileSync(file,'utf8'));for(const [key,value]of Object.entries(saved)){if(!keys.includes(key)||!['string','boolean'].includes(typeof value))throw Error('周报配置无效');config[key]=String(value);}}
 for(const key of keys)if(env[key]!=null)config[key]=String(env[key]);
 for(const key of keys.slice(0,3))if(!['true','false'].includes(config[key]))throw Error('周报开关配置无效');
 if(config.WEEKLY_SEND_ENABLED==='true'&&config.WEEKLY_USE_DAILY_CHANNEL==='true'){
  const daily=env.DAILY_CONFIG_FILE||'/run/aiwei-config/daily-brief.json';
  config.DAILY_WECOM_WEBHOOK=env.DAILY_WECOM_WEBHOOK||(fs.existsSync(daily)?JSON.parse(fs.readFileSync(daily,'utf8')).DAILY_WECOM_WEBHOOK:undefined);
 }
 return config;
}
module.exports={read};
