// Host deployment tool, not an HTTP endpoint. SSH/container execution is the authorization boundary.
// Provenance is explicitly a deployment service, never an impersonated platform user or forged token.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg'),{validateReport,canonical}=require('../operations-reports'),archive=require('../report-archive');
const {collectPacket}=require('../operations-report-packet');
async function main(){
  const [bundleFile,release]=process.argv.slice(2);
  if(!bundleFile||!/^[a-f0-9]{40}$/.test(release||''))throw Error('需要已授权发布包和真实部署提交SHA');
  if(!process.env.REPORT_ARCHIVE_DIR)throw Error('必须配置持久化私有报告目录');
  const bundle=JSON.parse(fs.readFileSync(bundleFile,'utf8'));
  assert.equal(bundle.schemaVersion,1);assert.equal(bundle.reports.length,3);
  const actor='deployment:weekly-archive:'+release;
  const pool=new Pool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432),user:'postgres',database:process.env.DB_NAME||'postgres',password:process.env.DB_PASS||process.env.DB_PASSWORD});
  const db=await pool.connect(),results=[],written=[];let committed=false;
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await db.query("SET LOCAL statement_timeout='30s'");
    // Preflight every source before writing any report or file.
    for(const item of bundle.reports){
      const p=item.packet,{sha256,...payload}=p;
      assert.equal(archive.hash(canonical(payload)),sha256,'封存来源SHA不一致');
      const report=validateReport(item.report);assert.equal(report.reportType,'weekly');
      assert.equal(report.packetId,p.id);assert.equal(new Date(p.current.start+'T00:00:00Z').getUTCDay(),1);
      assert.equal((Date.parse(p.current.end)-Date.parse(p.current.start))/86400000,6);
      assert.ok(report.weekly.sources.every(s=>/^\d{4}-\d{2}-\d{2}$/.test(s.published)&&s.published<=p.current.end));
      const fresh=await collectPacket(db,p.current,p.previous,'部署核对，保持历史预测和分析不变');
      function compare(a,b,key){if(typeof a==='number'&&typeof b==='number')assert.ok(Math.abs(a-b)<1e-6,'经营指标已变化：'+key);else if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),'指标结构变化：'+key);for(const k of Object.keys(a))compare(a[k],b[k],key+'.'+k);}else assert.deepEqual(a,b,'指标变化：'+key);}
      compare(p.metrics.current,fresh.metrics.current,p.current.start+'本期');compare(p.metrics.previous,fresh.metrics.previous,p.current.start+'比较期');
      item.validated=report;
    }
    if(process.argv[4]==='--check-only'){console.log(JSON.stringify({validated:true,reports:bundle.reports.length}));return;}
    for(const item of bundle.reports){
      const p=item.packet,report=item.validated,start=p.current.start,end=p.current.end;
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['weekly:'+start]);
      const existing=(await db.query(`SELECT r.* FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id
        WHERE r.content->>'reportType'='weekly' AND p.start_date=$1 AND p.end_date=$2
        AND NOT EXISTS(SELECT 1 FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id)`,[start,end])).rows;
      assert.ok(existing.length<=1,'同期间存在多条当前周报');
      const sourceHash=archive.hash(canonical(report)),old=existing[0];
      if(old?.content?.publication?.sourceHash===sourceHash){archive.read(old.content.artifact);results.push({id:old.id,start,end,reused:true});continue;}
      const stored=(await db.query('SELECT sha256 FROM operations_analysis_packets WHERE id=$1',[p.id])).rows[0];
      if(stored)assert.equal(stored.sha256,p.sha256,'原来源编号冲突');
      else await db.query('INSERT INTO operations_analysis_packets(id,start_date,end_date,compare_start,compare_end,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[p.id,start,end,p.previous.start,p.previous.end,p.sha256,JSON.stringify(p),actor]);
      const id=crypto.randomUUID(),publishedAt=new Date().toISOString();
      const content={...report,reportVersion:(old?.content.reportVersion||0)+1,supersedes:old?.id||null,publication:{method:'authorized-deployment',release,sourceHash}};
      const artifact=archive.write({id,title:report.title,summary:report.summary,content,startDate:start,endDate:end,compareStart:p.previous.start,compareEnd:p.previous.end,publishedAt,packetId:p.id,sha256:p.sha256});written.push(artifact);content.artifact=artifact;
      delete content.packetId;delete content.title;delete content.summary;
      await db.query('INSERT INTO operations_analysis_reports(id,packet_id,title,summary,content,published_by,published_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',[id,p.id,report.title,report.summary,JSON.stringify(content),actor,publishedAt]);
      await db.query("INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,'archive_weekly_deployment','operations_analysis_reports',$3,$4::jsonb)",[crypto.randomUUID(),actor,id,JSON.stringify({release,packetId:p.id,sourceSha256:p.sha256,artifactSha256:artifact.sha256,authorization:'馆长确认静态周报及云端归档部署'})]);
      results.push({id,start,end,artifactSha256:artifact.sha256});
    }
    await db.query('COMMIT');committed=true;
    console.log(JSON.stringify({completed:true,results}));
  }finally{if(!committed){await db.query('ROLLBACK');for(const a of written)archive.discard(a);}db.release();await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
