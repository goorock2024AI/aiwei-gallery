'use strict';
const fs=require('node:fs'),{Pool}=require('pg'),core=require('./daily-brief-core'),store=require('./daily-brief-store'),rules=require('./daily-brief-policy'),loop=require('./daily-brief-lifecycle');
async function run(){
 const file=process.env.DAILY_CONFIG_FILE||'/run/aiwei-config/daily-brief.json';
 if(fs.existsSync(file)){
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  const allowed=new Set(['DAILY_BRIEF_ENABLED','DAILY_SEND_ENABLED','DAILY_WECOM_WEBHOOK','DAILY_WEATHER_HOST','DAILY_WEATHER_KEY','DAILY_WEATHER_LAT','DAILY_WEATHER_LON','DAILY_MODEL_ENABLED','DAILY_MODEL_BASE','DAILY_MODEL_NAME','DAILY_MODEL_KEY','DAILY_CORRECTION_POLICY','DAILY_REMINDER_OWNER']);
  for(const [k,v]of Object.entries(config)){if(!allowed.has(k))throw Error('日报配置键无效');if(k==='DAILY_CORRECTION_POLICY'){process.env[k]=JSON.stringify(rules.policy(v));}else{if(!['string','boolean','number'].includes(typeof v))throw Error('日报配置类型无效');process.env[k]=String(v);}}
 }
 const cmd=process.argv[2]||'tick',now=new Date(),today=core.day(now),date=process.argv[3]||today;
 if(!['tick','review','check','generate','weekly','reconcile'].includes(cmd))throw Error('日报命令无效');core.validateDate(date);
 if(['tick','review'].includes(cmd)&&process.env.DAILY_BRIEF_ENABLED!=='true')return;
 if(cmd==='tick'&&(+now<rules.at(today,'17:58')||+now>rules.at(today,'18:20')))return;
 const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD,connectionTimeoutMillis:10000,statement_timeout:90000});
 try{
  if(cmd==='generate'){const row=await store.generate(pool,date);console.log(JSON.stringify({date,id:row.id,revision:row.revision,delivery:'not_requested'}));return;}
  if(cmd==='weekly'){console.log(JSON.stringify(await store.weekly(pool,date,{refresh:true})));return;}
  const service=loop.service({pool,now,clock:()=>new Date()});
  if(cmd==='reconcile'){console.log(JSON.stringify(await service.run(date,{archiveOnly:true})));return;}
  if(cmd==='check'){for(const d of [today,core.add(today,-1)])console.log(JSON.stringify({date:d,...await service.check(d)}));return;}
  if(cmd==='review'){for(const d of [core.add(today,-1),today])if(rules.within(d,now)&&(d!==today||+now>=rules.at(today,'18:25')))console.log(JSON.stringify({date:d,...await service.run(d)}));}
  else console.log(JSON.stringify({date:today,...await service.run(today,{initial:true})}));
 }finally{await pool.end();}
}
module.exports={run};
