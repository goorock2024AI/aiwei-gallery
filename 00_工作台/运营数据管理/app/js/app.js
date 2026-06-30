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

    // 未登录不允许切换
    if (!Auth.isLoggedIn) { return; }

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
        case 'users': await UI.renderUsersPage(); break;
      }
    } catch (err) {
      console.error('渲染错误：', err);
      UI.toast('页面加载失败：' + err.message, 'error');
    }
  });

  // 登录表单提交
  document.addEventListener('submit', async function(e) {
    if (e.target.id === 'login-form') {
      e.preventDefault();
      const errEl = $('#login-error');
      const btn = e.target.querySelector('.login-btn');
      if (errEl) errEl.textContent = '';
      btn.disabled = true; btn.textContent = '登录中...';
      try {
        const username = $('#login-username').value.trim();
        const password = $('#login-password').value;
        if (!username || !password) throw new Error('请输入用户名和密码');
        await Auth.login(username, password);
        // 登录成功
        if (Auth.currentUser.needPasswordChange) {
          $('#login-overlay').style.display = 'none';
          $('#change-pwd-overlay').style.display = 'flex';
        } else {
          _enterApp();
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        btn.disabled = false; btn.textContent = '登 录';
      }
    }

    if (e.target.id === 'change-pwd-form') {
      e.preventDefault();
      const errEl = $('#change-pwd-error');
      const btn = e.target.querySelector('.login-btn');
      if (errEl) errEl.textContent = '';
      const pwd = $('#new-pwd').value;
      const confirm = $('#new-pwd-confirm').value;
      if (pwd.length < 6) { if (errEl) errEl.textContent = '密码至少 6 位'; return; }
      if (pwd !== confirm) { if (errEl) errEl.textContent = '两次密码输入不一致'; return; }
      btn.disabled = true; btn.textContent = '修改中...';
      try {
        await Auth.changePassword(pwd);
        UI.toast('密码修改成功');
        $('#change-pwd-overlay').style.display = 'none';
        _enterApp();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        btn.disabled = false; btn.textContent = '确认修改';
      }
    }
  });

  // 其他表单
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

  // 进入主应用
  function _enterApp() {
    $('#login-overlay').style.display = 'none';
    $('#change-pwd-overlay').style.display = 'none';
    $('#app').style.display = '';
    $('#sidebar-user').style.display = 'flex';
    $('#sidebar-username').textContent = Auth.currentUser.displayName;
    // 角色权限控制：各 tab 按 hasModuleAccess 显示/隐藏
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab) {
        btn.style.display = Auth.hasModuleAccess(tab) ? '' : 'none';
      }
    });
    // 正常初始化
    _initApp();
  }

  async function _initApp() {
    await Store.loadAppConfig();
    const health = await Store.healthCheck();
    if (!health.ok) {
      UI.toast(health.message, 'error');
    }
    await UI.renderRevenuePage();
  }

  // 初始化
  document.addEventListener('DOMContentLoaded', async function() {
    // 先恢复登录态
    Auth.init();
    if (!Auth.isLoggedIn) {
      // 未登录 → 显示登录页
      $('#login-overlay').style.display = 'flex';
      return;
    }
    // 已登录
    $('#sidebar-user').style.display = 'flex';
    $('#sidebar-username').textContent = Auth.currentUser.displayName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab) {
        btn.style.display = Auth.hasModuleAccess(tab) ? '' : 'none';
      }
    });
    if (Auth.currentUser.needPasswordChange) {
      $('#change-pwd-overlay').style.display = 'flex';
      return;
    }
    await _initApp();
  });
})();
