// models.js — 数据模型定义
const MODELS = {
  TICKET_PRICE: 10,
  COMBO_PRICE: 25,
  COFFEE_PRICE: 15,
  // 动态配置（从数据库加载后覆盖）
  ticketProducts: [{name:'普通票',price:10},{name:'套票',price:25}],
  coffeeProducts: [{name:'手冲咖啡',price:15}],
  spaceDetails: [],
  STORAGE_KEYS: {
    revenue: 'aiwei_revenue',
    expense: 'aiwei_expense',
    space: 'aiwei_space'
  },
  PROJECT_TYPES: ['运营','耗材','展览','团建','工坊','画廊','其他'],
  EXPENSE_CATEGORIES: ['材料','茶歇','设备','人工','交通','通信','打印','运费','保洁','其他'],
  SPACES: ['1号厅','2号厅','美学空间','多功能厅','六楼综合空间','走廊画廊','户外露台'],
  SPACE_TYPES: ['展览','企业团建','沙龙','会议活动','品牌快闪','长期经营'],
  SPACE_STATUSES: ['筹备中','已确认','进行中','已完成','已取消'],
  INVOICE_STATUSES: ['有发票','无发票','不需要','待补'],
  RECEIPT_STATUSES: ['有凭证','无凭证','不需要','待补'],
  WORKSHOP_PRODUCTS: [
    { name: '果壳风铃', price: 128 },
    { name: '豆荚娃娃', price: 118 },
    { name: '迷你冰箱贴', price: 35 },
    { name: '木刻杯垫', price: 88 },
    { name: 'A5木刻', price: 168 },
    { name: 'A4木刻', price: 198 },
    { name: '拓印体验', price: 38 }
  ]
};

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 收入记录
function createRevenue(data = {}) {
  return {
    id: data.id || createId(),
    date: data.date || todayStr(),
    ticketQty: +data.ticketQty || 0,
    ticketAmount: +data.ticketQty * MODELS.TICKET_PRICE || 0,
    comboQty: +data.comboQty || 0,
    comboAmount: +data.comboQty * MODELS.COMBO_PRICE || 0,
    coffeeQty: +data.coffeeQty || 0,
    coffeeAmount: +data.coffeeQty * MODELS.COFFEE_PRICE || 0,
    workshopItems: data.workshopItems || [],
    workshopAmount: calcWorkshopTotal(data.workshopItems || []),
    retailItems: data.retailItems || [],
    retailAmount: calcRetailTotal(data.retailItems || []),
    creativeAmount: +data.creativeAmount || 0,
    venueAmount: +data.venueAmount || 0,
    otherAmount: +data.otherAmount || 0,
    otherDesc: data.otherDesc || '',
    cashAmount: +data.cashAmount || 0,
    accountAmount: +data.accountAmount || 0,
    paymentMethod: data.paymentMethod || '现金',
    projectName: data.projectName || '',
    handler: data.handler || '',
    notes: data.notes || '',
    createdAt: data.createdAt || new Date().toISOString()
  };
}

function calcWorkshopTotal(items) {
  return items.reduce((sum, item) => {
    const qty = +item.qty || 0;
    const price = +item.unitPrice || 0;
    const disc = +item.discount || 0;
    return sum + qty * price * (1 - disc / 100);
  }, 0);
}

function calcRetailTotal(items) {
  return items.reduce((sum, item) => sum + (+item.qty || 0) * (+item.unitPrice || 0), 0);
}

// 收入金额自动计算
function calcRevenueAmounts(data) {
  const ticketAmount = (+data.ticketQty || 0) * MODELS.TICKET_PRICE;
  const comboAmount = (+data.comboQty || 0) * MODELS.COMBO_PRICE;
  const coffeeAmount = (+data.coffeeQty || 0) * MODELS.COFFEE_PRICE;
  const workshopAmount = calcWorkshopTotal(data.workshopItems || []);
  const retailAmount = calcRetailTotal(data.retailItems || []);
  return { ticketAmount, comboAmount, coffeeAmount, workshopAmount, retailAmount };
}

// 支出记录
function createExpense(data = {}) {
  return {
    id: data.id || createId(),
    date: data.date || todayStr(),
    type: data.type || '备用金支出',
    project: data.project || '运营',
    category: data.category || '材料',
    amount: +data.amount || 0,
    description: data.description || '',
    handler: data.handler || '',
    invoiceStatus: data.invoiceStatus || '待补',
    receiptStatus: data.receiptStatus || '待补',
    relatedActivity: data.relatedActivity || '',
    createdAt: data.createdAt || new Date().toISOString()
  };
}

// 空间使用记录
function createSpaceUsage(data = {}) {
  return {
    id: data.id || createId(),
    date: data.date || todayStr(),
    space: data.space || '1号厅',
    projectName: data.projectName || '',
    type: data.type || '展览',
    client: data.client || '',
    status: data.status || '筹备中',
    receivableAmount: +data.receivableAmount || 0,
    receivedAmount: +data.receivedAmount || 0,
    notes: data.notes || '',
    createdAt: data.createdAt || new Date().toISOString()
  };
}

// 验证函数
function validateRevenue(d) {
  const errs = [];
  if (!d.date) errs.push('请选择日期');
  if (!d.ticketQty && !d.comboQty && !d.coffeeQty && !d.creativeAmount && !d.venueAmount && !d.otherAmount && (!d.workshopItems || d.workshopItems.length === 0) && (!d.retailItems || d.retailItems.length === 0)) {
    errs.push('请至少填写一项收入');
  }
  return errs;
}

function validateExpense(d) {
  const errs = [];
  if (!d.date) errs.push('请选择日期');
  if (!d.amount || d.amount <= 0) errs.push('请输入有效金额');
  return errs;
}

function validateSpaceUsage(d) {
  const errs = [];
  if (!d.date) errs.push('请选择日期');
  if (!d.projectName) errs.push('请输入项目/活动名称');
  return errs;
}
