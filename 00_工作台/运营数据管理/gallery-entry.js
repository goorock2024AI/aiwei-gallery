const crypto = require('node:crypto');

module.exports = function createGalleryEntryHandler({ pool, getRequester, ensureRole, sendJSON, sendError, toCamel, toSnake }) {
  const editable = ['date', 'price', 'commission', 'buyer_name', 'payment_method', 'related_exhibition', 'status', 'handler', 'notes', 'sale_quantity', 'gallery_channel'];
  const soldStatuses = new Set(['已售出']);
  const lockedStatuses = new Set(['部分退款', '已退款', '已作废']);
  const money = value => Math.round(Number(value) * 100) / 100;
  const parseBody = async req => {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 65536) throw new Error('请求内容过大');
    }
    return JSON.parse(body || '{}');
  };
  const validateSale = sale => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sale.date || '') || new Date(sale.date).toISOString().slice(0, 10) !== sale.date) throw new Error('请选择有效日期');
    sale.price = money(sale.price);
    sale.commission = money(sale.commission || 0);
    sale.sale_quantity = Number(sale.sale_quantity);
    if (!Number.isFinite(sale.price) || sale.price <= 0 || sale.price >= 1e10) throw new Error('成交单价必须为有效正数');
    if (!Number.isFinite(sale.commission) || sale.commission < 0) throw new Error('佣金不能为负数');
    if (!Number.isInteger(sale.sale_quantity) || sale.sale_quantity < 1) throw new Error('成交数量必须为正整数');
    if (!['已售出', '已预定'].includes(sale.status)) throw new Error('新增或编辑只能使用已售出、已预定状态');
    const gross = money(sale.price * sale.sale_quantity);
    if (sale.commission > gross) throw new Error('佣金不能超过成交总额');
    return { gross, net: money(gross - sale.commission) };
  };
  const loadArtwork = async (client, id, requireSellable = true) => {
    if (!id) throw new Error('必须从作品库明确选择作品');
    const artwork = (await client.query('SELECT * FROM artworks WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!artwork) throw new Error('所选作品不存在');
    if (requireSellable && artwork.approval_status !== '已上架') throw new Error('所选作品尚未上架');
    if (requireSellable && ['借出', '下架'].includes(artwork.status)) throw new Error('所选作品当前不可售');
    return artwork;
  };
  const updateInventory = async (client, artwork, delta) => {
    if (!delta) return;
    const next = Number(artwork.sold_qty || 0) + delta;
    const total = Number(artwork.total_qty || 0);
    if (next < 0 || next > total) throw new Error(next > total ? '所选作品库存不足' : '作品库存状态异常');
    await client.query('UPDATE artworks SET sold_qty=$1,updated_at=NOW() WHERE id=$2', [next, artwork.id]);
    artwork.sold_qty = next;
  };
  const cash = async (client, { id, date, type, amount, saleId, user, reason, notes }) => {
    if (!amount) return;
    await client.query(`INSERT INTO cash_movements(id,date,type,amount,source_type,source_id,account_channel,operator_id,operator_name,reason,notes)
      VALUES($1,$2,$3,$4,'gallery',$5,'现金',$6,$7,$8,$9)`, [id, date, type, amount, saleId, user.id, user.displayName, reason, notes]);
  };
  const log = (client, user, action, id, details) => client.query(
    'INSERT INTO operation_logs(id,user_id,action,table_name,record_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [crypto.randomUUID(), user.id, action, 'gallery_sales', id, JSON.stringify(details)]
  );

  return async function handleGalleryEntry(req, res, query = {}) {
    let client;
    try {
      const user = await getRequester(req);
      if (!ensureRole(res, user, ['admin', 'editor'])) return;
      if (!['POST', 'PATCH'].includes(req.method)) return sendError(res, 405, '仅支持新增、编辑、退款和作废');
      const payload = await parseBody(req);
      client = await pool.connect();
      await client.query('BEGIN');
      const id = String(query.id || payload.sale?.id || crypto.randomUUID());

      if (query.action) {
        if (!ensureRole(res, user, ['admin'])) { await client.query('ROLLBACK'); return; }
        const action = String(query.action);
        if (!['refund', 'void'].includes(action)) throw new Error('无效调整操作');
        const previous = (await client.query('SELECT * FROM gallery_sales WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!previous) throw new Error('画廊销售记录不存在');
        if (!previous.artwork_id) throw new Error('旧记录尚未明确关联作品，不能自动调整库存');
        if (lockedStatuses.has(previous.status) && previous.status !== '部分退款') throw new Error('该记录已不能再次调整');
        const reason = String(payload.reason || '').trim().slice(0, 500);
        if (!reason) throw new Error('必须填写调整原因');
        const total = money(Number(previous.net_amount_snapshot ?? (Number(previous.price) * Number(previous.sale_quantity || 1) - Number(previous.commission))) || 0);
        const refunded = money(previous.refund_amount || 0);
        const remaining = money(Math.max(0, total - refunded));
        let amount = action === 'void' ? remaining : money(payload.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) throw new Error('退款金额必须大于 0 且不能超过可退金额');
        if (action === 'void' && refunded > 0) throw new Error('已有退款的记录不能作废，请完成退款');
        const newRefund = action === 'refund' ? money(refunded + amount) : refunded;
        const fullRefund = action === 'void' || newRefund >= total;
        const status = action === 'void' ? '已作废' : (fullRefund ? '已退款' : '部分退款');
        const payout = String(payload.payoutMethod || '原路退回').slice(0, 50);
        const adjustmentReason = action === 'refund' ? `${reason}；实际退款方式：${payout}` : reason;
        const saved = (await client.query(`UPDATE gallery_sales SET status=$1,refund_amount=$2,adjusted_at=NOW(),adjusted_by=$3,adjustment_reason=$4 WHERE id=$5 RETURNING *`,
          [status, newRefund, user.displayName, adjustmentReason, id])).rows[0];
        await client.query(`INSERT INTO transaction_adjustments(id,target_type,target_id,action,amount,reason,operator_id,operator_name)
          VALUES($1,'gallery',$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(), id, action === 'void' ? 'void' : (fullRefund ? 'refund' : 'partial_refund'), amount, adjustmentReason, user.id, user.displayName]);
        let released = false;
        if (fullRefund && ['已售出', '部分退款'].includes(previous.status)) {
          const artwork = await loadArtwork(client, previous.artwork_id, false);
          await updateInventory(client, artwork, -Number(previous.sale_quantity || 1));
          released = true;
        }
        if (action === 'refund' && payout === '现金') await cash(client, { id: `cash_refund_gallery_${id}_${crypto.randomUUID()}`, date: previous.date, type: 'cash_refund', amount: -amount, saleId: id, user, reason, notes: `画廊退款；原收款方式：${previous.payment_method || '未知'}` });
        if (action === 'void' && previous.payment_method === '现金') await cash(client, { id: `cash_void_gallery_${id}`, date: previous.date, type: 'cash_void', amount: -amount, saleId: id, user, reason, notes: '画廊现金销售作废' });
        await log(client, user, action, id, { source: 'gallery-entry-v2', originalRecordId: id, reason, payoutMethod: payout, inventoryReleased: released, before: previous, after: saved });
        await client.query('COMMIT');
        return sendJSON(res, 200, { sale: toCamel(saved), inventoryReleased: released });
      }

      if (!payload.sale || typeof payload.sale !== 'object') throw new Error('缺少销售数据');
      const input = toSnake(payload.sale);
      let previous = null;
      if (req.method === 'PATCH') {
        previous = (await client.query('SELECT * FROM gallery_sales WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!previous) throw new Error('画廊销售记录不存在');
        if (lockedStatuses.has(previous.status)) throw new Error('退款或作废记录不能编辑原单');
      }
      const artworkId = String(payload.artworkId || input.artwork_id || '');
      const artwork = await loadArtwork(client, artworkId);
      const sale = { ...(previous || {}), id, artwork_id: artwork.id };
      for (const key of editable) if (input[key] !== undefined) sale[key] = input[key];
      sale.status = sale.status || '已售出';
      sale.payment_method = sale.payment_method || '扫码支付';
      sale.gallery_channel = String(sale.gallery_channel || '馆内画廊').slice(0, 100);
      const totals = validateSale(sale);
      if (previous?.artwork_id && previous.artwork_id !== artwork.id) {
        const oldArtwork = await loadArtwork(client, previous.artwork_id, false);
        if (soldStatuses.has(previous.status)) await updateInventory(client, oldArtwork, -Number(previous.sale_quantity || 1));
      } else if (previous && soldStatuses.has(previous.status)) {
        await updateInventory(client, artwork, -Number(previous.sale_quantity || 1));
      }
      if (soldStatuses.has(sale.status)) await updateInventory(client, artwork, sale.sale_quantity);
      Object.assign(sale, {
        artwork_no: artwork.artwork_no || '', artwork_name: artwork.title, artist: artwork.artist || '',
        settlement_price_snapshot: money(artwork.settlement_price || 0), retail_price_snapshot: money(artwork.retail_price || 0),
        gross_amount_snapshot: totals.gross, net_amount_snapshot: totals.net, business_type_code: 'gallery_sale',
        refund_amount: previous?.refund_amount || 0
      });
      let saved;
      if (previous) {
        const cols = [...editable, 'artwork_id', 'artwork_no', 'artwork_name', 'artist', 'settlement_price_snapshot', 'retail_price_snapshot', 'gross_amount_snapshot', 'net_amount_snapshot', 'business_type_code'];
        saved = (await client.query(`UPDATE gallery_sales SET ${cols.map((key, i) => `"${key}"=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map(key => sale[key]), id])).rows[0];
      } else {
        const cols = ['id', ...editable, 'artwork_id', 'artwork_no', 'artwork_name', 'artist', 'settlement_price_snapshot', 'retail_price_snapshot', 'gross_amount_snapshot', 'net_amount_snapshot', 'business_type_code'];
        saved = (await client.query(`INSERT INTO gallery_sales(${cols.map(k => `"${k}"`).join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, cols.map(key => sale[key]))).rows[0];
      }
      const oldCash = previous && previous.payment_method === '现金' && soldStatuses.has(previous.status) ? Number(previous.net_amount_snapshot || 0) : 0;
      const newCash = sale.payment_method === '现金' && soldStatuses.has(sale.status) ? totals.net : 0;
      const delta = money(newCash - oldCash);
      await cash(client, { id: `cash_gallery_${previous ? 'edit' : 'sale'}_${id}_${crypto.randomUUID()}`, date: sale.date, type: previous ? 'cash_edit' : 'cash_sale', amount: delta, saleId: id, user, reason: previous ? '画廊现金收款编辑差额' : '画廊现金销售收款', notes: '由画廊交易事务自动生成' });
      await log(client, user, previous ? 'update' : 'create', id, { source: 'gallery-entry-v2', artworkId: artwork.id, before: previous, after: saved });
      await client.query('COMMIT');
      return sendJSON(res, previous ? 200 : 201, { sale: toCamel(saved) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return sendError(res, error.message === '请求内容过大' ? 413 : 400, error.code === '23505' ? '记录已存在，请刷新后编辑' : error.message);
    } finally {
      client?.release();
    }
  };
};
