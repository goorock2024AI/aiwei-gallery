// auth.js — 用户认证（自定义 users 表 + SHA-256，非 Supabase Auth）
const Auth = {
  _currentUser: null,

  // ===== 公开方法 =====

  init() {
    try {
      const saved = sessionStorage.getItem('aiwei_user');
      if (saved) this._currentUser = JSON.parse(saved);
    } catch { this._currentUser = null; }
    return this._currentUser;
  },

  async login(username, password) {
    const client = await Store._ensureClient();
    const { data, error } = await client.from('users').select('*').eq('username', username).maybeSingle();
    if (error || !data) throw new Error('用户不存在');
    if (!data.is_active) throw new Error('账号已被禁用，请联系管理员');

    const hash = await this._hash(password);
    const stored = data.password_hash || '';

    // 检查首次登录标记
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
      displayName: data.display_name || data.username,
      role: data.role,
      needPasswordChange: needChange
    };
    sessionStorage.setItem('aiwei_user', JSON.stringify(this._currentUser));

    // 异步更新 last_login_at
    client.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', data.id).then().catch(() => {});
    return this._currentUser;
  },

  async changePassword(newPwd) {
    const user = this._currentUser;
    if (!user) throw new Error('未登录');
    if (newPwd.length < 6) throw new Error('密码长度至少 6 位');

    const hash = await this._hash(newPwd);
    const client = await Store._ensureClient();
    const { error } = await client.from('users').update({ password_hash: hash }).eq('id', user.id);
    if (error) throw new Error('密码修改失败：' + error.message);

    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async addUser(data) {
    if (!this.isAdmin) throw new Error('无权限，仅管理员可创建用户');
    if (!data.username) throw new Error('请输入用户名');

    const defaultHash = await this._hash('88888888');
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
    const client = await Store._ensureClient();
    const { data, error } = await client.from('users').select('id, username, display_name, role, is_active, created_at, last_login_at').order('created_at', { ascending: true });
    if (error) throw new Error('查询用户失败：' + error.message);
    return Store._toCamelList(data || []);
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
    const client = await Store._ensureClient();
    const { data: user, error: fetchErr } = await client.from('users').select('role').eq('id', id).single();
    if (fetchErr || !user) throw new Error('用户不存在');
    if (user.role === 'admin') throw new Error('不能删除管理员');
    await Store.delete('users', id);
  },

  async changeOwnPassword(oldPwd, newPwd) {
    const user = this._currentUser;
    if (!user) throw new Error('未登录');
    if (!oldPwd) throw new Error('请输入当前密码');
    if (newPwd.length < 6) throw new Error('新密码长度至少 6 位');

    // 验证旧密码
    const oldHash = await this._hash(oldPwd);
    const client = await Store._ensureClient();
    const { data, error } = await client.from('users').select('password_hash').eq('id', user.id).single();
    if (error) throw new Error('验证失败：' + error.message);
    let storedHash = data.password_hash || '';
    if (storedHash.startsWith('__need_change__:')) {
      storedHash = storedHash.slice('__need_change__:'.length);
    }
    if (oldHash !== storedHash) throw new Error('当前密码错误');

    // 设置新密码
    const newHash = await this._hash(newPwd);
    const { error: updateError } = await client.from('users').update({ password_hash: newHash }).eq('id', user.id);
    if (updateError) throw new Error('密码修改失败：' + updateError.message);

    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async resetPassword(id) {
    if (!this.isAdmin) throw new Error('无权限');
    const hash = await this._hash('88888888');
    const client = await Store._ensureClient();
    await client.from('users').update({ password_hash: '__need_change__:' + hash }).eq('id', id);
  },

  logout() {
    this._currentUser = null;
    sessionStorage.removeItem('aiwei_user');
    location.reload();
  },

  // ===== Getter =====
  get isLoggedIn() { return !!this._currentUser; },
  get isAdmin() { return this._currentUser?.role === 'admin'; },
  get isEditor() { return this._currentUser?.role === 'editor'; },
  get isViewer() { return this._currentUser?.role === 'viewer'; },
  get roleLabel() {
    const map = { admin: '管理员', editor: '编辑者', viewer: '查看者' };
    return map[this._currentUser?.role] || '未知';
  },
  get currentUser() { return this._currentUser; },

  /**
   * 检查当前用户是否有权访问指定模块
   * @param {'revenue'|'expense'|'gallery'|'space'|'reports'|'manage'|'products'|'users'} moduleKey
   */
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
    };
    return (accessMap[moduleKey] || []).includes(role);
  },

  // ===== 内部工具 =====
  async _hash(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
};
