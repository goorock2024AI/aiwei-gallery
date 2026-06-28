// app.js — 应用初始化与导航控制（Supabase 异步版）
(function() {
  window.$ = function(sel) {
    if (sel.startsWith('#')) return document.getElementById(sel.slice(1));
    return document.querySelector(sel);
  };
  window.html = function(el, content) {
    if (typeof el === 'string') el = document.querySelector(el) || document.getElementById(el);
    if (el) el.innerHTML = content;
  };

  // Tab 切换
  document.addEventListener('click', async function(e) {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab) return;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + tab);
    if (page) page.classList.add('active');

    // 异步渲染
    try {
      switch (tab) {
        case 'dashboard': await UI.renderDashboard(); break;
        case 'revenue': await UI.renderRevenuePage(); break;
        case 'expense': await UI.renderExpensePage(); break;
        case 'gallery': await UI.renderGalleryPage(); break;
        case 'space': await UI.renderSpacePage(); break;
        case 'reports': await UI.renderReportsPage(); break;
        case 'manage': await UI.renderManagePage(); break;
        case 'products': await UI.renderProductPage(); break;
      }
    } catch (err) {
      console.error('渲染错误：', err);
      UI.toast('页面加载失败：' + err.message, 'error');
    }
  });

  // 表单提交
  document.addEventListener('submit', function(e) {
    if (e.target.id === 'expense-form') { e.preventDefault(); UI._saveExpense(e); }
    else if (e.target.id === 'space-form') { e.preventDefault(); UI._saveSpace(e); }
  });

  // 键盘 Enter 提交
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      const form = e.target.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
      }
    }
  });

  // 初始化
  document.addEventListener('DOMContentLoaded', async function() {
    // 先加载动态配置
    await Store.loadAppConfig();
    // 检查数据库连接
    const health = await Store.healthCheck();
    if (!health.ok) {
      UI.toast(health.message, 'error');
    }
    await UI.renderRevenuePage();
  });
})();
