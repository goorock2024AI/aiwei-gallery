const assert = require('assert/strict');
const fs = require('fs');
const { Client } = require('pg');

const cfg = JSON.parse(fs.readFileSync('tmp/m3-05-test.json', 'utf8'));
if (cfg.host !== '127.0.0.1' || cfg.port !== 55435 || cfg.database !== 'aiwei_m3_05_test') {
  throw new Error('Requires the dedicated local M6 reconciliation database');
}

const fixturePrefix = 'm604-';
const fixtureDate = '2026-09-11';
const fixtureMonth = '2026-09';

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function amount(centsValue) {
  return (centsValue / 100).toFixed(2);
}

async function clean(db) {
  await db.query(`
    DELETE FROM operation_logs WHERE record_id LIKE 'm604-%';
    DELETE FROM transaction_adjustments WHERE id LIKE 'm604-%';
    DELETE FROM daily_closings WHERE id LIKE 'm604-%';
    DELETE FROM space_payments WHERE id LIKE 'm604-%' OR space_usage_id LIKE 'm604-%';
    DELETE FROM space_usage WHERE id LIKE 'm604-%';
    DELETE FROM gallery_sales WHERE id LIKE 'm604-%';
    DELETE FROM artworks WHERE id LIKE 'm604-%';
    DELETE FROM revenue WHERE id LIKE 'm604-%';
    DELETE FROM expense WHERE id LIKE 'm604-%';
    DELETE FROM creative_products WHERE id LIKE 'm604-%';
  `);
}

async function sourceSnapshot(db) {
  return (await db.query(`SELECT
    (SELECT COUNT(*) FROM revenue)::INTEGER revenue_count,
    (SELECT COALESCE(SUM(ticket_amount+combo_amount+coffee_amount+workshop_amount+retail_amount+creative_amount+venue_amount+other_amount),0) FROM revenue)::NUMERIC(18,2) revenue_amount,
    (SELECT COUNT(*) FROM expense)::INTEGER expense_count,
    (SELECT COALESCE(SUM(amount),0) FROM expense)::NUMERIC(18,2) expense_amount,
    (SELECT COUNT(*) FROM gallery_sales)::INTEGER gallery_count,
    (SELECT COALESCE(SUM(price),0) FROM gallery_sales)::NUMERIC(18,2) gallery_gross,
    (SELECT COUNT(*) FROM space_usage)::INTEGER space_count,
    (SELECT COALESCE(SUM(receivable_amount),0) FROM space_usage)::NUMERIC(18,2) space_receivable,
    (SELECT COUNT(*) FROM space_payments)::INTEGER payment_count,
    (SELECT COALESCE(SUM(amount),0) FROM space_payments)::NUMERIC(18,2) payment_amount,
    (SELECT COUNT(*) FROM daily_closings)::INTEGER closing_count,
    (SELECT COALESCE(SUM(system_net_amount),0) FROM daily_closings)::NUMERIC(18,2) closing_amount,
    (SELECT COUNT(*) FROM transaction_adjustments)::INTEGER adjustment_count,
    (SELECT COALESCE(SUM(amount),0) FROM transaction_adjustments)::NUMERIC(18,2) adjustment_amount`)).rows[0];
}

async function seed(db) {
  await db.query(`
    INSERT INTO creative_products
      (id,name,standard_name,sku,cost_price,retail_price,stock,business_type_code,package_spec,is_beverage,is_countable_stock,is_active,approval_status)
    VALUES
      ('m604-product','M604商品','M604标准商品','M604-SKU',10,30,10,'creative_retail','1件',false,true,true,'已上架');

    INSERT INTO revenue
      (id,date,ticket_qty,ticket_amount,retail_items,retail_amount,other_amount,other_desc,status,payment_method,project_name)
    VALUES
      ('m604-pos','2026-09-11',2,100,
       '[{"productId":"m604-product","productName":"M604商品","standardName":"M604标准商品","businessTypeCode":"creative_retail","packageSpec":"1件","qty":2,"unitPrice":30,"amount":60,"costPriceSnapshot":10,"snapshotVersion":1}]',
       60,7,'M604待归类收入','正常','扫码支付','M604 POS');

    INSERT INTO expense(id,date,type,project,category,amount,description)
    VALUES
      ('m604-expense','2026-09-11','运营支出','M604运营','办公行政',40,'M604期间支出'),
      ('m604-borrow','2026-09-11','备用金借入','M604备用金','其他支出',200,'不进入期间成本');

    INSERT INTO artworks
      (id,artwork_no,title,artist,status,settlement_price,retail_price,total_qty,sold_qty,approval_status)
    VALUES
      ('m604-artwork','M604-A','M604作品','M604艺术家','已售',120,250,2,2,'已上架');

    INSERT INTO gallery_sales
      (id,date,artwork_id,artwork_no,artwork_name,artist,price,commission,refund_amount,status,payment_method,
       sale_quantity,settlement_price_snapshot,retail_price_snapshot,gross_amount_snapshot,net_amount_snapshot,
       gallery_channel,business_type_code)
    VALUES
      ('m604-gallery','2026-09-11','m604-artwork','M604-A','M604作品','M604艺术家',500,50,50,'部分退款','转账',
       2,120,250,500,450,'馆内','gallery_sale');

    INSERT INTO transaction_adjustments
      (id,target_type,target_id,action,amount,reason,operator_id,operator_name,created_at)
    VALUES
      ('m604-refund','gallery','m604-gallery','partial_refund',50,'M604部分退款','m604-admin','M604管理员','2026-09-11 12:00:00+08');

    INSERT INTO space_usage
      (id,date,end_date,space,project_name,type,client,status,rental_type,receivable_amount,expected_payment_date,
       business_layer_code,business_type_code,cooperation_mode,project_owner,contract_no,business_status)
    VALUES
      ('m604-space','2026-09-11','2026-09-12','1号厅','M604空间项目','场地租赁','M604客户','进行中','付费',1000,'2026-09-30',
       'art_transaction_cooperation','space_rental','租赁','M604负责人','M604-C-001','执行中');

    INSERT INTO space_payments(id,space_usage_id,payment_date,amount,payment_method)
    VALUES('m604-payment','m604-space','2026-09-11',300,'转账');
  `);
}

function fixturePredicate(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `((${prefix}source_table='revenue' AND ${prefix}source_id='m604-pos')
    OR (${prefix}source_table='gallery_sales' AND ${prefix}source_id='m604-gallery')
    OR (${prefix}source_table='space_payments' AND ${prefix}source_id='m604-payment')
    OR (${prefix}source_table='transaction_adjustments' AND ${prefix}source_id='m604-refund'))`;
}

(async () => {
  const db = new Client({ ...cfg, user: 'postgres' });
  await db.connect();
  let before;
  try {
    await clean(db);
    before = await sourceSnapshot(db);
    await seed(db);

    const legacyIncomeRows = (await db.query(`SELECT id,record_id,date,source,category,net_amount
      FROM revenue_facts
      WHERE (source='pos' AND record_id='m604-pos')
         OR (source='gallery' AND record_id='m604-gallery')
         OR (source='space' AND record_id='m604-payment')
         OR id='m604-refund:adjustment'
      ORDER BY id`)).rows;
    const v2IncomeRows = (await db.query(`SELECT fact_id,source_table,source_id,source_line_key,business_date,
      business_layer_code,business_type_code,mapping_status,net_amount
      FROM business_revenue_facts_v2 WHERE ${fixturePredicate()} ORDER BY fact_id`)).rows;

    const legacyIncome = legacyIncomeRows.reduce((sum, row) => sum + cents(row.net_amount), 0);
    const classifiedIncome = v2IncomeRows.filter(row => row.business_type_code !== 'uncategorized_revenue')
      .reduce((sum, row) => sum + cents(row.net_amount), 0);
    const pendingIncome = v2IncomeRows.filter(row => row.business_type_code === 'uncategorized_revenue')
      .reduce((sum, row) => sum + cents(row.net_amount), 0);
    assert.equal(legacyIncome, 86700);
    assert.equal(classifiedIncome, 91000);
    assert.equal(pendingIncome, -4300);
    assert.equal(legacyIncome, classifiedIncome + pendingIncome);

    const legacyBySource = legacyIncomeRows.reduce((totals, row) => {
      const source = row.id === 'm604-refund:adjustment'
        ? 'transaction_adjustments'
        : ({ pos: 'revenue', gallery: 'gallery_sales', space: 'space_payments' })[row.source];
      totals[source] = (totals[source] || 0) + cents(row.net_amount);
      return totals;
    }, {});
    const v2BySource = v2IncomeRows.reduce((totals, row) => {
      totals[row.source_table] = (totals[row.source_table] || 0) + cents(row.net_amount);
      return totals;
    }, {});
    assert.deepEqual(legacyBySource, {
      gallery_sales: 45000,
      revenue: 16700,
      space_payments: 30000,
      transaction_adjustments: -5000
    });
    assert.deepEqual(v2BySource, legacyBySource, 'Each source must reconcile independently before totals are combined');

    const daily = (await db.query(`SELECT
      COALESCE(SUM(net_amount),0)::NUMERIC(18,2) legacy,
      (SELECT COALESCE(SUM(net_amount),0) FROM business_revenue_facts_v2 WHERE ${fixturePredicate()})::NUMERIC(18,2) v2
      FROM revenue_facts
      WHERE date=$1 AND ((source='pos' AND record_id='m604-pos') OR (source='gallery' AND record_id='m604-gallery')
        OR (source='space' AND record_id='m604-payment') OR id='m604-refund:adjustment')`, [fixtureDate])).rows[0];
    assert.equal(cents(daily.legacy), cents(daily.v2));

    const monthly = (await db.query(`SELECT
      (SELECT COALESCE(SUM(net_amount),0) FROM revenue_facts WHERE LEFT(date,7)=$1 AND
        ((source='pos' AND record_id='m604-pos') OR (source='gallery' AND record_id='m604-gallery')
          OR (source='space' AND record_id='m604-payment') OR id='m604-refund:adjustment'))::NUMERIC(18,2) legacy,
      (SELECT COALESCE(SUM(net_amount),0) FROM business_revenue_facts_v2
        WHERE LEFT(business_date,7)=$1 AND ${fixturePredicate()})::NUMERIC(18,2) v2`, [fixtureMonth])).rows[0];
    assert.equal(cents(monthly.legacy), cents(monthly.v2));

    const layers = (await db.query(`SELECT business_layer_code,COALESCE(SUM(net_amount),0)::NUMERIC(18,2) amount
      FROM business_revenue_facts_v2 WHERE ${fixturePredicate()} AND business_layer_code<>''
      GROUP BY business_layer_code ORDER BY business_layer_code`)).rows;
    assert.deepEqual(Object.fromEntries(layers.map(row => [row.business_layer_code, cents(row.amount)])), {
      art_transaction_cooperation: 75000,
      onsite_consumption: 6000,
      visit: 10000
    });

    const expense = (await db.query(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM expense WHERE id IN ('m604-expense','m604-borrow'))::NUMERIC(18,2) raw_all,
      (SELECT COALESCE(SUM(amount),0) FROM expense WHERE id IN ('m604-expense','m604-borrow') AND type<>'备用金借入')::NUMERIC(18,2) eligible,
      (SELECT COALESCE(SUM(cost_amount),0) FROM business_cost_facts_v2
        WHERE source_table='expense' AND source_id IN ('m604-expense','m604-borrow') AND cost_basis='period_expense')::NUMERIC(18,2) v2_period`)).rows[0];
    assert.equal(cents(expense.raw_all), 24000);
    assert.equal(cents(expense.eligible), 4000);
    assert.equal(cents(expense.v2_period), 4000);

    const cogsRows = (await db.query(`SELECT source_table,source_id,source_line_key,cost_basis,quantity,unit_cost,cost_amount
      FROM business_cost_facts_v2
      WHERE (source_table='revenue' AND source_id='m604-pos' AND cost_basis='sold_cogs')
         OR (source_table='gallery_sales' AND source_id='m604-gallery' AND cost_basis='gallery_settlement')
      ORDER BY source_table,source_line_key`)).rows;
    for (const row of cogsRows) assert.equal(cents(row.cost_amount), cents(Number(row.quantity) * Number(row.unit_cost)));
    const retailCogs = cogsRows.filter(row => row.source_table === 'revenue').reduce((sum, row) => sum + cents(row.cost_amount), 0);
    const galleryCogs = cogsRows.filter(row => row.source_table === 'gallery_sales').reduce((sum, row) => sum + cents(row.cost_amount), 0);
    assert.equal(retailCogs, 2000);
    assert.equal(galleryCogs, 24000);

    const gallery = (await db.query(`SELECT * FROM gallery_transaction_performance_v2 WHERE id='m604-gallery'`)).rows[0];
    assert.deepEqual({
      gross: cents(gallery.gross_amount), commission: cents(gallery.commission), refund: cents(gallery.refund_amount),
      settlement: cents(gallery.settlement_cost), realized: cents(gallery.realized_net_amount), contribution: cents(gallery.contribution_amount)
    }, { gross: 50000, commission: 5000, refund: 5000, settlement: 24000, realized: 40000, contribution: 16000 });
    assert.equal(cents(gallery.realized_net_amount), cents(gallery.gross_amount) - cents(gallery.commission) - cents(gallery.refund_amount));
    assert.equal(cents(gallery.contribution_amount), cents(gallery.realized_net_amount) - cents(gallery.settlement_cost));

    const space = (await db.query(`SELECT * FROM space_project_performance_v2 WHERE id='m604-space'`)).rows[0];
    assert.deepEqual({
      receivable: cents(space.receivable_amount), received: cents(space.received_amount),
      outstanding: cents(space.outstanding_amount), payments: space.payment_count
    }, { receivable: 100000, received: 30000, outstanding: 70000, payments: 1 });
    assert.equal(cents(space.receivable_amount), cents(space.received_amount) + cents(space.outstanding_amount));

    await db.query(`INSERT INTO daily_closings
      (id,date,system_net_amount,confirmed_amount,difference_amount,revenue_summary,payment_summary,expense_summary,
       adjustment_summary,cash_summary,closer_id,closer_name,status,notes)
      VALUES('m604-closing',$1,$2,$2,0,$3,'{}','{}','{}','{}','m604-editor','M604编辑','已确认','M6-04对账样本')`,
    [fixtureDate, amount(legacyIncome), JSON.stringify({ fixtureNetAmount: amount(legacyIncome), facts: legacyIncomeRows.length })]);
    const closing = (await db.query(`SELECT system_net_amount,confirmed_amount,difference_amount,revenue_summary
      FROM daily_closings WHERE id='m604-closing'`)).rows[0];
    assert.equal(cents(closing.system_net_amount), legacyIncome);
    assert.equal(cents(closing.confirmed_amount), legacyIncome);
    assert.equal(cents(closing.difference_amount), 0);
    assert.equal(cents(closing.revenue_summary.fixtureNetAmount), legacyIncome);

    const differences = v2IncomeRows.filter(row => row.business_type_code === 'uncategorized_revenue').map(row => ({
      differenceType: row.source_table === 'transaction_adjustments' ? 'refund_adjustment_pending_classification' : 'pending_revenue_classification',
      sourceTable: row.source_table,
      sourceId: row.source_id,
      sourceLineKey: row.source_line_key,
      amount: amount(cents(row.net_amount)),
      basis: row.source_table === 'transaction_adjustments'
        ? '退款作为独立负数事实保留，待确认业务归属'
        : '1.0 其他收入完整保留，2.0 在治理区等待人工归类'
    }));
    assert.deepEqual(differences.map(row => [row.sourceTable, row.sourceId, row.sourceLineKey, row.amount]), [
      ['revenue', 'm604-pos', 'other_amount', '7.00'],
      ['transaction_adjustments', 'm604-refund', 'adjustment', '-50.00']
    ]);

    const result = {
      passed: true,
      period: { date: fixtureDate, month: fixtureMonth },
      income: {
        legacy: amount(legacyIncome), classifiedV2: amount(classifiedIncome), pendingV2: amount(pendingIncome),
        equation: 'legacy = classifiedV2 + pendingV2', dailyMatched: true, monthlyMatched: true,
        sourceAmounts: Object.fromEntries(Object.entries(legacyBySource).map(([source, value]) => [source, amount(value)])),
        layerAmounts: Object.fromEntries(layers.map(row => [row.business_layer_code, amount(cents(row.amount))]))
      },
      periodExpense: { rawIncludingBorrow: amount(cents(expense.raw_all)), eligible: amount(cents(expense.eligible)), v2: amount(cents(expense.v2_period)) },
      salesCost: { retail: amount(retailCogs), gallerySettlement: amount(galleryCogs), total: amount(retailCogs + galleryCogs), lineFormulaMatched: true },
      gallery: { gross: '500.00', commission: '50.00', refund: '50.00', realized: '400.00', settlement: '240.00', contribution: '160.00' },
      space: { receivable: '1000.00', received: '300.00', outstanding: '700.00', paymentCount: 1 },
      closing: { system: amount(legacyIncome), confirmed: amount(legacyIncome), difference: '0.00', unchanged: true },
      differences,
      sourceFactsRestored: false
    };

    await clean(db);
    assert.deepEqual(await sourceSnapshot(db), before, 'M6-04 must restore the local source database');
    result.sourceFactsRestored = true;
    fs.writeFileSync('tmp/m6-04-reconciliation-result.json', JSON.stringify(result, null, 2));
    console.log('PASS M6-04 reconciliation: income daily/monthly/source, period expense, sales cost, gallery, space, closing and traceable differences');
    console.log(JSON.stringify(result));
  } finally {
    await clean(db).catch(() => {});
    await db.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
