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
    const list = await this._fetch('GET', '/rest/v1/users?username=eq.' + encodeURIComponent(username));
    const data = Array.isArray(list) ? list[0] : null;
    if (!data || !data.id) throw new Error('用户不存在');
    if (!data.isActive) throw new Error('账号已被禁用，请联系管理员');

    const hash = await Auth._hash(password);
    const stored = data.passwordHash || '';

    let needChange = false;
    let actualHash = stored;
    if (stored.startsWith('__need_change__:')) {
      needChange = true;
      actualHash = stored.slice('__need_change__:'.length);
    }

    if (hash !== actualHash) throw new Error('密码错误');

    this._currentUser = {
      id: data.id,
      username: data.username,
      displayName: data.displayName || data.username,
      role: data.role,
      needPasswordChange: needChange
    };
    sessionStorage.setItem('aiwei_user', JSON.stringify(this._currentUser));

    // 异步更新 last_login_at
    this._fetch('PATCH', '/rest/v1/users?id=eq.' + encodeURIComponent(data.id), { last_login_at: new Date().toISOString() }).catch(() => {});
    return this._currentUser;
  },

  async changePassword(newPwd) {
    const user = this._currentUser;
    if (!user) throw new Error('未登录');
    if (newPwd.length < 6) throw new Error('密码长度至少 6 位');
    const hash = await Auth._hash(newPwd);
    await this._fetch('PATCH', '/rest/v1/users?id=eq.' + encodeURIComponent(user.id), { password_hash: hash });
    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async addUser(data) {
    if (!this.isAdmin) throw new Error('无权限，仅管理员可创建用户');
    if (!data.username) throw new Error('请输入用户名');
    const defaultHash = await Auth._hash('88888888');
    await Store.add('users', {
      id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: data.username,
      displayName: data.displayName || data.username,
      role: data.role || 'editor',
      passwordHash: '__need_change__:' + defaultHash,
      isActive: true
    });
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

    const oldHash = await Auth._hash(oldPwd);
    const data = await this._fetch('GET', '/rest/v1/users?id=eq.' + encodeURIComponent(user.id));
    const userData = Array.isArray(data) ? data[0] : data;
    if (!userData) throw new Error('验证失败');
    let storedHash = userData.passwordHash || '';
    if (storedHash.startsWith('__need_change__:')) {
      storedHash = storedHash.slice('__need_change__:'.length);
    }
    if (oldHash !== storedHash) throw new Error('当前密码错误');

    const newHash = await Auth._hash(newPwd);
    await this._fetch('PATCH', '/rest/v1/users?id=eq.' + encodeURIComponent(user.id), { password_hash: newHash });
    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async resetPassword(id) {
    if (!this.isAdmin) throw new Error('无权限');
    const hash = await Auth._hash('88888888');
    await this._fetch('PATCH', '/rest/v1/users?id=eq.' + encodeURIComponent(id), { password_hash: '__need_change__:' + hash });
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
      reports:  ['admin', 'editor', 'viewer'],
      manage:   ['admin'],
      products: ['admin'],
      users:    ['admin'],
      logs:     ['admin'],
    };
    return (accessMap[moduleKey] || []).includes(role);
  },

  async _hash(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
};
