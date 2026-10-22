'use strict';
const fs=require('node:fs'),path=require('node:path'),{Pool}=require('pg');
(async()=>{const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});try{for(const file of ['20261021_daily_briefs.sql','20261022_daily_delivery_loop.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../sql',file),'utf8'));console.log('日报归档表初始化完成（幂等）');}finally{await pool.end();}})().catch(()=>{console.error('日报初始化失败；未输出连接凭据');process.exitCode=1;});
