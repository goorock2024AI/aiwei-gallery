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
    if (newPwd.length < 6) throw new Error('密码长度至少 6 位');
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
    await Store.add('users', {
      id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: data.username,
      displayName: data.displayName || data.username,
      role: data.role || 'editor',
      passwordHash: '__need_change__:' + sha256('88888888'),
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

    const oldHash = sha256(oldPwd);
    const data = await this._fetch('GET', '/rest/v1/users?id=eq.' + encodeURIComponent(user.id));
    const userData = Array.isArray(data) ? data[0] : data;
    if (!userData) throw new Error('验证失败');
    let storedHash = userData.passwordHash || '';
    if (storedHash.startsWith('__need_change__:')) {
      storedHash = storedHash.slice('__need_change__:'.length);
    }
    if (oldHash !== storedHash) throw new Error('当前密码错误');

    const newHash = sha256(newPwd);
    await this._fetch('PATCH', '/rest/v1/users?id=eq.' + encodeURIComponent(user.id), { password_hash: newHash });
    user.needPasswordChange = false;
    sessionStorage.setItem('aiwei_user', JSON.stringify(user));
  },

  async resetPassword(id) {
    if (!this.isAdmin) throw new Error('无权限');
    const hash = sha256('88888888');
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

// 工具函数：SHA-256（仅新建用户 / 重置密码时使用）
function sha256(s) {
  const chrsz = 8;
  const K = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2];
  const H = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19];
  const W = new Array(64);
  const str2binb = (s) => { const bin = []; for (let i = 0; i < s.length * chrsz; i += chrsz) bin[i >> 5] |= (s.charCodeAt(i / chrsz) & 0xFF) << (24 - i % 32); return bin; };
  const binb2hex = (bin) => { const hex = '0123456789abcdef'; let str = ''; for (let i = 0; i < bin.length * 4; i++) str += hex[(bin[i >> 2] >> ((3 - i % 4) * 8 + 4)) & 0xF] + hex[(bin[i >> 2] >> ((3 - i % 4) * 8)) & 0xF]; return str; };
  const ROTR = (x, n) => (x >>> n) | (x << (32 - n));
  const S0 = (x) => ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22);
  const S1 = (x) => ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25);
  const s0 = (x) => ROTR(x, 7) ^ ROTR(x, 18) ^ (x >>> 3);
  const s1 = (x) => ROTR(x, 17) ^ ROTR(x, 19) ^ (x >>> 10);
  const Ch = (x, y, z) => (x & y) ^ (~x & z);
  const Maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
  const m = str2binb(s);
  const l = s.length * chrsz;
  m[l >> 5] |= 0x80 << (24 - l % 32);
  m[((l + 64 >> 9) << 4) + 15] = l;
  for (let i = 0; i < m.length; i += 16) {
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let j = 0; j < 64; j++) {
      if (j < 16) W[j] = m[i + j]; else W[j] = (s1(W[j-2]) + W[j-7] + s0(W[j-15]) + W[j-16]) | 0;
      const T1 = (h + S1(e) + Ch(e, f, g) + K[j] + W[j]) | 0;
      const T2 = (S0(a) + Maj(a, b, c)) | 0;
      h = g; g = f; f = e; e = (d + T1) | 0; d = c; c = b; b = a; a = (T1 + T2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return binb2hex(H);
}
