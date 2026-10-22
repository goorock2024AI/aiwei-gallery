'use strict';
const fs=require('fs'),path=require('path'),{Pool}=require('pg');
(async()=>{const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});try{await pool.query(fs.readFileSync(path.join(__dirname,'../sql/20261022_weekly_management.sql'),'utf8'));console.log('周报经营闭环表初始化完成（追加、幂等）');}finally{await pool.end();}})().catch(()=>{console.error('周报闭环迁移失败；未输出凭据');process.exitCode=1;});
