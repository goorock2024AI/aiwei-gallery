'use strict';
const {date}=require('./space-accounting');
function timestamp(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('请填写有效的日期和具体时刻');
 date(value.slice(0,10));return value;
}
async function guard(db,{id,space,start,end}){
 timestamp(start);timestamp(end);if(end<=start)throw Error('结束时间必须晚于开始时间');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['space-booking:'+space]);
 const conflict=(await db.query(`SELECT s.project_name FROM space_usage s
 LEFT JOIN space_quick_rentals q ON q.space_usage_id=s.id
 WHERE s.space=$1 AND s.id<>$2 AND s.status IN ('已确认','进行中','已完成')
 AND COALESCE(q.start_at,s.date||'T00:00')<$4
 AND COALESCE(q.end_at,(COALESCE(NULLIF(s.end_date,''),s.date)::date+1)::text||'T00:00')>$3 LIMIT 1`,[space,id,start,end])).rows[0];
 if(conflict){const e=Error('时间冲突：该场地已被「'+conflict.project_name+'」占用，请调整场地或时间');e.status=409;throw e;}
}
function dayAfter(value){date(value);return new Date(Date.parse(value+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
async function range(db,project){const quick=(await db.query('SELECT * FROM space_quick_rentals WHERE space_usage_id=$1',[project.id])).rows[0];if(quick&&quick.start_at.slice(0,10)===project.date&&quick.end_at.slice(0,10)===(project.end_date||project.date))return {start:quick.start_at,end:quick.end_at};return {start:project.date+'T00:00',end:dayAfter(project.end_date||project.date)+'T00:00'};}
async function sync(db,project){const r=await range(db,project);await db.query("UPDATE space_quick_rentals SET start_at=$2,end_at=$3,version=version+1,updated_at=now() WHERE space_usage_id=$1 AND mode='full' AND (start_at<>$2 OR end_at<>$3)",[project.id,r.start,r.end]);}
module.exports={timestamp,guard,dayAfter,range,sync};
