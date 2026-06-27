// 一次性脚本：将 2026 年经营收入管理表 Excel 数据导入 Supabase
// 运行方式：node scripts/import-2026-data.js
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pyzitexdzfrbexwgoqpz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wLj18C-NsgFqmjbk8QiAMg_bTuZCBOP';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

function parseNum(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/,/g, '').replace(/¥/g, '')) || 0;
}

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function toSnake(obj) {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const snake = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    result[snake] = val;
  }
  return result;
}

// 解析老格式（2026.1 - 2026.5）：日期格式 "1/1" 表示 1月1日
function parseLegacySheet(ws, monthStr) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const records = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const dateStr = (row[0] || '').trim();
    if (!dateStr || dateStr === '合计') continue;

    // 解析 "1/1" 格式 → 2026-01-01
    const parts = dateStr.split('/');
    if (parts.length !== 2) continue;
    const month = String(parseInt(parts[0])).padStart(2, '0');
    const day = String(parseInt(parts[1])).padStart(2, '0');
    const date = `2026-${month}-${day}`;

    const ticketAmount = parseNum(row[1]);
    const workshopAmount = parseNum(row[2]);
    const creativeAmount = parseNum(row[3]);
    const otherAmount = parseNum(row[4]);

    // 跳过全零行
    if (ticketAmount + workshopAmount + creativeAmount + otherAmount === 0) continue;

    records.push({
      id: createId(),
      date,
      ticketAmount,
      workshopAmount,
      creativeAmount,
      otherAmount,
      cashAmount: 0,
      accountAmount: 0,
      paymentMethod: '现金',
      createdAt: `${date}T00:00:00.000Z`
    });
  }
  return records;
}

// 解析新格式（2026.6）：完整日期
function parseNewSheet(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = (row[0] || '').trim();
    if (!date || date === '合计') continue;
    // 跳过空行或非日期行
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const ticketQty = parseNum(row[1]);
    const ticketAmount = parseNum(row[2]);
    const comboQty = parseNum(row[3]);
    const comboAmount = parseNum(row[4]);
    const workshopAmount = parseNum(row[5]);
    const creativeAmount = parseNum(row[6]);
    const coffeeAmount = parseNum(row[7]);
    const venueAmount = parseNum(row[8]);
    const galleryAmount = parseNum(row[9]);
    const otherAmount = parseNum(row[10]) - venueAmount - galleryAmount; // 收入合计去掉场地和画廊
    const projectName = (row[15] || '').trim();
    const notes = (row[16] || '').trim();

    // 跳过全零行
    const total = ticketAmount + comboAmount + coffeeAmount + workshopAmount + creativeAmount + venueAmount + galleryAmount + otherAmount;
    if (total === 0 && !projectName) continue;

    records.push({
      id: createId(),
      date,
      ticketQty, ticketAmount,
      comboQty, comboAmount,
      coffeeAmount,
      workshopAmount,
      creativeAmount,
      venueAmount,
      otherAmount,
      otherDesc: notes ? notes : (otherAmount > 0 ? '其他' : ''),
      cashAmount: 0,
      accountAmount: total,
      paymentMethod: '扫码支付',
      projectName,
      notes,
      createdAt: `${date}T00:00:00.000Z`
    });
  }
  return records;
}

async function main() {
  const wb = XLSX.readFile('00_工作台/运营数据管理/202606-美术馆经营收入管理表.xlsx');

  const allRecords = [];

  // 2026.1 - 2026.5（老格式）
  for (const sheetName of ['2026.1', '2026.2', '2026.3', '2026.4', '2026.5']) {
    const ws = wb.Sheets[sheetName];
    const records = parseLegacySheet(ws, sheetName);
    console.log(`${sheetName}: ${records.length} 条有效记录`);
    allRecords.push(...records);
  }

  // 2026.6（新格式）
  const ws6 = wb.Sheets['2026.6'];
  const records6 = parseNewSheet(ws6);
  console.log(`2026.6: ${records6.length} 条有效记录`);
  allRecords.push(...records6);

  console.log(`\n总共 ${allRecords.length} 条记录，开始导入 Supabase...`);

  // 批量插入（按100条一批）
  const batchSize = 100;
  let imported = 0;
  for (let i = 0; i < allRecords.length; i += batchSize) {
    const batch = allRecords.slice(i, i + batchSize);
    const snakeBatch = batch.map(toSnake);
    const { error } = await supabase.from('revenue').upsert(snakeBatch, { onConflict: 'id' });
    if (error) {
      console.error(`批次 ${i}-${i+batch.length} 导入失败:`, error.message);
    } else {
      imported += batch.length;
      console.log(`已导入 ${imported}/${allRecords.length}`);
    }
  }

  console.log(`\n✅ 导入完成！共 ${imported} 条记录`);
}

main().catch(console.error);
