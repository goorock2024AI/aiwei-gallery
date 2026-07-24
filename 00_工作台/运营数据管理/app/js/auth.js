// auth.js — 用户认证（通过自有 REST API）
const Auth = {
  _currentUser: null,

  init() {
    try {
      const saved = sessionStorage.getItem('aiwei_user');
      if (saved) this._currentUser = JSON.parse(saved);
    } catch { this._currentUser = null; }
    return this._currentUser;
  },

  async _fetch(method, path, body) {
    const base = await Store._ensureClient();
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(base + path, opts);
    if (!res.ok) {
      let msg = '请求失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },

  async login(username, password) {
    const base = await Store._ensureClient();
    const res = await fetch(base + '/rest/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      let msg = '登录失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    const data = await res.json();
    this._currentUser = {
      id: data.id,
      username: data.username,
      displayName: data.displayName || data.username,
      role: data.role,
      needPasswordChange: data.needPasswordChange
    };
    sessionStorage.setItem('aiwei_user', JSON.stringify(this._currentUser));
    return this._currentUser;
  },

  async changePassword(newPwd) {
    const user = this._currentUser;
    if (!user) throw new Error('未登录');
    if (typeof newPwd !== 'string' || newPwd.length < 6) throw new Error('密码长度至少 6 位');
    const base = await Store._ensureClient();
    const res = await fetch(base + '/rest/v1/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, newPassword: newPwd })
    });
    if (!res.ok) {
      let msg = '修改失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async addUser(data) {
    if (!this.isAdmin) throw new Error('无权限，仅管理员可创建用户');
    if (!data.username) throw new Error('请输入用户名');
    const base = await Store._ensureClient();
    const res = await fetch(base + '/rest/v1/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: data.username,
        displayName: data.displayName || data.username,
        role: data.role || 'editor',
        password: data.password || '88888888'
      })
    });
    if (!res.ok) {
      let msg = '创建失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
  },

  async listUsers() {
    if (!this.isAdmin) throw new Error('无权限');
    return await this._fetch('GET', '/rest/v1/users?order=created_at.asc') || [];
  },

  async toggleUser(id) {
    if (!this.isAdmin) throw new Error('无权限');
    const user = await Store.getById('users', id);
    if (!user) throw new Error('用户不存在');
    if (user.role === 'admin') throw new Error('不能禁用管理员');
    await Store.update('users', id, { isActive: !user.isActive });
  },

  async editUser(id, data) {
    if (!this.isAdmin) throw new Error('无权限');
    const user = await Store.getById('users', id);
    if (!user) throw new Error('用户不存在');
    const updates = {};
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.role !== undefined) updates.role = data.role;
    if (Object.keys(updates).length === 0) throw new Error('没有需要修改的字段');
    await Store.update('users', id, updates);
  },

  async deleteUser(id) {
    if (!this.isAdmin) throw new Error('无权限');
    if (id === this._currentUser.id) throw new Error('不能删除自己');
    const user = await Store.getById('users', id);
    if (!user) throw new Error('用户不存在');
    if (user.role === 'admin') throw new Error('不能删除管理员');
    await Store.delete('users', id);
  },

  async changeOwnPassword(oldPwd, newPwd) {
    const user = this._currentUser;
    if (!user) throw new Error('未登录');
    if (!oldPwd) throw new Error('请输入当前密码');
    if (newPwd.length < 6) throw new Error('新密码长度至少 6 位');
    const base = await Store._ensureClient();
    const res = await fetch(base + '/rest/v1/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, oldPassword: oldPwd, newPassword: newPwd })
    });
    if (!res.ok) {
      let msg = '修改失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async resetPassword(id) {
    if (!this.isAdmin) throw new Error('无权限');
    const base = await Store._ensureClient();
    const res = await fetch(base + '/rest/v1/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, password: '88888888' })
    });
    if (!res.ok) {
      let msg = '重置失败';
      try { const e = await res.json(); msg = e.message || e.error || msg; } catch {}
      throw new Error(msg);
    }
  },

  logout() {
    this._currentUser = null;
    sessionStorage.removeItem('aiwei_user');
    location.reload();
  },

  get isLoggedIn() { return !!this._currentUser; },
  get isAdmin() { return this._currentUser?.role === 'admin'; },
  get isEditor() { return this._currentUser?.role === 'editor'; },
  get isViewer() { return this._currentUser?.role === 'viewer'; },
  get roleLabel() {
    const map = { admin: '管理员', editor: '编辑者', viewer: '查看者' };
    return map[this._currentUser?.role] || '未知';
  },
  get currentUser() { return this._currentUser; },

  hasModuleAccess(moduleKey) {
    if (!this._currentUser) return false;
    const role = this._currentUser.role;
    const accessMap = {
      revenue:  ['admin', 'editor'],
      expense:  ['admin', 'editor'],
      gallery:  ['admin', 'editor'],
      space:    ['admin', 'editor'],
      'project-list': ['admin', 'editor'],
      reports:  ['admin', 'editor', 'viewer'],
      manage:   ['admin'],
      products: ['admin'],
      users:    ['admin'],
      logs:     ['admin'],
    };
    return (accessMap[moduleKey] || []).includes(role);
  }
};

// 注：所有 SHA-256 哈希在后端用 Node crypto 统一计算（见 server.js:127）
// 历史上 auth.js 自带的 sha256 实现结果与 crypto 不一致，导致 addUser/resetPassword
// 写入错误 hash、用户无法登录；现已移除，前端不再计算密码哈希。
