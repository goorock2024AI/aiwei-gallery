const fs=require('fs'),assert=require('assert/strict'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('tmp/m3-05-test.json'));
const migration=fs.readFileSync('sql/20260908_m4_07_gallery_workshop_link_candidates.sql','utf8');
const rollback=fs.readFileSync('sql/20260908_m4_07_rollback.sql','utf8');
async function seed(db){
  await db.query("DELETE FROM record_business_links WHERE id LIKE 'm407-%' OR source_id LIKE 'm407-%';DELETE FROM expense WHERE id LIKE 'm407-%';DELETE FROM revenue WHERE id LIKE 'm407-%';DELETE FROM gallery_sales WHERE id LIKE 'm407-%';DELETE FROM artworks WHERE id LIKE 'm407-%';DELETE FROM project_registry WHERE id LIKE 'm407-%'");
  await db.query(`INSERT INTO artworks(id,artwork_no,title,artist,status,settlement_price,retail_price,approval_status) VALUES
    ('m407-art-linked','M407-001','M407已关联作品','艺术家甲','在库',300,800,'已上架'),
    ('m407-art-name','M407-002','M407唯一名称','艺术家乙','在库',450,1000,'已上架'),
    ('m407-art-amb-a','M407-003','M407同名作品','艺术家丙','在库',500,1200,'已上架'),
    ('m407-art-amb-b','M407-004','M407同名作品','艺术家丙','在库',550,1300,'已上架')`);
  const gallery=[
    ['m407-gallery-linked','2026-12-01','m407-art-linked','M407-001','M407已关联作品','艺术家甲',900,1,300],
    ['m407-gallery-linked-missing','2026-12-02','m407-art-linked','M407-001','M407已关联作品','艺术家甲',900,1,0],
    ['m407-gallery-no','2026-12-03','','M407-001','旧编号作品','艺术家甲',850,1,0],
    ['m407-gallery-name','2026-12-04','','','M407唯一名称','艺术家乙',950,1,0],
    ['m407-gallery-amb','2026-12-05','','','M407同名作品','艺术家丙',1000,1,0],
    ['m407-gallery-none','2026-12-06','','','M407无档案作品','未知',700,1,0],
    ['m407-gallery-invalid','2026-12-07','m407-missing-art','','M407失效关联','未知',600,1,0]
  ];
  for(const row of gallery)await db.query(`INSERT INTO gallery_sales(id,date,artwork_id,artwork_no,artwork_name,artist,price,sale_quantity,settlement_price_snapshot,gross_amount_snapshot,net_amount_snapshot,status,related_exhibition)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$7,'已售出','M407冬季展')`,row);
  await db.query(`INSERT INTO project_registry(id,name,status,notes) VALUES
    ('m407-project-ready','M407工坊完整','active','完整项目'),
    ('m407-project-review','M407工坊待审','active','成本待审'),
    ('m407-project-nocost','M407工坊无成本','active','无成本项目'),
    ('m407-project-amb-a','M407工坊同名','active','同名 A'),
    ('m407-project-amb-b','M407工坊同名','active','同名 B')`);
  const workshop=[
    ['m407-workshop-ready','M407工坊完整','木刻体验',300],
    ['m407-workshop-review','M407工坊待审','拓印体验',240],
    ['m407-workshop-nocost','M407工坊无成本','版画体验',180],
    ['m407-workshop-amb','M407工坊同名','亲子体验',200],
    ['m407-workshop-unregistered','M407工坊未登记','研学体验',360],
    ['m407-workshop-missing','','旧工坊汇总',100]
  ];
  for(const [id,project,name,amount] of workshop){const items=JSON.stringify([{productName:name,projectName:project,activityTypeCode:'workshop',participantCount:2,qty:2,unitPrice:amount/2,amount,snapshotVersion:1}]);await db.query("INSERT INTO revenue(id,date,workshop_items,workshop_amount,project_name,status) VALUES($1,'2026-12-08',$2::jsonb,$3,$4,'正常')",[id,items,amount,project]);}
  await db.query(`INSERT INTO expense(id,date,type,project,category,amount,description) VALUES
    ('m407-cost-ready','2026-12-08','运营支出','M407工坊完整','活动材料',80,'已确认直接材料'),
    ('m407-cost-review','2026-12-08','运营支出','M407工坊待审','其他',50,'用途待确认')`);
  await db.query(`INSERT INTO record_business_links(id,source_table,source_id,source_line_key,business_layer_code,business_type_code,cost_type_code,capability_axis_code,override_reason,created_by) VALUES
    ('m407-link-ready','expense','m407-cost-ready','expense','experience_activity','workshop','activity_execution','content_ip','同项目直接材料','m407-reviewer'),
    ('m407-link-review','expense','m407-cost-review','expense','','','uncategorized_cost','','用途待确认','m407-reviewer')`);
}
(async()=>{const db=new Client({host:cfg.host,port:cfg.port,database:cfg.database,user:'postgres'});await db.connect();try{await seed(db);
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT
    (SELECT COUNT(*) FROM gallery_sales WHERE id LIKE 'm407-%')::INTEGER gallery_count,
    (SELECT COALESCE(SUM(price),0) FROM gallery_sales WHERE id LIKE 'm407-%')::NUMERIC gallery_amount,
    (SELECT COUNT(*) FROM artworks WHERE id LIKE 'm407-%')::INTEGER artwork_count,
    (SELECT COUNT(*) FROM revenue WHERE id LIKE 'm407-%')::INTEGER revenue_count,
    (SELECT COALESCE(SUM(workshop_amount),0) FROM revenue WHERE id LIKE 'm407-%')::NUMERIC revenue_amount,
    (SELECT COUNT(*) FROM expense WHERE id LIKE 'm407-%')::INTEGER expense_count,
    (SELECT COUNT(*) FROM record_business_links WHERE id LIKE 'm407-%')::INTEGER link_count,
    (SELECT COUNT(*) FROM project_registry WHERE id LIKE 'm407-%')::INTEGER project_count`)).rows[0]);
  const before=await snapshot();await db.query(rollback);assert.equal((await db.query("SELECT to_regclass('gallery_link_candidates_v2') IS NULL AND to_regclass('workshop_link_candidates_v2') IS NULL ok")).rows[0].ok,true);for(let i=0;i<2;i++)await db.query(migration);assert.equal(await snapshot(),before);
  const gallery=(await db.query("SELECT * FROM gallery_link_candidates_v2 WHERE source_id LIKE 'm407-%' ORDER BY source_id")).rows;assert.equal(gallery.length,7);assert.ok(gallery.every(x=>/^gallerycand_[0-9a-f]{20}$/.test(x.candidate_id)));assert.equal(new Set(gallery.map(x=>x.candidate_id)).size,7);
  assert.equal(gallery.find(x=>x.source_id==='m407-gallery-linked').candidate_status,'linked_with_snapshot');assert.equal(gallery.find(x=>x.source_id==='m407-gallery-linked').settlement_evidence_status,'frozen_snapshot');
  const linkedMissing=gallery.find(x=>x.source_id==='m407-gallery-linked-missing');assert.equal(linkedMissing.candidate_status,'linked_missing_snapshot');assert.equal(linkedMissing.settlement_evidence_status,'current_master_reference');assert.equal(Number(linkedMissing.settlement_evidence_amount),300);
  const byNo=gallery.find(x=>x.source_id==='m407-gallery-no');assert.equal(byNo.candidate_status,'unique_artwork_no');assert.equal(byNo.suggested_artwork_id,'m407-art-linked');assert.equal(byNo.settlement_evidence_status,'current_master_reference');
  assert.equal(gallery.find(x=>x.source_id==='m407-gallery-name').candidate_status,'unique_title_artist');
  const ambiguous=gallery.find(x=>x.source_id==='m407-gallery-amb');assert.equal(ambiguous.candidate_status,'ambiguous_artworks');assert.equal(ambiguous.artwork_candidate_count,2);assert.equal(ambiguous.suggested_artwork_id,'');
  assert.equal(gallery.find(x=>x.source_id==='m407-gallery-none').candidate_status,'no_artwork_candidate');assert.equal(gallery.find(x=>x.source_id==='m407-gallery-invalid').candidate_status,'invalid_artwork_link');
  const workshop=(await db.query("SELECT * FROM workshop_link_candidates_v2 WHERE source_id LIKE 'm407-%' ORDER BY source_id")).rows;assert.equal(workshop.length,6);assert.ok(workshop.every(x=>/^workshopcand_[0-9a-f]{20}$/.test(x.candidate_id)));
  const ready=workshop.find(x=>x.source_id==='m407-workshop-ready');assert.equal(ready.candidate_status,'ready_candidate');assert.equal(ready.suggested_project_id,'m407-project-ready');assert.equal(ready.confirmed_direct_cost_count,1);assert.equal(Number(ready.confirmed_direct_cost_amount),80);
  const review=workshop.find(x=>x.source_id==='m407-workshop-review');assert.equal(review.candidate_status,'cost_review');assert.equal(review.pending_direct_cost_count,1);assert.equal(Number(review.pending_direct_cost_amount),50);
  assert.equal(workshop.find(x=>x.source_id==='m407-workshop-nocost').candidate_status,'missing_direct_cost');assert.equal(workshop.find(x=>x.source_id==='m407-workshop-amb').candidate_status,'ambiguous_projects');assert.equal(workshop.find(x=>x.source_id==='m407-workshop-unregistered').candidate_status,'unregistered_project');assert.equal(workshop.find(x=>x.source_id==='m407-workshop-missing').candidate_status,'missing_project');
  const galleryIds=(await db.query("SELECT candidate_id FROM gallery_link_candidates_v2 WHERE source_id LIKE 'm407-%' ORDER BY source_id")).rows.map(x=>x.candidate_id);assert.deepEqual(galleryIds,gallery.map(x=>x.candidate_id));
  console.log('PASS M4-07 migration: gallery exact-evidence tiers, frozen/current settlement boundaries, workshop project/direct-cost candidates, stable IDs, idempotence, rollback and unchanged sources');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
