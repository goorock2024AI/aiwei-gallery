'use strict';
// Authorized server maintenance only; reuse the original settings validator, never forge an HTTP user.
const {Pool}=require('pg'),crypto=require('crypto'),{isDeepStrictEqual}=require('util'),coffee=require('../coffee-inventory');
(async()=>{
 if(process.argv[2]!=='--apply')throw Error('需要明确--apply');
 const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});const db=await pool.connect();
 try{await db.query('BEGIN');const row=(await db.query("SELECT * FROM coffee_inventory_state WHERE id='coffee' FOR UPDATE")).rows[0];if(!row)throw Error('缺少库存设置');
 const old=row.payload.config?.closeHour;if(old===17.5){await db.query('ROLLBACK');console.log(JSON.stringify({state:'already_aligned',version:row.version}));return;}
 if(old!=null&&old!==18)throw Error('当前关门时间有新的自定义值，停止覆盖');
 const actor={id:'deployment:daily-loop-20261022',displayName:'馆长授权部署：统一17:30闭馆'},now=new Date().toISOString(),requestId=crypto.randomUUID();
 const before=structuredClone(row.payload),data={requestId,action:'settings',version:row.version,config:{closeHour:17.5}};
 coffee.apply(row.payload,data,[],now,actor);
 const a=structuredClone(before),b=structuredClone(row.payload);delete a.config;delete b.config;if(!isDeepStrictEqual(a,b))throw Error('非设置状态发生变化，停止');
 const updated=await db.query("UPDATE coffee_inventory_state SET payload=$1::jsonb,version=version+1,updated_at=NOW() WHERE id='coffee' AND version=$2 RETURNING version",[JSON.stringify(row.payload),row.version]);if(updated.rowCount!==1)throw Error('库存版本变化');
 await db.query('INSERT INTO coffee_inventory_events(request_id,actor_id,actor_name,action,payload,state_version) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[requestId,actor.id,actor.displayName,'settings',JSON.stringify(data),row.version+1]);
 await db.query("INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,'coffee_settings','coffee_inventory_state','coffee',$3::jsonb)",[crypto.randomUUID(),actor.id,JSON.stringify({requestId,version:row.version+1,beforeCloseHour:old??18,closeHour:17.5,authorization:'用户批准部署20261022日报闭环'})]);
 await db.query('COMMIT');console.log(JSON.stringify({state:'aligned',closeHour:17.5,version:row.version+1,otherInventoryStateUnchanged:true}));
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();await pool.end();}
})().catch(()=>{console.error('闭馆时间统一失败，请检查受保护日志及版本；未输出凭据。');process.exitCode=1;});
