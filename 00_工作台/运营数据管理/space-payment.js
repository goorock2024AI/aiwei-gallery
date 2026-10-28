'use strict';
const crypto=require('node:crypto'),{date,cents}=require('./space-accounting');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
// Caller holds the project row lock and owns the transaction, including the audit.
module.exports=async function recordPayment(db,user,project,input){
 if(project.rental_type!=='付费')throw Error('免费项目不能录入到账');
 if(project.business_status==='已取消'||project.status==='已取消')throw Error('已取消项目不能录入到账');
 const paymentDate=String(input.paymentDate||input.payment_date||'');date(paymentDate);
 if(paymentDate>today())throw Error('实际到账日期不能晚于今天');
 const amount=Number(input.amount);if(cents(amount)<=0)throw Error('到账金额必须大于0');
 const id=String(input.id||crypto.randomUUID());if(!id||id.length>100)throw Error('到账标识无效');
 const method=String(input.paymentMethod||input.payment_method||'转账').slice(0,50),notes=String(input.notes||'').slice(0,500);
 const received=Number((await db.query('SELECT COALESCE(SUM(amount),0) amount FROM space_payments WHERE space_usage_id=$1',[project.id])).rows[0].amount);
 const previous=(await db.query('SELECT * FROM space_payments WHERE id=$1',[id])).rows[0];
 if(previous){if(previous.space_usage_id!==project.id||previous.payment_date!==paymentDate||Number(previous.amount)!==amount||previous.payment_method!==method||previous.notes!==notes){const e=Error('该到账标识已用于其他收款，请刷新核对');e.status=409;throw e;}return {payment:previous,remainingAmount:Math.round((Number(project.receivable_amount)-received)*100)/100,unchanged:true};}
 const remaining=Math.round((Number(project.receivable_amount)-received)*100)/100;if(amount>remaining)throw Error('到账金额不能超过待收金额');
 const payment=(await db.query('INSERT INTO space_payments(id,space_usage_id,payment_date,amount,payment_method,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,project.id,paymentDate,amount,method,notes])).rows[0];
 if(method==='现金')await db.query("INSERT INTO cash_movements(id,date,type,amount,source_type,source_id,operator_id,operator_name,reason,notes) VALUES($1,$2,'cash_sale',$3,'space',$4,$5,$6,'场地现金租金到账','由场地收款事务生成')",['cash_space_'+id,paymentDate,amount,id,user.id,user.display_name||user.username||'']);
 await db.query('INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),user.id,'payment_create','space_usage',project.id,JSON.stringify({source:'space-payment',payment,receivedBefore:received,receivedAfter:received+amount})]);
 return {payment,remainingAmount:Math.round((remaining-amount)*100)/100};
};
