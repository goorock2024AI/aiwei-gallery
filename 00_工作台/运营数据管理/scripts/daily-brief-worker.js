// Server-only runner. Disabled by default; official internal-group delivery requires protected configuration.
'use strict';
const fs=require('node:fs'),{Pool}=require('pg'),core=require('../daily-brief-core'),store=require('../daily-brief-store'),dispatch=require('../daily-brief-dispatch');
async function run(){
 const configFile=process.env.DAILY_CONFIG_FILE||'/run/aiwei-config/daily-brief.json';
 if(fs.existsSync(configFile)){const config=JSON.parse(fs.readFileSync(configFile,'utf8'));const allowed=new Set(['DAILY_BRIEF_ENABLED','DAILY_SEND_ENABLED','DAILY_WECOM_WEBHOOK','DAILY_WEATHER_HOST','DAILY_WEATHER_KEY','DAILY_WEATHER_LAT','DAILY_WEATHER_LON','DAILY_MODEL_ENABLED','DAILY_MODEL_BASE','DAILY_MODEL_NAME','DAILY_MODEL_KEY']);for(const [key,v]of Object.entries(config)){if(!allowed.has(key)||!['string','boolean','number'].includes(typeof v))throw Error('日报配置键无效');process.env[key]=String(v);}}

 const command=process.argv[2]||'tick';if(!['tick','generate','weekly'].includes(command))throw Error('仅支持tick/generate/weekly');
 if(command==='tick'&&process.env.DAILY_BRIEF_ENABLED!=='true'){console.log('日报自动任务未启用');return;}
 const now=new Date(),date=process.argv[3]||core.day(now);
 if(command==='tick'&&+now<+new Date(date+'T17:58:00+08:00'))return;
 const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});
 try{
  if(command==='weekly'){console.log(JSON.stringify(await store.weekly(pool,date,{refresh:true})));return;}
  let row=await store.latest(pool,date);if(!row||command==='generate'||+now<+new Date(date+'T18:01:00+08:00'))row=await store.generate(pool,date);
  // Preparation starts shortly before 18:00; delivery starts at 18:00 and never sends prior dates.
  const delivery=command==='tick'&&+new Date()>=+new Date(date+'T18:00:00+08:00')?await dispatch.send(pool,row):{state:'not_requested'};
  console.log(JSON.stringify({date,id:row.id,revision:row.revision,delivery}));
 }finally{await pool.end();}
}
run().catch(()=>{console.error('日报任务失败，请检查受保护配置、数据库与归档目录；未输出凭据。');process.exitCode=1;});
